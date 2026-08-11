'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { MEDIA_SCHEMA_VERSION, MAX_MEDIA_FILE_SIZE } = require('../storage/storage-contracts.cjs');
const { SUPPORTED_MEDIA } = require('./media-contracts.cjs');

class MediaImportError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MediaImportError';
    this.code = code;
  }
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new MediaImportError('MEDIA_PATH_INVALID', 'Managed media path escaped the media root.');
  }
  return resolved;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function readHeader(filePath, maxBytes = 256 * 1024) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

function hasPngSignature(buffer) {
  return (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  );
}

function hasJpegSignature(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasIsoBmffSignature(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const boxSize = buffer.readUInt32BE(0);
  return boxSize === 0 || boxSize === 1 || boxSize >= 8;
}

function pngDimensions(buffer) {
  if (!hasPngSignature(buffer)) return { width: null, height: null };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (!hasJpegSignature(buffer)) return { width: null, height: null };
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return { width: null, height: null };
}

function inspectMediaHeader(buffer, extension) {
  if (extension === '.png') {
    const dimensions = pngDimensions(buffer);
    return { valid: dimensions.width !== null && dimensions.height !== null, dimensions };
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    const dimensions = jpegDimensions(buffer);
    return { valid: dimensions.width !== null && dimensions.height !== null, dimensions };
  }
  if (extension === '.mp4' || extension === '.mov') {
    return { valid: hasIsoBmffSignature(buffer), dimensions: { width: null, height: null } };
  }
  return { valid: false, dimensions: { width: null, height: null } };
}

function inspectSignature(buffer, extension) {
  return inspectMediaHeader(buffer, extension).valid;
}

function imageDimensions(buffer, extension) {
  return inspectMediaHeader(buffer, extension).dimensions;
}

function publicSummary(media) {
  const {
    id,
    kind,
    originalFilename,
    fileSize,
    importedAt,
    width,
    height,
    durationSeconds,
    availability
  } = media;
  return { id, kind, originalFilename, fileSize, importedAt, width, height, durationSeconds, availability };
}

class MediaImportService {
  static async open(options) {
    const service = new MediaImportService(options);
    await service.#initialise();
    return service;
  }

  constructor({ rootDirectory, repository, now = () => new Date(), idFactory = randomUUID, faultInjector = () => {} } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) {
      throw new TypeError('rootDirectory must be an absolute trusted path.');
    }
    if (!repository || typeof repository.findMediaByHash !== 'function' || typeof repository.createMediaRecord !== 'function') {
      throw new TypeError('repository must implement the media persistence contract.');
    }
    this.rootDirectory = path.resolve(rootDirectory);
    this.filesDirectory = path.join(this.rootDirectory, 'files');
    this.stagingDirectory = path.join(this.rootDirectory, '.staging');
    this.repository = repository;
    this.now = now;
    this.idFactory = idFactory;
    this.faultInjector = faultInjector;
  }

  async #initialise() {
    await fsp.mkdir(this.filesDirectory, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.stagingDirectory, { recursive: true, mode: 0o700 });
  }

  #timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  async importFile(sourcePath) {
    if (typeof sourcePath !== 'string' || sourcePath.length === 0 || sourcePath.includes('\0') || !path.isAbsolute(sourcePath)) {
      throw new MediaImportError('MEDIA_SOURCE_INVALID', 'Selected media path is invalid.');
    }

    const source = path.resolve(sourcePath);
    let stat;
    try {
      stat = await fsp.lstat(source);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new MediaImportError('MEDIA_SOURCE_MISSING', 'Selected media no longer exists.', { cause: error });
      }
      throw error;
    }
    if (!stat.isFile()) throw new MediaImportError('MEDIA_SOURCE_INVALID', 'Selected media must be a regular file.');
    if (stat.size <= 0 || stat.size > MAX_MEDIA_FILE_SIZE) {
      throw new MediaImportError('MEDIA_SIZE_UNSUPPORTED', 'Selected media size is unsupported.');
    }

    const extension = path.extname(source).toLowerCase();
    const format = SUPPORTED_MEDIA[extension];
    if (!format) throw new MediaImportError('MEDIA_TYPE_UNSUPPORTED', 'Selected media format is not supported.');

    const header = await readHeader(source);
    const inspection = inspectMediaHeader(header, extension);
    if (!inspection.valid) {
      throw new MediaImportError('MEDIA_SIGNATURE_INVALID', 'Selected media content does not match its supported format.');
    }

    const sha256 = await hashFile(source);
    const existing = await this.repository.findMediaByHash(sha256);
    if (existing) return { status: 'duplicate', media: publicSummary(existing) };

    const id = this.idFactory();
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new MediaImportError('MEDIA_ID_INVALID', 'Could not allocate a safe media id.');
    }

    const relativeReference = `files/${id}${format.canonicalExtension}`;
    const finalPath = ensureInside(this.rootDirectory, path.join(this.rootDirectory, ...relativeReference.split('/')));
    const stagingPath = ensureInside(this.stagingDirectory, path.join(this.stagingDirectory, `${id}-${randomUUID()}.part`));
    let finalOwned = false;

    try {
      await pipeline(
        fs.createReadStream(source),
        fs.createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 })
      );
      await this.faultInjector('after-staging-copy');

      const stagedStat = await fsp.stat(stagingPath);
      if (stagedStat.size !== stat.size) {
        throw new MediaImportError('MEDIA_COPY_VERIFY_FAILED', 'Managed media copy size verification failed.');
      }
      const stagedHash = await hashFile(stagingPath);
      if (stagedHash !== sha256) {
        throw new MediaImportError('MEDIA_COPY_VERIFY_FAILED', 'Managed media copy hash verification failed.');
      }

      try {
        await fsp.copyFile(stagingPath, finalPath, fs.constants.COPYFILE_EXCL);
        finalOwned = true;
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new MediaImportError('MEDIA_ID_COLLISION', 'Managed media destination already exists.', { cause: error });
        }
        await fsp.rm(finalPath, { force: true }).catch(() => {});
        throw error;
      }
      await this.faultInjector('after-final-copy');
      await fsp.chmod(finalPath, 0o600).catch(() => {});

      const finalStat = await fsp.stat(finalPath);
      const finalHash = await hashFile(finalPath);
      if (finalStat.size !== stat.size || finalHash !== sha256) {
        throw new MediaImportError('MEDIA_COPY_VERIFY_FAILED', 'Final managed media verification failed.');
      }
      await this.faultInjector('after-final-copy-before-metadata');

      const media = {
        id,
        schemaVersion: MEDIA_SCHEMA_VERSION,
        kind: format.kind,
        originalFilename: path.basename(source),
        managedReference: relativeReference,
        fileSize: stat.size,
        sha256,
        importedAt: this.#timestamp(),
        importMode: 'managed-copy',
        width: inspection.dimensions.width,
        height: inspection.dimensions.height,
        durationSeconds: null,
        container: format.container,
        codec: null,
        availability: 'ready'
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const concurrent = await this.repository.findMediaByHash(sha256);
        if (concurrent) {
          await fsp.rm(finalPath, { force: true });
          finalOwned = false;
          await fsp.rm(stagingPath, { force: true }).catch(() => {});
          return { status: 'duplicate', media: publicSummary(concurrent) };
        }
        try {
          const committed = await this.repository.createMediaRecord({
            expectedRevision: this.repository.getStorageSummary().revision,
            media
          });
          await fsp.rm(stagingPath, { force: true }).catch(() => {});
          return { status: 'imported', media: publicSummary(committed.media) };
        } catch (error) {
          if (error?.code === 'STORAGE_CONFLICT' && attempt === 0) continue;
          if (error?.code === 'MEDIA_DUPLICATE') {
            const duplicate = await this.repository.findMediaByHash(sha256);
            if (duplicate) {
              await fsp.rm(finalPath, { force: true });
              finalOwned = false;
              await fsp.rm(stagingPath, { force: true }).catch(() => {});
              return { status: 'duplicate', media: publicSummary(duplicate) };
            }
          }
          throw error;
        }
      }
      throw new MediaImportError('MEDIA_IMPORT_FAILED', 'Media metadata could not be committed safely.');
    } catch (error) {
      await fsp.rm(stagingPath, { force: true }).catch(() => {});
      if (finalOwned) await fsp.rm(finalPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async listMedia() {
    return this.repository.listMedia();
  }

  async attachMediaToProject(request) {
    return this.repository.attachMediaToProject(request);
  }

  async detachMediaFromProject(request) {
    return this.repository.detachMediaFromProject(request);
  }
}

module.exports = {
  MediaImportError,
  MediaImportService,
  ensureInside,
  hashFile,
  imageDimensions,
  inspectSignature,
  publicSummary
};

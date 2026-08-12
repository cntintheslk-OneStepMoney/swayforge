'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const PREVIEW_CACHE_SCHEMA_VERSION = 1;
const PREVIEW_ARTIFACT_VERSION = 1;
const DEFAULT_MAX_DIMENSION = 512;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_QUEUE_SIZE = 128;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class MediaPreviewError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MediaPreviewError';
    this.code = code;
  }
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new MediaPreviewError('PREVIEW_PATH_INVALID', 'Preview path escaped its trusted root.');
  }
  return resolved;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

function artifactKindFor(media) {
  if (media?.kind === 'image') return 'image-thumbnail';
  if (media?.kind === 'video') return 'video-poster';
  throw new MediaPreviewError('PREVIEW_MEDIA_UNSUPPORTED', 'This media kind does not support a local preview.');
}

function createArtifactId({ mediaId, sourceHash, artifactKind, artifactVersion, generatorVersion }) {
  if (typeof mediaId !== 'string' || typeof sourceHash !== 'string' || typeof artifactKind !== 'string') {
    throw new TypeError('Preview artifact identity inputs are invalid.');
  }
  return createHash('sha256')
    .update(JSON.stringify({ mediaId, sourceHash, artifactKind, artifactVersion, generatorVersion }))
    .digest('hex');
}

function createEmptyIndex(generatorVersion) {
  return {
    schemaVersion: PREVIEW_CACHE_SCHEMA_VERSION,
    generatorVersion,
    artifacts: {}
  };
}

function isIndexShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.schemaVersion !== PREVIEW_CACHE_SCHEMA_VERSION || typeof value.generatorVersion !== 'string') return false;
  if (!value.artifacts || typeof value.artifacts !== 'object' || Array.isArray(value.artifacts)) return false;
  return Object.values(value.artifacts).every((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    if (typeof record.artifactId !== 'string' || !/^[a-f0-9]{64}$/.test(record.artifactId)) return false;
    if (typeof record.mediaId !== 'string' || typeof record.sourceHash !== 'string') return false;
    if (!['image-thumbnail', 'video-poster'].includes(record.kind)) return false;
    if (!['ready', 'failed'].includes(record.status)) return false;
    if (record.relativePath !== null && typeof record.relativePath !== 'string') return false;
    return true;
  });
}

function publicPreviewSummary(record, { reused = false } = {}) {
  return Object.freeze({
    mediaId: record.mediaId,
    artifactId: record.artifactId,
    kind: record.kind,
    status: record.status,
    width: Number.isFinite(record.width) ? record.width : null,
    height: Number.isFinite(record.height) ? record.height : null,
    durationSeconds: Number.isFinite(record.durationSeconds) ? record.durationSeconds : null,
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : null,
    url: record.status === 'ready' ? `swayforge-preview://artifact/${record.artifactId}` : null,
    reused
  });
}

class MediaPreviewService {
  static async open(options) {
    const service = new MediaPreviewService(options);
    await service.#initialise();
    return service;
  }

  constructor({
    rootDirectory,
    mediaRootDirectory,
    repository,
    generators,
    generatorVersion = 'swayforge-preview-v1',
    now = () => new Date(),
    maxDimension = DEFAULT_MAX_DIMENSION,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
    maxQueueSize = DEFAULT_MAX_QUEUE_SIZE
  } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) {
      throw new TypeError('rootDirectory must be an absolute trusted path.');
    }
    if (typeof mediaRootDirectory !== 'string' || !path.isAbsolute(mediaRootDirectory)) {
      throw new TypeError('mediaRootDirectory must be an absolute trusted path.');
    }
    if (!repository || typeof repository.getMediaRecord !== 'function') {
      throw new TypeError('repository must provide getMediaRecord(mediaId).');
    }
    if (!generators || typeof generators.imageThumbnail !== 'function' || typeof generators.videoPoster !== 'function') {
      throw new TypeError('generators must provide imageThumbnail and videoPoster functions.');
    }
    if (typeof generatorVersion !== 'string' || generatorVersion.length === 0 || generatorVersion.length > 160) {
      throw new TypeError('generatorVersion is invalid.');
    }
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 64 || maxDimension > 2048) {
      throw new TypeError('maxDimension is invalid.');
    }
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8) {
      throw new TypeError('maxConcurrency is invalid.');
    }
    if (!Number.isSafeInteger(maxQueueSize) || maxQueueSize < maxConcurrency || maxQueueSize > 1000) {
      throw new TypeError('maxQueueSize is invalid.');
    }

    this.rootDirectory = path.resolve(rootDirectory);
    this.mediaRootDirectory = path.resolve(mediaRootDirectory);
    this.artifactsDirectory = path.join(this.rootDirectory, 'artifacts');
    this.stagingDirectory = path.join(this.rootDirectory, '.staging');
    this.indexPath = path.join(this.rootDirectory, 'preview-index.json');
    this.repository = repository;
    this.generators = generators;
    this.generatorVersion = generatorVersion;
    this.now = now;
    this.maxDimension = maxDimension;
    this.maxConcurrency = maxConcurrency;
    this.maxQueueSize = maxQueueSize;
    this.index = createEmptyIndex(generatorVersion);
    this.queue = [];
    this.runningCount = 0;
    this.shuttingDown = false;
    this.inFlight = new Map();
    this.runningControllers = new Set();
    this.indexWriteTail = Promise.resolve();
  }

  async #initialise() {
    await fsp.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.artifactsDirectory, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.stagingDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.indexPath, 'utf8'));
      if (!isIndexShape(parsed) || parsed.generatorVersion !== this.generatorVersion) {
        await this.#quarantineIndex();
        this.index = createEmptyIndex(this.generatorVersion);
      } else {
        this.index = parsed;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') await this.#quarantineIndex();
      this.index = createEmptyIndex(this.generatorVersion);
    }
    await this.#cleanupStaging();
  }

  #timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  async #quarantineIndex() {
    try {
      await fsp.rename(this.indexPath, path.join(this.rootDirectory, `preview-index.corrupt-${Date.now()}-${randomUUID()}.json`));
    } catch (error) {
      if (error?.code !== 'ENOENT') await fsp.rm(this.indexPath, { force: true }).catch(() => {});
    }
  }

  async #cleanupStaging() {
    const entries = await fsp.readdir(this.stagingDirectory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.isFile()).map((entry) =>
      fsp.rm(ensureInside(this.stagingDirectory, path.join(this.stagingDirectory, entry.name)), { force: true }).catch(() => {})
    ));
  }

  async #persistIndex() {
    const snapshot = JSON.stringify(this.index, null, 2);
    const write = async () => {
      const temporary = ensureInside(this.rootDirectory, path.join(this.rootDirectory, `.preview-index-${randomUUID()}.tmp`));
      try {
        await fsp.writeFile(temporary, `${snapshot}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        try {
          await fsp.rename(temporary, this.indexPath);
        } catch (error) {
          if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
          await fsp.rm(this.indexPath, { force: true });
          await fsp.rename(temporary, this.indexPath);
        }
      } finally {
        await fsp.rm(temporary, { force: true }).catch(() => {});
      }
    };
    this.indexWriteTail = this.indexWriteTail.then(write, write);
    return this.indexWriteTail;
  }

  #resolveManagedSource(media) {
    if (media.importMode !== 'managed-copy' || typeof media.managedReference !== 'string') {
      throw new MediaPreviewError('PREVIEW_SOURCE_UNAVAILABLE', 'Preview generation requires trusted managed media.');
    }
    const segments = media.managedReference.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
      throw new MediaPreviewError('PREVIEW_PATH_INVALID', 'Managed media reference is invalid.');
    }
    return ensureInside(this.mediaRootDirectory, path.join(this.mediaRootDirectory, ...segments));
  }

  #artifactRelativePath(artifactId) {
    return `artifacts/${artifactId}.png`;
  }

  #artifactPath(recordOrId) {
    const relativePath = typeof recordOrId === 'string'
      ? this.#artifactRelativePath(recordOrId)
      : recordOrId.relativePath;
    if (typeof relativePath !== 'string') throw new MediaPreviewError('PREVIEW_PATH_INVALID', 'Preview artifact path is invalid.');
    return ensureInside(this.rootDirectory, path.join(this.rootDirectory, ...relativePath.split('/')));
  }

  async #isHealthyArtifact(record) {
    if (record?.status !== 'ready' || typeof record.relativePath !== 'string') return false;
    try {
      const artifactPath = this.#artifactPath(record);
      const stat = await fsp.stat(artifactPath);
      if (!stat.isFile() || stat.size <= PNG_SIGNATURE.length) return false;
      const handle = await fsp.open(artifactPath, 'r');
      try {
        const header = Buffer.alloc(PNG_SIGNATURE.length);
        await handle.read(header, 0, header.length, 0);
        return header.equals(PNG_SIGNATURE);
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }

  async requestPreview(mediaId, { force = false } = {}) {
    if (this.shuttingDown) throw new MediaPreviewError('PREVIEW_SHUTDOWN', 'Preview generation is shutting down.');
    if (typeof mediaId !== 'string' || mediaId.length === 0 || mediaId.length > 128) {
      throw new TypeError('mediaId is invalid.');
    }
    if (typeof force !== 'boolean') throw new TypeError('force must be a boolean.');

    const snapshot = await this.repository.getMediaRecord(mediaId);
    const media = snapshot?.media;
    if (!media || media.id !== mediaId) throw new MediaPreviewError('PREVIEW_MEDIA_NOT_FOUND', 'Media record is unavailable.');
    if (media.availability !== 'ready') throw new MediaPreviewError('PREVIEW_SOURCE_UNAVAILABLE', 'Media is not currently available for preview generation.');
    if (typeof media.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(media.sha256)) {
      throw new MediaPreviewError('PREVIEW_SOURCE_INVALID', 'Media content identity is invalid.');
    }

    const kind = artifactKindFor(media);
    const artifactId = createArtifactId({
      mediaId,
      sourceHash: media.sha256,
      artifactKind: kind,
      artifactVersion: PREVIEW_ARTIFACT_VERSION,
      generatorVersion: this.generatorVersion
    });
    const existing = this.index.artifacts[artifactId];
    if (!force && existing && await this.#isHealthyArtifact(existing)) {
      return publicPreviewSummary(existing, { reused: true });
    }

    const inFlight = this.inFlight.get(artifactId);
    if (inFlight) return inFlight;
    if (this.queue.length + this.runningCount >= this.maxQueueSize) {
      throw new MediaPreviewError('PREVIEW_QUEUE_FULL', 'The local preview queue is full.');
    }

    const promise = new Promise((resolve, reject) => {
      this.queue.push({ artifactId, kind, media, force, resolve, reject });
      this.#pump();
    });
    this.inFlight.set(artifactId, promise);
    promise.finally(() => this.inFlight.delete(artifactId)).catch(() => {});
    return promise;
  }

  #pump() {
    while (!this.shuttingDown && this.runningCount < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.runningCount += 1;
      void this.#runJob(job)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.runningCount -= 1;
          this.#pump();
        });
    }
  }

  async #runJob(job) {
    const controller = new AbortController();
    this.runningControllers.add(controller);
    const stagingPath = ensureInside(this.stagingDirectory, path.join(this.stagingDirectory, `${job.artifactId}-${randomUUID()}.part`));
    const finalPath = this.#artifactPath(job.artifactId);
    try {
      if (this.shuttingDown) throw new MediaPreviewError('PREVIEW_CANCELLED', 'Preview generation was cancelled.');
      const sourcePath = this.#resolveManagedSource(job.media);
      const stat = await fsp.stat(sourcePath).catch((error) => {
        if (error?.code === 'ENOENT') throw new MediaPreviewError('PREVIEW_SOURCE_UNAVAILABLE', 'Managed media is missing.', { cause: error });
        throw error;
      });
      if (!stat.isFile()) throw new MediaPreviewError('PREVIEW_SOURCE_UNAVAILABLE', 'Managed media is not a regular file.');
      if (Number.isSafeInteger(job.media.fileSize) && stat.size !== job.media.fileSize) {
        throw new MediaPreviewError('PREVIEW_SOURCE_CHANGED', 'Managed media size no longer matches its authoritative record.');
      }
      const sourceHash = await hashFile(sourcePath);
      if (sourceHash !== job.media.sha256) {
        throw new MediaPreviewError('PREVIEW_SOURCE_CHANGED', 'Managed media content no longer matches its authoritative hash.');
      }

      const generator = job.kind === 'image-thumbnail' ? this.generators.imageThumbnail : this.generators.videoPoster;
      const result = await generator({
        sourcePath,
        outputPath: stagingPath,
        maxDimension: this.maxDimension,
        signal: controller.signal
      });
      if (controller.signal.aborted || this.shuttingDown) {
        throw new MediaPreviewError('PREVIEW_CANCELLED', 'Preview generation was cancelled.');
      }

      const stagedRecord = {
        artifactId: job.artifactId,
        mediaId: job.media.id,
        sourceHash: job.media.sha256,
        kind: job.kind,
        artifactVersion: PREVIEW_ARTIFACT_VERSION,
        generatorVersion: this.generatorVersion,
        relativePath: this.#artifactRelativePath(job.artifactId),
        status: 'ready',
        width: Number.isFinite(result?.width) ? result.width : null,
        height: Number.isFinite(result?.height) ? result.height : null,
        durationSeconds: Number.isFinite(result?.durationSeconds) ? result.durationSeconds : null,
        generatedAt: this.#timestamp()
      };
      const stagingHealthRecord = { ...stagedRecord, relativePath: path.relative(this.rootDirectory, stagingPath).split(path.sep).join('/') };
      if (!await this.#isHealthyArtifact(stagingHealthRecord)) {
        throw new MediaPreviewError('PREVIEW_GENERATION_INVALID', 'Generated preview was missing or corrupt.');
      }

      await fsp.rm(finalPath, { force: true });
      await fsp.rename(stagingPath, finalPath);
      await fsp.chmod(finalPath, 0o600).catch(() => {});

      const oldRecords = Object.values(this.index.artifacts).filter((record) =>
        record.mediaId === job.media.id && record.kind === job.kind && record.artifactId !== job.artifactId
      );
      this.index.artifacts[job.artifactId] = stagedRecord;
      for (const oldRecord of oldRecords) delete this.index.artifacts[oldRecord.artifactId];
      await this.#persistIndex();
      await Promise.all(oldRecords.map((record) => {
        if (typeof record.relativePath !== 'string') return Promise.resolve();
        return fsp.rm(this.#artifactPath(record), { force: true }).catch(() => {});
      }));
      return publicPreviewSummary(stagedRecord, { reused: false });
    } catch (error) {
      const failedRecord = {
        artifactId: job.artifactId,
        mediaId: job.media.id,
        sourceHash: job.media.sha256,
        kind: job.kind,
        artifactVersion: PREVIEW_ARTIFACT_VERSION,
        generatorVersion: this.generatorVersion,
        relativePath: null,
        status: 'failed',
        width: null,
        height: null,
        durationSeconds: null,
        generatedAt: this.#timestamp()
      };
      this.index.artifacts[job.artifactId] = failedRecord;
      await this.#persistIndex().catch(() => {});
      if (error instanceof MediaPreviewError) throw error;
      throw new MediaPreviewError('PREVIEW_GENERATION_FAILED', 'Local preview generation failed.', { cause: error });
    } finally {
      this.runningControllers.delete(controller);
      await fsp.rm(stagingPath, { force: true }).catch(() => {});
    }
  }

  async resolveArtifact(artifactId) {
    if (typeof artifactId !== 'string' || !/^[a-f0-9]{64}$/.test(artifactId)) return null;
    const record = this.index.artifacts[artifactId];
    if (!record || !await this.#isHealthyArtifact(record)) return null;
    return Object.freeze({
      artifactId,
      filePath: this.#artifactPath(record),
      contentType: 'image/png'
    });
  }

  async clearMediaCache(mediaId) {
    if (typeof mediaId !== 'string' || mediaId.length === 0) throw new TypeError('mediaId is invalid.');
    const records = Object.values(this.index.artifacts).filter((record) => record.mediaId === mediaId);
    for (const record of records) delete this.index.artifacts[record.artifactId];
    await this.#persistIndex();
    await Promise.all(records.map((record) => {
      if (typeof record.relativePath !== 'string') return Promise.resolve();
      return fsp.rm(this.#artifactPath(record), { force: true }).catch(() => {});
    }));
    return Object.freeze({ mediaId, removed: records.length });
  }

  shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const error = new MediaPreviewError('PREVIEW_CANCELLED', 'Preview generation was cancelled during shutdown.');
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const controller of this.runningControllers) controller.abort();
  }

  getStatus() {
    return Object.freeze({
      running: this.runningCount,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency,
      maxQueueSize: this.maxQueueSize,
      shuttingDown: this.shuttingDown
    });
  }
}

module.exports = {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_DIMENSION,
  DEFAULT_MAX_QUEUE_SIZE,
  MediaPreviewError,
  MediaPreviewService,
  PREVIEW_ARTIFACT_VERSION,
  PREVIEW_CACHE_SCHEMA_VERSION,
  PNG_SIGNATURE,
  artifactKindFor,
  createArtifactId,
  ensureInside,
  hashFile,
  publicPreviewSummary
};

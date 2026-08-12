'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const HEADER_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class MediaIntegrityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MediaIntegrityError';
    this.code = code;
  }
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new MediaIntegrityError('MEDIA_INTEGRITY_PATH_INVALID', 'Managed media path escaped the trusted media root.');
  }
  return resolved;
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new MediaIntegrityError('MEDIA_INTEGRITY_CANCELLED', 'Media integrity scan was cancelled safely.');
}

async function hashFile(filePath, signal) {
  abortIfNeeded(signal);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    abortIfNeeded(signal);
    hash.update(chunk);
  }
  abortIfNeeded(signal);
  return hash.digest('hex');
}

async function readHeader(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, HEADER_BYTES);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

function validSignature(buffer, extension) {
  const ext = String(extension || '').toLowerCase();
  if (ext === '.png') return buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE) && buffer.toString('ascii', 12, 16) === 'IHDR';
  if (ext === '.jpg' || ext === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === '.mp4' || ext === '.mov') {
    if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
    const size = buffer.readUInt32BE(0);
    return size === 0 || size === 1 || size >= 8;
  }
  return false;
}

module.exports = {
  MediaIntegrityError,
  PNG_SIGNATURE,
  abortIfNeeded,
  ensureInside,
  hashFile,
  readHeader,
  validSignature
};

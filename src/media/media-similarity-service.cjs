'use strict';

const nodeFs = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const {
  MEDIA_SIMILARITY_METHOD_VERSION,
  MEDIA_SIMILARITY_SCHEMA_VERSION
} = require('./media-similarity-contracts.cjs');

const CACHE_FILENAME = 'fingerprints.json';
const DEFAULT_MAX_CANDIDATE_COMPARISONS = 128;
const HIGHLY_SIMILAR_THRESHOLD = 0.9;
const RELATED_THRESHOLD = 0.72;

class MediaSimilarityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MediaSimilarityError';
    this.code = code;
  }
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new MediaSimilarityError('SIMILARITY_PATH_INVALID', 'Managed media path escaped its trusted root.');
  }
  return resolved;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of nodeFs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

function hammingSimilarity(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) {
    throw new TypeError('Perceptual hashes must be 64-bit hexadecimal strings.');
  }
  let distance = 0;
  for (let index = 0; index < 16; index += 1) {
    let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return 1 - (distance / 64);
}

function fingerprintSimilarity(left, right) {
  if (!left || !right || left.kind !== right.kind || !Array.isArray(left.hashes) || !Array.isArray(right.hashes)) return 0;
  if (left.hashes.length === 0 || right.hashes.length === 0) return 0;
  if (left.kind === 'image') {
    let best = 0;
    for (const a of left.hashes) for (const b of right.hashes) best = Math.max(best, hammingSimilarity(a, b));
    return best;
  }
  const count = Math.min(left.hashes.length, right.hashes.length);
  if (count === 0) return 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) total += hammingSimilarity(left.hashes[index], right.hashes[index]);
  return total / count;
}

function aspectRatio(media) {
  return Number.isFinite(media?.width) && Number.isFinite(media?.height) && media.width > 0 && media.height > 0
    ? media.width / media.height
    : null;
}

function coarseCandidateDistance(source, candidate) {
  const sourceRatio = aspectRatio(source);
  const candidateRatio = aspectRatio(candidate);
  const ratioDistance = sourceRatio && candidateRatio ? Math.abs(Math.log(sourceRatio / candidateRatio)) : 0.4;
  const durationDistance = source.kind === 'video' && Number.isFinite(source.durationSeconds) && Number.isFinite(candidate.durationSeconds)
    ? Math.abs(source.durationSeconds - candidate.durationSeconds) / Math.max(1, source.durationSeconds, candidate.durationSeconds)
    : 0;
  return ratioDistance + durationDistance;
}

function isPlausibleCandidate(source, candidate) {
  if (!candidate || source.id === candidate.id || source.kind !== candidate.kind || candidate.availability !== 'ready') return false;
  const sourceRatio = aspectRatio(source);
  const candidateRatio = aspectRatio(candidate);
  if (sourceRatio && candidateRatio && Math.abs(Math.log(sourceRatio / candidateRatio)) > 0.42) return false;
  if (source.kind === 'video' && Number.isFinite(source.durationSeconds) && Number.isFinite(candidate.durationSeconds)) {
    const relativeDelta = Math.abs(source.durationSeconds - candidate.durationSeconds) / Math.max(1, source.durationSeconds, candidate.durationSeconds);
    if (relativeDelta > 0.3) return false;
  }
  return true;
}

function publicResult(source, candidate, category, score, method, version, explanation) {
  return Object.freeze({
    sourceMediaId: source.id,
    candidateMediaId: candidate.id,
    category,
    score: Number(score.toFixed(4)),
    method,
    version,
    explanation
  });
}

function groupResults(results) {
  return Object.freeze([
    Object.freeze({ category: 'exact-duplicate', results: Object.freeze(results.filter((item) => item.category === 'exact-duplicate')) }),
    Object.freeze({ category: 'highly-similar', results: Object.freeze(results.filter((item) => item.category === 'highly-similar')) }),
    Object.freeze({ category: 'related', results: Object.freeze(results.filter((item) => item.category === 'related')) })
  ]);
}

class MediaSimilarityService {
  static async open(options) {
    const service = new MediaSimilarityService(options);
    await service.initialise();
    return service;
  }

  constructor({
    rootDirectory,
    mediaRootDirectory,
    repository,
    fingerprintProvider,
    methodVersion = MEDIA_SIMILARITY_METHOD_VERSION,
    maxCandidateComparisons = DEFAULT_MAX_CANDIDATE_COMPARISONS
  } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) throw new TypeError('rootDirectory must be an absolute trusted path.');
    if (typeof mediaRootDirectory !== 'string' || !path.isAbsolute(mediaRootDirectory)) throw new TypeError('mediaRootDirectory must be an absolute trusted path.');
    if (!repository || typeof repository.listMedia !== 'function' || typeof repository.getMediaRecord !== 'function') throw new TypeError('repository is invalid.');
    if (typeof fingerprintProvider !== 'function') throw new TypeError('fingerprintProvider is required.');
    if (typeof methodVersion !== 'string' || methodVersion.length === 0 || methodVersion.length > 160) throw new TypeError('methodVersion is invalid.');
    if (!Number.isSafeInteger(maxCandidateComparisons) || maxCandidateComparisons < 1 || maxCandidateComparisons > 1000) throw new TypeError('maxCandidateComparisons is invalid.');
    this.rootDirectory = path.resolve(rootDirectory);
    this.mediaRootDirectory = path.resolve(mediaRootDirectory);
    this.cachePath = path.join(this.rootDirectory, CACHE_FILENAME);
    this.repository = repository;
    this.fingerprintProvider = fingerprintProvider;
    this.methodVersion = methodVersion;
    this.maxCandidateComparisons = maxCandidateComparisons;
    this.fingerprints = new Map();
    this.lastCleanupRemoved = 0;
    this.writeTail = Promise.resolve();
  }

  async initialise() {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fs.readFile(this.cachePath, 'utf8'));
      if (!parsed || parsed.schemaVersion !== MEDIA_SIMILARITY_SCHEMA_VERSION || parsed.methodVersion !== this.methodVersion || !Array.isArray(parsed.fingerprints)) {
        throw Object.assign(new Error('Similarity cache is stale.'), { code: 'SIMILARITY_CACHE_STALE' });
      }
      this.fingerprints = new Map(parsed.fingerprints.map((record) => [record.cacheKey, Object.freeze(record)]));
    } catch (error) {
      if (error?.code !== 'ENOENT') await this.quarantineCache().catch(() => {});
      this.fingerprints = new Map();
      await this.persist();
    }
  }

  async quarantineCache() {
    const destination = path.join(this.rootDirectory, `fingerprints.stale-${Date.now()}-${randomUUID()}.json`);
    await fs.rename(this.cachePath, destination).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  cacheKey(media) {
    if (typeof media?.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(media.sha256)) {
      throw new MediaSimilarityError('SIMILARITY_SOURCE_INVALID', 'Media content hash is invalid.');
    }
    return `${media.sha256.toLowerCase()}:${this.methodVersion}`;
  }

  resolveManagedSource(media) {
    if (media.importMode !== 'managed-copy' || typeof media.managedReference !== 'string') {
      throw new MediaSimilarityError('SIMILARITY_SOURCE_UNAVAILABLE', 'Similarity requires trusted managed media.');
    }
    const segments = media.managedReference.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
      throw new MediaSimilarityError('SIMILARITY_PATH_INVALID', 'Managed media reference is invalid.');
    }
    return ensureInside(this.mediaRootDirectory, path.join(this.mediaRootDirectory, ...segments));
  }

  async verifyManagedSource(media) {
    const sourcePath = this.resolveManagedSource(media);
    const stat = await fs.stat(sourcePath).catch((error) => {
      if (error?.code === 'ENOENT') throw new MediaSimilarityError('SIMILARITY_SOURCE_UNAVAILABLE', 'Managed media is missing.', { cause: error });
      throw error;
    });
    if (!stat.isFile()) throw new MediaSimilarityError('SIMILARITY_SOURCE_UNAVAILABLE', 'Managed media is not a regular file.');
    if (Number.isSafeInteger(media.fileSize) && stat.size !== media.fileSize) {
      throw new MediaSimilarityError('SIMILARITY_SOURCE_CHANGED', 'Managed media size no longer matches its authoritative record.');
    }
    if (await hashFile(sourcePath) !== media.sha256.toLowerCase()) {
      throw new MediaSimilarityError('SIMILARITY_SOURCE_CHANGED', 'Managed media content no longer matches its authoritative hash.');
    }
    return sourcePath;
  }

  async getFingerprint(media, { persist = true } = {}) {
    const cacheKey = this.cacheKey(media);
    const existing = this.fingerprints.get(cacheKey);
    if (existing?.fingerprint?.kind === media.kind) return existing.fingerprint;
    const sourcePath = await this.verifyManagedSource(media);
    const fingerprint = await this.fingerprintProvider({ media, sourcePath, methodVersion: this.methodVersion });
    if (!fingerprint || fingerprint.kind !== media.kind || !Array.isArray(fingerprint.hashes) || fingerprint.hashes.length === 0) {
      throw new MediaSimilarityError('SIMILARITY_FINGERPRINT_INVALID', 'Perceptual fingerprint provider returned invalid data.');
    }
    if (fingerprint.hashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{16}$/i.test(hash))) {
      throw new MediaSimilarityError('SIMILARITY_FINGERPRINT_INVALID', 'Perceptual fingerprint hash is invalid.');
    }
    this.fingerprints.set(cacheKey, Object.freeze({
      cacheKey,
      sourceHash: media.sha256.toLowerCase(),
      methodVersion: this.methodVersion,
      kind: media.kind,
      fingerprint: Object.freeze({ kind: fingerprint.kind, hashes: Object.freeze([...fingerprint.hashes]) })
    }));
    if (persist) await this.persist();
    return this.fingerprints.get(cacheKey).fingerprint;
  }

  async loadFullMedia() {
    const snapshot = await this.repository.listMedia();
    const records = [];
    for (const summary of snapshot.media ?? []) {
      try {
        const record = await this.repository.getMediaRecord(summary.id);
        if (record?.media) records.push(record.media);
      } catch (error) {
        if (error?.code !== 'MEDIA_NOT_FOUND') throw error;
      }
    }
    return records;
  }

  async cleanupForActiveMedia(mediaItems) {
    const active = new Set(mediaItems.filter((item) => item?.availability === 'ready').map((item) => {
      try { return this.cacheKey(item); } catch { return null; }
    }).filter(Boolean));
    let removed = 0;
    for (const key of this.fingerprints.keys()) {
      if (!active.has(key)) {
        this.fingerprints.delete(key);
        removed += 1;
      }
    }
    this.lastCleanupRemoved = removed;
    if (removed > 0) await this.persist();
    return removed;
  }

  async persist() {
    const snapshot = `${JSON.stringify({
      schemaVersion: MEDIA_SIMILARITY_SCHEMA_VERSION,
      methodVersion: this.methodVersion,
      fingerprints: [...this.fingerprints.values()].sort((a, b) => a.cacheKey.localeCompare(b.cacheKey))
    }, null, 2)}\n`;
    const write = async () => {
      const staging = `${this.cachePath}.staging-${process.pid}-${randomUUID()}`;
      try {
        await fs.writeFile(staging, snapshot, { mode: 0o600, flag: 'wx' });
        try {
          await fs.rename(staging, this.cachePath);
        } catch (error) {
          if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
          await fs.rm(this.cachePath, { force: true });
          await fs.rename(staging, this.cachePath);
        }
      } finally {
        await fs.rm(staging, { force: true }).catch(() => {});
      }
    };
    this.writeTail = this.writeTail.then(write, write);
    return this.writeTail;
  }

  getStatus() {
    return Object.freeze({
      schemaVersion: MEDIA_SIMILARITY_SCHEMA_VERSION,
      methodVersion: this.methodVersion,
      fingerprintCount: this.fingerprints.size,
      maxCandidateComparisons: this.maxCandidateComparisons,
      lastCleanupRemoved: this.lastCleanupRemoved,
      localOnly: true,
      rebuildable: true,
      destructiveActions: false
    });
  }

  async rebuild() {
    const mediaItems = await this.loadFullMedia();
    this.fingerprints.clear();
    for (const media of mediaItems) {
      if (media.availability !== 'ready') continue;
      await this.getFingerprint(media, { persist: false });
    }
    await this.persist();
    await this.cleanupForActiveMedia(mediaItems);
    return this.getStatus();
  }

  async findSimilar({ mediaId, limit = 24, includeRelated = true } = {}) {
    const sourceSnapshot = await this.repository.getMediaRecord(mediaId);
    const source = sourceSnapshot?.media;
    if (!source || source.id !== mediaId) throw new MediaSimilarityError('MEDIA_NOT_FOUND', 'Source media no longer exists.');
    if (source.availability !== 'ready') throw new MediaSimilarityError('SIMILARITY_SOURCE_UNAVAILABLE', 'Source media is not available.');
    const allMedia = await this.loadFullMedia();
    await this.cleanupForActiveMedia(allMedia);

    const candidates = allMedia
      .filter((candidate) => isPlausibleCandidate(source, candidate))
      .sort((a, b) => coarseCandidateDistance(source, a) - coarseCandidateDistance(source, b) || a.id.localeCompare(b.id));
    const bounded = candidates.slice(0, this.maxCandidateComparisons);
    const results = [];
    let sourceFingerprint = null;

    for (const candidate of bounded) {
      if (candidate.sha256 === source.sha256) {
        results.push(publicResult(source, candidate, 'exact-duplicate', 1, 'sha256', 'authoritative-v1', 'identical content hash'));
        continue;
      }
      sourceFingerprint ??= await this.getFingerprint(source);
      const score = fingerprintSimilarity(sourceFingerprint, await this.getFingerprint(candidate));
      if (score >= HIGHLY_SIMILAR_THRESHOLD) {
        results.push(publicResult(source, candidate, 'highly-similar', score, 'dhash-multisample', this.methodVersion, source.kind === 'image' ? 'same-looking image' : 'similar sampled frames'));
      } else if (includeRelated && score >= RELATED_THRESHOLD) {
        results.push(publicResult(source, candidate, 'related', score, 'dhash-multisample', this.methodVersion, source.kind === 'image' ? 'visually related image' : 'related sampled frames'));
      }
    }

    const rank = Object.freeze({ 'exact-duplicate': 0, 'highly-similar': 1, related: 2 });
    results.sort((a, b) => rank[a.category] - rank[b.category] || b.score - a.score || a.candidateMediaId.localeCompare(b.candidateMediaId));
    const limited = Object.freeze(results.slice(0, limit));
    return Object.freeze({
      sourceMediaId: source.id,
      methodVersion: this.methodVersion,
      candidatePoolSize: candidates.length,
      comparisonsPerformed: bounded.length,
      comparisonLimit: this.maxCandidateComparisons,
      destructiveActions: false,
      groups: groupResults(limited),
      results: limited
    });
  }
}

module.exports = {
  DEFAULT_MAX_CANDIDATE_COMPARISONS,
  HIGHLY_SIMILAR_THRESHOLD,
  MediaSimilarityError,
  MediaSimilarityService,
  RELATED_THRESHOLD,
  coarseCandidateDistance,
  fingerprintSimilarity,
  hammingSimilarity,
  isPlausibleCandidate
};

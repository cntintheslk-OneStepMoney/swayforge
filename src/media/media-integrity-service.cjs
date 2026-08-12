'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MAX_SCAN_ITEMS } = require('./media-integrity-contracts.cjs');
const { MediaIntegrityDerived } = require('./media-integrity-derived.cjs');
const { repairManagedMedia } = require('./media-integrity-repair.cjs');
const {
  MediaIntegrityError,
  abortIfNeeded,
  ensureInside,
  hashFile,
  readHeader,
  validSignature
} = require('./media-integrity-files.cjs');

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILENAME = 'integrity-cache.json';

function createEmptyCache() {
  return { schemaVersion: CACHE_SCHEMA_VERSION, records: {} };
}

class MediaIntegrityService {
  static async open(options) {
    const service = new MediaIntegrityService(options);
    await service.initialise();
    return service;
  }

  constructor({
    mediaRootDirectory,
    cacheDirectory,
    previewCacheDirectory,
    aiDirectory,
    repository,
    previewService,
    indexService,
    similarityService,
    aiAnalysisService,
    now = () => new Date(),
    maxScanItems = MAX_SCAN_ITEMS
  } = {}) {
    for (const [label, value] of [['mediaRootDirectory', mediaRootDirectory], ['cacheDirectory', cacheDirectory]]) {
      if (typeof value !== 'string' || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute trusted path.`);
    }
    if (!repository || typeof repository.listMedia !== 'function' || typeof repository.getMediaRecord !== 'function' || typeof repository.getStorageSummary !== 'function') {
      throw new TypeError('repository does not implement the media integrity persistence contract.');
    }
    if (!previewService || typeof previewService.clearMediaCache !== 'function' || typeof previewService.requestPreview !== 'function') throw new TypeError('previewService is invalid.');
    if (!indexService || typeof indexService.rebuild !== 'function' || typeof indexService.getStatus !== 'function') throw new TypeError('indexService is invalid.');
    if (!similarityService || typeof similarityService.rebuild !== 'function' || typeof similarityService.getStatus !== 'function') throw new TypeError('similarityService is invalid.');
    if (!aiAnalysisService || typeof aiAnalysisService.analyse !== 'function') throw new TypeError('aiAnalysisService is invalid.');
    if (!Number.isSafeInteger(maxScanItems) || maxScanItems < 1 || maxScanItems > MAX_SCAN_ITEMS) throw new TypeError('maxScanItems is invalid.');

    this.mediaRootDirectory = path.resolve(mediaRootDirectory);
    this.cacheDirectory = path.resolve(cacheDirectory);
    this.cachePath = path.join(this.cacheDirectory, CACHE_FILENAME);
    this.repairStagingDirectory = path.join(this.mediaRootDirectory, '.repair-staging');
    this.repository = repository;
    this.now = now;
    this.maxScanItems = maxScanItems;
    this.cache = createEmptyCache();
    this.writeTail = Promise.resolve();
    this.derived = new MediaIntegrityDerived({
      previewCacheDirectory,
      aiDirectory,
      repository,
      previewService,
      indexService,
      similarityService,
      aiAnalysisService
    });
  }

  async initialise() {
    await fsp.mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.repairStagingDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.cachePath, 'utf8'));
      if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) throw new Error('Integrity cache shape is invalid.');
      this.cache = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') await this.quarantineCache().catch(() => {});
      this.cache = createEmptyCache();
    }
    const staging = await fsp.readdir(this.repairStagingDirectory, { withFileTypes: true }).catch(() => []);
    await Promise.all(staging.filter((entry) => entry.isFile()).map((entry) =>
      fsp.rm(ensureInside(this.repairStagingDirectory, path.join(this.repairStagingDirectory, entry.name)), { force: true }).catch(() => {})
    ));
  }

  timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  async quarantineCache() {
    const destination = path.join(this.cacheDirectory, `integrity-cache.corrupt-${Date.now()}-${randomUUID()}.json`);
    await fsp.rename(this.cachePath, destination).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }

  async persistCache() {
    const snapshot = `${JSON.stringify(this.cache, null, 2)}\n`;
    const write = async () => {
      const staging = ensureInside(this.cacheDirectory, path.join(this.cacheDirectory, `.integrity-${randomUUID()}.tmp`));
      try {
        await fsp.writeFile(staging, snapshot, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        try {
          await fsp.rename(staging, this.cachePath);
        } catch (error) {
          if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
          await fsp.rm(this.cachePath, { force: true });
          await fsp.rename(staging, this.cachePath);
        }
      } finally {
        await fsp.rm(staging, { force: true }).catch(() => {});
      }
    };
    this.writeTail = this.writeTail.then(write, write);
    return this.writeTail;
  }

  resolveManagedSource(media) {
    if (media?.importMode !== 'managed-copy' || typeof media.managedReference !== 'string') return null;
    const segments = media.managedReference.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
      throw new MediaIntegrityError('MEDIA_INTEGRITY_PATH_INVALID', 'Managed media reference is invalid.');
    }
    return ensureInside(this.mediaRootDirectory, path.join(this.mediaRootDirectory, ...segments));
  }

  invalidateCachedTrust(mediaId) {
    delete this.cache.records[mediaId];
  }

  async inspectMedia(media, { forceHash = false, signal } = {}) {
    abortIfNeeded(signal);
    if (media.importMode !== 'managed-copy') {
      return Object.freeze({
        mediaId: media.id,
        state: 'needs-relink',
        reason: 'referenced-source-needs-user-selection',
        checkedAt: this.timestamp(),
        hashVerified: false,
        incremental: false,
        derived: await this.derived.inspect(media)
      });
    }

    let sourcePath;
    try {
      sourcePath = this.resolveManagedSource(media);
    } catch {
      this.invalidateCachedTrust(media.id);
      return Object.freeze({ mediaId: media.id, state: 'corrupt', reason: 'managed-reference-invalid', checkedAt: this.timestamp(), hashVerified: false, incremental: false, derived: await this.derived.inspect(media) });
    }

    let stat;
    try {
      stat = await fsp.stat(sourcePath);
    } catch (error) {
      this.invalidateCachedTrust(media.id);
      const state = error?.code === 'ENOENT' ? 'missing' : 'corrupt';
      const reason = state === 'missing' ? 'managed-source-missing' : 'managed-source-unreadable';
      return Object.freeze({ mediaId: media.id, state, reason, checkedAt: this.timestamp(), hashVerified: false, incremental: false, derived: await this.derived.inspect(media) });
    }
    if (!stat.isFile()) {
      this.invalidateCachedTrust(media.id);
      return Object.freeze({ mediaId: media.id, state: 'corrupt', reason: 'managed-source-not-file', checkedAt: this.timestamp(), hashVerified: false, incremental: false, derived: await this.derived.inspect(media) });
    }
    if (Number.isSafeInteger(media.fileSize) && stat.size !== media.fileSize) {
      this.invalidateCachedTrust(media.id);
      return Object.freeze({ mediaId: media.id, state: 'changed', reason: 'size-mismatch', checkedAt: this.timestamp(), hashVerified: false, incremental: false, derived: await this.derived.inspect(media) });
    }

    try {
      if (!validSignature(await readHeader(sourcePath), path.extname(media.managedReference))) {
        this.invalidateCachedTrust(media.id);
        return Object.freeze({ mediaId: media.id, state: 'corrupt', reason: 'content-signature-invalid', checkedAt: this.timestamp(), hashVerified: false, incremental: false, derived: await this.derived.inspect(media) });
      }
    } catch {
      this.invalidateCachedTrust(media.id);
      return Object.freeze({ mediaId: media.id, state: 'corrupt', reason: 'managed-source-unreadable', checkedAt: this.timestamp(), hashVerified: false, incremental: false, derived: await this.derived.inspect(media) });
    }

    abortIfNeeded(signal);
    const cached = this.cache.records[media.id];
    const canSkipHash = !forceHash && cached?.sourceHash === media.sha256 && cached?.state === 'healthy' && cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs;
    const actualHash = canSkipHash ? media.sha256 : await hashFile(sourcePath, signal);
    const state = actualHash === media.sha256 ? 'healthy' : 'changed';
    const checkedAt = this.timestamp();
    this.cache.records[media.id] = { sourceHash: media.sha256, size: stat.size, mtimeMs: stat.mtimeMs, state, checkedAt };
    return Object.freeze({
      mediaId: media.id,
      state,
      reason: state === 'healthy' ? (canSkipHash ? 'unchanged-since-verified-check' : 'content-hash-verified') : 'hash-mismatch',
      checkedAt,
      hashVerified: state === 'healthy' && !canSkipHash,
      incremental: canSkipHash,
      derived: await this.derived.inspect(media)
    });
  }

  async scan({ mediaIds = null, forceHash = false, signal } = {}) {
    abortIfNeeded(signal);
    const snapshot = await this.repository.listMedia();
    let summaries = snapshot.media ?? [];
    if (mediaIds) {
      const wanted = new Set(mediaIds);
      summaries = summaries.filter((item) => wanted.has(item.id));
    }
    const total = summaries.length;
    const limited = summaries.slice(0, this.maxScanItems);
    const items = [];
    let hashedCount = 0;
    let incrementalHashSkips = 0;
    for (const summary of limited) {
      abortIfNeeded(signal);
      const record = await this.repository.getMediaRecord(summary.id);
      const result = await this.inspectMedia(record.media, { forceHash, signal });
      items.push(result);
      if (result.hashVerified) hashedCount += 1;
      if (result.incremental) incrementalHashSkips += 1;
    }
    abortIfNeeded(signal);
    await this.persistCache();
    return Object.freeze({
      storeRevision: snapshot.storeRevision,
      total,
      checked: items.length,
      truncated: total > limited.length,
      maxScanItems: this.maxScanItems,
      hashedCount,
      incrementalHashSkips,
      items: Object.freeze(items)
    });
  }

  repairManagedMedia(mediaId, replacementPath) {
    return repairManagedMedia({
      mediaId,
      replacementPath,
      repository: this.repository,
      resolveManagedSource: (media) => this.resolveManagedSource(media),
      repairStagingDirectory: this.repairStagingDirectory,
      cache: this.cache,
      persistCache: () => this.persistCache()
    });
  }

  async rebuildDerived({ mediaId, targets }) {
    const result = await this.derived.rebuild(mediaId, targets);
    if (!result) throw new MediaIntegrityError('MEDIA_NOT_FOUND', 'Media record is unavailable.');
    return result;
  }

  getPolicy() {
    return Object.freeze({
      localOnly: true,
      automaticStartupHashing: false,
      maxScanItems: this.maxScanItems,
      sourceDeletionExposed: false,
      externalSourceDeletion: false,
      hardDelete: 'deferred',
      libraryRemoval: 'deferred'
    });
  }

  requestManagedDelete() {
    throw new MediaIntegrityError('MEDIA_DELETE_DEFERRED', 'Managed source deletion is not exposed by the v0.2 integrity workflow.');
  }
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  MediaIntegrityError,
  MediaIntegrityService,
  abortIfNeeded,
  ensureInside,
  hashFile,
  validSignature
};

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { ensureInside, readHeader, PNG_SIGNATURE } = require('./media-integrity-files.cjs');

function safeDerivedState(value) {
  return ['ready', 'missing', 'stale', 'failed', 'rebuildable', 'unknown'].includes(value) ? value : 'unknown';
}

class MediaIntegrityDerived {
  constructor({ previewCacheDirectory, aiDirectory, repository, previewService, indexService, similarityService, aiAnalysisService }) {
    this.previewCacheDirectory = previewCacheDirectory ? path.resolve(previewCacheDirectory) : null;
    this.aiDirectory = aiDirectory ? path.resolve(aiDirectory) : null;
    this.repository = repository;
    this.previewService = previewService;
    this.indexService = indexService;
    this.similarityService = similarityService;
    this.aiAnalysisService = aiAnalysisService;
  }

  async inspectPreview(media) {
    if (!this.previewCacheDirectory) return 'unknown';
    try {
      const parsed = JSON.parse(await fsp.readFile(path.join(this.previewCacheDirectory, 'preview-index.json'), 'utf8'));
      const records = Object.values(parsed?.artifacts ?? {}).filter((record) => record?.mediaId === media.id);
      if (records.length === 0) return 'missing';
      const current = records.find((record) => record.sourceHash === media.sha256 && record.status === 'ready' && typeof record.relativePath === 'string');
      if (!current) return 'stale';
      const artifactPath = ensureInside(this.previewCacheDirectory, path.join(this.previewCacheDirectory, ...current.relativePath.split('/')));
      const stat = await fsp.stat(artifactPath);
      if (!stat.isFile() || stat.size <= PNG_SIGNATURE.length) return 'missing';
      const header = await readHeader(artifactPath);
      return header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? 'ready' : 'stale';
    } catch (error) {
      return error?.code === 'ENOENT' ? 'missing' : 'stale';
    }
  }

  async inspectAi(media) {
    if (!this.aiDirectory) return 'unknown';
    try {
      const parsed = JSON.parse(await fsp.readFile(path.join(this.aiDirectory, 'analyses.json'), 'utf8'));
      const record = parsed?.records?.[media.id];
      if (!record) return 'missing';
      if (record.sourceHash !== media.sha256 || record.status === 'stale') return 'stale';
      if (record.status === 'ready') return 'ready';
      if (record.status === 'failed' || record.status === 'unavailable') return 'failed';
      return 'unknown';
    } catch (error) {
      return error?.code === 'ENOENT' ? 'missing' : 'stale';
    }
  }

  async inspectSimilarity(media) {
    try {
      const status = this.similarityService.getStatus();
      if (!status?.methodVersion) return 'rebuildable';
      const cachePath = path.join(this.similarityService.rootDirectory ?? '', 'fingerprints.json');
      if (!path.isAbsolute(cachePath)) return 'rebuildable';
      const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      const key = `${media.sha256}:${status.methodVersion}`;
      return parsed?.fingerprints?.some((record) => record?.cacheKey === key) ? 'ready' : 'missing';
    } catch (error) {
      return error?.code === 'ENOENT' ? 'missing' : 'stale';
    }
  }

  async inspect(media) {
    const indexStatus = this.indexService.getStatus();
    const indexState = indexStatus?.sourceRevision === this.repository.getStorageSummary().revision ? 'ready' : 'stale';
    const [preview, similarity, ai] = await Promise.all([
      this.inspectPreview(media),
      this.inspectSimilarity(media),
      this.inspectAi(media)
    ]);
    return Object.freeze({
      preview: safeDerivedState(preview),
      index: safeDerivedState(indexState),
      similarity: safeDerivedState(similarity),
      ai: safeDerivedState(ai)
    });
  }

  async rebuild(mediaId, targets) {
    const media = (await this.repository.getMediaRecord(mediaId))?.media;
    if (!media) return null;
    const beforeRevision = this.repository.getStorageSummary().revision;
    const results = [];
    for (const target of targets) {
      try {
        if (target === 'preview') {
          await this.previewService.clearMediaCache(mediaId);
          const value = await this.previewService.requestPreview(mediaId, { force: true });
          results.push(Object.freeze({ target, ok: true, state: value?.status ?? 'ready' }));
        } else if (target === 'index') {
          const value = await this.indexService.rebuild('media-integrity-explicit');
          results.push(Object.freeze({ target, ok: true, state: value?.state ?? 'ready' }));
        } else if (target === 'similarity') {
          const value = await this.similarityService.rebuild();
          results.push(Object.freeze({ target, ok: true, state: value ? 'ready' : 'rebuildable' }));
        } else if (target === 'ai') {
          const value = await this.aiAnalysisService.analyse(mediaId);
          results.push(Object.freeze({ target, ok: true, state: value?.status ?? 'unknown' }));
        }
      } catch (error) {
        results.push(Object.freeze({ target, ok: false, state: 'failed', code: typeof error?.code === 'string' ? error.code : 'DERIVED_REBUILD_FAILED' }));
      }
    }
    return Object.freeze({
      mediaId,
      authoritativeStatePreserved: beforeRevision === this.repository.getStorageSummary().revision,
      sourceBytesDeleted: false,
      externalSourceDeleted: false,
      results: Object.freeze(results)
    });
  }
}

module.exports = { MediaIntegrityDerived };

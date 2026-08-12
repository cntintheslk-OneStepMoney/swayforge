'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { MEDIA_INDEX_SCHEMA_VERSION } = require('./media-index-contracts.cjs');

const INDEX_FILENAME = 'index.json';
const MAX_DERIVED_TEXT = 240;
const MAX_DERIVED_ITEMS = 64;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

function normaliseText(value, max = MAX_DERIVED_TEXT) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, max) : '';
}

function tokens(value) {
  return (normaliseText(value, 5000).toLocaleLowerCase().match(TOKEN_PATTERN) ?? []).filter(Boolean);
}

function durationBucket(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 15) return 'under-15s';
  if (seconds < 60) return '15-59s';
  if (seconds < 300) return '1-5m';
  return '5m-plus';
}

function orientation(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function cleanDerivedList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_DERIVED_ITEMS).map((item) => normaliseText(item)).filter(Boolean))];
}

function cleanDerivedIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_DERIVED_ITEMS).filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 128))];
}

function canonicalDerived(derived = {}) {
  return {
    userTagIds: cleanDerivedIds(derived.userTagIds),
    userTags: cleanDerivedList(derived.userTags),
    collectionIds: cleanDerivedIds(derived.collectionIds),
    collectionNames: cleanDerivedList(derived.collectionNames),
    aiLabels: cleanDerivedList(derived.aiLabels),
    aiDescription: normaliseText(derived.aiDescription)
  };
}

function sourceFingerprint(media, projectIds, derived = {}) {
  const payload = JSON.stringify({
    id: media.id,
    originalFilename: media.originalFilename,
    fileSize: Number.isSafeInteger(media.fileSize) ? media.fileSize : null,
    kind: media.kind,
    width: media.width ?? null,
    height: media.height ?? null,
    durationSeconds: media.durationSeconds ?? null,
    importedAt: media.importedAt,
    availability: media.availability,
    projectIds: [...projectIds].sort(),
    derived: canonicalDerived(derived)
  });
  return createHash('sha256').update(payload).digest('hex');
}

function buildSearchText(entry) {
  return [entry.filenameStem, ...entry.userTags, ...entry.collectionNames, ...entry.aiLabels, entry.aiDescription]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase();
}

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    projectIds: Object.freeze([...entry.projectIds]),
    userTagIds: Object.freeze([...entry.userTagIds]),
    userTags: Object.freeze([...entry.userTags]),
    collectionIds: Object.freeze([...entry.collectionIds]),
    collectionNames: Object.freeze([...entry.collectionNames]),
    aiLabels: Object.freeze([...entry.aiLabels])
  });
}

function serialisableEntry(entry) {
  const { searchText, ...rest } = entry;
  return rest;
}

function assertIndexDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Index document must be an object.');
  if (value.schemaVersion !== MEDIA_INDEX_SCHEMA_VERSION) throw Object.assign(new Error('Media index schema is stale.'), { code: 'MEDIA_INDEX_SCHEMA_MISMATCH' });
  if (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0 || !Array.isArray(value.entries)) throw new TypeError('Index document is invalid.');
}

function createEntry(media, projectIds, derived = {}) {
  const filename = normaliseText(media.originalFilename, 512);
  const stem = normaliseText(path.parse(filename).name, 512);
  const cleanDerived = canonicalDerived(derived);
  const entry = {
    mediaId: media.id,
    filename,
    filenameStem: stem,
    filenameTokens: tokens(stem),
    fileSize: Number.isSafeInteger(media.fileSize) ? media.fileSize : null,
    kind: media.kind,
    width: Number.isFinite(media.width) ? media.width : null,
    height: Number.isFinite(media.height) ? media.height : null,
    orientation: orientation(media.width, media.height),
    durationSeconds: Number.isFinite(media.durationSeconds) ? media.durationSeconds : null,
    durationBucket: durationBucket(media.durationSeconds),
    importedAt: media.importedAt,
    availability: media.availability,
    projectIds: [...projectIds].sort(),
    exactDuplicateState: 'canonical',
    sourceFingerprint: sourceFingerprint(media, projectIds, cleanDerived),
    ...cleanDerived,
    searchText: ''
  };
  entry.searchText = buildSearchText(entry);
  return freezeEntry(entry);
}

function compare(sort) {
  const stable = (a, b, primary) => primary || a.mediaId.localeCompare(b.mediaId);
  switch (sort) {
    case 'imported-asc': return (a, b) => stable(a, b, a.importedAt.localeCompare(b.importedAt));
    case 'filename-asc': return (a, b) => stable(a, b, a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }));
    case 'filename-desc': return (a, b) => stable(a, b, b.filename.localeCompare(a.filename, undefined, { sensitivity: 'base' }));
    case 'kind-asc': return (a, b) => stable(a, b, a.kind.localeCompare(b.kind) || a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }));
    case 'duration-asc': return (a, b) => stable(a, b, (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity));
    case 'duration-desc': return (a, b) => stable(a, b, (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1));
    default: return (a, b) => stable(a, b, b.importedAt.localeCompare(a.importedAt));
  }
}

class MediaIndexService {
  static async open(options) {
    const service = new MediaIndexService(options);
    await service.initialise();
    return service;
  }

  constructor({ rootDirectory, repository, derivedMetadataProviders = [] } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) throw new TypeError('rootDirectory must be an absolute trusted path.');
    if (!repository || typeof repository.listMedia !== 'function' || typeof repository.getStorageSummary !== 'function') throw new TypeError('repository is invalid.');
    if (!Array.isArray(derivedMetadataProviders) || derivedMetadataProviders.some((provider) => typeof provider !== 'function')) throw new TypeError('derivedMetadataProviders is invalid.');
    this.rootDirectory = path.resolve(rootDirectory);
    this.indexPath = path.join(this.rootDirectory, INDEX_FILENAME);
    this.repository = repository;
    this.derivedMetadataProviders = [...derivedMetadataProviders];
    this.sourceRevision = -1;
    this.entries = new Map();
    this.lastRebuildReason = 'not-initialised';
    this.lastSyncChangedCount = 0;
    this.refreshPromise = null;
  }

  async initialise() {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
      assertIndexDocument(parsed);
      this.sourceRevision = parsed.sourceRevision;
      this.entries = new Map(parsed.entries.map((raw) => {
        const entry = freezeEntry({ ...raw, searchText: buildSearchText(raw) });
        return [entry.mediaId, entry];
      }));
      this.lastRebuildReason = 'loaded';
      this.lastSyncChangedCount = 0;
    } catch (error) {
      if (error?.code !== 'ENOENT') await this.quarantineBrokenIndex().catch(() => {});
      await this.rebuild(error?.code === 'MEDIA_INDEX_SCHEMA_MISMATCH' ? 'schema-mismatch' : 'missing-or-corrupt');
      return;
    }
    await this.refreshIfStale();
  }

  async quarantineBrokenIndex() {
    const destination = path.join(this.rootDirectory, `index.corrupt-${Date.now()}-${randomUUID()}.json`);
    await fs.rename(this.indexPath, destination).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }

  async readProjectReferences() {
    const output = new Map();
    if (typeof this.repository.listProjects !== 'function' || typeof this.repository.readProject !== 'function') return output;
    const projects = await this.repository.listProjects();
    for (const summary of projects.projects ?? []) {
      const detail = await this.repository.readProject({ projectId: summary.id });
      for (const mediaId of detail.project?.mediaIds ?? []) {
        if (!output.has(mediaId)) output.set(mediaId, []);
        output.get(mediaId).push(summary.id);
      }
    }
    return output;
  }

  async getDerivedMetadata(media) {
    const merged = {};
    for (const provider of this.derivedMetadataProviders) {
      const value = await provider(media);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const key of ['userTagIds', 'userTags', 'collectionIds', 'collectionNames', 'aiLabels', 'aiDescription']) {
        if (Object.hasOwn(value, key)) merged[key] = value[key];
      }
    }
    return merged;
  }

  async rebuild(reason = 'explicit') {
    return this.synchronise({ forceRebuild: true, reason });
  }

  async synchronise({ forceRebuild = false, reason = 'source-revision-changed' } = {}) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const mediaSnapshot = await this.repository.listMedia();
      const projectReferences = await this.readProjectReferences();
      const next = new Map();
      let changedCount = 0;
      for (const media of mediaSnapshot.media ?? []) {
        const projectIds = projectReferences.get(media.id) ?? [];
        const derived = await this.getDerivedMetadata(media);
        const fingerprint = sourceFingerprint(media, projectIds, derived);
        const existing = this.entries.get(media.id);
        if (!forceRebuild && existing?.sourceFingerprint === fingerprint) {
          next.set(media.id, existing);
          continue;
        }
        const entry = createEntry(media, projectIds, derived);
        next.set(entry.mediaId, entry);
        changedCount += 1;
      }
      for (const mediaId of this.entries.keys()) if (!next.has(mediaId)) changedCount += 1;
      this.entries = next;
      this.sourceRevision = mediaSnapshot.storeRevision;
      this.lastRebuildReason = reason;
      this.lastSyncChangedCount = changedCount;
      await this.persist();
      return this.getStatus();
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async refreshIfStale() {
    const revision = this.repository.getStorageSummary().revision;
    if (revision === this.sourceRevision) return false;
    await this.synchronise({ reason: 'source-revision-changed' });
    return true;
  }

  async persist() {
    const document = {
      schemaVersion: MEDIA_INDEX_SCHEMA_VERSION,
      sourceRevision: this.sourceRevision,
      entries: [...this.entries.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId)).map(serialisableEntry)
    };
    const staging = `${this.indexPath}.staging-${process.pid}-${randomUUID()}`;
    await fs.writeFile(staging, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(staging, this.indexPath);
  }

  getStatus() {
    return Object.freeze({
      schemaVersion: MEDIA_INDEX_SCHEMA_VERSION,
      sourceRevision: this.sourceRevision,
      entryCount: this.entries.size,
      state: 'ready',
      rebuildable: true,
      localOnly: true,
      lastRebuildReason: this.lastRebuildReason,
      lastSyncChangedCount: this.lastSyncChangedCount
    });
  }

  matchSources(entry, queryTokens) {
    if (queryTokens.length === 0) return [];
    if (!queryTokens.every((token) => entry.searchText.includes(token))) return null;
    const sources = [];
    if (queryTokens.some((token) => entry.filenameStem.toLocaleLowerCase().includes(token))) sources.push('filename');
    if (queryTokens.some((token) => entry.userTags.join(' ').toLocaleLowerCase().includes(token))) sources.push('user-tag');
    if (queryTokens.some((token) => entry.collectionNames.join(' ').toLocaleLowerCase().includes(token))) sources.push('collection');
    if (queryTokens.some((token) => [...entry.aiLabels, entry.aiDescription].join(' ').toLocaleLowerCase().includes(token))) sources.push('ai-label');
    return sources;
  }

  async search(request) {
    await this.refreshIfStale();
    const queryTokens = tokens(request.query);
    let items = [];
    for (const entry of this.entries.values()) {
      if (request.tagIds?.length && !request.tagIds.every((tagId) => entry.userTagIds.includes(tagId))) continue;
      if (request.collectionId && !entry.collectionIds.includes(request.collectionId)) continue;
      if (request.mediaKind && entry.kind !== request.mediaKind) continue;
      if (request.availability && entry.availability !== request.availability) continue;
      if (request.orientation && entry.orientation !== request.orientation) continue;
      if (request.importedAfter && entry.importedAt < request.importedAfter) continue;
      if (request.importedBefore && entry.importedAt > request.importedBefore) continue;
      if (request.minDurationSeconds !== null && (entry.durationSeconds === null || entry.durationSeconds < request.minDurationSeconds)) continue;
      if (request.maxDurationSeconds !== null && (entry.durationSeconds === null || entry.durationSeconds > request.maxDurationSeconds)) continue;
      if (request.minWidth !== null && (entry.width === null || entry.width < request.minWidth)) continue;
      if (request.maxWidth !== null && (entry.width === null || entry.width > request.maxWidth)) continue;
      if (request.minHeight !== null && (entry.height === null || entry.height < request.minHeight)) continue;
      if (request.maxHeight !== null && (entry.height === null || entry.height > request.maxHeight)) continue;
      const matchSources = this.matchSources(entry, queryTokens);
      if (matchSources === null) continue;
      items.push({ entry, matchSources });
    }
    items.sort((a, b) => compare(request.sort)(a.entry, b.entry));
    const total = items.length;
    items = items.slice(request.offset, request.offset + request.limit).map(({ entry, matchSources }) => Object.freeze({
      id: entry.mediaId,
      kind: entry.kind,
      originalFilename: entry.filename,
      fileSize: entry.fileSize,
      width: entry.width,
      height: entry.height,
      orientation: entry.orientation,
      durationSeconds: entry.durationSeconds,
      durationBucket: entry.durationBucket,
      importedAt: entry.importedAt,
      availability: entry.availability,
      projectIds: Object.freeze([...entry.projectIds]),
      userTagIds: Object.freeze([...entry.userTagIds]),
      userTags: Object.freeze([...entry.userTags]),
      collectionIds: Object.freeze([...entry.collectionIds]),
      collectionNames: Object.freeze([...entry.collectionNames]),
      exactDuplicateState: entry.exactDuplicateState,
      matchSources: Object.freeze([...matchSources])
    }));
    return Object.freeze({
      sourceRevision: this.sourceRevision,
      total,
      offset: request.offset,
      limit: request.limit,
      hasMore: request.offset + items.length < total,
      items: Object.freeze(items)
    });
  }
}

module.exports = {
  MediaIndexService,
  canonicalDerived,
  createEntry,
  durationBucket,
  orientation,
  sourceFingerprint,
  tokens
};

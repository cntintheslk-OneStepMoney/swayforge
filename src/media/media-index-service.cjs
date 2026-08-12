'use strict';

const { createHash } = require('node:crypto');
const core = require('./media-index-service-core.cjs');

function normaliseFilename(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, 512) : '';
}

function baseFingerprintFromValues({ id, filename, fileSize, kind, width, height, durationSeconds, importedAt, availability, projectIds }) {
  const payload = JSON.stringify({
    id,
    originalFilename: filename,
    fileSize: Number.isSafeInteger(fileSize) ? fileSize : null,
    kind,
    width: width ?? null,
    height: height ?? null,
    durationSeconds: durationSeconds ?? null,
    importedAt,
    availability,
    projectIds: [...projectIds].sort()
  });
  return createHash('sha256').update(payload).digest('hex');
}

function baseSourceFingerprint(media, projectIds) {
  return baseFingerprintFromValues({
    id: media.id,
    filename: normaliseFilename(media.originalFilename),
    fileSize: media.fileSize,
    kind: media.kind,
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds,
    importedAt: media.importedAt,
    availability: media.availability,
    projectIds
  });
}

function baseEntryFingerprint(entry) {
  return baseFingerprintFromValues({
    id: entry.mediaId,
    filename: entry.filename,
    fileSize: entry.fileSize,
    kind: entry.kind,
    width: entry.width,
    height: entry.height,
    durationSeconds: entry.durationSeconds,
    importedAt: entry.importedAt,
    availability: entry.availability,
    projectIds: entry.projectIds
  });
}

class MediaIndexService extends core.MediaIndexService {
  static async open(options) {
    const service = new MediaIndexService(options);
    await service.initialise();
    return service;
  }

  constructor(options) {
    super(options);
    this.organisationFingerprint = null;
    this.baseFingerprints = new Map();
  }

  async initialise() {
    await super.initialise();
    this.organisationFingerprint = await this.getOrganisationFingerprint();
    this.baseFingerprints = new Map(
      [...this.entries.entries()].map(([mediaId, entry]) => [mediaId, baseEntryFingerprint(entry)])
    );
  }

  async getOrganisationFingerprint() {
    if (typeof this.repository.readMediaOrganisation !== 'function') return null;
    const snapshot = await this.repository.readMediaOrganisation();
    return createHash('sha256')
      .update(JSON.stringify(snapshot?.organisation ?? null))
      .digest('hex');
  }

  async synchronise({ forceRebuild = false, reason = 'source-revision-changed' } = {}) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const mediaSnapshot = await this.repository.listMedia();
      const projectReferences = await this.readProjectReferences();
      const currentOrganisationFingerprint = await this.getOrganisationFingerprint();
      const derivedInvalidated = forceRebuild || currentOrganisationFingerprint !== this.organisationFingerprint;
      const next = new Map();
      const nextBaseFingerprints = new Map();
      let changedCount = 0;

      for (const media of mediaSnapshot.media ?? []) {
        const projectIds = projectReferences.get(media.id) ?? [];
        const baseFingerprint = baseSourceFingerprint(media, projectIds);
        const existing = this.entries.get(media.id);
        const existingBaseFingerprint = this.baseFingerprints.get(media.id)
          ?? (existing ? baseEntryFingerprint(existing) : null);

        if (!derivedInvalidated && existing && existingBaseFingerprint === baseFingerprint) {
          next.set(media.id, existing);
          nextBaseFingerprints.set(media.id, baseFingerprint);
          continue;
        }

        const derived = await this.getDerivedMetadata(media);
        const entry = core.createEntry(media, projectIds, derived);
        next.set(entry.mediaId, entry);
        nextBaseFingerprints.set(entry.mediaId, baseFingerprint);
        changedCount += 1;
      }

      for (const mediaId of this.entries.keys()) {
        if (!next.has(mediaId)) changedCount += 1;
      }

      this.entries = next;
      this.baseFingerprints = nextBaseFingerprints;
      this.organisationFingerprint = currentOrganisationFingerprint;
      this.sourceRevision = mediaSnapshot.storeRevision;
      this.lastRebuildReason = reason;
      this.lastSyncChangedCount = changedCount;
      await this.persist();
      return this.getStatus();
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }
}

module.exports = {
  ...core,
  MediaIndexService,
  baseSourceFingerprint
};

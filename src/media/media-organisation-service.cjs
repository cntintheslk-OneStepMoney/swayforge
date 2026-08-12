'use strict';

const { randomUUID } = require('node:crypto');
const {
  MEDIA_ORGANISATION_SCHEMA_VERSION,
  normaliseDisplayName,
  normaliseLookupName,
  normaliseSuggestionLabel,
  validateSavedViewCriteria
} = require('./media-organisation-contracts.cjs');

class MediaOrganisationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaOrganisationError';
    this.code = code;
  }
}

function clone(value) {
  return structuredClone(value);
}

function createEmptyOrganisation() {
  return {
    schemaVersion: MEDIA_ORGANISATION_SCHEMA_VERSION,
    tags: {},
    mediaTags: {},
    collections: {},
    savedViews: {},
    dismissedAiSuggestions: {}
  };
}

function compareByName(left, right) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id);
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const label = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(label);
  }
  return output;
}

class MediaOrganisationService {
  static async open(options) {
    const service = new MediaOrganisationService(options);
    await service.initialise();
    return service;
  }

  constructor({ repository, aiAnalysisProvider = async () => null, idFactory = randomUUID, now = () => new Date() } = {}) {
    if (
      !repository ||
      typeof repository.readMediaOrganisation !== 'function' ||
      typeof repository.replaceMediaOrganisation !== 'function' ||
      typeof repository.getMediaRecord !== 'function' ||
      typeof repository.listMedia !== 'function'
    ) {
      throw new TypeError('Media organisation requires the authoritative local repository.');
    }
    if (typeof aiAnalysisProvider !== 'function' || typeof idFactory !== 'function' || typeof now !== 'function') {
      throw new TypeError('Invalid media organisation dependency injection.');
    }
    this.repository = repository;
    this.aiAnalysisProvider = aiAnalysisProvider;
    this.idFactory = idFactory;
    this.now = now;
    this.organisation = createEmptyOrganisation();
    this.storeRevision = -1;
    this.writeTail = Promise.resolve();
  }

  timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  async initialise() {
    await this.refresh();
    return this;
  }

  async refresh() {
    const snapshot = await this.repository.readMediaOrganisation();
    this.storeRevision = snapshot.storeRevision;
    this.organisation = clone(snapshot.organisation);
    return this.organisation;
  }

  allocateId(recordMap) {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const id = this.idFactory();
      if (typeof id === 'string' && !(id in recordMap)) return id;
    }
    throw new MediaOrganisationError('ORGANISATION_ID_COLLISION', 'A unique local organisation id could not be allocated.');
  }

  findTagByName(organisation, name) {
    const key = normaliseLookupName(name, 'tag name');
    return Object.values(organisation.tags).find((tag) => tag.normalisedName === key) ?? null;
  }

  findCollectionByName(organisation, name) {
    const key = normaliseLookupName(name, 'collection name');
    return Object.values(organisation.collections).find((collection) => collection.normalisedName === key) ?? null;
  }

  findSavedViewByName(organisation, name) {
    const key = normaliseLookupName(name, 'saved view name');
    return Object.values(organisation.savedViews).find((view) => view.normalisedName === key) ?? null;
  }

  requireTag(organisation, tagId) {
    const tag = organisation.tags[tagId];
    if (!tag) throw new MediaOrganisationError('TAG_NOT_FOUND', 'The requested media tag no longer exists.');
    return tag;
  }

  requireCollection(organisation, collectionId) {
    const collection = organisation.collections[collectionId];
    if (!collection) throw new MediaOrganisationError('COLLECTION_NOT_FOUND', 'The requested media collection no longer exists.');
    return collection;
  }

  async requireMedia(mediaIds) {
    for (const mediaId of mediaIds) await this.repository.getMediaRecord(mediaId);
  }

  enqueueMutation(mutator) {
    const run = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.refresh();
        const working = clone(this.organisation);
        const outcome = await mutator(working);
        if (outcome?.changed === false) return Object.freeze({ storeRevision: this.storeRevision, changed: false, value: clone(outcome.value) });
        try {
          const saved = await this.repository.replaceMediaOrganisation({
            expectedRevision: this.storeRevision,
            organisation: working
          });
          this.storeRevision = saved.storeRevision;
          this.organisation = clone(saved.organisation);
          return Object.freeze({ storeRevision: saved.storeRevision, changed: true, value: clone(outcome?.value ?? null) });
        } catch (error) {
          if (error?.code === 'STORAGE_CONFLICT' && attempt === 0) continue;
          throw error;
        }
      }
      throw new MediaOrganisationError('ORGANISATION_CONFLICT', 'Media organisation changed before it could be saved.');
    };
    const queued = this.writeTail.then(run, run);
    this.writeTail = queued.catch(() => {});
    return queued;
  }

  async getSnapshot() {
    await this.refresh();
    const mediaSnapshot = await this.repository.listMedia();
    const mediaById = new Map((mediaSnapshot.media ?? []).map((media) => [media.id, media]));
    const tagCounts = new Map();
    for (const tagIds of Object.values(this.organisation.mediaTags)) {
      for (const tagId of tagIds) tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1);
    }

    const tags = Object.values(this.organisation.tags)
      .map((tag) => Object.freeze({ ...tag, mediaCount: tagCounts.get(tag.id) ?? 0 }))
      .sort(compareByName);
    const collections = Object.values(this.organisation.collections)
      .map((collection) => {
        const missingMediaIds = collection.mediaIds.filter((mediaId) => !mediaById.has(mediaId));
        return Object.freeze({
          ...collection,
          mediaIds: Object.freeze([...collection.mediaIds]),
          mediaCount: collection.mediaIds.length,
          missingMediaIds: Object.freeze(missingMediaIds)
        });
      })
      .sort(compareByName);
    const savedViews = Object.values(this.organisation.savedViews)
      .map((view) => Object.freeze({ ...view, criteria: Object.freeze(clone(view.criteria)) }))
      .sort(compareByName);

    return Object.freeze({
      schemaVersion: MEDIA_ORGANISATION_SCHEMA_VERSION,
      storeRevision: this.storeRevision,
      tags: Object.freeze(tags),
      collections: Object.freeze(collections),
      savedViews: Object.freeze(savedViews)
    });
  }

  getIndexMetadata(media) {
    if (!media || typeof media.id !== 'string') return Object.freeze({});
    const tagIds = [...(this.organisation.mediaTags[media.id] ?? [])].filter((tagId) => this.organisation.tags[tagId]);
    const userTags = tagIds.map((tagId) => this.organisation.tags[tagId].name);
    const collections = Object.values(this.organisation.collections).filter((collection) => collection.mediaIds.includes(media.id));
    return Object.freeze({
      userTagIds: Object.freeze(tagIds),
      userTags: Object.freeze(userTags),
      collectionIds: Object.freeze(collections.map((collection) => collection.id)),
      collectionNames: Object.freeze(collections.map((collection) => collection.name))
    });
  }

  async createTag(name) {
    const displayName = normaliseDisplayName(name, 'tag name');
    return this.enqueueMutation(async (organisation) => {
      const existing = this.findTagByName(organisation, displayName);
      if (existing) return { changed: false, value: existing };
      const timestamp = this.timestamp();
      const id = this.allocateId(organisation.tags);
      const tag = { id, name: displayName, normalisedName: normaliseLookupName(displayName), createdAt: timestamp, updatedAt: timestamp };
      organisation.tags[id] = tag;
      return { changed: true, value: tag };
    });
  }

  async renameTag(tagId, name) {
    const displayName = normaliseDisplayName(name, 'tag name');
    return this.enqueueMutation(async (organisation) => {
      const existing = this.requireTag(organisation, tagId);
      const collision = this.findTagByName(organisation, displayName);
      if (collision && collision.id !== tagId) throw new MediaOrganisationError('TAG_NAME_CONFLICT', 'Another tag already uses that name.');
      if (existing.name === displayName) return { changed: false, value: existing };
      const tag = { ...existing, name: displayName, normalisedName: normaliseLookupName(displayName), updatedAt: this.timestamp() };
      organisation.tags[tagId] = tag;
      return { changed: true, value: tag };
    });
  }

  async deleteTag(tagId) {
    return this.enqueueMutation(async (organisation) => {
      const tag = this.requireTag(organisation, tagId);
      delete organisation.tags[tagId];
      for (const [mediaId, tagIds] of Object.entries(organisation.mediaTags)) {
        const next = tagIds.filter((id) => id !== tagId);
        if (next.length > 0) organisation.mediaTags[mediaId] = next;
        else delete organisation.mediaTags[mediaId];
      }
      for (const view of Object.values(organisation.savedViews)) {
        if (!Array.isArray(view.criteria.tagIds) || !view.criteria.tagIds.includes(tagId)) continue;
        view.criteria = { ...view.criteria, tagIds: view.criteria.tagIds.filter((id) => id !== tagId) };
        view.updatedAt = this.timestamp();
      }
      return { changed: true, value: tag };
    });
  }

  async assignTags(tagIds, mediaIds) {
    await this.requireMedia(mediaIds);
    return this.enqueueMutation(async (organisation) => {
      tagIds.forEach((tagId) => this.requireTag(organisation, tagId));
      let changed = false;
      for (const mediaId of mediaIds) {
        const next = new Set(organisation.mediaTags[mediaId] ?? []);
        const before = next.size;
        tagIds.forEach((tagId) => next.add(tagId));
        if (next.size !== before) changed = true;
        organisation.mediaTags[mediaId] = [...next].sort();
      }
      return { changed, value: { tagIds, mediaIds } };
    });
  }

  async removeTags(tagIds, mediaIds) {
    return this.enqueueMutation(async (organisation) => {
      tagIds.forEach((tagId) => this.requireTag(organisation, tagId));
      let changed = false;
      for (const mediaId of mediaIds) {
        const previous = organisation.mediaTags[mediaId] ?? [];
        const next = previous.filter((tagId) => !tagIds.includes(tagId));
        if (next.length !== previous.length) changed = true;
        if (next.length > 0) organisation.mediaTags[mediaId] = next;
        else delete organisation.mediaTags[mediaId];
      }
      return { changed, value: { tagIds, mediaIds } };
    });
  }

  async createCollection(name) {
    const displayName = normaliseDisplayName(name, 'collection name');
    return this.enqueueMutation(async (organisation) => {
      const existing = this.findCollectionByName(organisation, displayName);
      if (existing) return { changed: false, value: existing };
      const timestamp = this.timestamp();
      const id = this.allocateId(organisation.collections);
      const collection = {
        id,
        name: displayName,
        normalisedName: normaliseLookupName(displayName),
        status: 'active',
        mediaIds: [],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      organisation.collections[id] = collection;
      return { changed: true, value: collection };
    });
  }

  async renameCollection(collectionId, name) {
    const displayName = normaliseDisplayName(name, 'collection name');
    return this.enqueueMutation(async (organisation) => {
      const existing = this.requireCollection(organisation, collectionId);
      const collision = this.findCollectionByName(organisation, displayName);
      if (collision && collision.id !== collectionId) throw new MediaOrganisationError('COLLECTION_NAME_CONFLICT', 'Another collection already uses that name.');
      if (existing.name === displayName) return { changed: false, value: existing };
      const collection = { ...existing, name: displayName, normalisedName: normaliseLookupName(displayName), updatedAt: this.timestamp() };
      organisation.collections[collectionId] = collection;
      return { changed: true, value: collection };
    });
  }

  async archiveCollection(collectionId) {
    return this.enqueueMutation(async (organisation) => {
      const existing = this.requireCollection(organisation, collectionId);
      if (existing.status === 'archived') return { changed: false, value: existing };
      const collection = { ...existing, status: 'archived', updatedAt: this.timestamp() };
      organisation.collections[collectionId] = collection;
      return { changed: true, value: collection };
    });
  }

  async deleteCollection(collectionId) {
    return this.enqueueMutation(async (organisation) => {
      const collection = this.requireCollection(organisation, collectionId);
      delete organisation.collections[collectionId];
      for (const view of Object.values(organisation.savedViews)) {
        if (view.criteria.collectionId !== collectionId) continue;
        view.criteria = { ...view.criteria, collectionId: null };
        view.updatedAt = this.timestamp();
      }
      return { changed: true, value: collection };
    });
  }

  async addMediaToCollection(collectionId, mediaIds) {
    await this.requireMedia(mediaIds);
    return this.enqueueMutation(async (organisation) => {
      const existing = this.requireCollection(organisation, collectionId);
      if (existing.status === 'archived') throw new MediaOrganisationError('COLLECTION_ARCHIVED', 'Archived collections cannot be edited.');
      const next = new Set(existing.mediaIds);
      const before = next.size;
      mediaIds.forEach((mediaId) => next.add(mediaId));
      if (next.size === before) return { changed: false, value: existing };
      const collection = { ...existing, mediaIds: [...next], updatedAt: this.timestamp() };
      organisation.collections[collectionId] = collection;
      return { changed: true, value: collection };
    });
  }

  async removeMediaFromCollection(collectionId, mediaIds) {
    return this.enqueueMutation(async (organisation) => {
      const existing = this.requireCollection(organisation, collectionId);
      if (existing.status === 'archived') throw new MediaOrganisationError('COLLECTION_ARCHIVED', 'Archived collections cannot be edited.');
      const mediaSet = new Set(mediaIds);
      const next = existing.mediaIds.filter((mediaId) => !mediaSet.has(mediaId));
      if (next.length === existing.mediaIds.length) return { changed: false, value: existing };
      const collection = { ...existing, mediaIds: next, updatedAt: this.timestamp() };
      organisation.collections[collectionId] = collection;
      return { changed: true, value: collection };
    });
  }

  async saveView(name, criteria) {
    const displayName = normaliseDisplayName(name, 'saved view name');
    const savedCriteria = clone(validateSavedViewCriteria(criteria));
    return this.enqueueMutation(async (organisation) => {
      const existing = this.findSavedViewByName(organisation, displayName);
      const timestamp = this.timestamp();
      const id = existing?.id ?? this.allocateId(organisation.savedViews);
      const view = {
        id,
        name: displayName,
        normalisedName: normaliseLookupName(displayName),
        criteria: savedCriteria,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      const changed = !existing || JSON.stringify(existing.criteria) !== JSON.stringify(savedCriteria) || existing.name !== displayName;
      organisation.savedViews[id] = view;
      return { changed, value: view };
    });
  }

  async deleteSavedView(savedViewId) {
    return this.enqueueMutation(async (organisation) => {
      const view = organisation.savedViews[savedViewId];
      if (!view) throw new MediaOrganisationError('SAVED_VIEW_NOT_FOUND', 'The requested saved media view no longer exists.');
      delete organisation.savedViews[savedViewId];
      return { changed: true, value: view };
    });
  }

  async rawAiCandidates(mediaId) {
    await this.repository.getMediaRecord(mediaId);
    const analysis = await this.aiAnalysisProvider(mediaId);
    if (!analysis || analysis.status !== 'ready') return { analysis, labels: [] };
    return {
      analysis,
      labels: uniqueStrings([
        ...(analysis.labels ?? []),
        analysis.scene,
        analysis.activity,
        ...(analysis.visualQualities ?? [])
      ])
    };
  }

  async getAiSuggestions(mediaId) {
    await this.refresh();
    const { analysis, labels } = await this.rawAiCandidates(mediaId);
    const assignedNames = new Set(
      (this.organisation.mediaTags[mediaId] ?? [])
        .map((tagId) => this.organisation.tags[tagId]?.normalisedName)
        .filter(Boolean)
    );
    const dismissed = new Set(this.organisation.dismissedAiSuggestions[mediaId] ?? []);
    const suggestions = labels
      .filter((label) => {
        const key = normaliseLookupName(label, 'AI suggestion label');
        return !assignedNames.has(key) && !dismissed.has(key);
      })
      .map((label) => Object.freeze({ label, source: 'ai', status: 'suggested' }));
    return Object.freeze({
      mediaId,
      analysisStatus: analysis?.status ?? 'not-analysed',
      generatedAt: analysis?.generatedAt ?? null,
      suggestions: Object.freeze(suggestions)
    });
  }

  async acceptAiSuggestion(mediaId, label) {
    const display = normaliseSuggestionLabel(label);
    const { labels } = await this.rawAiCandidates(mediaId);
    const key = normaliseLookupName(display, 'AI suggestion label');
    if (!labels.some((candidate) => normaliseLookupName(candidate, 'AI suggestion label') === key)) {
      throw new MediaOrganisationError('AI_SUGGESTION_NOT_FOUND', 'That label is not a current local AI suggestion.');
    }
    return this.enqueueMutation(async (organisation) => {
      let tag = this.findTagByName(organisation, display);
      const timestamp = this.timestamp();
      if (!tag) {
        const id = this.allocateId(organisation.tags);
        tag = { id, name: display, normalisedName: key, createdAt: timestamp, updatedAt: timestamp };
        organisation.tags[id] = tag;
      }
      const mediaTags = new Set(organisation.mediaTags[mediaId] ?? []);
      mediaTags.add(tag.id);
      organisation.mediaTags[mediaId] = [...mediaTags].sort();
      const dismissed = new Set(organisation.dismissedAiSuggestions[mediaId] ?? []);
      dismissed.delete(key);
      if (dismissed.size > 0) organisation.dismissedAiSuggestions[mediaId] = [...dismissed].sort();
      else delete organisation.dismissedAiSuggestions[mediaId];
      return { changed: true, value: { mediaId, tag } };
    });
  }

  async dismissAiSuggestion(mediaId, label) {
    const display = normaliseSuggestionLabel(label);
    const { labels } = await this.rawAiCandidates(mediaId);
    const key = normaliseLookupName(display, 'AI suggestion label');
    if (!labels.some((candidate) => normaliseLookupName(candidate, 'AI suggestion label') === key)) {
      throw new MediaOrganisationError('AI_SUGGESTION_NOT_FOUND', 'That label is not a current local AI suggestion.');
    }
    return this.enqueueMutation(async (organisation) => {
      const dismissed = new Set(organisation.dismissedAiSuggestions[mediaId] ?? []);
      const before = dismissed.size;
      dismissed.add(key);
      organisation.dismissedAiSuggestions[mediaId] = [...dismissed].sort();
      return { changed: dismissed.size !== before, value: { mediaId, label: display } };
    });
  }

  async performMutation(request) {
    switch (request.action) {
      case 'tag-create': return this.createTag(request.name);
      case 'tag-rename': return this.renameTag(request.tagId, request.name);
      case 'tag-delete': return this.deleteTag(request.tagId);
      case 'tag-assign': return this.assignTags(request.tagIds, request.mediaIds);
      case 'tag-remove': return this.removeTags(request.tagIds, request.mediaIds);
      case 'collection-create': return this.createCollection(request.name);
      case 'collection-rename': return this.renameCollection(request.collectionId, request.name);
      case 'collection-archive': return this.archiveCollection(request.collectionId);
      case 'collection-delete': return this.deleteCollection(request.collectionId);
      case 'collection-add-media': return this.addMediaToCollection(request.collectionId, request.mediaIds);
      case 'collection-remove-media': return this.removeMediaFromCollection(request.collectionId, request.mediaIds);
      case 'saved-view-save': return this.saveView(request.name, request.criteria);
      case 'saved-view-delete': return this.deleteSavedView(request.savedViewId);
      case 'ai-suggestion-accept': return this.acceptAiSuggestion(request.mediaId, request.label);
      case 'ai-suggestion-dismiss': return this.dismissAiSuggestion(request.mediaId, request.label);
      default: throw new TypeError('Unsupported media organisation mutation.');
    }
  }
}

module.exports = {
  MediaOrganisationError,
  MediaOrganisationService,
  compareByName,
  createEmptyOrganisation,
  uniqueStrings
};

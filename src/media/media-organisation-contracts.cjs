'use strict';

const MEDIA_ORGANISATION_REQUEST_VERSION = 1;
const MEDIA_ORGANISATION_SCHEMA_VERSION = 1;
const MEDIA_ORGANISATION_IPC_CHANNELS = Object.freeze({
  snapshot: 'swayforge:media:organisation:snapshot',
  mutate: 'swayforge:media:organisation:mutate',
  aiSuggestions: 'swayforge:media:organisation:ai-suggestions'
});

const MEDIA_ORGANISATION_SNAPSHOT_REQUEST = Object.freeze({
  kind: 'media-organisation-snapshot',
  version: MEDIA_ORGANISATION_REQUEST_VERSION
});
const MUTATION_KIND = 'media-organisation-mutation';
const AI_SUGGESTIONS_KIND = 'media-organisation-ai-suggestions';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MEDIA_ID_PATTERN = UUID_PATTERN;
const MAX_NAME_LENGTH = 80;
const MAX_LABEL_LENGTH = 80;
const MAX_MEDIA_IDS = 500;
const MAX_TAG_IDS = 64;
const ORIENTATIONS = new Set(['portrait', 'landscape', 'square']);
const AVAILABILITY = new Set(['ready', 'missing', 'corrupt', 'unsupported', 'needs-relink', 'unknown']);
const KINDS = new Set(['image', 'video']);
const SORTS = new Set(['imported-desc', 'imported-asc', 'filename-asc', 'filename-desc', 'kind-asc', 'duration-asc', 'duration-desc']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported fields.`);
}

function assertVersion(value, kind) {
  if (value.kind !== kind || value.version !== MEDIA_ORGANISATION_REQUEST_VERSION) {
    throw new TypeError('media organisation request version is invalid.');
  }
}

function normaliseDisplayName(value, label = 'name') {
  if (typeof value !== 'string') throw new TypeError(`${label} is invalid.`);
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) throw new TypeError(`${label} is invalid.`);
  return name;
}

function normaliseLookupName(value, label = 'name') {
  return normaliseDisplayName(value, label).toLocaleLowerCase();
}

function normaliseSuggestionLabel(value) {
  if (typeof value !== 'string') throw new TypeError('AI suggestion label is invalid.');
  const label = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (label.length < 1 || label.length > MAX_LABEL_LENGTH) throw new TypeError('AI suggestion label is invalid.');
  return label;
}

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function assertMediaId(value) {
  if (typeof value !== 'string' || !MEDIA_ID_PATTERN.test(value)) throw new TypeError('mediaId is invalid.');
  return value;
}

function validateIdArray(value, { label, max, validator }) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new TypeError(`${label} must be a bounded non-empty array.`);
  const seen = new Set();
  const output = [];
  for (const item of value) {
    validator(item);
    if (seen.has(item)) continue;
    seen.add(item);
    output.push(item);
  }
  return Object.freeze(output);
}

function finiteOptional(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${label} is invalid.`);
  return number;
}

function dateOptional(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} is invalid.`);
  return new Date(value).toISOString();
}

function validateSavedViewCriteria(value) {
  if (!isPlainObject(value)) throw new TypeError('saved view criteria must be an object.');
  const allowed = new Set([
    'query', 'tagIds', 'collectionId', 'mediaKind', 'availability', 'importedAfter', 'importedBefore',
    'minDurationSeconds', 'maxDurationSeconds', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'orientation', 'sort'
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError('saved view criteria contains unsupported fields.');
  const query = value.query == null ? '' : String(value.query).normalize('NFKC').trim();
  if (query.length > 160) throw new TypeError('saved view query is too long.');
  const tagIds = value.tagIds == null || (Array.isArray(value.tagIds) && value.tagIds.length === 0)
    ? []
    : [...validateIdArray(value.tagIds, { label: 'tagIds', max: MAX_TAG_IDS, validator: (id) => assertUuid(id, 'tagId') })];
  const collectionId = value.collectionId == null || value.collectionId === '' ? null : assertUuid(value.collectionId, 'collectionId');
  const mediaKind = value.mediaKind == null || value.mediaKind === '' ? null : value.mediaKind;
  if (mediaKind !== null && !KINDS.has(mediaKind)) throw new TypeError('mediaKind is invalid.');
  const availability = value.availability == null || value.availability === '' ? null : value.availability;
  if (availability !== null && !AVAILABILITY.has(availability)) throw new TypeError('availability is invalid.');
  const orientation = value.orientation == null || value.orientation === '' ? null : value.orientation;
  if (orientation !== null && !ORIENTATIONS.has(orientation)) throw new TypeError('orientation is invalid.');
  const sort = value.sort ?? 'imported-desc';
  if (!SORTS.has(sort)) throw new TypeError('sort is invalid.');
  const result = {
    query,
    tagIds,
    collectionId,
    mediaKind,
    availability,
    importedAfter: dateOptional(value.importedAfter, 'importedAfter'),
    importedBefore: dateOptional(value.importedBefore, 'importedBefore'),
    minDurationSeconds: finiteOptional(value.minDurationSeconds, 'minDurationSeconds'),
    maxDurationSeconds: finiteOptional(value.maxDurationSeconds, 'maxDurationSeconds'),
    minWidth: finiteOptional(value.minWidth, 'minWidth'),
    maxWidth: finiteOptional(value.maxWidth, 'maxWidth'),
    minHeight: finiteOptional(value.minHeight, 'minHeight'),
    maxHeight: finiteOptional(value.maxHeight, 'maxHeight'),
    orientation,
    sort
  };
  for (const [minimum, maximum] of [['minDurationSeconds', 'maxDurationSeconds'], ['minWidth', 'maxWidth'], ['minHeight', 'maxHeight']]) {
    if (result[minimum] !== null && result[maximum] !== null && result[minimum] > result[maximum]) throw new TypeError(`${minimum} exceeds ${maximum}.`);
  }
  if (result.importedAfter && result.importedBefore && result.importedAfter > result.importedBefore) throw new TypeError('importedAfter exceeds importedBefore.');
  return Object.freeze(result);
}

function validateSnapshotRequest(value) {
  assertExactKeys(value, ['kind', 'version'], 'media organisation snapshot request');
  assertVersion(value, 'media-organisation-snapshot');
  return MEDIA_ORGANISATION_SNAPSHOT_REQUEST;
}

function validateAiSuggestionsRequest(value) {
  assertExactKeys(value, ['kind', 'version', 'mediaId'], 'AI suggestion request');
  assertVersion(value, AI_SUGGESTIONS_KIND);
  assertMediaId(value.mediaId);
  return Object.freeze({ kind: value.kind, version: value.version, mediaId: value.mediaId });
}

function validateMutationRequest(value) {
  if (!isPlainObject(value)) throw new TypeError('media organisation mutation request must be an object.');
  if (value.kind !== MUTATION_KIND || value.version !== MEDIA_ORGANISATION_REQUEST_VERSION || typeof value.action !== 'string') {
    throw new TypeError('media organisation mutation request is invalid.');
  }
  const base = { kind: value.kind, version: value.version, action: value.action };
  switch (value.action) {
    case 'tag-create':
      assertExactKeys(value, ['kind', 'version', 'action', 'name'], 'tag-create request');
      return Object.freeze({ ...base, name: normaliseDisplayName(value.name, 'tag name') });
    case 'tag-rename':
      assertExactKeys(value, ['kind', 'version', 'action', 'tagId', 'name'], 'tag-rename request');
      return Object.freeze({ ...base, tagId: assertUuid(value.tagId, 'tagId'), name: normaliseDisplayName(value.name, 'tag name') });
    case 'tag-delete':
      assertExactKeys(value, ['kind', 'version', 'action', 'tagId'], 'tag-delete request');
      return Object.freeze({ ...base, tagId: assertUuid(value.tagId, 'tagId') });
    case 'tag-assign':
    case 'tag-remove':
      assertExactKeys(value, ['kind', 'version', 'action', 'tagIds', 'mediaIds'], `${value.action} request`);
      return Object.freeze({
        ...base,
        tagIds: validateIdArray(value.tagIds, { label: 'tagIds', max: MAX_TAG_IDS, validator: (id) => assertUuid(id, 'tagId') }),
        mediaIds: validateIdArray(value.mediaIds, { label: 'mediaIds', max: MAX_MEDIA_IDS, validator: assertMediaId })
      });
    case 'collection-create':
      assertExactKeys(value, ['kind', 'version', 'action', 'name'], 'collection-create request');
      return Object.freeze({ ...base, name: normaliseDisplayName(value.name, 'collection name') });
    case 'collection-rename':
      assertExactKeys(value, ['kind', 'version', 'action', 'collectionId', 'name'], 'collection-rename request');
      return Object.freeze({ ...base, collectionId: assertUuid(value.collectionId, 'collectionId'), name: normaliseDisplayName(value.name, 'collection name') });
    case 'collection-archive':
    case 'collection-delete':
      assertExactKeys(value, ['kind', 'version', 'action', 'collectionId'], `${value.action} request`);
      return Object.freeze({ ...base, collectionId: assertUuid(value.collectionId, 'collectionId') });
    case 'collection-add-media':
    case 'collection-remove-media':
      assertExactKeys(value, ['kind', 'version', 'action', 'collectionId', 'mediaIds'], `${value.action} request`);
      return Object.freeze({
        ...base,
        collectionId: assertUuid(value.collectionId, 'collectionId'),
        mediaIds: validateIdArray(value.mediaIds, { label: 'mediaIds', max: MAX_MEDIA_IDS, validator: assertMediaId })
      });
    case 'saved-view-save':
      assertExactKeys(value, ['kind', 'version', 'action', 'name', 'criteria'], 'saved-view-save request');
      return Object.freeze({ ...base, name: normaliseDisplayName(value.name, 'saved view name'), criteria: validateSavedViewCriteria(value.criteria) });
    case 'saved-view-delete':
      assertExactKeys(value, ['kind', 'version', 'action', 'savedViewId'], 'saved-view-delete request');
      return Object.freeze({ ...base, savedViewId: assertUuid(value.savedViewId, 'savedViewId') });
    case 'ai-suggestion-accept':
    case 'ai-suggestion-dismiss':
      assertExactKeys(value, ['kind', 'version', 'action', 'mediaId', 'label'], `${value.action} request`);
      return Object.freeze({ ...base, mediaId: assertMediaId(value.mediaId), label: normaliseSuggestionLabel(value.label) });
    default:
      throw new TypeError('media organisation mutation action is unsupported.');
  }
}

function mutationRequest(action, fields = {}) {
  return Object.freeze({ ...fields, kind: MUTATION_KIND, version: MEDIA_ORGANISATION_REQUEST_VERSION, action });
}

function aiSuggestionsRequest(mediaId) {
  return Object.freeze({ kind: AI_SUGGESTIONS_KIND, version: MEDIA_ORGANISATION_REQUEST_VERSION, mediaId });
}

module.exports = {
  AI_SUGGESTIONS_KIND,
  MAX_LABEL_LENGTH,
  MAX_MEDIA_IDS,
  MAX_NAME_LENGTH,
  MAX_TAG_IDS,
  MEDIA_ORGANISATION_IPC_CHANNELS,
  MEDIA_ORGANISATION_REQUEST_VERSION,
  MEDIA_ORGANISATION_SCHEMA_VERSION,
  MEDIA_ORGANISATION_SNAPSHOT_REQUEST,
  MUTATION_KIND,
  aiSuggestionsRequest,
  assertMediaId,
  assertUuid,
  mutationRequest,
  normaliseDisplayName,
  normaliseLookupName,
  normaliseSuggestionLabel,
  validateAiSuggestionsRequest,
  validateMutationRequest,
  validateSavedViewCriteria,
  validateSnapshotRequest
};

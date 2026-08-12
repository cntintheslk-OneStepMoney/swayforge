'use strict';

const MEDIA_INDEX_SCHEMA_VERSION = 2;
const MEDIA_INDEX_REQUEST_VERSION = 1;
const MEDIA_INDEX_IPC_CHANNELS = Object.freeze({
  search: 'swayforge:media:index:search',
  status: 'swayforge:media:index:status',
  rebuild: 'swayforge:media:index:rebuild'
});
const MEDIA_INDEX_STATUS_REQUEST = Object.freeze({ kind: 'media-index-status', version: MEDIA_INDEX_REQUEST_VERSION });
const MEDIA_INDEX_REBUILD_REQUEST = Object.freeze({ kind: 'media-index-rebuild', version: MEDIA_INDEX_REQUEST_VERSION });
const SORTS = new Set(['imported-desc', 'imported-asc', 'filename-asc', 'filename-desc', 'kind-asc', 'duration-asc', 'duration-desc']);
const KINDS = new Set(['image', 'video']);
const AVAILABILITY = new Set(['ready', 'missing', 'corrupt', 'unsupported', 'needs-relink', 'unknown']);
const ORIENTATIONS = new Set(['portrait', 'landscape', 'square']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_QUERY_LENGTH = 160;
const MAX_LIMIT = 100;
const MAX_TAG_FILTERS = 32;

function isExactRequest(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.join(',') === 'kind,version' && value.kind === expected.kind && value.version === expected.version;
}

function finiteOptional(value, name, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min) throw new TypeError(`${name} is invalid.`);
  return number;
}

function dateOptional(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) throw new TypeError(`${name} is invalid.`);
  return new Date(value).toISOString();
}

function uuidOptional(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${name} is invalid.`);
  return value;
}

function tagIdsOptional(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_TAG_FILTERS) throw new TypeError('tagIds is invalid.');
  const output = [];
  const seen = new Set();
  for (const tagId of value) {
    if (typeof tagId !== 'string' || !UUID_PATTERN.test(tagId)) throw new TypeError('tagIds is invalid.');
    if (seen.has(tagId)) continue;
    seen.add(tagId);
    output.push(tagId);
  }
  return Object.freeze(output);
}

function validateMediaIndexSearchRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('media index search request must be an object.');
  const allowed = new Set([
    'kind', 'version', 'query', 'tagIds', 'collectionId', 'mediaKind', 'availability', 'orientation',
    'importedAfter', 'importedBefore', 'minDurationSeconds', 'maxDurationSeconds', 'minWidth', 'maxWidth',
    'minHeight', 'maxHeight', 'sort', 'offset', 'limit'
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError('media index search request contains unsupported fields.');
  if (value.kind !== 'media-index-search' || value.version !== MEDIA_INDEX_REQUEST_VERSION) throw new TypeError('media index search request version is invalid.');
  const query = value.query == null ? '' : String(value.query).normalize('NFKC').trim();
  if (query.length > MAX_QUERY_LENGTH) throw new TypeError('media index query is too long.');
  const mediaKind = value.mediaKind == null || value.mediaKind === '' ? null : value.mediaKind;
  if (mediaKind !== null && !KINDS.has(mediaKind)) throw new TypeError('mediaKind is invalid.');
  const availability = value.availability == null || value.availability === '' ? null : value.availability;
  if (availability !== null && !AVAILABILITY.has(availability)) throw new TypeError('availability is invalid.');
  const orientation = value.orientation == null || value.orientation === '' ? null : value.orientation;
  if (orientation !== null && !ORIENTATIONS.has(orientation)) throw new TypeError('orientation is invalid.');
  const sort = value.sort ?? 'imported-desc';
  if (!SORTS.has(sort)) throw new TypeError('sort is invalid.');
  const offset = value.offset ?? 0;
  const limit = value.limit ?? 60;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new TypeError('offset is invalid.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new TypeError('limit is invalid.');
  const result = {
    kind: value.kind,
    version: value.version,
    query,
    tagIds: tagIdsOptional(value.tagIds),
    collectionId: uuidOptional(value.collectionId, 'collectionId'),
    mediaKind,
    availability,
    orientation,
    importedAfter: dateOptional(value.importedAfter, 'importedAfter'),
    importedBefore: dateOptional(value.importedBefore, 'importedBefore'),
    minDurationSeconds: finiteOptional(value.minDurationSeconds, 'minDurationSeconds'),
    maxDurationSeconds: finiteOptional(value.maxDurationSeconds, 'maxDurationSeconds'),
    minWidth: finiteOptional(value.minWidth, 'minWidth'),
    maxWidth: finiteOptional(value.maxWidth, 'maxWidth'),
    minHeight: finiteOptional(value.minHeight, 'minHeight'),
    maxHeight: finiteOptional(value.maxHeight, 'maxHeight'),
    sort,
    offset,
    limit
  };
  for (const [minimum, maximum] of [['minDurationSeconds', 'maxDurationSeconds'], ['minWidth', 'maxWidth'], ['minHeight', 'maxHeight']]) {
    if (result[minimum] !== null && result[maximum] !== null && result[minimum] > result[maximum]) throw new TypeError(`${minimum} exceeds ${maximum}.`);
  }
  if (result.importedAfter && result.importedBefore && result.importedAfter > result.importedBefore) throw new TypeError('importedAfter exceeds importedBefore.');
  return Object.freeze(result);
}

module.exports = {
  MAX_LIMIT,
  MAX_TAG_FILTERS,
  MEDIA_INDEX_IPC_CHANNELS,
  MEDIA_INDEX_REBUILD_REQUEST,
  MEDIA_INDEX_REQUEST_VERSION,
  MEDIA_INDEX_SCHEMA_VERSION,
  MEDIA_INDEX_STATUS_REQUEST,
  isExactRequest,
  validateMediaIndexSearchRequest
};

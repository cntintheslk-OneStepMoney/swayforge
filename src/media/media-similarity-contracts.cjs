'use strict';

const MEDIA_SIMILARITY_SCHEMA_VERSION = 1;
const MEDIA_SIMILARITY_METHOD_VERSION = 'perceptual-dhash-multisample-v1';
const VIDEO_SIMILARITY_SAMPLE_FRACTIONS = Object.freeze([0.1, 0.5, 0.9]);
const MEDIA_SIMILARITY_IPC_CHANNELS = Object.freeze({
  find: 'swayforge:media:similarity:find',
  status: 'swayforge:media:similarity:status',
  rebuild: 'swayforge:media:similarity:rebuild'
});
const MEDIA_SIMILARITY_STATUS_REQUEST = Object.freeze({ kind: 'media-similarity-status', version: 1 });
const MEDIA_SIMILARITY_REBUILD_REQUEST = Object.freeze({ kind: 'media-similarity-rebuild', version: 1 });

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExactRequest(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function validateFindSimilarityRequest(value) {
  if (!isPlainObject(value)) throw new TypeError('Similarity request must be an object.');
  const allowed = new Set(['kind', 'version', 'mediaId', 'limit', 'includeRelated']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError('Similarity request contains unknown fields.');
  if (value.kind !== 'media-similarity-find' || value.version !== 1) throw new TypeError('Similarity request kind/version is invalid.');
  if (typeof value.mediaId !== 'string' || value.mediaId.length === 0 || value.mediaId.length > 128) throw new TypeError('mediaId is invalid.');
  const limit = value.limit === undefined ? 24 : value.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit is invalid.');
  const includeRelated = value.includeRelated === undefined ? true : value.includeRelated;
  if (typeof includeRelated !== 'boolean') throw new TypeError('includeRelated is invalid.');
  return Object.freeze({ mediaId: value.mediaId, limit, includeRelated });
}

module.exports = {
  MEDIA_SIMILARITY_IPC_CHANNELS,
  MEDIA_SIMILARITY_METHOD_VERSION,
  MEDIA_SIMILARITY_REBUILD_REQUEST,
  MEDIA_SIMILARITY_SCHEMA_VERSION,
  MEDIA_SIMILARITY_STATUS_REQUEST,
  VIDEO_SIMILARITY_SAMPLE_FRACTIONS,
  isExactRequest,
  validateFindSimilarityRequest
};

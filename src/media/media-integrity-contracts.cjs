'use strict';

const MEDIA_INTEGRITY_IPC_CHANNELS = Object.freeze({
  scan: 'swayforge:media:integrity:scan',
  repair: 'swayforge:media:integrity:repair',
  rebuildDerived: 'swayforge:media:integrity:rebuild-derived'
});

const MEDIA_INTEGRITY_SCAN_KIND = 'media-integrity-scan';
const MEDIA_INTEGRITY_REPAIR_KIND = 'media-integrity-repair';
const MEDIA_INTEGRITY_REBUILD_DERIVED_KIND = 'media-integrity-rebuild-derived';
const MAX_SCAN_ITEMS = 250;
const DERIVED_TARGETS = Object.freeze(['preview', 'index', 'similarity', 'ai']);
const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowedKeys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field.`);
}

function assertMediaId(value, label = 'mediaId') {
  if (typeof value !== 'string' || !MEDIA_ID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function validateScanRequest(value) {
  assertExactKeys(value, ['kind', 'version', 'mediaIds', 'forceHash'], 'media integrity scan request');
  if (value.kind !== MEDIA_INTEGRITY_SCAN_KIND || value.version !== 1) throw new TypeError('Invalid media integrity scan request.');
  if (value.mediaIds !== undefined) {
    if (!Array.isArray(value.mediaIds) || value.mediaIds.length > MAX_SCAN_ITEMS) throw new TypeError('mediaIds must be a bounded array.');
    const seen = new Set();
    for (const mediaId of value.mediaIds) {
      assertMediaId(mediaId);
      if (seen.has(mediaId)) throw new TypeError('mediaIds must not contain duplicates.');
      seen.add(mediaId);
    }
  }
  if (value.forceHash !== undefined && typeof value.forceHash !== 'boolean') throw new TypeError('forceHash must be boolean.');
  return Object.freeze({ mediaIds: value.mediaIds ? Object.freeze([...value.mediaIds]) : null, forceHash: value.forceHash === true });
}

function validateRepairRequest(value) {
  assertExactKeys(value, ['kind', 'version', 'mediaId'], 'media integrity repair request');
  if (value.kind !== MEDIA_INTEGRITY_REPAIR_KIND || value.version !== 1) throw new TypeError('Invalid media integrity repair request.');
  return Object.freeze({ mediaId: assertMediaId(value.mediaId) });
}

function validateRebuildDerivedRequest(value) {
  assertExactKeys(value, ['kind', 'version', 'mediaId', 'targets'], 'media integrity derived rebuild request');
  if (value.kind !== MEDIA_INTEGRITY_REBUILD_DERIVED_KIND || value.version !== 1) throw new TypeError('Invalid media integrity derived rebuild request.');
  assertMediaId(value.mediaId);
  if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > DERIVED_TARGETS.length) {
    throw new TypeError('targets must be a non-empty bounded array.');
  }
  const unique = new Set();
  for (const target of value.targets) {
    if (!DERIVED_TARGETS.includes(target) || unique.has(target)) throw new TypeError('targets contains an invalid or duplicate target.');
    unique.add(target);
  }
  return Object.freeze({ mediaId: value.mediaId, targets: Object.freeze([...value.targets]) });
}

module.exports = {
  DERIVED_TARGETS,
  MAX_SCAN_ITEMS,
  MEDIA_INTEGRITY_IPC_CHANNELS,
  MEDIA_INTEGRITY_REBUILD_DERIVED_KIND,
  MEDIA_INTEGRITY_REPAIR_KIND,
  MEDIA_INTEGRITY_SCAN_KIND,
  validateRebuildDerivedRequest,
  validateRepairRequest,
  validateScanRequest
};

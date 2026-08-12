'use strict';

(function initialiseMediaLibraryModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SwayForgeMediaLibraryModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_RENDER_LIMIT = 60;
  const RENDER_STEP = 60;
  const MAX_RENDER_LIMIT = 6000;
  const AVAILABILITY_STATES = Object.freeze(['ready', 'missing', 'corrupt', 'unsupported', 'needs-relink', 'unknown']);
  const SORT_OPTIONS = Object.freeze([
    'newest',
    'oldest',
    'name',
    'type',
    'duration-longest',
    'duration-shortest'
  ]);

  function safeString(value, fallback = '') {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  }

  function safeNullableInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function safeNullableNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function normaliseKind(value) {
    return value === 'image' || value === 'video' ? value : 'unknown';
  }

  function normaliseAvailability(value) {
    const candidate = safeString(value, 'unknown').toLowerCase();
    return AVAILABILITY_STATES.includes(candidate) ? candidate : 'unknown';
  }

  function normaliseMediaItem(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const id = safeString(value.id);
    if (!id) return null;
    return Object.freeze({
      id,
      kind: normaliseKind(value.kind),
      originalFilename: safeString(value.originalFilename, 'Unnamed media'),
      fileSize: safeNullableInteger(value.fileSize),
      importedAt: safeString(value.importedAt) || null,
      width: safeNullableInteger(value.width),
      height: safeNullableInteger(value.height),
      durationSeconds: safeNullableNumber(value.durationSeconds),
      availability: normaliseAvailability(value.availability)
    });
  }

  function extractMediaItems(payload) {
    const source = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.media)
        ? payload.media
        : [];
    const unique = new Map();
    for (const value of source) {
      const item = normaliseMediaItem(value);
      if (item && !unique.has(item.id)) unique.set(item.id, item);
    }
    return Object.freeze(Array.from(unique.values()));
  }

  function timestampOf(value) {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function compareNullableNumbers(left, right, direction = 1) {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * direction;
  }

  function compareItems(left, right, sort) {
    if (sort === 'oldest' || sort === 'newest') {
      const leftTime = timestampOf(left.importedAt);
      const rightTime = timestampOf(right.importedAt);
      const direction = sort === 'oldest' ? 1 : -1;
      const byDate = compareNullableNumbers(leftTime, rightTime, direction);
      if (byDate !== 0) return byDate;
    }
    if (sort === 'name') {
      const byName = left.originalFilename.localeCompare(right.originalFilename, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
    }
    if (sort === 'type') {
      const byKind = left.kind.localeCompare(right.kind);
      if (byKind !== 0) return byKind;
      const byName = left.originalFilename.localeCompare(right.originalFilename, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
    }
    if (sort === 'duration-longest' || sort === 'duration-shortest') {
      const direction = sort === 'duration-longest' ? -1 : 1;
      const byDuration = compareNullableNumbers(left.durationSeconds, right.durationSeconds, direction);
      if (byDuration !== 0) return byDuration;
    }
    return left.id.localeCompare(right.id);
  }

  function applyLibraryQuery(items, options = {}) {
    const source = Array.isArray(items) ? items : [];
    const kind = options.kind === 'image' || options.kind === 'video' ? options.kind : 'all';
    const availability = AVAILABILITY_STATES.includes(options.availability) ? options.availability : 'all';
    const sort = SORT_OPTIONS.includes(options.sort) ? options.sort : 'newest';
    return source
      .filter((item) => kind === 'all' || item.kind === kind)
      .filter((item) => availability === 'all' || item.availability === availability)
      .slice()
      .sort((left, right) => compareItems(left, right, sort));
  }

  function reconcileSelection(selectedIds, items) {
    const existing = new Set((Array.isArray(items) ? items : []).map((item) => item.id));
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    return new Set(Array.from(selected).filter((id) => existing.has(id)));
  }

  function clampRenderLimit(value) {
    if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_RENDER_LIMIT;
    return Math.min(value, MAX_RENDER_LIMIT);
  }

  function visibleItems(items, limit = DEFAULT_RENDER_LIMIT) {
    const source = Array.isArray(items) ? items : [];
    return source.slice(0, clampRenderLimit(limit));
  }

  function nextRenderLimit(currentLimit, totalItems) {
    const current = clampRenderLimit(currentLimit);
    const total = Number.isSafeInteger(totalItems) && totalItems >= 0 ? totalItems : 0;
    return Math.min(Math.max(current + RENDER_STEP, DEFAULT_RENDER_LIMIT), total, MAX_RENDER_LIMIT);
  }

  function formatDate(value) {
    const timestamp = timestampOf(value);
    if (timestamp === null) return 'Unknown date';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp));
  }

  function formatFileSize(value) {
    if (!Number.isSafeInteger(value) || value < 0) return 'Unknown size';
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const precision = size >= 10 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  }

  function formatDuration(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Unknown duration';
    const rounded = Math.round(value);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatDimensions(item) {
    return Number.isSafeInteger(item?.width) && Number.isSafeInteger(item?.height)
      ? `${item.width}×${item.height}`
      : 'Unknown dimensions';
  }

  function availabilityLabel(value) {
    const labels = Object.freeze({
      ready: 'Ready',
      missing: 'Missing',
      corrupt: 'Corrupt',
      unsupported: 'Unsupported',
      'needs-relink': 'Needs relink',
      unknown: 'Unknown'
    });
    return labels[normaliseAvailability(value)];
  }

  function kindLabel(value) {
    return value === 'video' ? 'Video' : value === 'image' ? 'Image' : 'Media';
  }

  return Object.freeze({
    AVAILABILITY_STATES,
    DEFAULT_RENDER_LIMIT,
    RENDER_STEP,
    SORT_OPTIONS,
    applyLibraryQuery,
    availabilityLabel,
    extractMediaItems,
    formatDate,
    formatDimensions,
    formatDuration,
    formatFileSize,
    kindLabel,
    nextRenderLimit,
    normaliseMediaItem,
    reconcileSelection,
    visibleItems
  });
});

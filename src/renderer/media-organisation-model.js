'use strict';

(function initialiseMediaOrganisationModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SwayForgeMediaOrganisationModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SORT_MAP = Object.freeze({
    newest: 'imported-desc',
    oldest: 'imported-asc',
    name: 'filename-asc',
    type: 'kind-asc',
    'duration-longest': 'duration-desc',
    'duration-shortest': 'duration-asc'
  });

  function emptyCriteria() {
    return Object.freeze({
      query: '', tagIds: Object.freeze([]), collectionId: null, mediaKind: null, availability: null,
      orientation: null, importedAfter: null, importedBefore: null, minDurationSeconds: null,
      maxDurationSeconds: null, minWidth: null, maxWidth: null, minHeight: null, maxHeight: null,
      sort: 'imported-desc'
    });
  }

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function nullableNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function dateToIso(value, endOfDay = false) {
    const candidate = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
    const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    const date = new Date(`${candidate}${suffix}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function isoToDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''; }

  function criteriaFromControls(values = {}) {
    const tagIds = Array.isArray(values.tagIds) ? [...new Set(values.tagIds.filter((id) => typeof id === 'string' && id))] : [];
    return Object.freeze({
      query: text(values.query).slice(0, 160),
      tagIds: Object.freeze(tagIds),
      collectionId: text(values.collectionId) || null,
      mediaKind: values.mediaKind === 'image' || values.mediaKind === 'video' ? values.mediaKind : null,
      availability: text(values.availability) && values.availability !== 'all' ? values.availability : null,
      orientation: ['landscape', 'portrait', 'square'].includes(values.orientation) ? values.orientation : null,
      importedAfter: dateToIso(values.importedAfter, false),
      importedBefore: dateToIso(values.importedBefore, true),
      minDurationSeconds: nullableNumber(values.minDurationSeconds),
      maxDurationSeconds: nullableNumber(values.maxDurationSeconds),
      minWidth: nullableNumber(values.minWidth), maxWidth: nullableNumber(values.maxWidth),
      minHeight: nullableNumber(values.minHeight), maxHeight: nullableNumber(values.maxHeight),
      sort: SORT_MAP[values.sort] || 'imported-desc'
    });
  }

  function toSearchRequest(criteria, { offset = 0, limit = 100 } = {}) {
    const source = criteria || emptyCriteria();
    return Object.freeze({ ...source, offset, limit });
  }

  function toSavedViewCriteria(criteria) {
    const { offset, limit, ...rest } = criteria || emptyCriteria();
    return Object.freeze({ ...rest, tagIds: Object.freeze([...(rest.tagIds || [])]) });
  }

  function hasActiveFilters(criteria) {
    const base = emptyCriteria();
    return Object.keys(base).some((key) => key !== 'sort' && key !== 'minWidth' && key !== 'maxWidth' && key !== 'minHeight' && key !== 'maxHeight'
      ? Array.isArray(criteria?.[key]) ? criteria[key].length > 0 : criteria?.[key] !== null && criteria?.[key] !== ''
      : ['minWidth','maxWidth','minHeight','maxHeight'].includes(key) && criteria?.[key] !== null);
  }

  function activeFilterLabels(criteria, organisation = {}) {
    const labels = [];
    if (criteria?.query) labels.push(`Search: ${criteria.query}`);
    const tags = new Map((organisation.tags || []).map((tag) => [tag.id, tag.name]));
    for (const tagId of criteria?.tagIds || []) labels.push(`Tag: ${tags.get(tagId) || 'Unknown tag'}`);
    const collection = (organisation.collections || []).find((item) => item.id === criteria?.collectionId);
    if (criteria?.collectionId) labels.push(`Collection: ${collection?.name || 'Unknown collection'}`);
    if (criteria?.mediaKind) labels.push(`Kind: ${criteria.mediaKind}`);
    if (criteria?.availability) labels.push(`State: ${criteria.availability}`);
    if (criteria?.orientation) labels.push(`Orientation: ${criteria.orientation}`);
    if (criteria?.importedAfter) labels.push(`After: ${isoToDate(criteria.importedAfter)}`);
    if (criteria?.importedBefore) labels.push(`Before: ${isoToDate(criteria.importedBefore)}`);
    if (criteria?.minDurationSeconds !== null && criteria?.minDurationSeconds !== undefined) labels.push(`Min duration: ${criteria.minDurationSeconds}s`);
    if (criteria?.maxDurationSeconds !== null && criteria?.maxDurationSeconds !== undefined) labels.push(`Max duration: ${criteria.maxDurationSeconds}s`);
    return Object.freeze(labels);
  }

  return Object.freeze({ SORT_MAP, activeFilterLabels, criteriaFromControls, emptyCriteria, hasActiveFilters, isoToDate, toSavedViewCriteria, toSearchRequest });
});

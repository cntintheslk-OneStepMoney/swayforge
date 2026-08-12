'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../src/renderer/media-organisation-model.js');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

test('reset criteria contains no active filters and keeps deterministic default sort', () => {
  const empty = model.emptyCriteria();
  assert.equal(model.hasActiveFilters(empty), false);
  assert.equal(empty.sort, 'imported-desc');
  assert.deepEqual(empty.tagIds, []);
});

test('renderer criteria map to bounded index request semantics', () => {
  const criteria = model.criteriaFromControls({
    query: ' sunset ', tagIds: ['tag-a', 'tag-a', 'tag-b'], collectionId: 'collection-a', mediaKind: 'video',
    availability: 'ready', orientation: 'landscape', importedAfter: '2026-08-01', importedBefore: '2026-08-12',
    minDurationSeconds: '5', maxDurationSeconds: '60', sort: 'duration-longest'
  });
  assert.equal(criteria.query, 'sunset');
  assert.deepEqual(criteria.tagIds, ['tag-a', 'tag-b']);
  assert.equal(criteria.sort, 'duration-desc');
  assert.equal(criteria.importedAfter, '2026-08-01T00:00:00.000Z');
  assert.equal(criteria.importedBefore, '2026-08-12T23:59:59.999Z');
  assert.deepEqual(model.toSearchRequest(criteria, { offset: 100, limit: 100 }), { ...criteria, offset: 100, limit: 100 });
});

test('active filter labels distinguish user organisation from generic search state', () => {
  const criteria = { ...model.emptyCriteria(), query: 'car', tagIds: ['tag-a'], collectionId: 'collection-a', orientation: 'portrait' };
  const labels = model.activeFilterLabels(criteria, { tags: [{ id: 'tag-a', name: 'Car Club' }], collections: [{ id: 'collection-a', name: 'Launch' }] });
  assert.deepEqual(labels, ['Search: car', 'Tag: Car Club', 'Collection: Launch', 'Orientation: portrait']);
});

test('organisation renderer uses explicit local controls and does not expose filesystem or generic IPC', () => {
  const source = read('src/renderer/media-organisation-library.js');
  assert.match(source, /Accept as tag/);
  assert.match(source, /AI-derived match/);
  assert.match(source, /deleteMediaCollection/);
  assert.doesNotMatch(source, /readFile|writeFile|sourcePath|managedReference|ipcRenderer|require\(/);
});

test('clear filters resets only search/filter controls before rerunning index search', () => {
  const source = read('src/renderer/media-organisation-library.js');
  const clearStart = source.indexOf("controller.clearFiltersButton.addEventListener('click'");
  assert.notEqual(clearStart, -1);
  const block = source.slice(clearStart, clearStart + 700);
  assert.match(block, /controls\.search\.value=''/);
  assert.match(block, /controls\.tagFilter\.selectedIndex=-1/);
  assert.match(block, /controls\.collectionFilter\.value=''/);
  assert.match(block, /runOrganisationSearch/);
  assert.doesNotMatch(block, /deleteMedia|deleteMediaTag|deleteMediaCollection/);
});

test('large organisation lists provide local filtering controls', () => {
  const source = read('src/renderer/media-organisation-library.js');
  assert.match(source, /placeholder = 'Filter tags'/);
  assert.match(source, /placeholder = 'Filter collections'/);
  assert.match(source, /tagListQuery/);
  assert.match(source, /collectionListQuery/);
});

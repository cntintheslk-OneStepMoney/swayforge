'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const model = require('../src/renderer/media-library-model.js');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function item(overrides = {}) {
  return {
    id: overrides.id ?? 'media-a',
    kind: overrides.kind ?? 'image',
    originalFilename: overrides.originalFilename ?? 'alpha.jpg',
    fileSize: overrides.fileSize ?? 2048,
    importedAt: overrides.importedAt ?? '2026-08-11T10:00:00.000Z',
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    durationSeconds: overrides.durationSeconds ?? null,
    availability: overrides.availability ?? 'ready'
  };
}

test('empty Media Library response produces an empty browse set', () => {
  assert.deepEqual(model.extractMediaItems({ storeRevision: 4, media: [] }), []);
  assert.deepEqual(model.applyLibraryQuery([], {}), []);
});

test('mixed image and video summaries retain only approved renderer metadata', () => {
  const payload = {
    storeRevision: 9,
    media: [
      item({ id: 'image-1', kind: 'image', originalFilename: 'photo.png', sha256: 'not-renderer-data' }),
      item({ id: 'video-1', kind: 'video', originalFilename: 'clip.mp4', durationSeconds: 12.4, sourcePath: 'private' })
    ]
  };
  const items = model.extractMediaItems(payload);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'image');
  assert.equal(items[1].kind, 'video');
  assert.equal(items[1].durationSeconds, 12.4);
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'availability',
    'durationSeconds',
    'fileSize',
    'height',
    'id',
    'importedAt',
    'kind',
    'originalFilename',
    'width'
  ]);
  assert.equal(Object.hasOwn(items[0], 'sha256'), false);
  assert.equal(Object.hasOwn(items[1], 'sourcePath'), false);
});

test('sort options use authoritative media summary fields without mutating source order', () => {
  const source = model.extractMediaItems({ media: [
    item({ id: 'b', originalFilename: 'Zulu.jpg', importedAt: '2026-08-10T10:00:00.000Z' }),
    item({ id: 'a', originalFilename: 'Alpha.jpg', importedAt: '2026-08-12T10:00:00.000Z' }),
    item({ id: 'c', kind: 'video', originalFilename: 'Movie.mp4', durationSeconds: 30, importedAt: '2026-08-11T10:00:00.000Z' })
  ] });
  const originalIds = source.map((entry) => entry.id);

  assert.deepEqual(model.applyLibraryQuery(source, { sort: 'newest' }).map((entry) => entry.id), ['a', 'c', 'b']);
  assert.deepEqual(model.applyLibraryQuery(source, { sort: 'oldest' }).map((entry) => entry.id), ['b', 'c', 'a']);
  assert.deepEqual(model.applyLibraryQuery(source, { sort: 'name' }).map((entry) => entry.id), ['a', 'c', 'b']);
  assert.deepEqual(model.applyLibraryQuery(source, { sort: 'type' }).map((entry) => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(source.map((entry) => entry.id), originalIds);
});

test('kind and availability filters combine without mutating media records', () => {
  const raw = [
    item({ id: 'ready-image', kind: 'image', availability: 'ready' }),
    item({ id: 'missing-image', kind: 'image', availability: 'missing' }),
    item({ id: 'ready-video', kind: 'video', availability: 'ready', durationSeconds: 5 })
  ];
  const before = structuredClone(raw);
  const items = model.extractMediaItems({ media: raw });
  const filtered = model.applyLibraryQuery(items, { kind: 'image', availability: 'missing' });
  assert.deepEqual(filtered.map((entry) => entry.id), ['missing-image']);
  assert.deepEqual(raw, before);
});

test('single and multi-selection remain stable by media ID across ordinary rerenders', () => {
  const items = model.extractMediaItems({ media: [item({ id: 'one' }), item({ id: 'two' }), item({ id: 'three' })] });
  const single = model.reconcileSelection(new Set(['two']), items);
  assert.deepEqual(Array.from(single), ['two']);

  const multi = model.reconcileSelection(new Set(['one', 'three']), model.applyLibraryQuery(items, { sort: 'name' }));
  assert.deepEqual(Array.from(multi).sort(), ['one', 'three']);

  const afterReload = model.reconcileSelection(new Set(['one', 'gone', 'three']), items);
  assert.deepEqual(Array.from(afterReload).sort(), ['one', 'three']);
});

test('missing and unknown availability stay visibly distinct from ready media', () => {
  const items = model.extractMediaItems({ media: [
    item({ id: 'ready', availability: 'ready' }),
    item({ id: 'missing', availability: 'missing' }),
    item({ id: 'odd', availability: 'new-future-state' })
  ] });
  assert.equal(items.find((entry) => entry.id === 'ready').availability, 'ready');
  assert.equal(items.find((entry) => entry.id === 'missing').availability, 'missing');
  assert.equal(items.find((entry) => entry.id === 'odd').availability, 'unknown');
  assert.equal(model.availabilityLabel('missing'), 'Missing');
});

test('duplicate media IDs are rendered once and do not create duplicate view records', () => {
  const items = model.extractMediaItems({ media: [
    item({ id: 'same', originalFilename: 'first.jpg' }),
    item({ id: 'same', originalFilename: 'duplicate-view.jpg' })
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].originalFilename, 'first.jpg');
});

test('rerender implementation keeps event registration outside render paths', () => {
  const source = read('src/renderer/media-library.js');
  const renderStart = source.indexOf('    render() {');
  const selectionSummaryStart = source.indexOf('    updateSelectionSummary() {');
  assert.notEqual(renderStart, -1);
  assert.notEqual(selectionSummaryStart, -1);
  assert.doesNotMatch(source.slice(renderStart, selectionSummaryStart), /addEventListener\(/);
  assert.match(source, /registerHandlers\(\)/);
  assert.match(source, /itemsElement\.addEventListener\('change'/);
});

test('Media Library uses native keyboard-operable controls and explicit selection semantics', () => {
  const html = read('src/renderer/index.html');
  const source = read('src/renderer/media-library.js');
  assert.match(html, /<button id="media-view-grid"/);
  assert.match(html, /<select id="media-kind-filter">/);
  assert.match(html, /<ul id="media-library-items"/);
  assert.match(source, /checkbox\.type = 'checkbox'/);
  assert.match(source, /media-card__selection-text/);
  assert.doesNotMatch(html, /role="button"/);
});

test('preview-unavailable state is safe until the dedicated local preview service exists', () => {
  const source = read('src/renderer/media-library.js');
  assert.match(source, /Preview unavailable/);
  assert.doesNotMatch(source, /document\.createElement\(['"](?:img|video)['"]\)/);
  assert.doesNotMatch(source, /createObjectURL/);
});

test('large synthetic libraries use a bounded progressive render window', () => {
  const large = Array.from({ length: 1500 }, (_, index) => model.normaliseMediaItem(item({
    id: `media-${String(index).padStart(4, '0')}`,
    originalFilename: `clip-${index}.jpg`
  })));
  assert.equal(model.visibleItems(large).length, model.DEFAULT_RENDER_LIMIT);
  assert.equal(model.DEFAULT_RENDER_LIMIT, 60);
  assert.equal(model.nextRenderLimit(60, large.length), 120);
  assert.equal(model.visibleItems(large, 120).length, 120);
});

test('Media Library does not introduce arbitrary path or filesystem access', () => {
  const sources = [
    read('src/renderer/media-library-model.js'),
    read('src/renderer/media-library.js'),
    read('src/renderer/renderer-app.js')
  ].join('\n');
  assert.doesNotMatch(sources, /\breadFile\b/);
  assert.doesNotMatch(sources, /managedReference/);
  assert.doesNotMatch(sources, /sourcePath/);
  assert.doesNotMatch(sources, /file:\/\//);
  assert.doesNotMatch(sources, /sha256/);
});

test('duration and safe display formatting remain deterministic', () => {
  const videos = model.extractMediaItems({ media: [
    item({ id: 'short', kind: 'video', durationSeconds: 4 }),
    item({ id: 'unknown', kind: 'video', durationSeconds: null }),
    item({ id: 'long', kind: 'video', durationSeconds: 65 })
  ] });
  assert.deepEqual(
    model.applyLibraryQuery(videos, { sort: 'duration-longest' }).map((entry) => entry.id),
    ['long', 'short', 'unknown']
  );
  assert.equal(model.formatDuration(65), '1:05');
  assert.equal(model.formatFileSize(2048), '2.0 KB');
  assert.equal(model.formatDimensions(videos[0]), '1920×1080');
});

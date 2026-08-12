'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MEDIA_PREVIEW_REQUEST_KIND,
  MEDIA_PREVIEW_REBUILD_REQUEST_KIND,
  validateMediaPreviewRequest
} = require('../src/media/media-contracts.cjs');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Electron composes preview bootstrap before integrity extension and registers scheme before foundation main loads', () => {
  const packageJson = JSON.parse(read('package.json'));
  const composition = read(packageJson.main);
  const source = read('src/main/preview-bootstrap.cjs');
  assert.equal(packageJson.main, 'src/main/application-bootstrap.cjs');
  assert.ok(composition.indexOf("require('./preview-bootstrap.cjs')") < composition.indexOf("require('./integrity-bootstrap.cjs')"));
  assert.ok(source.indexOf('registerMediaPreviewScheme(protocol)') < source.indexOf("require('./main-process.cjs')"));
  assert.match(source, /app\.getPath\('userData'\).*CACHE_DIRECTORY_NAME/s);
  assert.match(source, /MEDIA_PREVIEW_GENERATOR_VERSION = 'electron-native-preview-v1'/);
  assert.doesNotMatch(source, /child_process|shell:\s*true|exec\(|spawn\(/);
});

test('preview IPC contract accepts only typed UUID requests', () => {
  const mediaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(validateMediaPreviewRequest({ kind: MEDIA_PREVIEW_REQUEST_KIND, version: 1, mediaId }).mediaId, mediaId);
  assert.equal(validateMediaPreviewRequest({ kind: MEDIA_PREVIEW_REBUILD_REQUEST_KIND, version: 1, mediaId }, MEDIA_PREVIEW_REBUILD_REQUEST_KIND).mediaId, mediaId);
  assert.throws(() => validateMediaPreviewRequest({ kind: MEDIA_PREVIEW_REQUEST_KIND, version: 1, mediaId: '../../secret' }), TypeError);
  assert.throws(() => validateMediaPreviewRequest({ kind: MEDIA_PREVIEW_REQUEST_KIND, version: 1, mediaId, sourcePath: 'private' }), TypeError);
});

test('preload exposes typed preview operations without filesystem paths', () => {
  const source = read('src/preload/preload-bridge.cjs');
  assert.match(source, /requestMediaPreview:/);
  assert.match(source, /rebuildMediaPreview:/);
  assert.match(source, /swayforge:media:preview/);
  assert.doesNotMatch(source, /managedReference|sourcePath|destinationPath|readFile|writeFile|file:\/\//);
});

test('renderer allows only controlled local preview URLs and loads preview wrapper before app boot', () => {
  const html = read('src/renderer/index.html');
  const source = read('src/renderer/media-preview-library.js');
  assert.match(html, /img-src 'self' swayforge-preview:/);
  assert.ok(html.indexOf('./media-library.js') < html.indexOf('./media-preview-library.js'));
  assert.ok(html.indexOf('./media-preview-library.js') < html.indexOf('./renderer-app.js'));
  assert.match(source, /PREVIEW_URL_PATTERN = \/\^swayforge-preview:/);
  assert.match(source, /document\.createElement\('img'\)/);
  assert.match(source, /querySelectorAll\('\[data-media-id\]'\)/);
  assert.doesNotMatch(source, /managedReference|sourcePath|sha256|file:\/\/|createObjectURL/);
});

test('preview styling keeps thumbnails bounded in grid and list layouts', () => {
  const css = read('src/renderer/media-library.css');
  assert.match(css, /\.media-card__preview--ready/);
  assert.match(css, /\.media-card__preview-image/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /data-layout="list"[^}]*media-card__preview-image/s);
});

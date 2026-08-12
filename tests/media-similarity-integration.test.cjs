'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('preload exposes only typed similarity operations and no destructive action', () => {
  const preload = read('src/preload/preload-bridge.cjs');
  assert.match(preload, /findSimilarMedia:/);
  assert.match(preload, /getMediaSimilarityStatus:/);
  assert.match(preload, /rebuildMediaSimilarity:/);
  assert.doesNotMatch(preload, /deleteSimilarMedia|mergeSimilarMedia|autoDedup/i);
});

test('main bootstrap registers local similarity IPC without startup scanning', () => {
  const bootstrap = read('src/main/preview-bootstrap.cjs');
  assert.match(bootstrap, /registerMediaSimilarityIpcHandlers\(\)/);
  assert.match(bootstrap, /MediaSimilarityService\.open/);
  assert.match(bootstrap, /app\.whenReady\(\)\.then\(\(\) => getMediaSimilarityService\(\)\)/);
  assert.doesNotMatch(bootstrap, /whenReady[^\n]+rebuild/);
});

test('video worker exposes bounded deterministic perceptual frame extraction', () => {
  const worker = read('src/media/video-poster-worker.js');
  assert.match(worker, /swayForgeExtractVideoPerceptualHashes/);
  assert.match(worker, /currentFrameDHash/);
  assert.match(worker, /sampleFractions\.length > 5/);
});

test('similarity documentation records thresholds, method version and non-destructive limitation', () => {
  const documentation = read('docs/media-similarity.md');
  assert.match(documentation, /perceptual-dhash-multisample-v1/);
  assert.match(documentation, /0\.90/);
  assert.match(documentation, /0\.72/);
  assert.match(documentation, /never merges, deletes/i);
});

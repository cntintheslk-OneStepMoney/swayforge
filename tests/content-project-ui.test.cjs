'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

test('Create navigation is enabled for v0.3.0 Content Studio', () => {
  const source = read('src/renderer/navigation-model.js');
  assert.match(source, /key: 'create'.*enabled: true/s);
  assert.match(source, /content-studio-ui\.js/);
});

test('Content Studio renderer uses typed content project bridge', () => {
  const source = read('src/renderer/content-studio-ui.js');
  for (const method of ['listContentProjects','createContentProject','getContentProject','updateContentProject','archiveContentProject']) assert.match(source, new RegExp(method));
  assert.doesNotMatch(source, /ipcRenderer|child_process|spawn\(|exec\(|https?:\/\//i);
});

test('preload exposes only typed content project operations rather than raw IPC', () => {
  const source = read('src/preload/preload-bridge.cjs');
  assert.match(source, /createContentProject/);
  assert.match(source, /content-project-create/);
  assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
});

test('Content Studio UI writes text through DOM APIs and not HTML injection surfaces', () => {
  const source = read('src/renderer/content-studio-ui.js');
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('project UI includes required brief controls and media-ID selection', () => {
  const source = read('src/renderer/content-studio-ui.js');
  for (const id of ['content-title','content-goal','content-format','content-platform','content-duration','content-aspect','content-export-goal','content-tone','content-instructions','content-caption-notes','content-script-notes','content-media-list']) assert.match(source, new RegExp(id));
});

test('content IPC validators reject arbitrary request fields and retain revision inputs', () => {
  const { validateUpdateRequest } = require('../src/content/content-ipc-contracts.cjs');
  const validId = '11111111-1111-4111-8111-111111111111';
  assert.throws(() => validateUpdateRequest({ kind: 'content-project-update', version: 1, projectId: validId, expectedStoreRevision: 1, expectedContentRevision: 2, patch: {}, command: 'rm -rf /' }), /unsupported field/);
  assert.equal(validateUpdateRequest({ kind: 'content-project-update', version: 1, projectId: validId, expectedStoreRevision: 1, expectedContentRevision: 2, patch: { brief: { goal: 'safe' } } }).expectedContentRevision, 2);
});

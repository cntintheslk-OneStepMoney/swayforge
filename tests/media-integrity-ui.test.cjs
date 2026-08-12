'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('application entry composes existing media bootstrap before integrity IPC extension', () => {
  const packageJson = JSON.parse(read('package.json'));
  const source = read(packageJson.main);
  assert.equal(packageJson.main, 'src/main/application-bootstrap.cjs');
  assert.ok(source.indexOf("require('./preview-bootstrap.cjs')") < source.indexOf("require('./integrity-bootstrap.cjs')"));
});

test('integrity bridge exposes typed operations without renderer filesystem paths', () => {
  const source = read('src/preload/preload-bridge.cjs');
  assert.match(source, /scanMediaIntegrity:/);
  assert.match(source, /repairManagedMedia:/);
  assert.match(source, /rebuildMediaDerived:/);
  assert.match(source, /integrityRepairRequest\(mediaId\)/);
  assert.doesNotMatch(source, /replacementPath|managedReference|sourcePath|readFile|writeFile|file:\/\//);
});

test('recovery file selection is owned by Electron main process and no startup scan is installed', () => {
  const source = read('src/main/integrity-bootstrap.cjs');
  assert.match(source, /dialog\.showOpenDialog/);
  assert.match(source, /properties:\s*\['openFile'\]/);
  assert.match(source, /repairManagedMedia\(validated\.mediaId, selection\.filePaths\[0\]\)/);
  assert.doesNotMatch(source, /whenReady[^\n]+(?:scan|rebuildDerived)/i);
});

test('Media Inspector makes integrity, recovery and cleanup explicit rather than automatic', () => {
  const html = read('src/renderer/index.html');
  const source = read('src/renderer/media-integrity-library.js');
  assert.ok(html.indexOf('./media-library.js') < html.indexOf('./media-integrity-library.js'));
  assert.ok(html.indexOf('./media-integrity-library.js') < html.indexOf('./renderer-app.js'));
  assert.match(source, /Check integrity/);
  assert.match(source, /Force hash/);
  assert.match(source, /Choose recovery file/);
  assert.match(source, /Rebuild derived/);
  assert.match(source, /Regenerate local AI/);
  assert.match(source, /bridge\.scanMediaIntegrity\(\[item\.id\]/);
  assert.match(source, /bridge\.repairManagedMedia\(item\.id\)/);
  assert.match(source, /bridge\.rebuildMediaDerived\(item\.id, \['ai'\]\)/);
  assert.doesNotMatch(source, /deleteManagedMedia|deleteSourceMedia|removeMediaRecord/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write|managedReference|sourcePath|sha256|readFile|file:\/\//);
});

test('integrity policy documents local-only recovery and deliberate hard-delete deferral', () => {
  const documentation = read('docs/media-integrity.md');
  assert.match(documentation, /local-only/i);
  assert.match(documentation, /bounded to 250/i);
  assert.match(documentation, /renderer sends only the media ID/i);
  assert.match(documentation, /Hard source-byte deletion.*not exposed/is);
  assert.match(documentation, /no external source file is deleted/i);
});

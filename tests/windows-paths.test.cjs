'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function isInsideWindowsRoot(root, candidate) {
  const relative = path.win32.relative(path.win32.resolve(root), path.win32.resolve(candidate));
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !path.win32.isAbsolute(relative));
}

test('Windows user-data paths remain separate from installation resources', () => {
  const installRoot = 'C:\\Program Files\\SwayForge';
  const userDataRoot = 'C:\\Users\\Creator\\AppData\\Roaming\\SwayForge';
  const statePath = path.win32.join(userDataRoot, 'state', 'workspace.json');
  const mediaPath = path.win32.join(userDataRoot, 'media-library', 'ab', 'synthetic.bin');

  assert.equal(isInsideWindowsRoot(userDataRoot, statePath), true);
  assert.equal(isInsideWindowsRoot(userDataRoot, mediaPath), true);
  assert.equal(isInsideWindowsRoot(installRoot, statePath), false);
  assert.equal(isInsideWindowsRoot(installRoot, mediaPath), false);
});

test('Windows path containment rejects sibling-prefix and traversal lookalikes', () => {
  const root = 'C:\\Users\\Creator\\AppData\\Roaming\\SwayForge';
  assert.equal(isInsideWindowsRoot(root, `${root}Other\\state.json`), false);
  assert.equal(isInsideWindowsRoot(root, path.win32.join(root, '..', 'OtherApp', 'state.json')), false);
  assert.equal(isInsideWindowsRoot(root, path.win32.join(root, 'projects', 'project-1.json')), true);
});

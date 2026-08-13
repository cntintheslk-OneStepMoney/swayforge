'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const navigation = require('../src/renderer/navigation-model.js');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('navigation exposes one canonical entry for every intended destination', () => {
  const keys = navigation.ROUTES.map((route) => route.key);
  assert.deepEqual(keys, ['home', 'projects', 'media', 'create', 'trends', 'publishing', 'settings']);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(
    navigation.ROUTES.filter((route) => !route.enabled).map((route) => route.key),
    ['trends', 'publishing']
  );
  assert.equal(navigation.normaliseRouteKey('publishing'), 'home');
});

test('keyboard route movement skips disabled future destinations', () => {
  assert.equal(navigation.moveEnabledRoute('home', 'next'), 'projects');
  assert.equal(navigation.moveEnabledRoute('media', 'next'), 'create');
  assert.equal(navigation.moveEnabledRoute('create', 'next'), 'settings');
  assert.equal(navigation.moveEnabledRoute('settings', 'next'), 'home');
  assert.equal(navigation.moveEnabledRoute('home', 'previous'), 'settings');
  assert.equal(navigation.moveEnabledRoute('projects', 'first'), 'home');
  assert.equal(navigation.moveEnabledRoute('projects', 'last'), 'settings');
});

test('application shell is semantic, selected state is announced and future areas are disabled', () => {
  const html = read('src/renderer/index.html');
  assert.match(html, /<aside\b[^>]*aria-label="Primary application navigation"/);
  assert.match(html, /<nav\b[^>]*aria-label="Primary"/);
  assert.match(html, /<main\b[^>]*id="main-content"/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  for (const key of ['home', 'projects', 'media', 'create', 'trends', 'publishing', 'settings']) {
    assert.match(html, new RegExp(`data-route="${key}"`));
  }
  for (const key of ['trends', 'publishing']) {
    assert.match(html, new RegExp(`data-route="${key}"[^>]*aria-disabled="true"[^>]*disabled`));
  }
  assert.match(html, /Sway Forge/);
  assert.match(html, /Create smarter\. Stay in control\./);
  assert.doesNotMatch(html, /Catch the signal\. Forge the content\./);
});

test('renderer navigation has a one-time boot guard and keyboard support', () => {
  const source = read('src/renderer/renderer-app.js');
  assert.match(source, /if\s*\(booted\)\s*return;/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Home:'first'/);
  assert.match(source, /End:'last'/);
  assert.match(source, /route\?\.enabled/);
  assert.match(source, /aria-current/);
});

test('opening views reads existing service contracts without storage mutation', () => {
  const source = read('src/renderer/renderer-app.js');
  assert.match(source, /bridge\.listProjects\(\)/);
  assert.match(source, /bridge\.listMedia\(\)/);
  assert.match(source, /bridge\.getAiRuntimeStatus\(\)/);
  assert.match(source, /bridge\.getSecretStorageStatus\(\)/);
  assert.doesNotMatch(source, /bridge\.createProject\(/);
  assert.doesNotMatch(source, /bridge\.updateProject\(/);
  assert.doesNotMatch(source, /bridge\.updateApplicationState\(/);
  assert.doesNotMatch(source, /bridge\.attachMediaToProject\(/);
  assert.doesNotMatch(source, /bridge\.detachMediaFromProject\(/);
});

test('media import is only attached to the explicit existing typed action', () => {
  const source = read('src/renderer/renderer-app.js');
  assert.match(source, /#import-media/);
  assert.match(source, /bridge\.chooseAndImportMedia\(\)/);
  assert.doesNotMatch(source, /readFile|writeFile|unlink|rmSync|shell\.openExternal/);
});

test('untrusted project and media strings are rendered as inert text', () => {
  const source = read('src/renderer/renderer-app.js');
  assert.match(source, /heading\.textContent=title/);
  assert.match(source, /body\.textContent=description/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
  assert.doesNotMatch(source, /document\.write/);
});

test('home uses real local capability calls and does not contain fabricated social metrics', () => {
  const html = read('src/renderer/index.html');
  const source = read('src/renderer/renderer-app.js');
  for (const method of ['listProjects', 'listMedia', 'getAiRuntimeStatus', 'getSecretStorageStatus']) {
    assert.match(source, new RegExp(`bridge\\.${method}`));
  }
  assert.doesNotMatch(`${html}\n${source}`, /follower count|engagement rate|trend score|impressions/i);
});

test('shared semantic tokens cover core controls in light, dark and system palettes', () => {
  const css = read('src/renderer/styles.css');
  for (const token of [
    '--app-background', '--surface', '--surface-elevated', '--border', '--text-primary', '--text-secondary',
    '--primary-action', '--success', '--warning', '--error', '--info', '--focus-ring', '--space-4',
    '--radius-md', '--text-md', '--control-height', '--motion-fast'
  ]) {
    assert.match(css, new RegExp(token.replace(/-/g, '\\-')));
  }
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root\[data-theme="system"\]/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /focus-visible/);
});

test('responsive shell avoids application-level horizontal overflow', () => {
  const css = read('src/renderer/styles.css');
  assert.match(css, /grid-template-columns: 16\.5rem minmax\(0, 1fr\)/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /min-width: 0/);
});

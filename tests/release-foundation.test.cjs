'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));

 test('release metadata has one authoritative v0.1.0 application version', () => {
  assert.equal(packageJson.name, 'swayforge');
  assert.equal(packageJson.productName, 'SwayForge');
  assert.equal(packageJson.version, '0.1.0');
  assert.equal(packageLock.packages[''].name, packageJson.name);

  const builder = read('build/electron-builder.config.cjs');
  assert.match(builder, /artifactName:\s*'\$\{productName\}-\$\{version\}-win-\$\{arch\}\.\$\{ext\}'/);
  assert.match(builder, /artifactName:\s*'\$\{productName\}-\$\{version\}-win-\$\{arch\}-setup\.\$\{ext\}'/);

  const readme = read('README.md');
  const changelog = read('CHANGELOG.md');
  assert.match(readme, /Current application release metadata: \*\*v0\.1\.0\*\*/);
  assert.match(changelog, /## 0\.1\.0 — 2026-08-11/);
});

test('release surface includes Windows packaging without adding publishing or update behaviour', () => {
  assert.match(packageJson.scripts['pack:win'], /electron-builder/);
  assert.match(packageJson.scripts['dist:win'], /electron-builder/);
  assert.equal(packageJson.scripts['check:package'], 'node scripts/check-package-config.cjs');
  assert.equal(packageJson.scripts['check:package-output'], 'node scripts/check-package-output.cjs');

  const workflow = read('.github/workflows/windows-packaging.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /--publish never/);
  assert.doesNotMatch(workflow, /release\s+create|autoUpdater|publish:\s*(?!never)/i);
});

test('release notes state the intentionally unimplemented product areas', () => {
  const readme = read('README.md');
  for (const phrase of ['social accounts', 'publish or schedule posts', 'collect trends', 'analytics', 'Autopilot']) {
    assert.match(readme, new RegExp(phrase, 'i'));
  }

  const verification = read('docs/release-verification-v0.1.0.md');
  assert.match(verification, /no telemetry, analytics, cloud AI, social APIs, publishing, scheduling or Autopilot capability/i);
  assert.match(verification, /uninstall does not casually delete creator\/application data/i);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('release metadata follows the authoritative application version', () => {
  assert.equal(packageJson.name, 'swayforge');
  assert.equal(packageJson.productName, 'SwayForge');
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.packages[''].name, packageJson.name);
  assert.deepEqual(packageLock.packages[''].dependencies ?? {}, packageJson.dependencies ?? {});
  assert.deepEqual(packageLock.packages[''].devDependencies ?? {}, packageJson.devDependencies ?? {});
  assert.deepEqual(packageLock.packages[''].optionalDependencies ?? {}, packageJson.optionalDependencies ?? {});

  const builder = read('build/electron-builder.config.cjs');
  assert.match(builder, /artifactName:\s*'\$\{productName\}-\$\{version\}-win-\$\{arch\}\.\$\{ext\}'/);
  assert.match(builder, /artifactName:\s*'\$\{productName\}-\$\{version\}-win-\$\{arch\}-setup\.\$\{ext\}'/);

  const readme = read('README.md');
  const changelog = read('CHANGELOG.md');
  const versionPattern = escaped(packageJson.version);
  assert.match(readme, new RegExp(`Current application release metadata: \\*\\*v${versionPattern}\\*\\*`));
  assert.match(changelog, new RegExp(`## ${versionPattern} — \\d{4}-\\d{2}-\\d{2}`));
  assert.ok(fs.existsSync(path.join(root, `docs/release-verification-v${packageJson.version}.md`)));
});

test('release surface includes Windows packaging without adding publishing or update behaviour', () => {
  assert.match(packageJson.scripts['pack:win'], /electron-builder/);
  assert.match(packageJson.scripts['pack:win'], /--publish never/);
  assert.match(packageJson.scripts['dist:win'], /electron-builder/);
  assert.match(packageJson.scripts['dist:win'], /--publish never/);
  assert.equal(packageJson.scripts['check:package'], 'node scripts/check-package-config.cjs');
  assert.equal(packageJson.scripts['check:package-output'], 'node scripts/check-package-output.cjs');

  const workflow = read('.github/workflows/windows-packaging.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /npm run pack:win/);
  assert.match(workflow, /npm run dist:win/);
  assert.doesNotMatch(workflow, /release\s+create|autoUpdater|publish:\s*(?!never)/i);
});

test('release notes state the intentionally unimplemented product areas', () => {
  const readme = read('README.md');
  for (const phrase of ['social accounts', 'publish or schedule posts', 'collect trends', 'analytics', 'Autopilot']) {
    assert.match(readme, new RegExp(phrase, 'i'));
  }

  const verification = read(`docs/release-verification-v${packageJson.version}.md`);
  assert.match(verification, /no telemetry/i);
  assert.match(verification, /cloud AI/i);
  assert.match(verification, /social publishing/i);
  assert.match(verification, /uninstall/i);
});

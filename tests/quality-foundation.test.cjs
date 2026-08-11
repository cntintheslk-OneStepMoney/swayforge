'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { assertPrivacySafe, scanPrivacy } = require('../scripts/check-privacy.cjs');
const { validatePackagePolicy } = require('../scripts/check-security.cjs');
const { assertWorkflowPolicy, readWorkflowFiles } = require('../scripts/check-workflows.cjs');

function withTempTree(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swayforge-quality-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFile(rootDirectory, relativePath, content) {
  const absolutePath = path.join(rootDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

test('privacy guard rejects an environment secret file without printing its contents', (t) => {
  const tempRoot = withTempTree(t);
  const sentinel = 'SWAYFORGE_ENV_SENTINEL_DO_NOT_LOG';
  writeFile(tempRoot, '.env.local', `TOKEN=${sentinel}\n`);
  assert.throws(
    () => assertPrivacySafe(tempRoot),
    (error) => error.message.includes('.env.local') && !error.message.includes(sentinel)
  );
});

test('privacy guard rejects a fake OAuth/token export', (t) => {
  const tempRoot = withTempTree(t);
  writeFile(tempRoot, 'oauth-session-export.json', '{"kind":"synthetic"}\n');
  const violations = scanPrivacy(tempRoot);
  assert.equal(violations.length, 1);
  assert.match(violations[0].rule, /credential|session/i);
});

test('synthetic fixtures are allowlisted by exact path only', (t) => {
  const tempRoot = withTempTree(t);
  const approved = 'tests/fixtures/synthetic/tiny.mp4';
  const sibling = 'tests/fixtures/synthetic/other.mp4';
  writeFile(tempRoot, approved, 'tiny redistribution-safe synthetic fixture');
  writeFile(tempRoot, sibling, 'another synthetic fixture');

  const violations = scanPrivacy(tempRoot, { allowPaths: [approved] });
  assert.deepEqual(violations.map((entry) => entry.path), [sibling]);
});

test('private-key sentinel is detected without leaking sentinel payload', (t) => {
  const tempRoot = withTempTree(t);
  const sentinel = 'SWAYFORGE_PRIVATE_KEY_SENTINEL_DO_NOT_LOG';
  writeFile(tempRoot, 'fixture.txt', `-----BEGIN PRIVATE KEY-----\n${sentinel}\n-----END PRIVATE KEY-----\n`);
  assert.throws(
    () => assertPrivacySafe(tempRoot),
    (error) => error.message.includes('private-key header') && !error.message.includes(sentinel)
  );
});

test('media guard rejects unapproved creator video while allowing one exact tiny fixture', (t) => {
  const tempRoot = withTempTree(t);
  writeFile(tempRoot, 'creator-media/clip.mp4', 'synthetic creator video marker');
  assert.throws(() => assertPrivacySafe(tempRoot), /clip\.mp4/);

  assert.doesNotThrow(() => assertPrivacySafe(tempRoot, { allowPaths: ['creator-media/clip.mp4'] }));
});

test('package policy rejects private/runtime package inclusion paths', () => {
  const packageJson = {
    name: 'swayforge',
    version: '0.1.0-dev.0',
    files: ['src/**', 'runtime-data/**']
  };
  const lockJson = {
    lockfileVersion: 3,
    packages: { '': { name: 'swayforge', version: '0.1.0-dev.0' } }
  };
  assert.throws(() => validatePackagePolicy(packageJson, lockJson), /Unsafe package inclusion/);
});

test('real package and lock metadata are consistent and privacy-safe', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockJson = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.doesNotThrow(() => validatePackagePolicy(packageJson, lockJson));
  assert.doesNotThrow(() => assertPrivacySafe(root));
});

test('CI workflows enforce read-only permissions and the Windows quality job', () => {
  assert.doesNotThrow(() => assertWorkflowPolicy(root));
  const workflows = readWorkflowFiles(root);
  const quality = workflows.find((workflow) => workflow.relativePath.endsWith('/quality.yml'));
  assert.ok(quality);
  assert.match(quality.source, /windows:\s*\n/);
  assert.match(quality.source, /npm run test:windows/);
  assert.match(quality.source, /npm run smoke:electron/);
});

test('CI has no production social credentials, live Ollama requirement, or privileged PR trigger', () => {
  for (const workflow of readWorkflowFiles(root)) {
    assert.doesNotMatch(workflow.source, /pull_request_target\s*:/);
    assert.doesNotMatch(workflow.source, /\$\{\{\s*secrets\./);
    assert.doesNotMatch(workflow.source, /TIKTOK_|INSTAGRAM_|YOUTUBE_|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|OLLAMA_/);
  }
});

test('canonical developer commands include focused quality gates', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const script of [
    'test', 'test:smoke', 'test:windows', 'check', 'check:privacy', 'check:security', 'check:workflow', 'lint', 'smoke:electron'
  ]) {
    assert.equal(typeof packageJson.scripts[script], 'string', script);
  }
});

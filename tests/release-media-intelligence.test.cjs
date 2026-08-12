'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const REQUIRED_MEDIA_RELEASE_FILES = Object.freeze([
  'src/media/media-preview-service.cjs',
  'src/media/media-index-service.cjs',
  'src/media/media-index-service-core.cjs',
  'src/media/media-similarity-service.cjs',
  'src/media/media-ai-analysis-service.cjs',
  'src/media/media-organisation-service.cjs',
  'src/media/media-integrity-service.cjs',
  'src/renderer/media-preview-library.js',
  'src/renderer/media-organisation-library.js',
  'src/renderer/media-integrity-library.js'
]);

test('v0.2.0 application bootstrap composes all accepted media intelligence layers', () => {
  for (const relativePath of REQUIRED_MEDIA_RELEASE_FILES) {
    assert.ok(fs.existsSync(path.join(root, relativePath)), `${relativePath} must exist in the integrated release`);
  }

  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.main, 'src/main/application-bootstrap.cjs');

  const bootstrap = read(packageJson.main);
  assert.match(bootstrap, /preview-bootstrap\.cjs/);
  assert.match(bootstrap, /integrity-bootstrap\.cjs/);

  const previewBootstrap = read('src/main/preview-bootstrap.cjs');
  for (const marker of ['media-index', 'media-similarity', 'media-ai', 'media-organisation']) {
    assert.match(previewBootstrap, new RegExp(marker, 'i'));
  }
});

test('exact identity, perceptual similarity and user organisation remain separate authorities', () => {
  const similarity = read('src/media/media-similarity-service.cjs');
  assert.match(similarity, /category:\s*'exact-duplicate'/);
  assert.match(similarity, /category:\s*'highly-similar'/);
  assert.match(similarity, /category:\s*'related'/);
  assert.match(similarity, /createHash\(['"]sha256['"]\)/);

  const organisation = read('src/media/media-organisation-service.cjs');
  assert.match(organisation, /repository\.readMediaOrganisation/);
  assert.match(organisation, /repository\.replaceMediaOrganisation/);
  assert.doesNotMatch(organisation, /unlinkSync|rmSync|deleteFile|removeManaged/i);

  const integrity = read('src/media/media-integrity-service.cjs');
  assert.match(integrity, /sha256/i);
  assert.match(integrity, /missing|changed|corrupt/i);
});

test('release retains explicit bounded-scale evidence for low-thousands media libraries', () => {
  const indexTests = read('tests/media-index.test.cjs');
  const similarityTests = `${read('tests/media-similarity.test.cjs')}\n${read('tests/media-similarity-integration.test.cjs')}`;
  const libraryModel = read('src/renderer/media-library-model.js');

  assert.match(indexTests, /5[,_]?000/);
  assert.match(similarityTests, /5[,_]?000/);
  assert.match(libraryModel, /DEFAULT_RENDER_LIMIT\s*=\s*60/);
  assert.match(libraryModel, /MAX_RENDER_LIMIT\s*=\s*6000/);
});

test('release documentation preserves local-first and rebuildable-derived semantics', () => {
  const readme = read('README.md');
  const changelog = read('CHANGELOG.md');
  const verification = read('docs/release-verification-v0.2.0.md');

  for (const source of [readme, changelog, verification]) {
    assert.match(source, /local/i);
    assert.match(source, /rebuild/i);
    assert.match(source, /authoritative/i);
  }
  assert.match(readme, /No telemetry/i);
  assert.match(changelog, /no cloud media or cloud-AI fallback/i);
});

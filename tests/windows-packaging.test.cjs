'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const builderConfig = require(path.join(ROOT, 'build', 'electron-builder.config.cjs'));
const { validatePackageConfig } = require(path.join(ROOT, 'scripts', 'check-package-config.cjs'));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('Windows package policy validates the repository configuration', () => {
  assert.doesNotThrow(() => validatePackageConfig(ROOT));
});

test('SwayForge uses stable package identity and current pinned packaging tools', () => {
  assert.equal(packageJson.productName, 'SwayForge');
  assert.equal(builderConfig.productName, 'SwayForge');
  assert.equal(builderConfig.appId, 'app.swayforge.desktop');
  assert.equal(packageJson.devDependencies['electron-builder'], '26.15.7');
  assert.equal(packageJson.devDependencies['@electron/asar'], '4.2.1');
  assert.equal(builderConfig.win.forceCodeSigning, false);
});

test('Windows distribution is intentionally x64 NSIS only', () => {
  assert.deepEqual([...builderConfig.win.target], [{ target: 'nsis', arch: ['x64'] }]);
  assert.match(packageJson.scripts['pack:win'], /--win\b.*--x64\b.*--dir\b/);
  assert.match(packageJson.scripts['dist:win'], /--win\s+nsis\b.*--x64\b/);
});

test('assisted per-user uninstall preserves SwayForge creator data', () => {
  assert.equal(builderConfig.nsis.oneClick, false);
  assert.equal(builderConfig.nsis.perMachine, false);
  assert.equal(builderConfig.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(builderConfig.nsis.deleteAppDataOnUninstall, false);
  assert.equal(builderConfig.nsis.createStartMenuShortcut, true);
  assert.equal(builderConfig.nsis.createDesktopShortcut, true);
});

test('package contents use an explicit runtime allowlist and ASAR', () => {
  assert.equal(builderConfig.asar, true);
  assert.deepEqual([...builderConfig.files], ['package.json', 'src/**/*']);
  const serialised = JSON.stringify(builderConfig);
  for (const excluded of ['tests/**/*', 'scripts/**/*', 'docs/**/*', '.github/**/*', '.env', 'models/**/*']) {
    assert.equal(serialised.includes(excluded), false);
  }
});

test('artifact naming carries product, version, Windows and architecture identity', () => {
  assert.equal(builderConfig.nsis.artifactName, '${productName}-${version}-win-${arch}-setup.${ext}');
  assert.equal(builderConfig.artifactName, '${productName}-${version}-win-${arch}.${ext}');
});

test('development icon is original local SVG source without embedded artwork', () => {
  const source = read('build/icon.svg');
  assert.match(source, /Original SwayForge development icon/);
  assert.doesNotMatch(source, /<image\b/i);
  assert.doesNotMatch(source, /(?:href|xlink:href)\s*=\s*["'](?:https?:|data:)/i);
});

test('packaged mutable state remains rooted in Electron userData', () => {
  const mainProcess = read('src/main/main-process.cjs');
  for (const directoryName of ['DATA_DIRECTORY_NAME', 'CREDENTIAL_DIRECTORY_NAME', 'MEDIA_DIRECTORY_NAME', 'DIAGNOSTIC_DIRECTORY_NAME']) {
    assert.match(mainProcess, new RegExp(`app\\.getPath\\(['\"]userData['\"]\\)[^\\n]*${directoryName}`));
  }
  assert.doesNotMatch(mainProcess, /process\.resourcesPath[^\n]*(?:write|mkdir|rename|copyFile|rootDirectory)/i);
});

test('packaging adds no automatic updater, publisher or bundled Ollama dependency', () => {
  const allDependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  assert.equal(Object.hasOwn(allDependencies, 'electron-updater'), false);
  assert.equal(Object.hasOwn(allDependencies, 'ollama'), false);
  assert.equal(Object.hasOwn(builderConfig, 'publish'), false);
  assert.equal(Object.hasOwn(builderConfig.win, 'publisherName'), false);
  assert.equal(Object.hasOwn(builderConfig.win, 'certificateFile'), false);
});

test('post-build inspector guards private data, model binaries and runtime state', () => {
  const source = read('scripts/check-package-output.cjs');
  assert.match(source, /\.env/);
  assert.match(source, /workspace/);
  assert.match(source, /credentials/);
  assert.match(source, /gguf/);
  assert.match(source, /ollama/i);
  assert.match(source, /app\.asar/);
});

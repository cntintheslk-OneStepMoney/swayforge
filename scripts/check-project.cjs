'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_FILES = Object.freeze([
  'package.json',
  'src/main/preview-bootstrap.cjs',
  'src/main/main-process.cjs',
  'src/preload/preload-bridge.cjs',
  'src/renderer/index.html',
  'src/renderer/fallback.html',
  'src/renderer/renderer-app.js',
  'src/renderer/styles.css',
  'src/renderer/fallback.css',
  'src/core/application-contracts.cjs',
  'src/security/electron-window-policy.cjs',
  'src/security/secret-contracts.cjs',
  'src/security/secret-redaction.cjs',
  'src/security/protected-secret-store.cjs',
  'src/storage/storage-contracts.cjs',
  'src/storage/migrations.cjs',
  'src/storage/local-data-repository.cjs',
  'src/media/media-contracts.cjs',
  'src/media/media-import-service.cjs',
  'src/media/media-preview-service.cjs',
  'src/media/media-preview-protocol.cjs',
  'src/media/electron-preview-generators.cjs',
  'src/media/image-orientation.cjs',
  'src/media/video-poster-worker.html',
  'src/media/video-poster-worker.js',
  'docs/media-storage.md',
  'docs/media-previews.md'
]);

const FORBIDDEN_BASENAMES = new Set([
  '.env',
  'credentials.json',
  'tokens.json',
  'oauth-response.json',
  'cookies.json',
  'workspace.json',
  'workspace.previous.json',
  'credential-store.json',
  'credential-store.previous.json'
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx',
  '.db', '.sqlite', '.sqlite3',
  '.mp4', '.mov', '.mkv', '.avi', '.heic'
]);

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'release', 'coverage']);
const MAX_SECRET_SCAN_BYTES = 1024 * 1024;
const LIKELY_SECRET_PATTERNS = Object.freeze([
  { name: 'private-key header', pattern: new RegExp('^-----BEGIN (?:RSA |EC |OPENSSH )?' + 'PRIVATE ' + 'KEY-----$', 'm') },
  { name: 'GitHub token', pattern: new RegExp('\\bgh' + '[pousr]_' + '[A-Za-z0-9]{30,}\\b') },
  { name: 'OpenAI-style secret key', pattern: new RegExp('\\b' + 's' + 'k-' + '[A-Za-z0-9]{32,}\\b') },
  { name: 'AWS access key', pattern: new RegExp('\\b' + 'AK' + 'IA' + '[0-9A-Z]{16}\\b') }
]);

function listFiles(root, current = root, output = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) listFiles(root, absolute, output);
    if (entry.isFile()) output.push(path.relative(root, absolute));
  }
  return output;
}

function isForbiddenProjectFile(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  const extension = path.extname(relativePath).toLowerCase();
  if (FORBIDDEN_BASENAMES.has(basename) || FORBIDDEN_EXTENSIONS.has(extension)) return true;
  if (/^\.env(?:\..+)?$/i.test(basename)) return true;
  return /(?:credential|token|oauth|session|cookie).*(?:dump|export|backup)\.(?:json|txt|log)$/i.test(basename);
}

function assertNoForbiddenProjectFiles(root) {
  const violations = [];
  for (const relativePath of listFiles(root)) {
    if (isForbiddenProjectFile(relativePath)) violations.push(relativePath);
  }

  if (violations.length > 0) {
    throw new Error(`Forbidden secret/runtime/private-media file class detected: ${violations.join(', ')}`);
  }
}

function assertNoLikelySecretContent(root) {
  const violations = [];
  for (const relativePath of listFiles(root)) {
    const absolute = path.join(root, relativePath);
    const stat = fs.statSync(absolute);
    if (stat.size === 0 || stat.size > MAX_SECRET_SCAN_BYTES) continue;
    let source;
    try {
      source = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    if (source.includes('\u0000')) continue;
    for (const rule of LIKELY_SECRET_PATTERNS) {
      if (rule.pattern.test(source)) {
        violations.push(`${relativePath} (${rule.name})`);
        break;
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`Likely production credential material detected: ${violations.join(', ')}`);
  }
}

function checkProject(root = process.cwd()) {
  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  if (packageJson.name !== 'swayforge') throw new Error('package.json name must be swayforge.');
  if (packageJson.main !== 'src/main/preview-bootstrap.cjs') throw new Error('Unexpected Electron main entry.');

  for (const scriptName of ['start', 'test', 'check', 'lint']) {
    if (typeof packageJson.scripts?.[scriptName] !== 'string') {
      throw new Error(`Missing npm script: ${scriptName}`);
    }
  }

  for (const relativePath of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      throw new Error(`Required foundation file missing: ${relativePath}`);
    }
  }

  assertNoForbiddenProjectFiles(root);
  assertNoLikelySecretContent(root);
  return true;
}

if (require.main === module) {
  try {
    checkProject(process.cwd());
    process.stdout.write('Project foundation check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertNoForbiddenProjectFiles,
  assertNoLikelySecretContent,
  checkProject,
  isForbiddenProjectFile,
  listFiles
};

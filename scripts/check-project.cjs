'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_FILES = Object.freeze([
  'package.json',
  'src/main/main-process.cjs',
  'src/preload/preload-bridge.cjs',
  'src/renderer/index.html',
  'src/renderer/fallback.html',
  'src/renderer/renderer-app.js',
  'src/renderer/styles.css',
  'src/renderer/fallback.css',
  'src/core/application-contracts.cjs',
  'src/security/electron-window-policy.cjs'
]);

const FORBIDDEN_BASENAMES = new Set([
  '.env',
  'credentials.json',
  'tokens.json',
  'oauth-response.json',
  'cookies.json'
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx',
  '.db', '.sqlite', '.sqlite3',
  '.mp4', '.mov', '.mkv', '.avi', '.heic'
]);

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'release', 'coverage']);

function listFiles(root, current = root, output = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) listFiles(root, absolute, output);
    if (entry.isFile()) output.push(path.relative(root, absolute));
  }
  return output;
}

function assertNoForbiddenProjectFiles(root) {
  const violations = [];
  for (const relativePath of listFiles(root)) {
    const basename = path.basename(relativePath).toLowerCase();
    const extension = path.extname(relativePath).toLowerCase();
    if (FORBIDDEN_BASENAMES.has(basename) || FORBIDDEN_EXTENSIONS.has(extension)) {
      violations.push(relativePath);
    }
  }

  if (violations.length > 0) {
    throw new Error(`Forbidden secret/runtime/private-media file class detected: ${violations.join(', ')}`);
  }
}

function checkProject(root = process.cwd()) {
  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  if (packageJson.name !== 'swayforge') throw new Error('package.json name must be swayforge.');
  if (packageJson.main !== 'src/main/main-process.cjs') throw new Error('Unexpected Electron main entry.');

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

module.exports = { assertNoForbiddenProjectFiles, checkProject, listFiles };

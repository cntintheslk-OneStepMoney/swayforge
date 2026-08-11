'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SAFE_PATHS = new Set(['.env.example']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage']);
const PRIVATE_BASENAMES = new Set([
  '.env',
  'credentials.json',
  'tokens.json',
  'oauth-response.json',
  'cookies.json',
  'credential-store.json',
  'credential-store.previous.json',
  'workspace.json',
  'workspace.previous.json',
  'application-state.json',
  'diagnostics-export.json'
]);
const PRIVATE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx',
  '.db', '.db-journal', '.sqlite', '.sqlite3',
  '.mp4', '.mov', '.mkv', '.avi', '.webm',
  '.wav', '.mp3', '.m4a'
]);
const PRIVATE_DIRECTORY_SEGMENTS = new Set([
  'runtime-data',
  'user-data',
  'media-library',
  'working-media',
  'diagnostic-exports',
  'private-exports'
]);
const MAX_CONTENT_SCAN_BYTES = 1024 * 1024;
const LARGE_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic']);
const SECRET_RULES = Object.freeze([
  { name: 'private-key header', pattern: /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----$/m },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'OpenAI-style secret key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'OAuth refresh token field', pattern: /["']refresh_token["']\s*:\s*["'][A-Za-z0-9._~+\/-]{24,}["']/i }
]);

function normaliseRelative(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function createAllowlist(extraPaths = []) {
  return new Set([...DEFAULT_SAFE_PATHS, ...extraPaths].map(normaliseRelative));
}

function listFiles(root, current = root, output = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) listFiles(root, absolutePath, output);
    if (entry.isFile()) output.push(normaliseRelative(path.relative(root, absolutePath)));
  }
  return output;
}

function classifyPrivatePath(relativePath, { size = 0, allowlist = createAllowlist() } = {}) {
  const normalised = normaliseRelative(relativePath);
  if (allowlist.has(normalised)) return null;

  const basename = path.posix.basename(normalised).toLowerCase();
  const extension = path.posix.extname(normalised).toLowerCase();
  const segments = normalised.toLowerCase().split('/');

  if (/^\.env(?:\..+)?$/i.test(basename)) return 'environment secret file';
  if (PRIVATE_BASENAMES.has(basename)) return 'private runtime or credential file';
  if (PRIVATE_EXTENSIONS.has(extension)) return 'private credential, runtime, or creator-media file';
  if (segments.some((segment) => PRIVATE_DIRECTORY_SEGMENTS.has(segment))) return 'private runtime or creator-data directory';
  if (/(?:credential|token|oauth|session|cookie).*(?:dump|export|backup)\.(?:json|txt|log)$/i.test(basename)) {
    return 'credential/session export';
  }
  if (/(?:diagnostic|state|workspace).*(?:backup|export)\.(?:json|zip|tar|gz)$/i.test(basename)) {
    return 'runtime state or diagnostic export';
  }
  if (IMAGE_EXTENSIONS.has(extension) && size > LARGE_IMAGE_BYTES && !segments.includes('assets')) {
    return 'large unapproved image artifact';
  }
  return null;
}

function scanPrivacy(root, { allowPaths = [] } = {}) {
  const allowlist = createAllowlist(allowPaths);
  const violations = [];

  for (const relativePath of listFiles(root)) {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.statSync(absolutePath);
    const pathReason = classifyPrivatePath(relativePath, { size: stat.size, allowlist });
    if (pathReason) {
      violations.push({ path: relativePath, rule: pathReason });
      continue;
    }
    if (allowlist.has(relativePath) || stat.size === 0 || stat.size > MAX_CONTENT_SCAN_BYTES) continue;

    let source;
    try {
      source = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (source.includes('\u0000')) continue;

    const secretRule = SECRET_RULES.find((rule) => rule.pattern.test(source));
    if (secretRule) violations.push({ path: relativePath, rule: secretRule.name });
  }

  return violations;
}

function assertPrivacySafe(root, options) {
  const violations = scanPrivacy(root, options);
  if (violations.length > 0) {
    const summary = violations.map(({ path: relativePath, rule }) => `${relativePath} (${rule})`).join(', ');
    throw new Error(`Repository privacy guard rejected: ${summary}`);
  }
  return true;
}

if (require.main === module) {
  try {
    assertPrivacySafe(process.cwd());
    process.stdout.write('Privacy guard passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  classifyPrivatePath,
  createAllowlist,
  listFiles,
  scanPrivacy,
  assertPrivacySafe
};

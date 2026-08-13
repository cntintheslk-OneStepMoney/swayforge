'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN_DEPENDENCIES = Object.freeze([
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'cohere-ai',
  'mixpanel',
  'posthog-js',
  '@sentry/electron',
  '@sentry/node',
  '@sentry/browser',
  '@segment/analytics-node',
  '@segment/analytics-next'
]);
const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
  { name: 'OpenAI cloud endpoint', pattern: /api\.openai\.com/i },
  { name: 'Anthropic cloud endpoint', pattern: /api\.anthropic\.com/i },
  { name: 'Google generative AI endpoint', pattern: /generativelanguage\.googleapis\.com/i },
  { name: 'Sentry telemetry endpoint', pattern: /(?:^|[/:.])sentry\.io\b/i },
  { name: 'PostHog telemetry endpoint', pattern: /(?:^|[/:.])posthog\.com\b/i },
  { name: 'Segment telemetry endpoint', pattern: /(?:^|[/:.])segment\.(?:com|io)\b/i }
]);
const RENDERER_FORBIDDEN_CAPABILITY = /(?:require\s*\(\s*['"](?:node:)?(?:fs|path|child_process|net|tls|http|https|os|worker_threads)['"]\s*\)|from\s+['"](?:node:)?(?:fs|path|child_process|net|tls|http|https|os|worker_threads)['"])/;
const FORBIDDEN_PACKAGE_FILE_PATTERN = /(?:^|\/)(?:runtime-data|user-data|media-library|diagnostic-exports)(?:\/|$)|\.(?:db|sqlite3?|pem|key|p12|pfx)$/i;

function collectSourceFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(absolutePath, output);
    if (entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name)) output.push(absolutePath);
  }
  return output;
}

function dependencyMapsMatch(packageMap, lockMap) {
  const packageEntries = Object.entries(packageMap ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const lockEntries = Object.entries(lockMap ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(packageEntries) === JSON.stringify(lockEntries);
}

function validatePackagePolicy(packageJson, lockJson) {
  if (!lockJson || lockJson.lockfileVersion !== 3) throw new Error('package-lock.json version 3 is required.');
  const rootPackage = lockJson.packages?.[''];
  if (!rootPackage) throw new Error('package-lock.json is missing the root package entry.');
  if (lockJson.name !== packageJson.name || rootPackage.name !== packageJson.name) {
    throw new Error('package.json and package-lock.json package names are inconsistent.');
  }

  // package.json is the application/release version authority. A patch release that
  // changes no dependencies does not need to rewrite package-lock root version metadata.
  // Dependency and engine metadata must still match so a genuinely stale lockfile fails.
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!dependencyMapsMatch(packageJson[field], rootPackage[field])) {
      throw new Error(`package.json and package-lock.json ${field} are inconsistent.`);
    }
  }
  if (!dependencyMapsMatch(packageJson.engines, rootPackage.engines)) {
    throw new Error('package.json and package-lock.json engines are inconsistent.');
  }

  const allDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {})
  };
  for (const dependency of FORBIDDEN_DEPENDENCIES) {
    if (Object.hasOwn(allDependencies, dependency)) {
      throw new Error(`Forbidden cloud AI/telemetry dependency detected: ${dependency}`);
    }
  }

  if (Array.isArray(packageJson.files)) {
    const unsafeEntries = packageJson.files.filter((entry) => FORBIDDEN_PACKAGE_FILE_PATTERN.test(String(entry)));
    if (unsafeEntries.length > 0) throw new Error(`Unsafe package inclusion entry detected: ${unsafeEntries.join(', ')}`);
  }
  return true;
}

function assertSourcePolicy(root) {
  const violations = [];
  const sourceRoot = path.join(root, 'src');
  for (const absolutePath of collectSourceFiles(sourceRoot)) {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
      if (rule.pattern.test(source)) violations.push(`${relativePath} (${rule.name})`);
    }
    if (relativePath.startsWith('src/renderer/') && RENDERER_FORBIDDEN_CAPABILITY.test(source)) {
      violations.push(`${relativePath} (renderer Node.js capability import)`);
    }
  }

  const rootScripts = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name))
    .map((entry) => entry.name);
  if (rootScripts.length > 0) violations.push(`repository root (${rootScripts.join(', ')})`);

  if (violations.length > 0) throw new Error(`Source security policy rejected: ${violations.join(', ')}`);
  return true;
}

function checkSecurity(root = process.cwd()) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockJson = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  validatePackagePolicy(packageJson, lockJson);
  assertSourcePolicy(root);
  return true;
}

if (require.main === module) {
  try {
    checkSecurity(process.cwd());
    process.stdout.write('Security/source policy check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertSourcePolicy,
  checkSecurity,
  collectSourceFiles,
  dependencyMapsMatch,
  validatePackagePolicy
};

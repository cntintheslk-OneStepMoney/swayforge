'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIRECTORY = path.join(ROOT, 'dist');
const UNPACKED_DIRECTORY = path.join(DIST_DIRECTORY, 'win-unpacked');
const RESOURCES_DIRECTORY = path.join(UNPACKED_DIRECTORY, 'resources');
const ASAR_PATH = path.join(RESOURCES_DIRECTORY, 'app.asar');

function normaliseArchivePath(value) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function listAsar(archivePath) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(executable, ['--no-install', 'asar', 'list', archivePath], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Unable to inspect app.asar: ${(result.stderr || result.stdout || 'asar command failed').trim()}`);
  }
  return result.stdout.split(/\r?\n/).map(normaliseArchivePath).filter(Boolean);
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function validatePackageOutput(root = ROOT) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const distDirectory = path.join(root, 'dist');
  const unpackedDirectory = path.join(distDirectory, 'win-unpacked');
  const resourcesDirectory = path.join(unpackedDirectory, 'resources');
  const asarPath = path.join(resourcesDirectory, 'app.asar');
  const violations = [];

  if (!fs.existsSync(path.join(unpackedDirectory, 'SwayForge.exe'))) {
    violations.push('dist/win-unpacked/SwayForge.exe is missing');
  }
  if (!fs.existsSync(asarPath)) {
    violations.push('dist/win-unpacked/resources/app.asar is missing');
  }

  if (violations.length === 0) {
    const archiveFiles = listAsar(asarPath);
    const requiredFiles = [
      'package.json',
      'src/main/main-process.cjs',
      'src/preload/preload-bridge.cjs',
      'src/renderer/index.html',
      'src/renderer/renderer-app.js',
      'src/settings/application-settings-service.cjs',
      'src/media/media-import-service.cjs'
    ];
    for (const requiredFile of requiredFiles) {
      if (!archiveFiles.includes(requiredFile)) violations.push(`app.asar missing required runtime file ${requiredFile}`);
    }

    const forbiddenTopLevel = /^(?:\.git|\.github|tests|scripts|docs|build|coverage|runtime-data|user-data|media-library|imports|working-media|proxies|thumbnails|models|model-cache)(?:\/|$)/i;
    const forbiddenSensitive = /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|db-journal|gguf)$/i;
    const forbiddenRuntimeFiles = /(?:^|\/)(?:workspace(?:\.previous)?\.json|events\.json|credentials(?:\.json|\.bin)?|swayforge-diagnostics\.json)$/i;

    for (const archiveFile of archiveFiles) {
      if (forbiddenTopLevel.test(archiveFile)) violations.push(`forbidden development/private path in app.asar: ${archiveFile}`);
      if (forbiddenSensitive.test(archiveFile)) violations.push(`forbidden secret/runtime/model file in app.asar: ${archiveFile}`);
      if (forbiddenRuntimeFiles.test(archiveFile)) violations.push(`forbidden user/runtime state in app.asar: ${archiveFile}`);
    }
  }

  for (const filePath of walkFiles(resourcesDirectory)) {
    const relativePath = path.relative(resourcesDirectory, filePath).replace(/\\/g, '/');
    if (/ollama(?:\.exe)?$/i.test(path.basename(relativePath)) || /\.(?:gguf|safetensors)$/i.test(relativePath)) {
      violations.push(`Ollama/model binary must not be bundled: ${relativePath}`);
    }
    if (/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(relativePath)) {
      violations.push(`secret-bearing file must not be bundled: ${relativePath}`);
    }
  }

  if (fs.existsSync(distDirectory)) {
    const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const installerPattern = new RegExp(`^SwayForge-${escapedVersion}-win-x64-setup\\.exe$`);
    const installers = fs.readdirSync(distDirectory).filter((entry) => /setup\.exe$/i.test(entry));
    for (const installer of installers) {
      if (!installerPattern.test(installer)) violations.push(`unexpected installer artifact name: ${installer}`);
    }
  }

  const leakedState = walkFiles(unpackedDirectory).filter((filePath) => /(?:workspace(?:\.previous)?\.json|events\.json)$/i.test(path.basename(filePath)));
  for (const filePath of leakedState) {
    violations.push(`mutable runtime state was written inside packaged output: ${path.relative(root, filePath)}`);
  }

  if (violations.length > 0) throw new Error(`Windows package output rejected:\n- ${violations.join('\n- ')}`);
  return true;
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

if (require.main === module) {
  try {
    validatePackageOutput(ROOT);
    process.stdout.write('Windows package output check passed.\n');
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      process.stdout.write(`::error file=scripts/check-package-output.cjs,title=Windows package output rejected::${escapeWorkflowCommand(error.message)}\n`);
    }
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ASAR_PATH,
  DIST_DIRECTORY,
  RESOURCES_DIRECTORY,
  UNPACKED_DIRECTORY,
  escapeWorkflowCommand,
  listAsar,
  normaliseArchivePath,
  validatePackageOutput,
  walkFiles
};

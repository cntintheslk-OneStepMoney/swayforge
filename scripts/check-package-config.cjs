'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const CONFIG_PATH = path.join(ROOT, 'build', 'electron-builder.config.cjs');
const ICON_PATH = path.join(ROOT, 'build', 'icon.svg');
const MAIN_PROCESS_PATH = path.join(ROOT, 'src', 'main', 'main-process.cjs');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertEqual(actual, expected, description, violations) {
  if (actual !== expected) violations.push(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function validatePackageConfig(root = ROOT) {
  const violations = [];
  const packageJson = readJson(path.join(root, 'package.json'));
  const configFile = path.join(root, 'build', 'electron-builder.config.cjs');
  delete require.cache[require.resolve(configFile)];
  const config = require(configFile);

  assertEqual(packageJson.productName, 'SwayForge', 'package productName', violations);
  assertEqual(config.productName, 'SwayForge', 'builder productName', violations);
  assertEqual(config.appId, 'app.swayforge.desktop', 'builder appId', violations);
  assertEqual(config.asar, true, 'ASAR packaging', violations);
  assertEqual(config.directories?.output, 'dist', 'package output directory', violations);
  assertEqual(config.directories?.buildResources, 'build', 'build resources directory', violations);

  const expectedFiles = ['package.json', 'src/**/*'];
  if (!Array.isArray(config.files) || JSON.stringify([...config.files]) !== JSON.stringify(expectedFiles)) {
    violations.push('package files must be the explicit package.json + src/**/* allowlist');
  }
  if (config.files?.some((pattern) => pattern === '**/*' || pattern === '.')) {
    violations.push('repository-wide package inclusion is not allowed');
  }

  const target = Array.isArray(config.win?.target) ? config.win.target[0] : null;
  assertEqual(target?.target, 'nsis', 'Windows installer target', violations);
  if (!Array.isArray(target?.arch) || target.arch.length !== 1 || target.arch[0] !== 'x64') {
    violations.push('Windows target must be x64 only until another architecture is verified');
  }
  assertEqual(config.win?.executableName, 'SwayForge', 'Windows executable name', violations);
  assertEqual(config.win?.icon, 'build/icon.svg', 'Windows icon source', violations);
  assertEqual(config.win?.forceCodeSigning, false, 'foundation code-signing requirement', violations);

  assertEqual(config.nsis?.oneClick, false, 'NSIS assisted installer mode', violations);
  assertEqual(config.nsis?.perMachine, false, 'NSIS per-user installation', violations);
  assertEqual(config.nsis?.allowToChangeInstallationDirectory, true, 'NSIS selectable install directory', violations);
  assertEqual(config.nsis?.createDesktopShortcut, true, 'NSIS desktop shortcut', violations);
  assertEqual(config.nsis?.createStartMenuShortcut, true, 'NSIS Start Menu shortcut', violations);
  assertEqual(config.nsis?.deleteAppDataOnUninstall, false, 'NSIS creator-data preservation', violations);

  const installerArtifact = String(config.nsis?.artifactName ?? '');
  for (const marker of ['${productName}', '${version}', 'win', '${arch}', '${ext}']) {
    if (!installerArtifact.includes(marker)) violations.push(`installer artifact name must include ${marker}`);
  }

  const requiredScripts = ['check:package', 'check:package-output', 'pack:win', 'dist:win'];
  for (const script of requiredScripts) {
    if (typeof packageJson.scripts?.[script] !== 'string' || packageJson.scripts[script].trim() === '') {
      violations.push(`package script ${script} is required`);
    }
  }
  if (!packageJson.scripts?.check?.includes('npm run check:package')) {
    violations.push('canonical npm run check must include the package policy guard');
  }

  const allDependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  assertEqual(allDependencies['electron-builder'], '26.15.7', 'electron-builder version', violations);
  assertEqual(allDependencies['@electron/asar'], '4.2.1', '@electron/asar version', violations);
  for (const forbiddenDependency of ['electron-updater', 'ollama']) {
    if (Object.hasOwn(allDependencies, forbiddenDependency)) {
      violations.push(`${forbiddenDependency} must not be introduced by Windows packaging`);
    }
  }

  const requiredRuntimeFiles = [
    packageJson.main,
    'src/preload/preload-bridge.cjs',
    'src/renderer/index.html',
    'src/renderer/renderer-app.js',
    'src/renderer/styles.css'
  ];
  for (const relativePath of requiredRuntimeFiles) {
    if (!relativePath || !fs.existsSync(path.join(root, relativePath))) {
      violations.push(`required packaged runtime file missing: ${relativePath ?? '<unset main>'}`);
    }
  }

  const iconPath = path.join(root, 'build', 'icon.svg');
  if (!fs.existsSync(iconPath)) {
    violations.push('original build/icon.svg is required');
  } else {
    const iconSource = fs.readFileSync(iconPath, 'utf8');
    if (!iconSource.includes('Original SwayForge development icon')) {
      violations.push('build/icon.svg must retain its original-source provenance marker');
    }
    if (/<image\b|(?:href|xlink:href)\s*=\s*["'](?:https?:|data:)/i.test(iconSource)) {
      violations.push('build/icon.svg must not embed external or data-URI artwork');
    }
  }

  const mainProcess = fs.readFileSync(path.join(root, 'src', 'main', 'main-process.cjs'), 'utf8');
  for (const directoryName of ['DATA_DIRECTORY_NAME', 'CREDENTIAL_DIRECTORY_NAME', 'MEDIA_DIRECTORY_NAME', 'DIAGNOSTIC_DIRECTORY_NAME']) {
    const expression = new RegExp(`app\\.getPath\\(['\"]userData['\"]\\)[^\\n]*${directoryName}`);
    if (!expression.test(mainProcess)) {
      violations.push(`mutable ${directoryName} storage must derive from Electron userData`);
    }
  }
  if (/process\.resourcesPath[^\n]*(?:write|mkdir|rename|copyFile|rootDirectory)/i.test(mainProcess)) {
    violations.push('mutable runtime storage must not target packaged resources');
  }
  if (/\bautoUpdater\b|electron-updater/.test(mainProcess)) {
    violations.push('automatic updating is outside Issue #12');
  }

  if (Object.hasOwn(config, 'publish') || Object.hasOwn(config.win ?? {}, 'publish')) {
    violations.push('packaging configuration must not publish releases automatically');
  }
  if (Object.hasOwn(config, 'extraResources') || Object.hasOwn(config, 'extraFiles')) {
    violations.push('foundation packaging must not add broad external resources/files');
  }

  if (violations.length > 0) {
    throw new Error(`Windows package policy rejected:\n- ${violations.join('\n- ')}`);
  }
  return true;
}

if (require.main === module) {
  try {
    validatePackageConfig(ROOT);
    process.stdout.write('Windows package configuration check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIG_PATH,
  ICON_PATH,
  MAIN_PROCESS_PATH,
  PACKAGE_PATH,
  validatePackageConfig
};

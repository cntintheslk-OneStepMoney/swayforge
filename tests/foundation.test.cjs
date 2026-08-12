'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const {
  AI_REFRESH_REQUEST,
  AI_STATUS_REQUEST,
  HEALTH_REQUEST,
  IPC_CHANNELS,
  createApplicationInfo,
  isAiRefreshRequest,
  isAiStatusRequest,
  isHealthRequest
} = require('../src/core/application-contracts.cjs');
const {
  WINDOW_WEB_PREFERENCES,
  normaliseLocalDocumentUrl
} = require('../src/security/electron-window-policy.cjs');
const { assertNoForbiddenProjectFiles } = require('../scripts/check-project.cjs');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('package metadata and required developer commands are authoritative', () => {
  assert.equal(packageJson.name, 'swayforge');
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(packageJson.main, 'src/main/application-bootstrap.cjs');
  assert.equal(packageJson.devDependencies.electron, '43.3.0');
  for (const script of ['start', 'test', 'check', 'lint']) {
    assert.equal(typeof packageJson.scripts[script], 'string');
  }
});

test('main, preload, AI runtime, and renderer assets resolve locally', () => {
  for (const relativePath of [
    packageJson.main,
    'src/preload/preload-bridge.cjs',
    'src/ai/runtime-contracts.cjs',
    'src/ai/ai-runtime-service.cjs',
    'src/ai/providers/ollama-provider.cjs',
    'src/renderer/index.html',
    'src/renderer/fallback.html',
    'src/renderer/renderer-app.js',
    'src/renderer/styles.css',
    'src/renderer/fallback.css'
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }

  const html = read('src/renderer/index.html');
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/renderer-app\.js"/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
});

test('Electron renderer security defaults remain conservative', () => {
  assert.equal(WINDOW_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(WINDOW_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(WINDOW_WEB_PREFERENCES.sandbox, true);
  assert.equal(WINDOW_WEB_PREFERENCES.webSecurity, true);
  assert.equal(WINDOW_WEB_PREFERENCES.allowRunningInsecureContent, false);
  assert.equal(WINDOW_WEB_PREFERENCES.webviewTag, false);
});

test('navigation policy only normalises local file documents', () => {
  assert.equal(normaliseLocalDocumentUrl('https://example.com'), null);
  assert.equal(normaliseLocalDocumentUrl('javascript:alert(1)'), null);
  assert.equal(
    normaliseLocalDocumentUrl('file:///safe/index.html?query=ignored#fragment'),
    'file:///safe/index.html'
  );

  const policySource = read('src/security/electron-window-policy.cjs');
  assert.match(policySource, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(policySource, /will-redirect/);
  assert.match(policySource, /will-attach-webview/);
  assert.match(policySource, /preventDefault\(\)/);
});

test('preload exposes only named application and AI status capabilities', () => {
  const preloadSource = read('src/preload/preload-bridge.cjs');
  assert.match(preloadSource, /getApplicationInfo:/);
  assert.match(preloadSource, /healthCheck:/);
  assert.match(preloadSource, /getAiRuntimeStatus:/);
  assert.match(preloadSource, /refreshAiRuntimeStatus:/);
  assert.doesNotMatch(preloadSource, /invoke\s*:\s*\(/);
  assert.doesNotMatch(preloadSource, /send\s*:\s*\(/);
  assert.doesNotMatch(preloadSource, /on\s*:\s*\(/);
  assert.doesNotMatch(preloadSource, /shell/);
  assert.doesNotMatch(preloadSource, /process\.env/);
  assert.deepEqual(Object.keys(IPC_CHANNELS).sort(), [
    'aiRuntimeRefresh',
    'aiRuntimeStatus',
    'applicationInfo',
    'healthCheck'
  ]);
});

test('sandbox-safe preload protocol mirrors the trusted contract exactly', () => {
  const preloadSource = read('src/preload/preload-bridge.cjs');
  for (const channel of Object.values(IPC_CHANNELS)) {
    assert.match(preloadSource, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const request of [HEALTH_REQUEST, AI_STATUS_REQUEST, AI_REFRESH_REQUEST]) {
    assert.match(preloadSource, new RegExp(request.kind));
    assert.match(preloadSource, new RegExp(`version: ${request.version}`));
  }
  assert.doesNotMatch(preloadSource, /require\(['"]\.\.?\//);
});

test('main process denies renderer permissions not needed by the foundation', () => {
  const mainSource = read('src/main/main-process.cjs');
  assert.match(mainSource, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(mainSource, /setPermissionRequestHandler/);
  assert.match(mainSource, /callback\(false\)/);
});

test('health and AI status IPC inputs are narrow and validated', () => {
  assert.equal(isHealthRequest(HEALTH_REQUEST), true);
  assert.equal(isAiStatusRequest(AI_STATUS_REQUEST), true);
  assert.equal(isAiRefreshRequest(AI_REFRESH_REQUEST), true);
  assert.equal(isHealthRequest({ ...HEALTH_REQUEST, extra: true }), false);
  assert.equal(isHealthRequest({ kind: HEALTH_REQUEST.kind, version: 2 }), false);
  assert.equal(isAiStatusRequest({ ...AI_STATUS_REQUEST, version: 2 }), false);
  assert.equal(isAiRefreshRequest('ai-runtime-refresh'), false);
});

test('application info contract validates bounded string facts', () => {
  const info = createApplicationInfo({
    version: packageJson.version,
    platform: 'win32',
    architecture: 'x64',
    electron: '43.3.0',
    chrome: '150.0.7871.129',
    node: '24.18.0'
  });
  assert.equal(info.version, packageJson.version);
  assert.equal(Object.isFrozen(info), true);
  assert.throws(() => createApplicationInfo({ ...info, node: '' }), /Invalid application information/);
});

test('version shown by renderer comes from the preload application info', () => {
  const mainSource = read('src/main/main-process.cjs');
  const rendererSource = read('src/renderer/renderer-app.js');
  assert.match(mainSource, /version: app\.getVersion\(\)/);
  assert.match(rendererSource, /applicationInfo\.version/);
  assert.doesNotMatch(rendererSource, /\b\d+\.\d+\.\d+\b/);
});

test('minimal renderer has semantic landmarks and does not claim future features exist', () => {
  const html = read('src/renderer/index.html');
  assert.match(html, /<header\b/);
  assert.match(html, /<main\b/);
  assert.match(html, /<h1>Sway Forge<\/h1>/);
  assert.match(html, /intentionally not enabled yet/);
  assert.match(html, /Local AI/);
  assert.match(html, /No telemetry/);
});

test('project check rejects obvious secret, runtime database, and creator-video fixture classes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swayforge-check-'));
  try {
    fs.writeFileSync(path.join(tempRoot, '.env'), 'SYNTHETIC=1\n');
    assert.throws(() => assertNoForbiddenProjectFiles(tempRoot), /Forbidden/);
    fs.rmSync(path.join(tempRoot, '.env'));

    fs.writeFileSync(path.join(tempRoot, 'creator-footage.mp4'), 'synthetic marker');
    assert.throws(() => assertNoForbiddenProjectFiles(tempRoot), /creator-footage\.mp4/);
    fs.rmSync(path.join(tempRoot, 'creator-footage.mp4'));

    fs.writeFileSync(path.join(tempRoot, 'state.sqlite'), 'synthetic marker');
    assert.throws(() => assertNoForbiddenProjectFiles(tempRoot), /state\.sqlite/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('main lifecycle quits when all windows close and has a safe renderer fallback', () => {
  const mainSource = read('src/main/main-process.cjs');
  assert.match(mainSource, /app\.on\('window-all-closed'/);
  assert.match(mainSource, /app\.quit\(\)/);
  assert.match(mainSource, /FALLBACK_ENTRY/);
  assert.doesNotMatch(mainSource, /\bTray\b/);
  assert.doesNotMatch(mainSource, /setLoginItemSettings/);
});

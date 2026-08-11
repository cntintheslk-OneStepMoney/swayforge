'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_DIAGNOSTIC_MAX_EVENTS,
  DEFAULT_DIAGNOSTIC_RETENTION_DAYS,
  applySettingsPatch,
  createDefaultSettings,
  normaliseApplicationSettings,
  validateApplicationSettings,
  validateSettingsUpdateRequest
} = require('../src/settings/settings-contracts.cjs');
const { ApplicationSettingsService } = require('../src/settings/application-settings-service.cjs');
const {
  createDiagnosticEvent,
  sanitiseMetadata,
  validateDiagnosticDocument
} = require('../src/diagnostics/diagnostic-contracts.cjs');
const { DiagnosticStore } = require('../src/diagnostics/diagnostic-store.cjs');

const SECRET_SENTINEL = 'SYNTHETIC-CREDENTIAL-LEAK-SENTINEL-issue10';
const PROMPT_SENTINEL = 'SYNTHETIC-PRIVATE-PROMPT-SENTINEL-issue10';
const PATH_SENTINEL = 'C:\\Users\\Synthetic User\\Private Holiday Video.mov';

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeRepository(initialSettings = {}) {
  const state = {
    revision: 4,
    schemaVersion: 1,
    settings: structuredClone(initialSettings),
    selectedProjectId: null,
    recentProjectIds: []
  };
  return {
    state,
    async readApplicationState() {
      return structuredClone(state);
    },
    async updateApplicationState(request) {
      if (request.expectedRevision !== state.revision) {
        const error = new Error('conflict');
        error.code = 'STORAGE_CONFLICT';
        throw error;
      }
      if (request.patch.settings) state.settings = structuredClone(request.patch.settings);
      state.revision += 1;
      return structuredClone(state);
    }
  };
}

function fakeRuntimeFactory(calls) {
  return (options) => {
    const runtime = {
      enabled: options.enabled,
      selectedModel: options.selectedModel,
      provider: {
        async listCapabilities({ model }) {
          if (!model) return { models: [{ id: 'local-text:latest' }, { id: 'vision-only:latest' }] };
          return { selected: { id: model, capabilities: model.startsWith('local-text') ? ['completion'] : ['vision'] } };
        }
      },
      setEnabled(value) { this.enabled = Boolean(value); },
      setSelectedModel(value) { this.selectedModel = value; },
      getStatus() { return Promise.resolve({ provider: 'ollama', state: this.enabled ? 'ready' : 'disabled' }); },
      shutdown() { this.shutdownCalled = true; }
    };
    calls.push({ options, runtime });
    return runtime;
  };
}

test('settings defaults are explicit and appearance normalises safely', () => {
  const defaults = createDefaultSettings();
  assert.equal(defaults.appearance, 'system');
  assert.equal(defaults.ai.enabled, true);
  assert.equal(defaults.ai.endpoint, 'http://localhost:11434');
  assert.equal(defaults.ai.selectedModel, null);
  assert.equal(defaults.diagnostics.retentionDays, DEFAULT_DIAGNOSTIC_RETENTION_DAYS);
  assert.equal(defaults.diagnostics.maxEvents, DEFAULT_DIAGNOSTIC_MAX_EVENTS);

  const migrated = normaliseApplicationSettings({ appearance: 'neon', unrelatedSetting: 42 });
  assert.equal(migrated.appearance, 'system');
  assert.equal(migrated.unrelatedSetting, 42);
  assert.equal(migrated.ai.endpoint, 'http://localhost:11434');
  validateApplicationSettings(migrated);
});

test('settings contract rejects remote Ollama endpoints and prompt/response fields', () => {
  assert.throws(
    () => validateSettingsUpdateRequest({ expectedRevision: 0, patch: { aiEndpoint: 'https://example.com:11434' } }),
    /loopback/
  );
  assert.throws(
    () => validateApplicationSettings({ ...createDefaultSettings(), prompt: PROMPT_SENTINEL }),
    /must not persist prompts or model responses/
  );
  assert.throws(
    () => validateApplicationSettings({ ...createDefaultSettings(), modelResponse: 'synthetic' }),
    /must not persist prompts or model responses/
  );
  assert.equal(applySettingsPatch(createDefaultSettings(), { appearance: 'dark' }).appearance, 'dark');
});

test('settings service performs idempotent migration and preserves unrelated settings', async () => {
  const repository = fakeRepository({ appearance: 'dark', compactMode: true });
  const calls = [];
  const service = await ApplicationSettingsService.create({ repository, runtimeFactory: fakeRuntimeFactory(calls) });
  assert.equal(repository.state.revision, 5);
  assert.equal(repository.state.settings.appearance, 'dark');
  assert.equal(repository.state.settings.compactMode, true);
  assert.equal(calls.length, 1);

  const reopened = await ApplicationSettingsService.create({ repository, runtimeFactory: fakeRuntimeFactory([]) });
  assert.equal(repository.state.revision, 5);
  assert.equal(reopened.getSnapshot().settings.compactMode, true);
});

test('settings service applies AI enabled/model/endpoint state through runtime factory only', async () => {
  const repository = fakeRepository(createDefaultSettings());
  const calls = [];
  const service = await ApplicationSettingsService.create({ repository, runtimeFactory: fakeRuntimeFactory(calls) });
  const initial = service.getSnapshot();
  const updated = await service.update({
    expectedRevision: initial.revision,
    patch: { aiEnabled: false, selectedModel: 'local-text:latest', aiEndpoint: 'http://127.0.0.1:11434' }
  });
  assert.equal(updated.settings.ai.enabled, false);
  assert.equal(updated.settings.ai.selectedModel, 'local-text:latest');
  assert.equal(updated.settings.ai.endpoint, 'http://127.0.0.1:11434');
  assert.equal(calls.length, 2, 'endpoint change should rebuild the trusted runtime');
  assert.equal(calls[0].runtime.shutdownCalled, true);
});

test('model selector returns text-capable models from the trusted provider boundary', async () => {
  const repository = fakeRepository(createDefaultSettings());
  const service = await ApplicationSettingsService.create({ repository, runtimeFactory: fakeRuntimeFactory([]) });
  const result = await service.listTextModels();
  assert.deepEqual(result.models.map((model) => model.id), ['local-text:latest']);
});

test('diagnostic metadata rejects content-heavy fields and sanitises private paths', () => {
  assert.throws(() => sanitiseMetadata({ prompt: PROMPT_SENTINEL }), /unsupported field/);
  assert.throws(() => sanitiseMetadata({ caption: 'creator caption' }), /unsupported field/);
  assert.equal(sanitiseMetadata({ operation: PATH_SENTINEL }).operation, '[REDACTED_PATH]');
  assert.equal(sanitiseMetadata({ operation: `Authorization: Bearer ${SECRET_SENTINEL}` }).operation, '[REDACTED]');
});

test('diagnostic event schema stores structural fields only', () => {
  const event = createDiagnosticEvent({
    code: 'media.import.failed',
    severity: 'warning',
    component: 'media-import',
    metadata: { kind: 'video', errorCategory: 'unsupported-container' },
    correlationId: 'request-123',
    errorCode: 'unsupported-container'
  }, { applicationVersion: '0.1.0-dev.0', now: () => new Date('2026-08-11T20:00:00.000Z') });
  const document = { schemaVersion: 1, events: [event] };
  validateDiagnosticDocument(document);
  assert.equal(JSON.stringify(document).includes(PROMPT_SENTINEL), false);
  assert.equal(JSON.stringify(document).includes(SECRET_SENTINEL), false);
});

test('diagnostic store prunes by event count and remains separate from application data', async (t) => {
  const root = tempRoot('swayforge-diagnostics-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let minute = 0;
  const store = await DiagnosticStore.open({
    rootDirectory: root,
    applicationVersion: '0.1.0-dev.0',
    retentionDays: 7,
    maxEvents: 25,
    now: () => new Date(Date.UTC(2026, 7, 11, 12, minute++))
  });
  for (let index = 0; index < 35; index += 1) {
    await store.append({
      code: 'foundation.health',
      severity: 'info',
      component: 'foundation',
      metadata: { count: index },
      correlationId: null,
      errorCode: null
    });
  }
  const listed = await store.list();
  assert.equal(listed.events.length <= 25, true);
  assert.equal(store.getStatus().location, 'per-user-application-data/diagnostics');
});

test('corrupt diagnostic store is quarantined/reset without blocking open', async (t) => {
  const root = tempRoot('swayforge-diagnostics-corrupt-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await fsp.writeFile(path.join(root, 'events.json'), '{not-json', 'utf8');
  const store = await DiagnosticStore.open({ rootDirectory: root, applicationVersion: '0.1.0-dev.0' });
  const listed = await store.list();
  assert.deepEqual(listed.events, []);
  const entries = await fsp.readdir(root);
  assert.equal(entries.some((name) => name.startsWith('events.corrupt-')), true);
});

test('diagnostic export contains no secret, prompt or private path sentinel', async (t) => {
  const root = tempRoot('swayforge-diagnostics-export-');
  const exportRoot = tempRoot('swayforge-diagnostics-output-');
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(exportRoot, { recursive: true, force: true });
  });
  const store = await DiagnosticStore.open({ rootDirectory: root, applicationVersion: '0.1.0-dev.0' });
  await store.append({
    code: 'media.import.failed',
    severity: 'warning',
    component: 'media-import',
    metadata: { operation: PATH_SENTINEL, errorCategory: 'unsupported-container' },
    correlationId: null,
    errorCode: 'unsupported-container'
  });
  const exportPath = path.join(exportRoot, 'diagnostics.json');
  await store.exportTo(exportPath);
  const exported = await fsp.readFile(exportPath, 'utf8');
  assert.equal(exported.includes(PATH_SENTINEL), false);
  assert.equal(exported.includes(SECRET_SENTINEL), false);
  assert.equal(exported.includes(PROMPT_SENTINEL), false);
  assert.match(exported, /Local structural diagnostics only/);
});

test('clearing diagnostics does not interact with settings/project/media repositories', async (t) => {
  const root = tempRoot('swayforge-diagnostics-clear-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = await DiagnosticStore.open({ rootDirectory: root, applicationVersion: '0.1.0-dev.0' });
  await store.append({ code: 'foundation.health', severity: 'info', component: 'foundation', metadata: {}, correlationId: null, errorCode: null });
  const cleared = await store.clear();
  assert.equal(cleared.eventCount, 0);
  assert.deepEqual((await store.list()).events, []);
});

test('preload exposes typed settings/diagnostics only and blocks generic settings mutation', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src/preload/preload-bridge.cjs'), 'utf8');
  for (const capability of ['getSettings', 'updateSettings', 'listAiModels', 'getStoragePrivacyInfo', 'openApplicationDataFolder', 'listDiagnostics', 'exportDiagnostics', 'clearDiagnostics']) {
    assert.match(preload, new RegExp(`${capability}:`));
  }
  assert.match(preload, /Object\.hasOwn\(request\.patch, 'settings'\)/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell\.openPath|process\.env/);
});

test('settings renderer remains inert and documents privacy/local AI limitations', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/settings-page.js'), 'utf8');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(source, /does not automatically download models/);
  assert.match(source, /no cloud AI fallback/);
  assert.match(source, /never upload automatically/);
  assert.match(source, /credentials, prompts, model responses, creator content, raw media or private source paths/);
});

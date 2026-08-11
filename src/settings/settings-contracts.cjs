'use strict';

const { validateModelIdentifier } = require('../ai/runtime-contracts.cjs');
const {
  DEFAULT_OLLAMA_ENDPOINT,
  normaliseLocalEndpoint
} = require('../ai/providers/ollama-provider.cjs');

const SETTINGS_SCHEMA_VERSION = 1;
const APPEARANCES = Object.freeze(['light', 'dark', 'system']);
const DEFAULT_DIAGNOSTIC_RETENTION_DAYS = 7;
const DEFAULT_DIAGNOSTIC_MAX_EVENTS = 250;

const SETTINGS_IPC_CHANNELS = Object.freeze({
  read: 'swayforge:settings:read',
  update: 'swayforge:settings:update',
  aiModels: 'swayforge:settings:ai-models',
  storageInfo: 'swayforge:settings:storage-info',
  openAppData: 'swayforge:settings:open-app-data'
});

const SETTINGS_READ_REQUEST = Object.freeze({ kind: 'settings-read', version: 1 });
const SETTINGS_AI_MODELS_REQUEST = Object.freeze({ kind: 'settings-ai-models', version: 1 });
const SETTINGS_STORAGE_INFO_REQUEST = Object.freeze({ kind: 'settings-storage-info', version: 1 });
const SETTINGS_OPEN_APP_DATA_REQUEST = Object.freeze({ kind: 'settings-open-app-data', version: 1 });
const SETTINGS_PATCH_KEYS = Object.freeze([
  'appearance',
  'aiEnabled',
  'aiEndpoint',
  'selectedModel',
  'diagnosticsEnabled'
]);
const FORBIDDEN_SETTINGS_KEYS = new Set(['prompt', 'prompts', 'modelresponse', 'modelresponses', 'modeloutput', 'modeloutputs', 'responsecontent']);

function isForbiddenSettingsContentKey(key) {
  const normalised = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return FORBIDDEN_SETTINGS_KEYS.has(normalised);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowedKeys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object.`);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field.`);
  }
}

function isExactRequest(value, expected) {
  return Boolean(
    isPlainObject(value) &&
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue)
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appearance: 'system',
    ai: {
      enabled: true,
      endpoint: DEFAULT_OLLAMA_ENDPOINT,
      selectedModel: null
    },
    diagnostics: {
      enabled: true,
      retentionDays: DEFAULT_DIAGNOSTIC_RETENTION_DAYS,
      maxEvents: DEFAULT_DIAGNOSTIC_MAX_EVENTS
    }
  };
}

function containsForbiddenSettingsKey(value, depth = 0) {
  if (depth > 12 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenSettingsKey(item, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenSettingsContentKey(key)) return true;
    if (containsForbiddenSettingsKey(child, depth + 1)) return true;
  }
  return false;
}

function validateApplicationSettings(value) {
  if (!isPlainObject(value)) throw new TypeError('application settings must be an object.');
  if (containsForbiddenSettingsKey(value)) {
    throw new TypeError('application settings must not persist prompts or model responses.');
  }

  if ('schemaVersion' in value && value.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new TypeError('settings schemaVersion is unsupported.');
  }

  if ('appearance' in value && !APPEARANCES.includes(value.appearance)) {
    throw new TypeError('appearance setting is invalid.');
  }

  if ('ai' in value) {
    assertExactKeys(value.ai, ['enabled', 'endpoint', 'selectedModel'], 'AI settings');
    if ('enabled' in value.ai && typeof value.ai.enabled !== 'boolean') {
      throw new TypeError('AI enabled setting must be boolean.');
    }
    if ('endpoint' in value.ai) normaliseLocalEndpoint(value.ai.endpoint);
    if ('selectedModel' in value.ai && value.ai.selectedModel !== null) {
      validateModelIdentifier(value.ai.selectedModel);
    }
  }

  if ('diagnostics' in value) {
    assertExactKeys(value.diagnostics, ['enabled', 'retentionDays', 'maxEvents'], 'diagnostics settings');
    if ('enabled' in value.diagnostics && typeof value.diagnostics.enabled !== 'boolean') {
      throw new TypeError('diagnostics enabled setting must be boolean.');
    }
    if (
      'retentionDays' in value.diagnostics &&
      (!Number.isSafeInteger(value.diagnostics.retentionDays) || value.diagnostics.retentionDays < 1 || value.diagnostics.retentionDays > 30)
    ) {
      throw new TypeError('diagnostics retentionDays setting is invalid.');
    }
    if (
      'maxEvents' in value.diagnostics &&
      (!Number.isSafeInteger(value.diagnostics.maxEvents) || value.diagnostics.maxEvents < 25 || value.diagnostics.maxEvents > 1000)
    ) {
      throw new TypeError('diagnostics maxEvents setting is invalid.');
    }
  }

  return value;
}

function normaliseApplicationSettings(value) {
  const source = isPlainObject(value) ? cloneJson(value) : {};
  const defaults = createDefaultSettings();
  const result = {};

  for (const [key, child] of Object.entries(source)) {
    if (['schemaVersion', 'appearance', 'ai', 'diagnostics'].includes(key) || isForbiddenSettingsContentKey(key)) continue;
    result[key] = child;
  }

  result.schemaVersion = SETTINGS_SCHEMA_VERSION;
  result.appearance = APPEARANCES.includes(source.appearance) ? source.appearance : defaults.appearance;

  const ai = isPlainObject(source.ai) ? source.ai : {};
  let endpoint = defaults.ai.endpoint;
  try {
    endpoint = normaliseLocalEndpoint(ai.endpoint ?? defaults.ai.endpoint);
  } catch {
    endpoint = defaults.ai.endpoint;
  }
  let selectedModel = null;
  if (ai.selectedModel !== null && ai.selectedModel !== undefined) {
    try {
      selectedModel = validateModelIdentifier(ai.selectedModel);
    } catch {
      selectedModel = null;
    }
  }
  result.ai = {
    enabled: typeof ai.enabled === 'boolean' ? ai.enabled : defaults.ai.enabled,
    endpoint,
    selectedModel
  };

  const diagnostics = isPlainObject(source.diagnostics) ? source.diagnostics : {};
  result.diagnostics = {
    enabled: typeof diagnostics.enabled === 'boolean' ? diagnostics.enabled : defaults.diagnostics.enabled,
    retentionDays: Number.isSafeInteger(diagnostics.retentionDays) && diagnostics.retentionDays >= 1 && diagnostics.retentionDays <= 30
      ? diagnostics.retentionDays
      : defaults.diagnostics.retentionDays,
    maxEvents: Number.isSafeInteger(diagnostics.maxEvents) && diagnostics.maxEvents >= 25 && diagnostics.maxEvents <= 1000
      ? diagnostics.maxEvents
      : defaults.diagnostics.maxEvents
  };

  validateApplicationSettings(result);
  return result;
}

function validateSettingsUpdateRequest(value) {
  assertExactKeys(value, ['expectedRevision', 'patch'], 'settings update request');
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) {
    throw new TypeError('expectedRevision must be a non-negative safe integer.');
  }
  assertExactKeys(value.patch, SETTINGS_PATCH_KEYS, 'settings patch');
  if (Object.keys(value.patch).length === 0) throw new TypeError('settings patch must contain a change.');
  if ('appearance' in value.patch && !APPEARANCES.includes(value.patch.appearance)) {
    throw new TypeError('appearance setting is invalid.');
  }
  if ('aiEnabled' in value.patch && typeof value.patch.aiEnabled !== 'boolean') {
    throw new TypeError('AI enabled setting must be boolean.');
  }
  if ('aiEndpoint' in value.patch) normaliseLocalEndpoint(value.patch.aiEndpoint);
  if ('selectedModel' in value.patch && value.patch.selectedModel !== null) {
    validateModelIdentifier(value.patch.selectedModel);
  }
  if ('diagnosticsEnabled' in value.patch && typeof value.patch.diagnosticsEnabled !== 'boolean') {
    throw new TypeError('diagnostics enabled setting must be boolean.');
  }
  return value;
}

function applySettingsPatch(current, patch) {
  const next = normaliseApplicationSettings(current);
  if ('appearance' in patch) next.appearance = patch.appearance;
  if ('aiEnabled' in patch) next.ai.enabled = patch.aiEnabled;
  if ('aiEndpoint' in patch) next.ai.endpoint = normaliseLocalEndpoint(patch.aiEndpoint);
  if ('selectedModel' in patch) {
    next.ai.selectedModel = patch.selectedModel === null ? null : validateModelIdentifier(patch.selectedModel);
  }
  if ('diagnosticsEnabled' in patch) next.diagnostics.enabled = patch.diagnosticsEnabled;
  validateApplicationSettings(next);
  return next;
}

module.exports = {
  APPEARANCES,
  DEFAULT_DIAGNOSTIC_MAX_EVENTS,
  DEFAULT_DIAGNOSTIC_RETENTION_DAYS,
  SETTINGS_AI_MODELS_REQUEST,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_IPC_CHANNELS,
  SETTINGS_OPEN_APP_DATA_REQUEST,
  SETTINGS_READ_REQUEST,
  SETTINGS_STORAGE_INFO_REQUEST,
  applySettingsPatch,
  createDefaultSettings,
  isExactRequest,
  normaliseApplicationSettings,
  validateApplicationSettings,
  validateSettingsUpdateRequest
};

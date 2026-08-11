'use strict';

const { redactSensitiveText } = require('../security/secret-redaction.cjs');
const { validateModelIdentifier } = require('../ai/runtime-contracts.cjs');

const DIAGNOSTIC_SCHEMA_VERSION = 1;
const DIAGNOSTIC_SEVERITIES = Object.freeze(['info', 'warning', 'error']);
const MAX_DIAGNOSTIC_EVENTS = 1000;
const MAX_EVENT_METADATA_KEYS = 12;
const MAX_STRUCTURAL_STRING = 160;
const CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const STRUCTURAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ALLOWED_METADATA_KEYS = new Set([
  'provider',
  'model',
  'outcome',
  'errorCategory',
  'duration',
  'state',
  'kind',
  'operation',
  'status',
  'count',
  'availability',
  'format'
]);

const DIAGNOSTIC_IPC_CHANNELS = Object.freeze({
  list: 'swayforge:diagnostics:list',
  export: 'swayforge:diagnostics:export',
  clear: 'swayforge:diagnostics:clear'
});

const DIAGNOSTIC_LIST_REQUEST = Object.freeze({ kind: 'diagnostics-list', version: 1 });
const DIAGNOSTIC_EXPORT_REQUEST = Object.freeze({ kind: 'diagnostics-export', version: 1 });
const DIAGNOSTIC_CLEAR_REQUEST = Object.freeze({ kind: 'diagnostics-clear', version: 1 });

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

function assertCode(value, label) {
  if (typeof value !== 'string' || !CODE_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function sanitiseStructuralString(value, label, { model = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRUCTURAL_STRING) {
    throw new TypeError(`${label} must be a bounded structural string.`);
  }
  if (['[REDACTED]', '[REDACTED_PATH]', '[REDACTED_FILE]'].includes(value)) return value;
  const redacted = redactSensitiveText(value);
  if (redacted !== value) return '[REDACTED]';
  if (/(?:[A-Za-z]:\\|\\\\|\/Users\/|\/home\/|\/mnt\/|\/var\/|file:)/i.test(value)) return '[REDACTED_PATH]';
  if (/\.(?:jpe?g|png|gif|webp|mov|mp4|mkv|avi|wav|mp3)\b/i.test(value)) return '[REDACTED_FILE]';
  if (model) {
    validateModelIdentifier(value);
    return value;
  }
  if (!STRUCTURAL_PATTERN.test(value)) throw new TypeError(`${label} must contain structural data only.`);
  return value;
}

function sanitiseMetadata(metadata = {}) {
  if (!isPlainObject(metadata)) throw new TypeError('diagnostic metadata must be an object.');
  const entries = Object.entries(metadata);
  if (entries.length > MAX_EVENT_METADATA_KEYS) throw new TypeError('diagnostic metadata contains too many fields.');
  const result = {};
  for (const [key, value] of entries) {
    if (!ALLOWED_METADATA_KEYS.has(key)) throw new TypeError('diagnostic metadata contains an unsupported field.');
    if (value === null || typeof value === 'boolean') {
      result[key] = value;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000) {
        throw new TypeError('diagnostic metadata number is invalid.');
      }
      result[key] = value;
      continue;
    }
    if (key === 'duration') {
      if (typeof value !== 'string' || !/^(?:<\d+(?:ms|s)|>=\d+s)$/.test(value)) throw new TypeError('diagnostic duration is invalid.');
      result[key] = value;
      continue;
    }
    result[key] = sanitiseStructuralString(value, `diagnostic metadata ${key}`, { model: key === 'model' });
  }
  return result;
}

function validateDiagnosticEvent(event) {
  assertExactKeys(
    event,
    ['timestamp', 'code', 'severity', 'component', 'metadata', 'applicationVersion', 'correlationId', 'errorCode'],
    'diagnostic event'
  );
  if (typeof event.timestamp !== 'string' || event.timestamp.length > 64 || Number.isNaN(Date.parse(event.timestamp))) {
    throw new TypeError('diagnostic timestamp is invalid.');
  }
  assertCode(event.code, 'diagnostic code');
  if (!DIAGNOSTIC_SEVERITIES.includes(event.severity)) throw new TypeError('diagnostic severity is invalid.');
  assertCode(event.component, 'diagnostic component');
  sanitiseMetadata(event.metadata);
  if (typeof event.applicationVersion !== 'string' || event.applicationVersion.length === 0 || event.applicationVersion.length > 64) {
    throw new TypeError('diagnostic applicationVersion is invalid.');
  }
  if (event.correlationId !== null) sanitiseStructuralString(event.correlationId, 'diagnostic correlationId');
  if (event.errorCode !== null) assertCode(event.errorCode, 'diagnostic errorCode');
  return event;
}

function createDiagnosticEvent(input, { applicationVersion, now = () => new Date() } = {}) {
  assertExactKeys(input, ['code', 'severity', 'component', 'metadata', 'correlationId', 'errorCode'], 'diagnostic input');
  const timestamp = now();
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) throw new TypeError('diagnostic clock is invalid.');
  const event = {
    timestamp: timestamp.toISOString(),
    code: assertCode(input.code, 'diagnostic code'),
    severity: input.severity,
    component: assertCode(input.component, 'diagnostic component'),
    metadata: sanitiseMetadata(input.metadata ?? {}),
    applicationVersion,
    correlationId: input.correlationId === undefined || input.correlationId === null
      ? null
      : sanitiseStructuralString(input.correlationId, 'diagnostic correlationId'),
    errorCode: input.errorCode === undefined || input.errorCode === null
      ? null
      : assertCode(input.errorCode, 'diagnostic errorCode')
  };
  validateDiagnosticEvent(event);
  return Object.freeze({ ...event, metadata: Object.freeze(event.metadata) });
}

function validateDiagnosticDocument(value) {
  assertExactKeys(value, ['schemaVersion', 'events'], 'diagnostic store');
  if (value.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION) throw new TypeError('Unsupported diagnostic schema version.');
  if (!Array.isArray(value.events) || value.events.length > MAX_DIAGNOSTIC_EVENTS) {
    throw new TypeError('diagnostic event list is invalid.');
  }
  value.events.forEach(validateDiagnosticEvent);
  return value;
}

module.exports = {
  DIAGNOSTIC_CLEAR_REQUEST,
  DIAGNOSTIC_EXPORT_REQUEST,
  DIAGNOSTIC_IPC_CHANNELS,
  DIAGNOSTIC_LIST_REQUEST,
  DIAGNOSTIC_SCHEMA_VERSION,
  DIAGNOSTIC_SEVERITIES,
  MAX_DIAGNOSTIC_EVENTS,
  createDiagnosticEvent,
  isExactRequest,
  sanitiseMetadata,
  sanitiseStructuralString,
  validateDiagnosticDocument,
  validateDiagnosticEvent
};

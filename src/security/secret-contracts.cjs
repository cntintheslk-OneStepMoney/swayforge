'use strict';

const SECRET_STORE_SCHEMA_VERSION = 1;
const SECRET_KINDS = Object.freeze([
  'access-token',
  'refresh-token',
  'client-secret',
  'credential-bundle',
  'other'
]);
const SECRET_IPC_CHANNELS = Object.freeze({
  status: 'swayforge:secret-storage:status'
});
const SECRET_STATUS_REQUEST = Object.freeze({ kind: 'secret-storage-status', version: 1 });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ACCOUNT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_SECRET_LENGTH = 65536;

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

function assertSecretId(value, label = 'secretId') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function assertIsoTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function assertProvider(value) {
  if (typeof value !== 'string' || !PROVIDER_PATTERN.test(value)) throw new TypeError('provider is invalid.');
  return value;
}

function assertAccountReference(value) {
  if (value === null) return value;
  if (typeof value !== 'string' || !ACCOUNT_REFERENCE_PATTERN.test(value)) {
    throw new TypeError('accountRefId is invalid.');
  }
  return value;
}

function assertSecretKind(value) {
  if (!SECRET_KINDS.includes(value)) throw new TypeError('secret kind is invalid.');
  return value;
}

function assertSecretValue(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET_LENGTH) {
    throw new TypeError('secret value is invalid.');
  }
  return value;
}

function validateProtectedSecretRecord(record) {
  assertExactKeys(
    record,
    ['id', 'provider', 'accountRefId', 'kind', 'createdAt', 'updatedAt', 'expiresAt', 'protectedPayload'],
    'protected secret record'
  );
  assertSecretId(record.id);
  assertProvider(record.provider);
  assertAccountReference(record.accountRefId);
  assertSecretKind(record.kind);
  assertIsoTimestamp(record.createdAt, 'secret createdAt');
  assertIsoTimestamp(record.updatedAt, 'secret updatedAt');
  assertIsoTimestamp(record.expiresAt, 'secret expiresAt', { nullable: true });
  if (
    typeof record.protectedPayload !== 'string' ||
    record.protectedPayload.length === 0 ||
    record.protectedPayload.length > MAX_SECRET_LENGTH * 4 ||
    !BASE64_PATTERN.test(record.protectedPayload)
  ) {
    throw new TypeError('protected secret payload is invalid.');
  }
  return record;
}

function validateSecretStoreDocument(document) {
  assertExactKeys(document, ['schemaVersion', 'revision', 'createdAt', 'updatedAt', 'records'], 'secret store');
  if (document.schemaVersion !== SECRET_STORE_SCHEMA_VERSION) {
    throw new TypeError('Unsupported secret-store schema version.');
  }
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) {
    throw new TypeError('secret-store revision is invalid.');
  }
  assertIsoTimestamp(document.createdAt, 'secret-store createdAt');
  assertIsoTimestamp(document.updatedAt, 'secret-store updatedAt');
  if (!isPlainObject(document.records)) throw new TypeError('secret-store records must be an object.');
  for (const [id, record] of Object.entries(document.records)) {
    assertSecretId(id);
    validateProtectedSecretRecord(record);
    if (record.id !== id) throw new TypeError('secret record key does not match secret id.');
  }
  return document;
}

function validateCreateSecretRequest(value) {
  assertExactKeys(value, ['provider', 'accountRefId', 'kind', 'value', 'expiresAt'], 'secret create request');
  assertProvider(value.provider);
  assertAccountReference(value.accountRefId ?? null);
  assertSecretKind(value.kind);
  assertSecretValue(value.value);
  assertIsoTimestamp(value.expiresAt ?? null, 'secret expiresAt', { nullable: true });
  return value;
}

function validateReplaceSecretRequest(value) {
  assertExactKeys(value, ['secretId', 'value', 'expiresAt'], 'secret replace request');
  assertSecretId(value.secretId);
  assertSecretValue(value.value);
  if ('expiresAt' in value) assertIsoTimestamp(value.expiresAt, 'secret expiresAt', { nullable: true });
  return value;
}

function validateDeleteSecretRequest(value) {
  assertExactKeys(value, ['secretId'], 'secret delete request');
  assertSecretId(value.secretId);
  return value;
}

function isSecretStorageStatusRequest(value) {
  return isPlainObject(value) && value.kind === SECRET_STATUS_REQUEST.kind && value.version === SECRET_STATUS_REQUEST.version && Object.keys(value).length === 2;
}

function toSecretMetadata(record) {
  validateProtectedSecretRecord(record);
  return Object.freeze({
    id: record.id,
    provider: record.provider,
    accountRefId: record.accountRefId,
    kind: record.kind,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    credentialPresent: true
  });
}

module.exports = {
  MAX_SECRET_LENGTH,
  SECRET_IPC_CHANNELS,
  SECRET_KINDS,
  SECRET_STATUS_REQUEST,
  SECRET_STORE_SCHEMA_VERSION,
  assertSecretId,
  isPlainObject,
  isSecretStorageStatusRequest,
  toSecretMetadata,
  validateCreateSecretRequest,
  validateDeleteSecretRequest,
  validateProtectedSecretRecord,
  validateReplaceSecretRequest,
  validateSecretStoreDocument
};

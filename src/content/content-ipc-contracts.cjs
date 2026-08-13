'use strict';

const {
  assertProjectId,
  assertRevision,
  assertSafeJsonValue,
  validateMediaIds
} = require('../storage/storage-contracts.cjs');

const CONTENT_IPC_CHANNELS = Object.freeze({
  list: 'swayforge:content:project:list',
  create: 'swayforge:content:project:create',
  read: 'swayforge:content:project:read',
  update: 'swayforge:content:project:update',
  archive: 'swayforge:content:project:archive'
});

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}
function exact(value, keys, label) {
  object(value, label);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field.`);
  return value;
}
function title(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) throw new TypeError('title is invalid.');
  return value.trim();
}
function validateListRequest(value) {
  exact(value, ['kind','version'], 'content list request');
  if (value.kind !== 'content-project-list' || value.version !== 1) throw new TypeError('content list request is invalid.');
  return value;
}
function validateCreateRequest(value) {
  exact(value, ['kind','version','title','mediaIds','brief'], 'content create request');
  if (value.kind !== 'content-project-create' || value.version !== 1) throw new TypeError('content create request is invalid.');
  title(value.title);
  validateMediaIds(value.mediaIds || []);
  object(value.brief, 'creative brief');
  assertSafeJsonValue(value.brief, 'creative brief');
  return value;
}
function validateReadRequest(value) {
  exact(value, ['kind','version','projectId'], 'content read request');
  if (value.kind !== 'content-project-read' || value.version !== 1) throw new TypeError('content read request is invalid.');
  assertProjectId(value.projectId);
  return value;
}
function validateUpdateRequest(value) {
  exact(value, ['kind','version','projectId','expectedStoreRevision','expectedContentRevision','patch'], 'content update request');
  if (value.kind !== 'content-project-update' || value.version !== 1) throw new TypeError('content update request is invalid.');
  assertProjectId(value.projectId);
  assertRevision(value.expectedStoreRevision, 'expectedStoreRevision');
  assertRevision(value.expectedContentRevision, 'expectedContentRevision');
  object(value.patch, 'content patch');
  assertSafeJsonValue(value.patch, 'content patch');
  return value;
}
function validateArchiveRequest(value) {
  exact(value, ['kind','version','projectId','expectedStoreRevision'], 'content archive request');
  if (value.kind !== 'content-project-archive' || value.version !== 1) throw new TypeError('content archive request is invalid.');
  assertProjectId(value.projectId);
  assertRevision(value.expectedStoreRevision, 'expectedStoreRevision');
  return value;
}

module.exports = {
  CONTENT_IPC_CHANNELS,
  validateArchiveRequest,
  validateCreateRequest,
  validateListRequest,
  validateReadRequest,
  validateUpdateRequest
};

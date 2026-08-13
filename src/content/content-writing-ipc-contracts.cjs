'use strict';

const { assertProjectId, assertRevision } = require('../storage/storage-contracts.cjs');
const { WRITING_TASKS } = require('./content-writing.cjs');

const CONTENT_WRITING_IPC_CHANNELS = Object.freeze({
  generate: 'swayforge:content:writing:generate',
  cancel: 'swayforge:content:writing:cancel',
  accept: 'swayforge:content:writing:accept',
  edit: 'swayforge:content:writing:edit'
});
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function exact(value, keys, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`); const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field.`); return value; }
function operationId(value) { if (typeof value !== 'string' || !OPERATION_PATTERN.test(value)) throw new TypeError('operationId is invalid.'); return value; }
function task(value) { if (!Object.hasOwn(WRITING_TASKS, value)) throw new TypeError('writing task is invalid.'); return value; }
function boundedText(value, label, max = 8000) { if (typeof value !== 'string' || value.length > max) throw new TypeError(`${label} is invalid.`); return value; }
function validateGenerateRequest(value) { exact(value, ['kind','version','operationId','projectId','task','userText'], 'writing generate request'); if (value.kind !== 'content-writing-generate' || value.version !== 1) throw new TypeError('writing generate request is invalid.'); operationId(value.operationId); assertProjectId(value.projectId); task(value.task); boundedText(value.userText || '', 'userText'); return value; }
function validateCancelRequest(value) { exact(value, ['kind','version','operationId'], 'writing cancel request'); if (value.kind !== 'content-writing-cancel' || value.version !== 1) throw new TypeError('writing cancel request is invalid.'); operationId(value.operationId); return value; }
function validateAcceptRequest(value) { exact(value, ['kind','version','projectId','proposalId','optionId','expectedStoreRevision','expectedContentRevision'], 'writing accept request'); if (value.kind !== 'content-writing-accept' || value.version !== 1) throw new TypeError('writing accept request is invalid.'); assertProjectId(value.projectId); operationId(value.proposalId); boundedText(value.optionId, 'optionId', 128); assertRevision(value.expectedStoreRevision,'expectedStoreRevision'); assertRevision(value.expectedContentRevision,'expectedContentRevision'); return value; }
function validateEditRequest(value) { exact(value, ['kind','version','projectId','task','text','expectedStoreRevision','expectedContentRevision'], 'writing edit request'); if (value.kind !== 'content-writing-edit' || value.version !== 1) throw new TypeError('writing edit request is invalid.'); assertProjectId(value.projectId); task(value.task); boundedText(value.text, 'text', 6000); assertRevision(value.expectedStoreRevision,'expectedStoreRevision'); assertRevision(value.expectedContentRevision,'expectedContentRevision'); return value; }

module.exports = { CONTENT_WRITING_IPC_CHANNELS, validateAcceptRequest, validateCancelRequest, validateEditRequest, validateGenerateRequest };

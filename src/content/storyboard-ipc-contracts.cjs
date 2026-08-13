'use strict';

const { assertProjectId, assertRevision, assertSafeJsonValue } = require('../storage/storage-contracts.cjs');

const STORYBOARD_IPC_CHANNELS = Object.freeze({
  snapshot: 'swayforge:content:storyboard:snapshot',
  generate: 'swayforge:content:storyboard:generate',
  manual: 'swayforge:content:storyboard:manual',
  cancel: 'swayforge:content:storyboard:cancel',
  accept: 'swayforge:content:storyboard:accept',
  revise: 'swayforge:content:storyboard:revise'
});
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_SHOTS = 120;
function exact(value, keys, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`); const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field.`); return value; }
function token(value,label){if(typeof value!=='string'||!TOKEN_PATTERN.test(value))throw new TypeError(`${label} is invalid.`);return value;}
function validateSnapshotRequest(value){exact(value,['kind','version','projectId'],'storyboard snapshot request');if(value.kind!=='storyboard-snapshot'||value.version!==1)throw new TypeError('storyboard snapshot request is invalid.');assertProjectId(value.projectId);return value;}
function validateGenerateRequest(value){exact(value,['kind','version','projectId','operationId'],'storyboard generate request');if(value.kind!=='storyboard-generate'||value.version!==1)throw new TypeError('storyboard generate request is invalid.');assertProjectId(value.projectId);token(value.operationId,'operationId');return value;}
function validateManualRequest(value){exact(value,['kind','version','projectId','shots'],'manual storyboard request');if(value.kind!=='storyboard-manual'||value.version!==1)throw new TypeError('manual storyboard request is invalid.');assertProjectId(value.projectId);if(!Array.isArray(value.shots)||value.shots.length<1||value.shots.length>MAX_SHOTS)throw new TypeError('manual storyboard shots are invalid.');assertSafeJsonValue(value.shots,'manual storyboard shots');return value;}
function validateCancelRequest(value){exact(value,['kind','version','operationId'],'storyboard cancel request');if(value.kind!=='storyboard-cancel'||value.version!==1)throw new TypeError('storyboard cancel request is invalid.');token(value.operationId,'operationId');return value;}
function validateAcceptRequest(value){exact(value,['kind','version','projectId','proposalId','expectedStoreRevision','expectedContentRevision'],'storyboard accept request');if(value.kind!=='storyboard-accept'||value.version!==1)throw new TypeError('storyboard accept request is invalid.');assertProjectId(value.projectId);token(value.proposalId,'proposalId');assertRevision(value.expectedStoreRevision,'expectedStoreRevision');assertRevision(value.expectedContentRevision,'expectedContentRevision');return value;}
function validateReviseRequest(value){exact(value,['kind','version','projectId','expectedStoreRevision','expectedContentRevision','expectedStoryboardRevision','operation'],'storyboard revise request');if(value.kind!=='storyboard-revise'||value.version!==1)throw new TypeError('storyboard revise request is invalid.');assertProjectId(value.projectId);assertRevision(value.expectedStoreRevision,'expectedStoreRevision');assertRevision(value.expectedContentRevision,'expectedContentRevision');assertRevision(value.expectedStoryboardRevision,'expectedStoryboardRevision');exact(value.operation,['type','shotId','toIndex','patch'],'storyboard operation');if(!['reorder','edit'].includes(value.operation.type))throw new TypeError('storyboard operation type is invalid.');token(value.operation.shotId,'shotId');if(value.operation.type==='reorder'&&(!Number.isSafeInteger(value.operation.toIndex)||value.operation.toIndex<0||value.operation.toIndex>=MAX_SHOTS))throw new TypeError('storyboard reorder target is invalid.');if(value.operation.type==='edit'){if(!value.operation.patch||typeof value.operation.patch!=='object'||Array.isArray(value.operation.patch))throw new TypeError('storyboard edit patch is invalid.');assertSafeJsonValue(value.operation.patch,'storyboard edit patch');}return value;}

module.exports={STORYBOARD_IPC_CHANNELS,validateAcceptRequest,validateCancelRequest,validateGenerateRequest,validateManualRequest,validateReviseRequest,validateSnapshotRequest};

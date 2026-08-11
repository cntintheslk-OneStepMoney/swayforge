'use strict';

const CURRENT_SCHEMA_VERSION = 1;
const PROJECT_SCHEMA_VERSION = 1;
const APPLICATION_SCHEMA_VERSION = 1;
const MEDIA_SCHEMA_VERSION = 1;
const PROJECT_STATUSES = Object.freeze(['draft', 'archived']);
const MEDIA_KINDS = Object.freeze(['image', 'video']);
const MEDIA_AVAILABILITY_STATES = Object.freeze(['ready']);
const MEDIA_IMPORT_MODES = Object.freeze(['managed-copy']);

const STORAGE_IPC_CHANNELS = Object.freeze({
  applicationStateRead: 'swayforge:storage:application-state:read',
  applicationStateUpdate: 'swayforge:storage:application-state:update',
  projectCreate: 'swayforge:storage:project:create',
  projectRead: 'swayforge:storage:project:read',
  projectUpdate: 'swayforge:storage:project:update',
  projectList: 'swayforge:storage:project:list',
  projectArchive: 'swayforge:storage:project:archive'
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MANAGED_REFERENCE_PATTERN = /^files\/[0-9a-f-]{36}\.(?:jpg|png|mp4|mov)$/i;
const PROJECT_TITLE_LIMIT = 160;
const RECENT_PROJECT_LIMIT = 50;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_ARRAY_LENGTH = 10000;
const MAX_JSON_OBJECT_KEYS = 2000;
const MAX_JSON_STRING_LENGTH = 250000;
const MAX_MEDIA_FILE_SIZE = 16 * 1024 * 1024 * 1024;

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

function assertRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return value;
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp.`);
  return value;
}

function assertProjectId(value, label = 'projectId') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function assertMediaId(value) {
  if (typeof value !== 'string' || !MEDIA_ID_PATTERN.test(value)) throw new TypeError('mediaId is invalid.');
  return value;
}

function assertManagedMediaId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError('managed media id is invalid.');
  return value;
}

function normaliseSensitiveKey(key) { return key.replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function isForbiddenStateKey(key) {
  const normalised = normaliseSensitiveKey(key);
  if (!normalised) return false;
  if (normalised.endsWith('token')) return true;
  return new Set(['clientsecret','oauthsecret','signingkey','privatekey','sessioncookie','sessioncookies','encryptionkey','password','passwordhash','mediabytes','rawmediabytes','filebytes']).has(normalised);
}

function assertSafeJsonValue(value, label = 'value', depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new TypeError(`${label} is nested too deeply.`);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) throw new TypeError(`${label} must not contain binary data.`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`); return; }
  if (typeof value === 'string') { if (value.length > MAX_JSON_STRING_LENGTH) throw new TypeError(`${label} contains an oversized string.`); return; }
  if (Array.isArray(value)) { if (value.length > MAX_JSON_ARRAY_LENGTH) throw new TypeError(`${label} contains too many items.`); value.forEach((item,index)=>assertSafeJsonValue(item,`${label}[${index}]`,depth+1)); return; }
  if (!isPlainObject(value)) throw new TypeError(`${label} contains an unsupported value type.`);
  const entries = Object.entries(value);
  if (entries.length > MAX_JSON_OBJECT_KEYS) throw new TypeError(`${label} contains too many fields.`);
  for (const [key,child] of entries) {
    if (key.length === 0 || key.length > 128) throw new TypeError(`${label} contains an invalid field name.`);
    if (isForbiddenStateKey(key)) throw new TypeError(`${label} contains a secret or binary-media field.`);
    assertSafeJsonValue(child, `${label}.${key}`, depth + 1);
  }
}

function validateMediaIds(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new TypeError('mediaIds must be an array.');
  const unique = new Set();
  for (const mediaId of value) { assertMediaId(mediaId); if (unique.has(mediaId)) throw new TypeError('mediaIds must not contain duplicates.'); unique.add(mediaId); }
  return [...value];
}

function validateNullableDimension(value, label) {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100000) throw new TypeError(`${label} is invalid.`);
}

function validateMediaRecord(media) {
  assertExactKeys(media, ['id','schemaVersion','kind','originalFilename','managedReference','fileSize','sha256','importedAt','importMode','width','height','durationSeconds','container','codec','availability'], 'media record');
  assertManagedMediaId(media.id);
  if (media.schemaVersion !== MEDIA_SCHEMA_VERSION) throw new TypeError('Unsupported media schema version.');
  if (!MEDIA_KINDS.includes(media.kind)) throw new TypeError('media kind is invalid.');
  if (typeof media.originalFilename !== 'string' || media.originalFilename.length === 0 || media.originalFilename.length > 255 || /[\\/\0]/.test(media.originalFilename)) throw new TypeError('originalFilename is invalid.');
  if (typeof media.managedReference !== 'string' || !MANAGED_REFERENCE_PATTERN.test(media.managedReference) || !media.managedReference.includes(media.id)) throw new TypeError('managedReference is invalid.');
  if (!Number.isSafeInteger(media.fileSize) || media.fileSize <= 0 || media.fileSize > MAX_MEDIA_FILE_SIZE) throw new TypeError('media fileSize is invalid.');
  if (typeof media.sha256 !== 'string' || !SHA256_PATTERN.test(media.sha256)) throw new TypeError('media sha256 is invalid.');
  assertIsoTimestamp(media.importedAt, 'media importedAt');
  if (!MEDIA_IMPORT_MODES.includes(media.importMode)) throw new TypeError('media importMode is invalid.');
  validateNullableDimension(media.width, 'media width');
  validateNullableDimension(media.height, 'media height');
  if (media.durationSeconds !== null && (typeof media.durationSeconds !== 'number' || !Number.isFinite(media.durationSeconds) || media.durationSeconds < 0 || media.durationSeconds > 86400)) throw new TypeError('media durationSeconds is invalid.');
  for (const field of ['container','codec']) if (media[field] !== null && (typeof media[field] !== 'string' || media[field].length > 64)) throw new TypeError(`media ${field} is invalid.`);
  if (!MEDIA_AVAILABILITY_STATES.includes(media.availability)) throw new TypeError('media availability is invalid.');
  return media;
}

function validateApplicationState(application) {
  assertExactKeys(application, ['schemaVersion','settings','selectedProjectId','recentProjectIds'], 'application state');
  if (application.schemaVersion !== APPLICATION_SCHEMA_VERSION) throw new TypeError('Unsupported application-state schema version.');
  if (!isPlainObject(application.settings)) throw new TypeError('application settings must be an object.');
  assertSafeJsonValue(application.settings, 'application settings');
  if (application.selectedProjectId !== null) assertProjectId(application.selectedProjectId, 'selectedProjectId');
  if (!Array.isArray(application.recentProjectIds) || application.recentProjectIds.length > RECENT_PROJECT_LIMIT) throw new TypeError('recentProjectIds must be a bounded array.');
  const recent = new Set();
  for (const projectId of application.recentProjectIds) { assertProjectId(projectId, 'recentProjectId'); if (recent.has(projectId)) throw new TypeError('recentProjectIds must not contain duplicates.'); recent.add(projectId); }
  return application;
}

function validateProject(project) {
  assertExactKeys(project, ['id','schemaVersion','title','status','mediaIds','extensions','createdAt','updatedAt','revision'], 'project');
  assertProjectId(project.id);
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new TypeError('Unsupported project schema version.');
  if (typeof project.title !== 'string' || project.title.length === 0 || project.title.length > PROJECT_TITLE_LIMIT) throw new TypeError('project title is invalid.');
  if (!PROJECT_STATUSES.includes(project.status)) throw new TypeError('project status is invalid.');
  validateMediaIds(project.mediaIds);
  if (!isPlainObject(project.extensions)) throw new TypeError('project extensions must be an object.');
  assertSafeJsonValue(project.extensions, 'project extensions');
  assertIsoTimestamp(project.createdAt, 'project createdAt');
  assertIsoTimestamp(project.updatedAt, 'project updatedAt');
  assertRevision(project.revision, 'project revision');
  return project;
}

function validateDocument(document) {
  assertExactKeys(document, ['schemaVersion','revision','createdAt','updatedAt','application','projects','media'], 'store');
  if (document.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new TypeError('Unsupported store schema version.');
  assertRevision(document.revision); assertIsoTimestamp(document.createdAt,'store createdAt'); assertIsoTimestamp(document.updatedAt,'store updatedAt'); validateApplicationState(document.application);
  if (!isPlainObject(document.projects)) throw new TypeError('projects must be an object.');
  for (const [projectId, project] of Object.entries(document.projects)) { assertProjectId(projectId); validateProject(project); if (project.id !== projectId) throw new TypeError('project key does not match project id.'); }
  if (document.media !== undefined) {
    if (!isPlainObject(document.media)) throw new TypeError('media must be an object.');
    const hashes = new Set();
    for (const [mediaId, media] of Object.entries(document.media)) { assertManagedMediaId(mediaId); validateMediaRecord(media); if (media.id !== mediaId) throw new TypeError('media key does not match media id.'); if (hashes.has(media.sha256)) throw new TypeError('media content hashes must be unique.'); hashes.add(media.sha256); }
  }
  const knownProjectIds = new Set(Object.keys(document.projects));
  if (document.application.selectedProjectId && !knownProjectIds.has(document.application.selectedProjectId)) throw new TypeError('selectedProjectId does not reference a known project.');
  for (const projectId of document.application.recentProjectIds) if (!knownProjectIds.has(projectId)) throw new TypeError('recentProjectIds contains an unknown project.');
  return document;
}

function validateApplicationUpdateRequest(value) {
  assertExactKeys(value, ['expectedRevision','patch'], 'application update request'); assertRevision(value.expectedRevision,'expectedRevision'); assertExactKeys(value.patch,['settings','selectedProjectId','recentProjectIds'],'application patch');
  if ('settings' in value.patch) { if (!isPlainObject(value.patch.settings)) throw new TypeError('settings must be an object.'); assertSafeJsonValue(value.patch.settings,'settings'); }
  if ('selectedProjectId' in value.patch && value.patch.selectedProjectId !== null) assertProjectId(value.patch.selectedProjectId,'selectedProjectId');
  if ('recentProjectIds' in value.patch) { if (!Array.isArray(value.patch.recentProjectIds) || value.patch.recentProjectIds.length > RECENT_PROJECT_LIMIT) throw new TypeError('recentProjectIds must be a bounded array.'); const seen=new Set(); for (const projectId of value.patch.recentProjectIds) { assertProjectId(projectId,'recentProjectId'); if (seen.has(projectId)) throw new TypeError('recentProjectIds must not contain duplicates.'); seen.add(projectId); } }
  return value;
}
function validateCreateProjectRequest(value) { assertExactKeys(value,['expectedRevision','title','mediaIds','extensions'],'project create request'); assertRevision(value.expectedRevision,'expectedRevision'); if (typeof value.title!=='string'||value.title.length===0||value.title.length>PROJECT_TITLE_LIMIT) throw new TypeError('project title is invalid.'); if ('mediaIds' in value) validateMediaIds(value.mediaIds); if ('extensions' in value) { if (!isPlainObject(value.extensions)) throw new TypeError('extensions must be an object.'); assertSafeJsonValue(value.extensions,'extensions'); } return value; }
function validateRendererCreateProjectRequest(value) { validateCreateProjectRequest(value); if ('mediaIds' in value) throw new TypeError('Renderer project creation must attach media through the media service.'); return value; }
function validateRendererUpdateProjectRequest(value) { validateUpdateProjectRequest(value); if ('mediaIds' in value.patch) throw new TypeError('Renderer project updates must attach media through the media service.'); return value; }
function validateProjectReadRequest(value) { assertExactKeys(value,['projectId'],'project read request'); assertProjectId(value.projectId); return value; }
function validateUpdateProjectRequest(value) { assertExactKeys(value,['projectId','expectedRevision','patch'],'project update request'); assertProjectId(value.projectId); assertRevision(value.expectedRevision,'expectedRevision'); assertExactKeys(value.patch,['title','mediaIds','extensions'],'project patch'); if ('title' in value.patch && (typeof value.patch.title!=='string'||value.patch.title.length===0||value.patch.title.length>PROJECT_TITLE_LIMIT)) throw new TypeError('project title is invalid.'); if ('mediaIds' in value.patch) validateMediaIds(value.patch.mediaIds); if ('extensions' in value.patch) { if (!isPlainObject(value.patch.extensions)) throw new TypeError('extensions must be an object.'); assertSafeJsonValue(value.patch.extensions,'extensions'); } return value; }
function validateArchiveProjectRequest(value) { assertExactKeys(value,['projectId','expectedRevision'],'project archive request'); assertProjectId(value.projectId); assertRevision(value.expectedRevision,'expectedRevision'); return value; }

module.exports = { APPLICATION_SCHEMA_VERSION,CURRENT_SCHEMA_VERSION,MEDIA_SCHEMA_VERSION,MAX_MEDIA_FILE_SIZE,PROJECT_SCHEMA_VERSION,PROJECT_STATUSES,STORAGE_IPC_CHANNELS,assertManagedMediaId,assertProjectId,assertRevision,assertSafeJsonValue,isForbiddenStateKey,isPlainObject,validateApplicationState,validateApplicationUpdateRequest,validateArchiveProjectRequest,validateCreateProjectRequest,validateDocument,validateMediaIds,validateMediaRecord,validateProject,validateProjectReadRequest,validateRendererCreateProjectRequest,validateRendererUpdateProjectRequest,validateUpdateProjectRequest };

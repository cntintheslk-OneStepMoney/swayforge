'use strict';

const CONTENT_PROJECT_SCHEMA_VERSION = 1;
const CONTENT_PROJECT_EXTENSION_KEY = 'contentStudio';
const CONTENT_PROJECT_STATES = Object.freeze(['draft', 'ready-to-render', 'rendered', 'archived']);
const CONTENT_FORMATS = Object.freeze(['short-form-video', 'image', 'carousel']);
const ASPECT_RATIOS = Object.freeze(['9:16', '1:1', '16:9', '4:5']);
const PLATFORM_INTENTS = Object.freeze(['generic', 'tiktok', 'instagram-reel', 'youtube-short']);
const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORBIDDEN_KEYS = /(?:oauth|token|secret|password|privatekey|rawmedia|mediabytes|filebytes)/i;

function clone(value) { return structuredClone(value); }
function assertObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`); return value; }
function assertString(value, label, { min = 0, max = 5000, nullable = false } = {}) {
  if (value === null && nullable) return value;
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new TypeError(`${label} is invalid.`);
  return value;
}
function assertEnum(value, allowed, label) { if (!allowed.includes(value)) throw new TypeError(`${label} is invalid.`); return value; }
function assertRevision(value, label = 'revision') { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`); return value; }
function assertTimestamp(value, label) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp.`); return value; }
function assertMediaId(value, label = 'mediaId') { if (typeof value !== 'string' || !MEDIA_ID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`); return value; }
function assertSafeData(value, path = 'value', depth = 0) {
  if (depth > 10) throw new TypeError(`${path} is nested too deeply.`);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) throw new TypeError(`${path} must not contain raw media or binary data.`);
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return;
  if (Array.isArray(value)) { if (value.length > 2000) throw new TypeError(`${path} contains too many items.`); value.forEach((v, i) => assertSafeData(v, `${path}[${i}]`, depth + 1)); return; }
  assertObject(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key.replace(/[^a-z0-9_]/gi, ''))) throw new TypeError(`${path}.${key} contains a forbidden secret or raw-media field.`);
    assertSafeData(child, `${path}.${key}`, depth + 1);
  }
}
function uniqueMediaIds(value, label) {
  if (!Array.isArray(value) || value.length > 1000) throw new TypeError(`${label} must be a bounded array.`);
  const seen = new Set();
  for (const id of value) { assertMediaId(id, `${label} entry`); if (seen.has(id)) throw new TypeError(`${label} contains duplicates.`); seen.add(id); }
  return [...value];
}
function mediaCatalogMap(catalog = []) {
  const map = new Map();
  for (const item of catalog) { assertObject(item, 'media catalog item'); assertMediaId(item.id); map.set(item.id, item); }
  return map;
}
function validateBrief(brief) {
  assertObject(brief, 'creative brief');
  const allowed = ['title','goal','format','platformIntent','desiredDurationSeconds','aspectRatio','exportGoal','toneStyleNotes','userInstructions','selectedMediaIds','preferredMediaIds','requiredMediaIds','excludedMediaIds','captionNotes','scriptNotes'];
  for (const key of Object.keys(brief)) if (!allowed.includes(key)) throw new TypeError(`creative brief contains unsupported field ${key}.`);
  assertString(brief.title, 'brief title', { min: 1, max: 160 });
  assertString(brief.goal, 'brief goal', { max: 2000 });
  assertEnum(brief.format, CONTENT_FORMATS, 'brief format');
  assertEnum(brief.platformIntent, PLATFORM_INTENTS, 'platform intent');
  if (brief.desiredDurationSeconds !== null && (typeof brief.desiredDurationSeconds !== 'number' || !Number.isFinite(brief.desiredDurationSeconds) || brief.desiredDurationSeconds <= 0 || brief.desiredDurationSeconds > 3600)) throw new TypeError('desiredDurationSeconds is invalid.');
  assertEnum(brief.aspectRatio, ASPECT_RATIOS, 'aspect ratio');
  for (const key of ['exportGoal','toneStyleNotes','userInstructions','captionNotes','scriptNotes']) assertString(brief[key], key, { max: 5000 });
  const selected = uniqueMediaIds(brief.selectedMediaIds, 'selectedMediaIds');
  const preferred = uniqueMediaIds(brief.preferredMediaIds, 'preferredMediaIds');
  const required = uniqueMediaIds(brief.requiredMediaIds, 'requiredMediaIds');
  const excluded = uniqueMediaIds(brief.excludedMediaIds, 'excludedMediaIds');
  const selectedSet = new Set(selected); const excludedSet = new Set(excluded);
  for (const id of preferred) if (!selectedSet.has(id)) throw new TypeError('preferred media must be selected.');
  for (const id of required) if (!selectedSet.has(id)) throw new TypeError('required media must be selected.');
  for (const id of selected) if (excludedSet.has(id)) throw new TypeError('selected and excluded media cannot overlap.');
  return brief;
}
function mediaReferenceState(brief, catalog = []) {
  const map = mediaCatalogMap(catalog);
  const refs = [...new Set([...brief.selectedMediaIds, ...brief.excludedMediaIds])];
  return refs.map((id) => ({ id, availability: map.has(id) ? (map.get(id).availability || 'ready') : 'missing' }));
}
function validateProvenance(provenance) {
  if (!Array.isArray(provenance) || provenance.length > 500) throw new TypeError('acceptedAiProposals must be a bounded array.');
  for (const item of provenance) {
    assertObject(item, 'accepted AI proposal');
    const allowed = ['id','task','taskVersion','schemaVersion','model','acceptedAt','content','projectRevision'];
    for (const key of Object.keys(item)) if (!allowed.includes(key)) throw new TypeError('accepted AI proposal contains unsupported field.');
    assertString(item.id, 'proposal id', { min: 1, max: 128 }); assertString(item.task, 'task', { min: 1, max: 80 });
    assertString(item.taskVersion, 'taskVersion', { min: 1, max: 32 }); assertString(item.schemaVersion, 'schemaVersion', { min: 1, max: 32 });
    assertString(item.model, 'model', { min: 1, max: 200 }); assertTimestamp(item.acceptedAt, 'acceptedAt'); assertRevision(item.projectRevision, 'proposal projectRevision');
    assertSafeData(item.content, 'accepted proposal content');
  }
}
function validateContentProject(project, { mediaCatalog = [] } = {}) {
  assertObject(project, 'content project');
  const allowed = ['schemaVersion','state','revision','createdAt','updatedAt','brief','userAuthored','acceptedAiProposals','mediaReferences','storyboard','timeline','timedText','audio','cover','variants','renderOutputs'];
  for (const key of Object.keys(project)) if (!allowed.includes(key)) throw new TypeError(`content project contains unsupported field ${key}.`);
  if (project.schemaVersion !== CONTENT_PROJECT_SCHEMA_VERSION) throw new TypeError('Unsupported content project schema version.');
  assertEnum(project.state, CONTENT_PROJECT_STATES, 'content project state'); assertRevision(project.revision);
  assertTimestamp(project.createdAt, 'createdAt'); assertTimestamp(project.updatedAt, 'updatedAt'); validateBrief(project.brief);
  assertObject(project.userAuthored, 'userAuthored'); assertSafeData(project.userAuthored, 'userAuthored'); validateProvenance(project.acceptedAiProposals);
  if (!Array.isArray(project.mediaReferences)) throw new TypeError('mediaReferences must be an array.');
  const expected = mediaReferenceState(project.brief, mediaCatalog); const expectedById = new Map(expected.map((item) => [item.id, item.availability]));
  for (const ref of project.mediaReferences) { assertObject(ref, 'media reference'); assertMediaId(ref.id); assertEnum(ref.availability, ['ready','missing','unavailable','changed','corrupt'], 'media availability'); if (!expectedById.has(ref.id)) throw new TypeError('mediaReferences contains an unapproved media ID.'); }
  for (const key of ['storyboard','timeline','timedText','audio','cover','variants','renderOutputs']) assertSafeData(project[key], key);
  assertSafeData(project, 'content project'); return project;
}
function defaultBrief({ title, mediaIds = [] } = {}) {
  return { title: title || 'Untitled content project', goal: '', format: 'short-form-video', platformIntent: 'generic', desiredDurationSeconds: null, aspectRatio: '9:16', exportGoal: '', toneStyleNotes: '', userInstructions: '', selectedMediaIds: uniqueMediaIds(mediaIds, 'mediaIds'), preferredMediaIds: [], requiredMediaIds: [], excludedMediaIds: [], captionNotes: '', scriptNotes: '' };
}
function createContentProject({ title, mediaIds = [], brief = {}, now = new Date().toISOString(), mediaCatalog = [] } = {}) {
  const mergedBrief = { ...defaultBrief({ title, mediaIds }), ...clone(brief) }; validateBrief(mergedBrief);
  const project = { schemaVersion: CONTENT_PROJECT_SCHEMA_VERSION, state: 'draft', revision: 0, createdAt: now, updatedAt: now, brief: mergedBrief, userAuthored: { briefRevision: 0 }, acceptedAiProposals: [], mediaReferences: mediaReferenceState(mergedBrief, mediaCatalog), storyboard: null, timeline: null, timedText: [], audio: { sources: [], items: [] }, cover: null, variants: [], renderOutputs: [] };
  validateContentProject(project, { mediaCatalog }); return project;
}
function migrateGenericProject(genericProject, { mediaCatalog = [], now } = {}) {
  assertObject(genericProject, 'generic project'); const existing = genericProject.extensions?.[CONTENT_PROJECT_EXTENSION_KEY];
  if (existing) return validateContentProject(clone(existing), { mediaCatalog });
  const legacy = genericProject.extensions?.contentBrief || {};
  const content = createContentProject({ title: genericProject.title, mediaIds: genericProject.mediaIds || [], brief: { goal: typeof legacy.goal === 'string' ? legacy.goal : '', toneStyleNotes: typeof legacy.toneStyleNotes === 'string' ? legacy.toneStyleNotes : '', userInstructions: typeof legacy.userInstructions === 'string' ? legacy.userInstructions : '' }, now: now || genericProject.updatedAt || genericProject.createdAt || new Date().toISOString(), mediaCatalog });
  content.userAuthored.legacyExtensionSnapshot = clone(genericProject.extensions || {}); assertSafeData(content.userAuthored.legacyExtensionSnapshot, 'legacy extension snapshot'); return content;
}
function updateContentProject(project, patch, { expectedRevision, now = new Date().toISOString(), mediaCatalog = [] } = {}) {
  validateContentProject(project, { mediaCatalog }); assertRevision(expectedRevision, 'expectedRevision');
  if (project.revision !== expectedRevision) { const error = new Error('Content project revision conflict.'); error.code = 'CONTENT_PROJECT_CONFLICT'; throw error; }
  assertObject(patch, 'content project patch'); const next = clone(project);
  if ('state' in patch) next.state = patch.state;
  if ('brief' in patch) { next.brief = { ...next.brief, ...clone(patch.brief) }; next.userAuthored.briefRevision = (next.userAuthored.briefRevision || 0) + 1; }
  for (const key of ['storyboard','timeline','timedText','audio','cover','variants','renderOutputs']) if (key in patch) next[key] = clone(patch[key]);
  next.revision += 1; next.updatedAt = now; next.mediaReferences = mediaReferenceState(next.brief, mediaCatalog); validateContentProject(next, { mediaCatalog }); return next;
}
function acceptAiProposal(project, proposal, { expectedRevision, now = new Date().toISOString(), mediaCatalog = [] } = {}) {
  assertObject(proposal, 'AI proposal'); const allowedMedia = new Set(project.brief.selectedMediaIds);
  for (const id of proposal.mediaIds || []) if (!allowedMedia.has(id)) throw new TypeError('AI proposal references media outside the approved project set.');
  const record = { id: proposal.id, task: proposal.task, taskVersion: proposal.taskVersion, schemaVersion: proposal.schemaVersion, model: proposal.model, acceptedAt: now, content: clone(proposal.content), projectRevision: project.revision };
  const next = updateContentProject(project, {}, { expectedRevision, now, mediaCatalog }); next.acceptedAiProposals.push(record); validateContentProject(next, { mediaCatalog }); return next;
}
function toStorageExtension(project) { validateContentProject(project); return { [CONTENT_PROJECT_EXTENSION_KEY]: clone(project) }; }

module.exports = { ASPECT_RATIOS, CONTENT_FORMATS, CONTENT_PROJECT_EXTENSION_KEY, CONTENT_PROJECT_SCHEMA_VERSION, CONTENT_PROJECT_STATES, PLATFORM_INTENTS, acceptAiProposal, createContentProject, defaultBrief, mediaReferenceState, migrateGenericProject, toStorageExtension, updateContentProject, validateBrief, validateContentProject };

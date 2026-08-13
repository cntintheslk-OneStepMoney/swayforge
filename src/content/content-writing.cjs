'use strict';
const { acceptAiProposal, validateContentProject } = require('./content-project-contracts.cjs');

const WRITING_TASKS = Object.freeze({
  ideas: { id: 'content-ideas', version: '1', min: 2, max: 6, maxText: 1800 },
  hooks: { id: 'content-hooks', version: '1', min: 2, max: 8, maxText: 800 },
  script: { id: 'content-script', version: '1', min: 1, max: 3, maxText: 6000 },
  caption: { id: 'content-caption', version: '1', min: 1, max: 5, maxText: 3000 },
  rewrite: { id: 'content-rewrite', version: '1', min: 1, max: 5, maxText: 6000 },
  critique: { id: 'content-critique', version: '1', min: 1, max: 5, maxText: 2500 }
});
const MAX_MEDIA_SUMMARIES = 40; const MAX_SUMMARY_LENGTH = 1200;
function clone(v) { return structuredClone(v); }
function taskDefinition(task) { const def = WRITING_TASKS[task]; if (!def) throw new TypeError('Unsupported writing task.'); return def; }
function safeText(value, label, max) { if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError(`${label} is invalid.`); return value; }
function buildWritingContext(project, { mediaSummaries = [], creatorStyle = null, userText = '' } = {}) {
  validateContentProject(project); if (!Array.isArray(mediaSummaries) || mediaSummaries.length > MAX_MEDIA_SUMMARIES) throw new TypeError('mediaSummaries is invalid.'); const approved = new Set(project.brief.selectedMediaIds);
  const summaries = mediaSummaries.filter((item) => approved.has(item?.id)).map((item) => ({ id: item.id, kind: ['image','video'].includes(item.kind) ? item.kind : 'unknown', description: typeof item.description === 'string' ? item.description.slice(0, MAX_SUMMARY_LENGTH) : '', labels: Array.isArray(item.labels) ? item.labels.filter((v) => typeof v === 'string').slice(0, 24).map((v) => v.slice(0, 120)) : [] }));
  return { projectRevision: project.revision, brief: { title: project.brief.title, goal: project.brief.goal, format: project.brief.format, platformIntent: project.brief.platformIntent, desiredDurationSeconds: project.brief.desiredDurationSeconds, aspectRatio: project.brief.aspectRatio, toneStyleNotes: project.brief.toneStyleNotes, userInstructions: project.brief.userInstructions, captionNotes: project.brief.captionNotes, scriptNotes: project.brief.scriptNotes }, approvedMediaIds: [...approved], mediaSummaries: summaries, creatorStyle: creatorStyle && typeof creatorStyle === 'object' ? clone(creatorStyle) : null, userText: typeof userText === 'string' ? userText.slice(0, 8000) : '' };
}
function validateWritingResult(task, result, project) {
  const def = taskDefinition(task); validateContentProject(project); if (!result || typeof result !== 'object' || !Array.isArray(result.options)) throw new TypeError('Writing result must contain options.'); if (result.options.length < def.min || result.options.length > def.max) throw new TypeError('Writing result option count is invalid.');
  const approved = new Set(project.brief.selectedMediaIds); const seen = new Set();
  const options = result.options.map((option, index) => { if (!option || typeof option !== 'object') throw new TypeError('Writing option is invalid.'); const id = safeText(option.id || `${task}-${index + 1}`, 'option id', 128); if (seen.has(id)) throw new TypeError('Writing option IDs must be unique.'); seen.add(id); const text = safeText(option.text, 'option text', def.maxText); const mediaIds = Array.isArray(option.mediaIds) ? option.mediaIds : []; for (const idValue of mediaIds) if (!approved.has(idValue)) throw new TypeError('Writing result references media outside the approved set.'); const verificationRequired = option.verificationRequired === true; if (verificationRequired && option.verified === true) throw new TypeError('Unverified external facts cannot be presented as verified.'); return { id, text, mediaIds: [...mediaIds], verificationRequired, rationale: typeof option.rationale === 'string' ? option.rationale.slice(0, 1200) : '' }; });
  return { task, taskId: def.id, taskVersion: def.version, options };
}
async function generateWriting({ provider, task, project, mediaSummaries = [], creatorStyle = null, userText = '', signal } = {}) {
  const def = taskDefinition(task); validateContentProject(project); if (!provider || typeof provider.generateStructured !== 'function' || provider.available === false) return { status: 'unavailable', reason: 'local-ai-unavailable', task }; if (signal?.aborted) return { status: 'cancelled', task };
  const context = buildWritingContext(project, { mediaSummaries, creatorStyle, userText }); let raw;
  try { raw = await provider.generateStructured({ task: { id: def.id, version: def.version }, context, output: { kind: 'writing-options', min: def.min, max: def.max, maxText: def.maxText }, signal }); }
  catch (error) { if (signal?.aborted || error?.name === 'AbortError') return { status: 'cancelled', task }; return { status: 'unavailable', reason: 'local-ai-error', task, errorCode: typeof error?.code === 'string' ? error.code : null }; }
  if (signal?.aborted) return { status: 'cancelled', task }; const validated = validateWritingResult(task, raw, project); return { status: 'proposal', projectRevision: project.revision, task, taskId: def.id, taskVersion: def.version, model: typeof provider.model === 'string' ? provider.model : 'local-model', ...validated };
}
function acceptWritingOption(project, generation, optionId, { expectedRevision, mediaCatalog = [], now = new Date().toISOString() } = {}) {
  validateContentProject(project, { mediaCatalog }); if (!generation || generation.status !== 'proposal') throw new TypeError('generation is not an accepted proposal source.');
  if (generation.projectRevision !== project.revision || expectedRevision !== project.revision) { const error = new Error('Writing proposal is stale.'); error.code = 'CONTENT_WRITING_STALE'; throw error; }
  const option = generation.options.find((item) => item.id === optionId); if (!option) throw new TypeError('Writing option does not exist.');
  return acceptAiProposal(project, { id: `${generation.taskId}:${option.id}:${project.revision}`, task: generation.taskId, taskVersion: generation.taskVersion, schemaVersion: '1', model: generation.model, mediaIds: option.mediaIds, content: { text: option.text, verificationRequired: option.verificationRequired, rationale: option.rationale } }, { expectedRevision, mediaCatalog, now });
}
function writingDiagnostics(generation) { return { status: generation?.status || 'unknown', task: generation?.task || null, optionCount: Array.isArray(generation?.options) ? generation.options.length : 0, errorCode: generation?.errorCode || null }; }
module.exports = { MAX_MEDIA_SUMMARIES, WRITING_TASKS, acceptWritingOption, buildWritingContext, generateWriting, taskDefinition, validateWritingResult, writingDiagnostics };

'use strict';

const {
  ADVISORY_SYSTEM_RULES,
  CONTENT_FORMATS,
  PLATFORM_KEYS,
  getTaskDefinition
} = require('./task-definitions.cjs');

const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function validationFailure(code, path, message) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, path, message })
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function boundedString(value, { field, maxLength, minLength = 1, optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return undefined;
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new TypeError(`Invalid AI task context field: ${field}.`);
  }
  return value;
}

function boundedStringArray(value, {
  field,
  maxItems,
  maxLength,
  minItems = 0,
  optional = false,
  pattern = null,
  unique = false
} = {}) {
  if (optional && (value === undefined || value === null)) return undefined;
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new TypeError(`Invalid AI task context field: ${field}.`);
  }
  const result = value.map((item) => {
    const string = boundedString(item, { field, maxLength });
    if (pattern && !pattern.test(string)) throw new TypeError(`Invalid AI task context field: ${field}.`);
    return string;
  });
  if (unique && new Set(result).size !== result.length) {
    throw new TypeError(`Invalid AI task context field: ${field}.`);
  }
  return result;
}

function optionalInteger(value, { field, min, max, fallback } = {}) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`Invalid AI task context field: ${field}.`);
  }
  return value;
}

function buildTaskContext(taskId, source) {
  getTaskDefinition(taskId);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('AI task context source must be an object.');
  }

  let context;
  if (taskId === 'content_idea') {
    const creatorTone = boundedStringArray(source.creatorTone, {
      field: 'creatorTone',
      maxItems: 8,
      maxLength: 40,
      optional: true,
      unique: true
    });
    const projectSummary = boundedString(source.projectSummary, {
      field: 'projectSummary',
      maxLength: 2_000,
      optional: true
    });
    const availableMediaIds = boundedStringArray(source.availableMediaIds, {
      field: 'availableMediaIds',
      maxItems: 16,
      maxLength: 128,
      optional: true,
      pattern: MEDIA_ID_PATTERN,
      unique: true
    });
    const targetPlatform = boundedString(source.targetPlatform, {
      field: 'targetPlatform',
      maxLength: 32
    });
    if (!PLATFORM_KEYS.includes(targetPlatform)) {
      throw new TypeError('Invalid AI task context field: targetPlatform.');
    }

    context = {
      topicSummary: boundedString(source.topicSummary, { field: 'topicSummary', maxLength: 2_000 }),
      targetPlatform,
      requestedDurationSeconds: optionalInteger(source.requestedDurationSeconds, {
        field: 'requestedDurationSeconds',
        min: 1,
        max: 600,
        fallback: null
      })
    };
    if (creatorTone !== undefined) context.creatorTone = creatorTone;
    if (projectSummary !== undefined) context.projectSummary = projectSummary;
    if (availableMediaIds !== undefined) context.availableMediaIds = availableMediaIds;
  } else if (taskId === 'rewrite_copy') {
    const styleHints = boundedStringArray(source.styleHints, {
      field: 'styleHints',
      maxItems: 8,
      maxLength: 80,
      optional: true,
      unique: true
    });
    context = {
      draft: boundedString(source.draft, { field: 'draft', maxLength: 8_000 }),
      maxCharacters: optionalInteger(source.maxCharacters, {
        field: 'maxCharacters',
        min: 1,
        max: 5_000,
        fallback: 2_200
      })
    };
    if (styleHints !== undefined) context.styleHints = styleHints;
  } else {
    context = {
      text: boundedString(source.text, { field: 'text', maxLength: 8_000 }),
      allowedLabels: boundedStringArray(source.allowedLabels, {
        field: 'allowedLabels',
        maxItems: 16,
        minItems: 1,
        maxLength: 64,
        unique: true
      }),
      maxSummaryCharacters: optionalInteger(source.maxSummaryCharacters, {
        field: 'maxSummaryCharacters',
        min: 40,
        max: 2_000,
        fallback: 600
      })
    };
  }

  return deepFreeze(context);
}

function buildTaskMessages(taskId, context, { repair = false } = {}) {
  const definition = getTaskDefinition(taskId);
  const system = [
    ADVISORY_SYSTEM_RULES,
    `Task: ${definition.id}@${definition.taskVersion}.`,
    definition.instruction,
    repair ? 'A previous response was malformed. Produce a fresh valid JSON object; do not quote, explain, or reproduce the malformed response.' : null
  ].filter(Boolean).join(' ');

  const payload = JSON.stringify({
    task: Object.freeze({ id: definition.id, version: definition.taskVersion }),
    context
  });

  return Object.freeze([
    Object.freeze({ role: 'system', content: system }),
    Object.freeze({ role: 'user', content: payload })
  ]);
}

function createRuntimeTaskRequest({ taskId, model, context, repair = false, timeoutMs, maxOutputTokens, temperature } = {}) {
  const definition = getTaskDefinition(taskId);
  const request = {
    model,
    messages: buildTaskMessages(taskId, context, { repair }),
    structuredOutputSchema: definition.responseSchema,
    maxOutputTokens: maxOutputTokens ?? definition.defaultMaxOutputTokens,
    temperature: temperature ?? definition.defaultTemperature
  };
  if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
  return Object.freeze(request);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function requiredString(value, field, maxLength, { minLength = 1 } = {}) {
  if (typeof value !== 'string') return validationFailure('invalid-type', field, `${field} must be a string.`);
  if (value.length < minLength) return validationFailure('missing-field', field, `${field} is required.`);
  if (value.length > maxLength) return validationFailure('too-long', field, `${field} exceeds its maximum length.`);
  return null;
}

function optionalString(value, field, maxLength) {
  if (value === undefined) return null;
  if (typeof value !== 'string') return validationFailure('invalid-type', field, `${field} must be a string.`);
  if (value.length > maxLength) return validationFailure('too-long', field, `${field} exceeds its maximum length.`);
  return null;
}

function validateEnvelope(definition, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return validationFailure('invalid-type', '$', 'Structured AI response must be an object.');
  }
  if (value.responseType !== definition.responseType) {
    return validationFailure('schema-mismatch', 'responseType', 'AI response type does not match the task contract.');
  }
  if (value.schemaVersion !== definition.schemaVersion) {
    return validationFailure('schema-mismatch', 'schemaVersion', 'AI response schema version does not match the task contract.');
  }
  return null;
}

function validateStringArray(value, field, maxItems, maxLength) {
  if (!Array.isArray(value)) return validationFailure('invalid-type', field, `${field} must be an array.`);
  if (value.length > maxItems) return validationFailure('too-many-items', field, `${field} has too many items.`);
  for (let index = 0; index < value.length; index += 1) {
    const itemError = requiredString(value[index], `${field}[${index}]`, maxLength);
    if (itemError) return itemError;
  }
  return null;
}

function validateAllowedReference(value, field, allowedValues, message) {
  const allowed = allowedValues instanceof Set ? allowedValues : new Set(allowedValues);
  if (!allowed.has(value)) {
    return validationFailure('unknown-reference', field, message || 'AI response referenced a value outside the supplied task context.');
  }
  return null;
}

function validateAllowedReferences(value, field, allowedValues, { maxItems = 8, maxLength = 128, message } = {}) {
  const arrayError = validateStringArray(value, field, maxItems, maxLength);
  if (arrayError) return arrayError;
  const allowed = allowedValues instanceof Set ? allowedValues : new Set(allowedValues);
  for (let index = 0; index < value.length; index += 1) {
    const referenceError = validateAllowedReference(value[index], `${field}[${index}]`, allowed, message);
    if (referenceError) return referenceError;
  }
  return null;
}

function validateContentIdea(definition, value, context) {
  const allowed = new Set([
    'responseType', 'schemaVersion', 'title', 'hook', 'rationale', 'contentFormat',
    'platform', 'mediaIds', 'confidenceText', 'limitationsText'
  ]);
  if (!hasOnlyKeys(value, allowed)) return validationFailure('unexpected-field', '$', 'AI response contains an unsupported field.');

  for (const [field, limit] of [['title', 160], ['hook', 280], ['rationale', 600]]) {
    const error = requiredString(value[field], field, limit);
    if (error) return error;
  }
  for (const [field, limit] of [['confidenceText', 240], ['limitationsText', 320]]) {
    const error = optionalString(value[field], field, limit);
    if (error) return error;
  }
  if (!CONTENT_FORMATS.includes(value.contentFormat)) {
    return validationFailure('invalid-enum', 'contentFormat', 'AI response content format is unsupported.');
  }
  if (!PLATFORM_KEYS.includes(value.platform)) {
    return validationFailure('invalid-enum', 'platform', 'AI response platform is unsupported.');
  }
  const platformError = validateAllowedReference(
    value.platform,
    'platform',
    [context.targetPlatform],
    'AI response referenced a platform outside the supplied task context.'
  );
  if (platformError) return platformError;
  const mediaError = validateAllowedReferences(value.mediaIds, 'mediaIds', context.availableMediaIds || [], {
    maxItems: 8,
    maxLength: 128,
    message: 'AI response referenced an unavailable media ID.'
  });
  if (mediaError) return mediaError;
  return null;
}

function validateRewriteCopy(value, context) {
  const allowed = new Set(['responseType', 'schemaVersion', 'rewrittenText', 'explanation']);
  if (!hasOnlyKeys(value, allowed)) return validationFailure('unexpected-field', '$', 'AI response contains an unsupported field.');
  const rewrittenError = requiredString(value.rewrittenText, 'rewrittenText', context.maxCharacters);
  if (rewrittenError) return rewrittenError;
  return optionalString(value.explanation, 'explanation', 500);
}

function validateClassification(value, context) {
  const allowed = new Set(['responseType', 'schemaVersion', 'summary', 'labels']);
  if (!hasOnlyKeys(value, allowed)) return validationFailure('unexpected-field', '$', 'AI response contains an unsupported field.');
  const summaryError = requiredString(value.summary, 'summary', context.maxSummaryCharacters);
  if (summaryError) return summaryError;
  const labelsError = validateAllowedReferences(value.labels, 'labels', context.allowedLabels, {
    maxItems: 8,
    maxLength: 64,
    message: 'AI response referenced a label outside the supplied task context.'
  });
  if (labelsError) return labelsError;
  return null;
}

function validateTaskResponse(taskId, rawContent, context) {
  const definition = getTaskDefinition(taskId);
  let value = rawContent;
  if (typeof rawContent === 'string') {
    try {
      value = JSON.parse(rawContent);
    } catch {
      return validationFailure('malformed-json', '$', 'AI response was not valid JSON.');
    }
  }

  const envelopeError = validateEnvelope(definition, value);
  if (envelopeError) return envelopeError;

  let error;
  if (taskId === 'content_idea') error = validateContentIdea(definition, value, context);
  else if (taskId === 'rewrite_copy') error = validateRewriteCopy(value, context);
  else error = validateClassification(value, context);
  if (error) return error;

  const copy = JSON.parse(JSON.stringify(value));
  return Object.freeze({ ok: true, value: deepFreeze(copy) });
}

function taskMetadata(taskId) {
  const definition = getTaskDefinition(taskId);
  return Object.freeze({
    id: definition.id,
    taskVersion: definition.taskVersion,
    responseType: definition.responseType,
    schemaVersion: definition.schemaVersion
  });
}

module.exports = {
  MEDIA_ID_PATTERN,
  buildTaskContext,
  buildTaskMessages,
  createRuntimeTaskRequest,
  taskMetadata,
  validateAllowedReference,
  validateAllowedReferences,
  validateTaskResponse,
  validationFailure
};

'use strict';

const AI_RUNTIME_STATES = Object.freeze([
  'unavailable',
  'ready',
  'no-model',
  'busy',
  'error',
  'unsupported',
  'disabled'
]);

const AI_ERROR_CATEGORIES = Object.freeze([
  'aborted',
  'busy',
  'configuration',
  'malformed-response',
  'model-unavailable',
  'response-too-large',
  'runtime-error',
  'timeout',
  'transport',
  'unsupported'
]);

const LIMITS = Object.freeze({
  maxMessages: 32,
  maxInputCharacters: 64_000,
  maxMessageCharacters: 16_000,
  maxImagesPerMessage: 4,
  maxImageBytes: 2 * 1024 * 1024,
  maxTotalImageBytes: 6 * 1024 * 1024,
  maxModelIdentifierCharacters: 160,
  maxOutputCharacters: 64_000,
  maxOutputTokens: 8_192,
  maxSchemaCharacters: 16_000,
  maxTimeoutMs: 120_000,
  minTimeoutMs: 250
});

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function freezeStatus(status) {
  if (!status || !AI_RUNTIME_STATES.includes(status.state)) {
    throw new TypeError('Invalid AI runtime status state.');
  }

  const result = {
    provider: status.provider ?? 'unknown',
    state: status.state,
    model: status.model ?? null,
    runtimeVersion: status.runtimeVersion ?? null,
    capabilities: Array.isArray(status.capabilities) ? [...status.capabilities] : [],
    reason: status.reason ?? null
  };

  if (!isBoundedString(result.provider, 64)) throw new TypeError('Invalid AI provider identifier.');
  if (result.model !== null) validateModelIdentifier(result.model);
  if (result.runtimeVersion !== null && !isBoundedString(result.runtimeVersion, 128)) {
    throw new TypeError('Invalid runtime version.');
  }
  if (result.reason !== null && !isBoundedString(result.reason, 160)) {
    throw new TypeError('Invalid AI status reason.');
  }
  if (result.capabilities.some((value) => !isBoundedString(value, 64))) {
    throw new TypeError('Invalid AI capability.');
  }

  return Object.freeze({
    ...result,
    capabilities: Object.freeze(result.capabilities)
  });
}

function validateModelIdentifier(value) {
  if (!isBoundedString(value, LIMITS.maxModelIdentifierCharacters)) {
    throw new TypeError('Invalid AI model identifier.');
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Invalid AI model identifier.');
  }
  return value;
}

function normaliseImagePayload(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new TypeError('Invalid AI image payload.');
  }
  const decodedBytes = Buffer.byteLength(Buffer.from(value, 'base64'));
  if (decodedBytes < 1 || decodedBytes > LIMITS.maxImageBytes) {
    throw new TypeError('AI image payload exceeds its configured bound.');
  }
  return Object.freeze({ value, decodedBytes });
}

function normaliseMessages(request) {
  const source = Array.isArray(request.messages)
    ? request.messages
    : typeof request.input === 'string'
      ? [{ role: 'user', content: request.input }]
      : null;

  if (!source || source.length === 0 || source.length > LIMITS.maxMessages) {
    throw new TypeError('AI request must contain a bounded message list.');
  }

  let totalCharacters = 0;
  let totalImageBytes = 0;
  const messages = source.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new TypeError('Invalid AI message.');
    }
    const allowedKeys = new Set(['role', 'content', 'images']);
    if (Object.keys(message).some((key) => !allowedKeys.has(key))) {
      throw new TypeError('Unsupported AI message option.');
    }
    if (!ALLOWED_ROLES.has(message.role)) throw new TypeError('Invalid AI message role.');
    if (!isBoundedString(message.content, LIMITS.maxMessageCharacters)) {
      throw new TypeError('Invalid AI message content.');
    }
    totalCharacters += message.content.length;

    let images;
    if (message.images !== undefined) {
      if (message.role !== 'user' || !Array.isArray(message.images) || message.images.length < 1 || message.images.length > LIMITS.maxImagesPerMessage) {
        throw new TypeError('AI image payloads are only permitted on bounded user messages.');
      }
      const normalised = message.images.map(normaliseImagePayload);
      totalImageBytes += normalised.reduce((sum, item) => sum + item.decodedBytes, 0);
      images = Object.freeze(normalised.map((item) => item.value));
    }

    return Object.freeze(images
      ? { role: message.role, content: message.content, images }
      : { role: message.role, content: message.content });
  });

  if (totalCharacters > LIMITS.maxInputCharacters) {
    throw new TypeError('AI request input is too large.');
  }
  if (totalImageBytes > LIMITS.maxTotalImageBytes) {
    throw new TypeError('AI request image input is too large.');
  }

  return Object.freeze(messages);
}

function normaliseSchema(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Structured output schema must be an object.');
  }
  const serialised = JSON.stringify(value);
  if (serialised.length > LIMITS.maxSchemaCharacters) {
    throw new TypeError('Structured output schema is too large.');
  }
  return Object.freeze(JSON.parse(serialised));
}

function normaliseGenerationRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Invalid AI generation request.');
  }

  const model = validateModelIdentifier(request.model);
  const messages = normaliseMessages(request);
  const timeoutMs = request.timeoutMs ?? 30_000;
  const maxOutputTokens = request.maxOutputTokens ?? 2_048;

  if (!Number.isInteger(timeoutMs) || timeoutMs < LIMITS.minTimeoutMs || timeoutMs > LIMITS.maxTimeoutMs) {
    throw new TypeError('Invalid AI request timeout.');
  }
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > LIMITS.maxOutputTokens) {
    throw new TypeError('Invalid AI output-token bound.');
  }

  let temperature = null;
  if (request.temperature !== undefined && request.temperature !== null) {
    if (typeof request.temperature !== 'number' || !Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2) {
      throw new TypeError('Invalid AI temperature.');
    }
    temperature = request.temperature;
  }

  const allowedKeys = new Set([
    'input',
    'messages',
    'model',
    'structuredOutputSchema',
    'timeoutMs',
    'maxOutputTokens',
    'temperature'
  ]);
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
    throw new TypeError('Unsupported AI request option.');
  }

  return Object.freeze({
    model,
    messages,
    structuredOutputSchema: normaliseSchema(request.structuredOutputSchema),
    timeoutMs,
    maxOutputTokens,
    temperature
  });
}

function createFailure({ requestId = null, category, message, model = null }) {
  if (!AI_ERROR_CATEGORIES.includes(category)) throw new TypeError('Invalid AI error category.');
  if (!isBoundedString(message, 200)) throw new TypeError('Invalid AI error message.');
  if (model !== null) validateModelIdentifier(model);
  return Object.freeze({
    ok: false,
    requestId,
    model,
    error: Object.freeze({ category, message })
  });
}

function createSuccess({ requestId, model, content }) {
  validateModelIdentifier(model);
  if (typeof content !== 'string' || content.length > LIMITS.maxOutputCharacters) {
    throw new TypeError('Invalid AI generated content.');
  }
  return Object.freeze({
    ok: true,
    requestId,
    model,
    content
  });
}

module.exports = {
  AI_ERROR_CATEGORIES,
  AI_RUNTIME_STATES,
  BASE64_PATTERN,
  LIMITS,
  createFailure,
  createSuccess,
  freezeStatus,
  normaliseGenerationRequest,
  normaliseImagePayload,
  validateModelIdentifier
};

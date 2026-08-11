'use strict';

const {
  LIMITS,
  createFailure,
  createSuccess,
  freezeStatus,
  validateModelIdentifier
} = require('../runtime-contracts.cjs');

const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MAX_TRANSPORT_RESPONSE_BYTES = 128 * 1024;
const CLOUD_MODEL_MARKERS = Object.freeze([/:cloud(?:$|[-:])/i, /-cloud(?:$|[-:])/i]);

function normaliseLocalEndpoint(value = DEFAULT_OLLAMA_ENDPOINT) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Invalid Ollama endpoint.');
  }

  if (parsed.protocol !== 'http:' || !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new TypeError('Ollama endpoint must use an approved local loopback host.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('Ollama endpoint cannot contain credentials, query parameters, or fragments.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '/api' && parsed.pathname !== '/api/') {
    throw new TypeError('Ollama endpoint path must be empty or /api.');
  }

  const port = parsed.port || '80';
  const host = parsed.hostname === '[::1]' ? '[::1]' : parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname;
  return `${parsed.protocol}//${host}:${port}`;
}

function isCloudModelIdentifier(model) {
  validateModelIdentifier(model);
  return CLOUD_MODEL_MARKERS.some((pattern) => pattern.test(model));
}

async function readBoundedText(response, limit = MAX_TRANSPORT_RESPONSE_BYTES) {
  const lengthHeader = response.headers?.get?.('content-length');
  if (lengthHeader && Number(lengthHeader) > limit) {
    const error = new Error('Provider response exceeds the configured size bound.');
    error.code = 'response-too-large';
    throw error;
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limit) {
      const error = new Error('Provider response exceeds the configured size bound.');
      error.code = 'response-too-large';
      throw error;
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        const error = new Error('Provider response exceeds the configured size bound.');
        error.code = 'response-too-large';
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Ollama returned malformed JSON.');
    error.code = 'malformed-response';
    throw error;
  }
}

function hasRemoteModelMetadata(model) {
  if (!model || typeof model !== 'object') return false;
  return (typeof model.remote_model === 'string' && model.remote_model.length > 0) ||
    (typeof model.remote_host === 'string' && model.remote_host.length > 0);
}

function safeModelMetadata(model) {
  if (!model || typeof model !== 'object' || hasRemoteModelMetadata(model)) return null;
  const name = typeof model.name === 'string' ? model.name : model.model;
  if (typeof name !== 'string') return null;
  try {
    validateModelIdentifier(name);
  } catch {
    return null;
  }
  if (isCloudModelIdentifier(name)) return null;
  return Object.freeze({
    id: name,
    size: Number.isSafeInteger(model.size) && model.size >= 0 ? model.size : null,
    family: typeof model.details?.family === 'string' ? model.details.family.slice(0, 80) : null,
    parameterSize: typeof model.details?.parameter_size === 'string' ? model.details.parameter_size.slice(0, 80) : null,
    quantization: typeof model.details?.quantization_level === 'string' ? model.details.quantization_level.slice(0, 80) : null
  });
}

function ollamaStatus(status) {
  return freezeStatus({ provider: 'ollama', ...status });
}

class OllamaProvider {
  constructor({ endpoint = DEFAULT_OLLAMA_ENDPOINT, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.id = 'ollama';
    this.endpoint = normaliseLocalEndpoint(endpoint);
    this.fetchImpl = fetchImpl;
  }

  async requestJson(pathname, { method = 'GET', body, signal } = {}) {
    const target = new URL(pathname, `${this.endpoint}/`);
    if (!LOCAL_HOSTNAMES.has(target.hostname) || target.origin !== new URL(this.endpoint).origin) {
      throw new TypeError('Ollama request escaped the approved local origin.');
    }

    const response = await this.fetchImpl(target, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      redirect: 'manual',
      signal
    });

    if (response.status >= 300 && response.status < 400) {
      const error = new Error('Ollama redirect was rejected.');
      error.code = 'unsupported';
      throw error;
    }

    const text = await readBoundedText(response);
    const payload = text.length === 0 ? {} : parseJson(text);
    if (!response.ok) {
      const error = new Error('Ollama request failed.');
      error.code = 'runtime-error';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async getRuntimeVersion({ signal } = {}) {
    const payload = await this.requestJson('/api/version', { signal });
    if (!payload || typeof payload.version !== 'string' || payload.version.length === 0 || payload.version.length > 128) {
      const error = new Error('Ollama version response is unsupported.');
      error.code = 'unsupported';
      throw error;
    }
    return payload.version;
  }

  async listModels({ signal } = {}) {
    const payload = await this.requestJson('/api/tags', { signal });
    if (!payload || !Array.isArray(payload.models)) {
      const error = new Error('Ollama model list response is unsupported.');
      error.code = 'unsupported';
      throw error;
    }
    return Object.freeze(payload.models.map(safeModelMetadata).filter(Boolean));
  }

  async getModelDetails(model, { signal } = {}) {
    validateModelIdentifier(model);
    if (isCloudModelIdentifier(model)) {
      const error = new Error('Cloud-backed Ollama models are not permitted by the local-only runtime.');
      error.code = 'unsupported';
      throw error;
    }
    const payload = await this.requestJson('/api/show', {
      method: 'POST',
      body: { model, verbose: false },
      signal
    });
    if (hasRemoteModelMetadata(payload)) {
      const error = new Error('Remote-backed Ollama models are not permitted by the local-only runtime.');
      error.code = 'unsupported';
      throw error;
    }
    if (!payload || !Array.isArray(payload.capabilities)) {
      const error = new Error('Ollama model capability response is unsupported.');
      error.code = 'unsupported';
      throw error;
    }
    const capabilities = payload.capabilities
      .filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 64)
      .slice(0, 16);
    return Object.freeze({ capabilities: Object.freeze(capabilities) });
  }

  async getStatus({ model = null, signal } = {}) {
    try {
      const [runtimeVersion, models] = await Promise.all([
        this.getRuntimeVersion({ signal }),
        this.listModels({ signal })
      ]);

      if (!model) {
        return ollamaStatus({
          state: models.length === 0 ? 'no-model' : 'ready',
          runtimeVersion,
          reason: models.length === 0 ? 'No local models are available.' : null
        });
      }

      validateModelIdentifier(model);
      if (isCloudModelIdentifier(model)) {
        return ollamaStatus({
          state: 'unsupported',
          model,
          runtimeVersion,
          reason: 'Cloud-backed Ollama models are blocked by local-only policy.'
        });
      }

      if (!models.some((candidate) => candidate.id === model)) {
        return ollamaStatus({
          state: 'no-model',
          model,
          runtimeVersion,
          reason: 'The selected local model is not available.'
        });
      }

      const details = await this.getModelDetails(model, { signal });
      if (!details.capabilities.includes('completion')) {
        return ollamaStatus({
          state: 'unsupported',
          model,
          runtimeVersion,
          capabilities: details.capabilities,
          reason: 'The selected model does not declare text completion capability.'
        });
      }
      return ollamaStatus({
        state: 'ready',
        model,
        runtimeVersion,
        capabilities: details.capabilities
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.code === 'unsupported' || error?.code === 'malformed-response' || error?.code === 'response-too-large') {
        return ollamaStatus({
          state: 'unsupported',
          model,
          reason: 'The local Ollama runtime returned an unsupported response.'
        });
      }
      return ollamaStatus({
        state: 'unavailable',
        model,
        reason: 'The local Ollama runtime is not currently reachable.'
      });
    }
  }

  async listCapabilities({ model = null, signal } = {}) {
    const models = await this.listModels({ signal });
    if (!model) {
      return Object.freeze({ models });
    }
    const details = await this.getModelDetails(model, { signal });
    return Object.freeze({ models, selected: Object.freeze({ id: model, capabilities: details.capabilities }) });
  }

  async generate({ requestId, request, signal }) {
    const model = request.model;
    if (isCloudModelIdentifier(model)) {
      return createFailure({
        requestId,
        model,
        category: 'unsupported',
        message: 'Cloud-backed models are blocked by the local-only runtime.'
      });
    }

    try {
      const models = await this.listModels({ signal });
      if (!models.some((candidate) => candidate.id === model)) {
        return createFailure({
          requestId,
          model,
          category: 'model-unavailable',
          message: 'The selected local model is not available.'
        });
      }
      const details = await this.getModelDetails(model, { signal });
      if (!details.capabilities.includes('completion')) {
        return createFailure({
          requestId,
          model,
          category: 'unsupported',
          message: 'The selected model does not support text completion.'
        });
      }

      const options = { num_predict: request.maxOutputTokens };
      if (request.temperature !== null) options.temperature = request.temperature;
      const body = {
        model,
        messages: request.messages,
        stream: false,
        options
      };
      if (request.structuredOutputSchema) body.format = request.structuredOutputSchema;

      const payload = await this.requestJson('/api/chat', {
        method: 'POST',
        body,
        signal
      });

      if (Array.isArray(payload?.message?.tool_calls) && payload.message.tool_calls.length > 0) {
        return createFailure({
          requestId,
          model,
          category: 'unsupported',
          message: 'Tool-call output is not permitted by the local AI runtime.'
        });
      }

      const content = payload?.message?.content;
      if (typeof content !== 'string') {
        return createFailure({
          requestId,
          model,
          category: 'malformed-response',
          message: 'The local model response did not contain valid text output.'
        });
      }
      if (content.length > LIMITS.maxOutputCharacters) {
        return createFailure({
          requestId,
          model,
          category: 'response-too-large',
          message: 'The local model response exceeded the configured output bound.'
        });
      }
      return createSuccess({ requestId, model, content });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const category = error?.code === 'response-too-large'
        ? 'response-too-large'
        : error?.code === 'malformed-response'
          ? 'malformed-response'
          : error?.code === 'unsupported'
            ? 'unsupported'
            : error?.code === 'runtime-error'
              ? 'runtime-error'
              : 'transport';
      return createFailure({
        requestId,
        model,
        category,
        message: category === 'transport'
          ? 'The local Ollama runtime is not currently reachable.'
          : 'The local Ollama runtime could not complete the request safely.'
      });
    }
  }
}

module.exports = {
  CLOUD_MODEL_MARKERS,
  DEFAULT_OLLAMA_ENDPOINT,
  MAX_TRANSPORT_RESPONSE_BYTES,
  OllamaProvider,
  hasRemoteModelMetadata,
  isCloudModelIdentifier,
  normaliseLocalEndpoint,
  readBoundedText
};

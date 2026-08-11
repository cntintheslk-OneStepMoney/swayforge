'use strict';

const { randomUUID } = require('node:crypto');
const {
  createFailure,
  freezeStatus,
  normaliseGenerationRequest
} = require('./runtime-contracts.cjs');

function durationBucket(startedAt) {
  const duration = Math.max(0, Date.now() - startedAt);
  if (duration < 250) return '<250ms';
  if (duration < 1_000) return '<1s';
  if (duration < 5_000) return '<5s';
  if (duration < 30_000) return '<30s';
  return '>=30s';
}

function abortReason(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

class AiRuntimeService {
  constructor({ provider, logger = () => {}, enabled = true, selectedModel = null } = {}) {
    if (!provider || typeof provider.getStatus !== 'function' || typeof provider.generate !== 'function') {
      throw new TypeError('A valid AI provider is required.');
    }
    if (typeof logger !== 'function') throw new TypeError('AI logger must be a function.');
    this.provider = provider;
    this.providerId = typeof provider.id === 'string' && provider.id.length > 0 ? provider.id : 'unknown';
    this.logger = logger;
    this.enabled = Boolean(enabled);
    this.selectedModel = selectedModel;
    this.active = null;
    this.statusRefresh = null;
    this.shutdownRequested = false;
    this.lastStatus = freezeStatus({
      provider: this.providerId,
      state: this.enabled ? 'unavailable' : 'disabled'
    });
  }

  setSelectedModel(model) {
    this.selectedModel = model || null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.cancelActive();
  }

  async getStatus({ refresh = false } = {}) {
    if (!this.enabled) {
      this.lastStatus = freezeStatus({
        provider: this.providerId,
        state: 'disabled',
        reason: 'Local AI is disabled.'
      });
      return this.lastStatus;
    }
    if (this.active) {
      return freezeStatus({
        ...this.lastStatus,
        state: 'busy',
        model: this.active.model,
        reason: 'A local inference request is already active.'
      });
    }
    if (!refresh && this.lastStatus.state !== 'unavailable') return this.lastStatus;
    if (this.statusRefresh) return this.statusRefresh;

    this.statusRefresh = Promise.resolve(this.provider.getStatus({ model: this.selectedModel }))
      .then((status) => {
        this.lastStatus = freezeStatus({ provider: this.providerId, ...status });
        return this.lastStatus;
      })
      .finally(() => {
        this.statusRefresh = null;
      });
    return this.statusRefresh;
  }

  async listCapabilities() {
    if (!this.enabled) return Object.freeze({ models: Object.freeze([]), disabled: true });
    if (typeof this.provider.listCapabilities !== 'function') {
      return Object.freeze({ models: Object.freeze([]), unsupported: true });
    }
    return this.provider.listCapabilities({ model: this.selectedModel });
  }

  startGeneration(input, { signal: externalSignal } = {}) {
    const request = normaliseGenerationRequest(input);
    const requestId = randomUUID();

    if (!this.enabled || this.shutdownRequested) {
      return Object.freeze({
        requestId,
        result: Promise.resolve(createFailure({
          requestId,
          model: request.model,
          category: 'configuration',
          message: this.shutdownRequested ? 'Local AI is shutting down.' : 'Local AI is disabled.'
        }))
      });
    }
    if (this.active) {
      return Object.freeze({
        requestId,
        result: Promise.resolve(createFailure({
          requestId,
          model: request.model,
          category: 'busy',
          message: 'A local inference request is already active.'
        }))
      });
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(
      () => controller.abort(abortReason('TimeoutError', 'Timed out')),
      request.timeoutMs
    );

    const forwardExternalAbort = () => {
      controller.abort(externalSignal?.reason || abortReason('AbortError', 'Cancelled'));
    };
    if (externalSignal?.aborted) forwardExternalAbort();
    else externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true });

    this.active = { requestId, controller, model: request.model };

    const result = this.runGeneration({
      requestId,
      request,
      controller,
      timeout,
      externalSignal,
      forwardExternalAbort,
      startedAt
    });
    return Object.freeze({ requestId, result });
  }

  async runGeneration({ requestId, request, controller, timeout, externalSignal, forwardExternalAbort, startedAt }) {
    let result;
    try {
      result = await this.provider.generate({ requestId, request, signal: controller.signal });
      if (controller.signal.aborted) {
        const timeoutTriggered = controller.signal.reason?.name === 'TimeoutError';
        result = createFailure({
          requestId,
          model: request.model,
          category: timeoutTriggered ? 'timeout' : 'aborted',
          message: timeoutTriggered ? 'Local AI request timed out.' : 'Local AI request was cancelled.'
        });
      }
    } catch (error) {
      const timeoutTriggered = controller.signal.reason?.name === 'TimeoutError';
      const aborted = controller.signal.aborted || error?.name === 'AbortError';
      result = createFailure({
        requestId,
        model: request.model,
        category: timeoutTriggered ? 'timeout' : aborted ? 'aborted' : 'runtime-error',
        message: timeoutTriggered
          ? 'Local AI request timed out.'
          : aborted
            ? 'Local AI request was cancelled.'
            : 'Local AI request failed.'
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', forwardExternalAbort);
      if (this.active?.requestId === requestId) this.active = null;
    }

    if (!result.ok) {
      const stateByCategory = {
        transport: 'unavailable',
        'model-unavailable': 'no-model',
        'runtime-error': 'error',
        unsupported: 'unsupported',
        'malformed-response': 'unsupported',
        'response-too-large': 'unsupported'
      };
      const nextState = stateByCategory[result.error.category];
      if (nextState) {
        this.lastStatus = freezeStatus({
          provider: this.providerId,
          state: nextState,
          model: request.model,
          reason: result.error.message
        });
      }
    }

    this.logger(Object.freeze({
      component: 'ai-runtime',
      provider: this.providerId,
      requestId,
      model: request.model,
      outcome: result.ok ? 'success' : 'failure',
      errorCategory: result.ok ? null : result.error.category,
      duration: durationBucket(startedAt)
    }));
    return result;
  }

  generate(input, options) {
    return this.startGeneration(input, options).result;
  }

  cancel(requestId) {
    if (!this.active || this.active.requestId !== requestId) return false;
    this.active.controller.abort(abortReason('AbortError', 'Cancelled'));
    return true;
  }

  cancelActive() {
    if (!this.active) return false;
    this.active.controller.abort(abortReason('AbortError', 'Cancelled'));
    return true;
  }

  shutdown() {
    this.shutdownRequested = true;
    this.cancelActive();
  }
}

module.exports = { AiRuntimeService, abortReason, durationBucket };

'use strict';

const { randomUUID } = require('node:crypto');
const {
  buildTaskContext,
  createRuntimeTaskRequest,
  taskMetadata,
  validateTaskResponse
} = require('./task-contracts.cjs');

const REPAIRABLE_VALIDATION_CODES = new Set(['malformed-json']);

function failureResult({ task, requestId, category, code, message, retryCount, runtimeRequestId = null }) {
  return Object.freeze({
    ok: false,
    requestId,
    task,
    runtimeRequestId,
    retryCount,
    error: Object.freeze({ category, code, message })
  });
}

class AiTaskService {
  constructor({ runtime, logger = () => {} } = {}) {
    if (!runtime || typeof runtime.startGeneration !== 'function' || typeof runtime.cancel !== 'function') {
      throw new TypeError('A #6 AI runtime service is required.');
    }
    if (typeof logger !== 'function') throw new TypeError('AI task logger must be a function.');
    this.runtime = runtime;
    this.logger = logger;
    this.sequence = 0;
    this.currentSlots = new Map();
    this.activeRequests = new Map();
  }

  startTask(input, { signal } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid AI task request.');
    const task = taskMetadata(input.taskId);
    const context = buildTaskContext(input.taskId, input.context);
    const slot = input.slot ?? input.taskId;
    if (typeof slot !== 'string' || slot.length < 1 || slot.length > 128) throw new TypeError('Invalid AI task result slot.');

    const requestId = randomUUID();
    const sequence = ++this.sequence;
    this.currentSlots.set(slot, sequence);
    const active = {
      requestId,
      slot,
      sequence,
      runtimeRequestId: null,
      cancelled: false
    };
    this.activeRequests.set(requestId, active);

    const result = this.executeTask({ input, context, task, active, signal })
      .finally(() => {
        this.activeRequests.delete(requestId);
      });

    return Object.freeze({
      requestId,
      cancel: () => this.cancel(requestId),
      result
    });
  }

  runTask(input, options) {
    return this.startTask(input, options).result;
  }

  cancel(requestId) {
    const active = this.activeRequests.get(requestId);
    if (!active) return false;
    active.cancelled = true;
    if (active.runtimeRequestId) return this.runtime.cancel(active.runtimeRequestId);
    return true;
  }

  isCurrent(active) {
    return this.currentSlots.get(active.slot) === active.sequence;
  }

  logOutcome({ task, requestId, outcome, category = null, code = null, retryCount }) {
    this.logger(Object.freeze({
      component: 'ai-task',
      taskId: task.id,
      taskVersion: task.taskVersion,
      responseType: task.responseType,
      schemaVersion: task.schemaVersion,
      requestId,
      outcome,
      failureCategory: category,
      failureCode: code,
      retryCount
    }));
  }

  async executeTask({ input, context, task, active, signal }) {
    const allowRepair = input.allowRepair !== false;
    let retryCount = 0;

    while (true) {
      if (active.cancelled || signal?.aborted) {
        const failure = failureResult({
          task,
          requestId: active.requestId,
          category: 'cancelled',
          code: 'cancelled',
          message: 'AI task was cancelled.',
          retryCount
        });
        this.logOutcome({ task, requestId: active.requestId, outcome: 'failure', category: 'cancelled', code: 'cancelled', retryCount });
        return failure;
      }

      const runtimeRequest = createRuntimeTaskRequest({
        taskId: input.taskId,
        model: input.model,
        context,
        repair: retryCount > 0,
        timeoutMs: input.timeoutMs,
        maxOutputTokens: input.maxOutputTokens,
        temperature: input.temperature
      });
      const handle = this.runtime.startGeneration(runtimeRequest, { signal });
      active.runtimeRequestId = handle.requestId;
      const runtimeResult = await handle.result;
      active.runtimeRequestId = null;

      if (!this.isCurrent(active)) {
        const failure = failureResult({
          task,
          requestId: active.requestId,
          runtimeRequestId: handle.requestId,
          category: 'stale',
          code: 'stale-result',
          message: 'AI task result was superseded by a newer request.',
          retryCount
        });
        this.logOutcome({ task, requestId: active.requestId, outcome: 'failure', category: 'stale', code: 'stale-result', retryCount });
        return failure;
      }

      if (active.cancelled || signal?.aborted || (!runtimeResult.ok && runtimeResult.error?.category === 'aborted')) {
        const failure = failureResult({
          task,
          requestId: active.requestId,
          runtimeRequestId: handle.requestId,
          category: 'cancelled',
          code: 'cancelled',
          message: 'AI task was cancelled.',
          retryCount
        });
        this.logOutcome({ task, requestId: active.requestId, outcome: 'failure', category: 'cancelled', code: 'cancelled', retryCount });
        return failure;
      }

      if (!runtimeResult.ok) {
        const code = runtimeResult.error?.category || 'runtime-error';
        const failure = failureResult({
          task,
          requestId: active.requestId,
          runtimeRequestId: handle.requestId,
          category: 'runtime',
          code,
          message: 'Local AI runtime could not complete the task.',
          retryCount
        });
        this.logOutcome({ task, requestId: active.requestId, outcome: 'failure', category: 'runtime', code, retryCount });
        return failure;
      }

      const validation = validateTaskResponse(input.taskId, runtimeResult.content, context);
      if (validation.ok) {
        const success = Object.freeze({
          ok: true,
          requestId: active.requestId,
          task,
          value: validation.value,
          metadata: Object.freeze({
            model: runtimeResult.model,
            runtimeRequestId: handle.requestId,
            retryCount
          })
        });
        this.logOutcome({ task, requestId: active.requestId, outcome: 'success', retryCount });
        return success;
      }

      if (allowRepair && retryCount === 0 && REPAIRABLE_VALIDATION_CODES.has(validation.error.code)) {
        retryCount = 1;
        continue;
      }

      const failure = failureResult({
        task,
        requestId: active.requestId,
        runtimeRequestId: handle.requestId,
        category: 'validation',
        code: validation.error.code,
        message: validation.error.message,
        retryCount
      });
      this.logOutcome({
        task,
        requestId: active.requestId,
        outcome: 'failure',
        category: 'validation',
        code: validation.error.code,
        retryCount
      });
      return failure;
    }
  }
}

module.exports = { AiTaskService, REPAIRABLE_VALIDATION_CODES, failureResult };

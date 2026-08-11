'use strict';

const {
  applySettingsPatch,
  normaliseApplicationSettings,
  validateSettingsUpdateRequest
} = require('./settings-contracts.cjs');

function clone(value) {
  return structuredClone(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class ApplicationSettingsService {
  static async create(options) {
    const service = new ApplicationSettingsService(options);
    await service.initialise();
    return service;
  }

  constructor({ repository, runtimeFactory, diagnosticStore = null } = {}) {
    if (!repository || typeof repository.readApplicationState !== 'function' || typeof repository.updateApplicationState !== 'function') {
      throw new TypeError('Application settings require the local data repository.');
    }
    if (typeof runtimeFactory !== 'function') throw new TypeError('Application settings require an AI runtime factory.');
    this.repository = repository;
    this.runtimeFactory = runtimeFactory;
    this.diagnosticStore = diagnosticStore;
    this.settings = null;
    this.revision = null;
    this.runtime = null;
  }

  async initialise() {
    let state = await this.repository.readApplicationState();
    const migrated = normaliseApplicationSettings(state.settings);
    if (!sameJson(state.settings, migrated)) {
      state = await this.repository.updateApplicationState({
        expectedRevision: state.revision,
        patch: { settings: migrated }
      });
    }
    this.settings = normaliseApplicationSettings(state.settings);
    this.revision = state.revision;
    this.#configureDiagnostics();
    this.#configureRuntime({ forceRebuild: true });
    return this.getSnapshot();
  }

  #configureDiagnostics() {
    this.diagnosticStore?.configureRetention?.({
      retentionDays: this.settings.diagnostics.retentionDays,
      maxEvents: this.settings.diagnostics.maxEvents
    });
  }

  #runtimeLogger(event) {
    if (!this.diagnosticStore || !this.settings?.diagnostics?.enabled) return;
    const metadata = {
      provider: event.provider,
      outcome: event.outcome,
      duration: event.duration
    };
    if (event.model) metadata.model = event.model;
    if (event.errorCategory) metadata.errorCategory = event.errorCategory;
    void this.diagnosticStore.append({
      code: 'ai.runtime.request',
      severity: event.outcome === 'failure' ? 'warning' : 'info',
      component: 'ai-runtime',
      metadata,
      correlationId: event.requestId ?? null,
      errorCode: event.errorCategory ?? null
    }, { enabled: this.settings.diagnostics.enabled }).catch(() => {});
  }

  #configureRuntime({ forceRebuild = false, previousSettings = null } = {}) {
    const endpointChanged = previousSettings?.ai?.endpoint !== this.settings.ai.endpoint;
    if (!this.runtime || forceRebuild || endpointChanged) {
      this.runtime?.shutdown?.();
      this.runtime = this.runtimeFactory({
        endpoint: this.settings.ai.endpoint,
        enabled: this.settings.ai.enabled,
        selectedModel: this.settings.ai.selectedModel,
        logger: (event) => this.#runtimeLogger(event)
      });
      return;
    }
    this.runtime.setEnabled(this.settings.ai.enabled);
    this.runtime.setSelectedModel(this.settings.ai.selectedModel);
  }

  getSnapshot() {
    return Object.freeze({ revision: this.revision, settings: clone(this.settings) });
  }

  getRuntime() {
    if (!this.runtime) throw new Error('Application settings have not initialised the AI runtime.');
    return this.runtime;
  }

  async update(request) {
    validateSettingsUpdateRequest(request);
    const next = applySettingsPatch(this.settings, request.patch);
    const previous = this.settings;
    const saved = await this.repository.updateApplicationState({
      expectedRevision: request.expectedRevision,
      patch: { settings: next }
    });
    this.settings = normaliseApplicationSettings(saved.settings);
    this.revision = saved.revision;
    this.#configureDiagnostics();
    this.#configureRuntime({ previousSettings: previous });
    return this.getSnapshot();
  }

  async listTextModels() {
    const runtime = this.getRuntime();
    if (!runtime.enabled) return Object.freeze({ models: Object.freeze([]), disabled: true });
    if (!runtime.provider || typeof runtime.provider.listCapabilities !== 'function') {
      return Object.freeze({ models: Object.freeze([]), unsupported: true });
    }
    const summary = await runtime.provider.listCapabilities({ model: null });
    const models = [];
    for (const candidate of (summary.models ?? []).slice(0, 50)) {
      try {
        const details = await runtime.provider.listCapabilities({ model: candidate.id });
        if (details.selected?.capabilities?.includes('completion')) models.push(candidate);
      } catch {
        // A malformed/unsupported local model is omitted from the text-model selector.
      }
    }
    return Object.freeze({ models: Object.freeze(models) });
  }
}

module.exports = { ApplicationSettingsService, sameJson };

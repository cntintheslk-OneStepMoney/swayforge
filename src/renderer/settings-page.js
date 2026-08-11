'use strict';

(function initialiseSettingsPage() {
  if (!globalThis.document) return;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './settings.css';
  document.head.append(stylesheet);

  const view = document.querySelector('#view-settings');
  if (!view) return;

  let settingsRevision = null;
  let settingsSnapshot = null;
  let bridge = null;
  let statusLine = null;
  let aiStatus = null;
  let modelSelect = null;
  let endpointInput = null;
  let aiEnabledInput = null;
  let diagnosticsEnabledInput = null;
  let diagnosticsList = null;
  let storageSummary = null;

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.id) element.id = options.id;
    if (options.type) element.type = options.type;
    if (options.name) element.name = options.name;
    if (options.value !== undefined) element.value = options.value;
    if (options.checked !== undefined) element.checked = options.checked;
    if (options.disabled !== undefined) element.disabled = options.disabled;
    if (options.htmlFor) element.htmlFor = options.htmlFor;
    if (options.role) element.setAttribute('role', options.role);
    if (options.ariaLive) element.setAttribute('aria-live', options.ariaLive);
    if (options.ariaDescribedBy) element.setAttribute('aria-describedby', options.ariaDescribedBy);
    for (const child of children) if (child) element.append(child);
    return element;
  }

  function unwrap(result, fallback) {
    if (!result || result.ok !== true) throw new Error(result?.error?.message || fallback);
    return result.value;
  }

  function setStatus(message, kind = 'info') {
    if (!statusLine) return;
    statusLine.textContent = message;
    statusLine.dataset.kind = kind;
    statusLine.hidden = false;
  }

  function applyAppearance(appearance) {
    document.documentElement.dataset.theme = ['light', 'dark', 'system'].includes(appearance) ? appearance : 'system';
  }

  async function updateSettings(patch, successMessage) {
    if (!Number.isSafeInteger(settingsRevision)) throw new Error('Settings are not ready yet.');
    const saved = unwrap(
      await bridge.updateSettings({ expectedRevision: settingsRevision, patch }),
      'Settings could not be saved.'
    );
    settingsRevision = saved.revision;
    settingsSnapshot = saved.settings;
    applyAppearance(settingsSnapshot.appearance);
    setStatus(successMessage, 'success');
    return saved;
  }

  function createAppearanceSection() {
    const fieldset = node('fieldset', { className: 'settings-choice-group' });
    fieldset.append(node('legend', { text: 'Appearance' }));
    const description = node('p', { className: 'settings-help', text: 'Choose how SwayForge looks. Follow System tracks the operating-system preference.' });
    fieldset.append(description);

    for (const [value, labelText] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow System']]) {
      const input = node('input', { type: 'radio', name: 'appearance', value });
      input.id = `appearance-${value}`;
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        try {
          await updateSettings({ appearance: value }, `Appearance changed to ${labelText}.`);
        } catch (error) {
          setStatus(error.message, 'error');
          await loadSettings().catch(() => {});
        }
      });
      const label = node('label', { htmlFor: input.id, className: 'settings-choice' }, [input, node('span', { text: labelText })]);
      fieldset.append(label);
    }
    return fieldset;
  }

  function createAiSection() {
    aiEnabledInput = node('input', { type: 'checkbox' });
    aiEnabledInput.id = 'settings-ai-enabled';
    endpointInput = node('input', { type: 'url' });
    endpointInput.id = 'settings-ai-endpoint';
    endpointInput.placeholder = 'http://localhost:11434';
    endpointInput.autocomplete = 'off';
    endpointInput.spellcheck = false;
    modelSelect = node('select', { id: 'settings-ai-model' });
    modelSelect.append(node('option', { value: '', text: 'No model selected' }));
    aiStatus = node('span', { className: 'settings-status-value', text: 'Not checked', ariaLive: 'polite' });

    const save = node('button', { className: 'button button--primary', type: 'button', text: 'Save local AI settings' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await updateSettings({
          aiEnabled: aiEnabledInput.checked,
          aiEndpoint: endpointInput.value.trim(),
          selectedModel: modelSelect.value || null
        }, 'Local AI settings saved.');
        await refreshAiStatus();
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        save.disabled = false;
      }
    });

    const refresh = node('button', { className: 'button button--secondary', type: 'button', text: 'Refresh Ollama status' });
    refresh.addEventListener('click', () => refreshAiStatus(true));

    return node('article', { className: 'panel settings-section' }, [
      node('div', { className: 'settings-section-heading' }, [node('div', {}, [node('h3', { text: 'Local AI / Ollama' }), node('p', { className: 'settings-help', text: 'Ollama stays local. SwayForge does not automatically download models and has no cloud AI fallback in v0.1.0.' })])]),
      node('label', { className: 'settings-toggle', htmlFor: aiEnabledInput.id }, [aiEnabledInput, node('span', { text: 'Enable local AI features' })]),
      node('div', { className: 'form-row' }, [node('label', { htmlFor: endpointInput.id, text: 'Local Ollama endpoint' }), endpointInput, node('small', { text: 'Only approved loopback addresses are accepted.' })]),
      node('div', { className: 'form-row' }, [node('label', { htmlFor: modelSelect.id, text: 'Text-capable model' }), modelSelect, node('small', { text: 'The list comes from the trusted Ollama runtime boundary; unsupported or remote-backed models are omitted.' })]),
      node('div', { className: 'settings-inline-status' }, [node('strong', { text: 'Runtime status' }), aiStatus]),
      node('div', { className: 'button-group' }, [save, refresh])
    ]);
  }

  function createStorageSection() {
    storageSummary = node('div', { className: 'settings-facts', text: 'Loading local storage information…', ariaLive: 'polite' });
    const openFolder = node('button', { className: 'button button--secondary', type: 'button', text: 'Open application data folder' });
    openFolder.addEventListener('click', async () => {
      try {
        unwrap(await bridge.openApplicationDataFolder(), 'The application data folder could not be opened.');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
    return node('article', { className: 'panel settings-section' }, [
      node('h3', { text: 'Storage & Privacy' }),
      node('p', { className: 'settings-help', text: 'Projects, managed media, settings and diagnostics stay in SwayForge’s per-user application data. Source media is never modified by this screen.' }),
      storageSummary,
      openFolder
    ]);
  }

  function createDiagnosticsSection() {
    diagnosticsEnabledInput = node('input', { type: 'checkbox' });
    diagnosticsEnabledInput.id = 'settings-diagnostics-enabled';
    diagnosticsEnabledInput.addEventListener('change', async () => {
      try {
        await updateSettings({ diagnosticsEnabled: diagnosticsEnabledInput.checked }, diagnosticsEnabledInput.checked ? 'Local diagnostics enabled.' : 'Detailed local diagnostics disabled.');
      } catch (error) {
        setStatus(error.message, 'error');
        diagnosticsEnabledInput.checked = !diagnosticsEnabledInput.checked;
      }
    });

    diagnosticsList = node('div', { className: 'diagnostic-list', ariaLive: 'polite' });
    const exportButton = node('button', { className: 'button button--secondary', type: 'button', text: 'Export diagnostics…' });
    exportButton.addEventListener('click', async () => {
      try {
        const result = unwrap(await bridge.exportDiagnostics(), 'Diagnostics could not be exported.');
        if (result.status === 'cancelled') return;
        setStatus(`Exported ${result.exportedEvents} safe diagnostic event(s) to ${result.fileName}.`, 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    const clearButton = node('button', { className: 'button button--secondary', type: 'button', text: 'Clear diagnostics' });
    clearButton.addEventListener('click', async () => {
      if (!globalThis.confirm('Clear local diagnostics? Projects, media, settings and credentials are not affected.')) return;
      try {
        unwrap(await bridge.clearDiagnostics(), 'Diagnostics could not be cleared.');
        await loadDiagnostics();
        setStatus('Local diagnostics cleared. Your projects, media and settings were preserved.', 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    return node('article', { className: 'panel settings-section' }, [
      node('h3', { text: 'Diagnostics' }),
      node('p', { className: 'settings-help', text: 'Diagnostics are local, bounded structural health events only. They never upload automatically and must not contain credentials, prompts, model responses, creator content, raw media or private source paths.' }),
      node('label', { className: 'settings-toggle', htmlFor: diagnosticsEnabledInput.id }, [diagnosticsEnabledInput, node('span', { text: 'Record detailed local diagnostics' })]),
      node('p', { className: 'settings-help', id: 'diagnostic-retention', text: 'Retention information loading…' }),
      node('div', { className: 'button-group' }, [exportButton, clearButton]),
      diagnosticsList
    ]);
  }

  function createAboutSection() {
    const facts = node('dl', { className: 'settings-facts', id: 'settings-about-facts' });
    return node('article', { className: 'panel settings-section' }, [
      node('h3', { text: 'About SwayForge' }),
      node('p', { className: 'settings-help', text: 'Catch the signal. Forge the content. Local-first foundation with Ollama as the optional local AI runtime.' }),
      facts,
      node('p', { className: 'settings-help', text: 'This foundation does not yet connect or publish to TikTok, Instagram or YouTube.' })
    ]);
  }

  function buildSettingsView() {
    view.replaceChildren();
    const intro = node('div', { className: 'settings-intro' }, [
      node('div', {}, [node('span', { className: 'status-badge', text: 'Local configuration' }), node('h3', { text: 'Settings' }), node('p', { text: 'Configure SwayForge without sending configuration, creator media or diagnostics to a remote service.' })]),
      statusLine = node('p', { className: 'settings-save-status', text: 'Loading settings…', role: 'status', ariaLive: 'polite' })
    ]);
    const appearance = node('article', { className: 'panel settings-section' }, [createAppearanceSection()]);
    view.append(intro, node('div', { className: 'settings-grid' }, [appearance, createAiSection(), createStorageSection(), createDiagnosticsSection(), createAboutSection()]));
  }

  function renderSettings() {
    if (!settingsSnapshot) return;
    applyAppearance(settingsSnapshot.appearance);
    for (const input of document.querySelectorAll('input[name="appearance"]')) input.checked = input.value === settingsSnapshot.appearance;
    aiEnabledInput.checked = settingsSnapshot.ai.enabled;
    endpointInput.value = settingsSnapshot.ai.endpoint;
    diagnosticsEnabledInput.checked = settingsSnapshot.diagnostics.enabled;
    const retention = document.querySelector('#diagnostic-retention');
    retention.textContent = `Retention: up to ${settingsSnapshot.diagnostics.retentionDays} day(s) and ${settingsSnapshot.diagnostics.maxEvents} events. Diagnostics are non-authoritative and safe to clear.`;
  }

  async function loadSettings() {
    const snapshot = unwrap(await bridge.getSettings(), 'Settings could not be loaded.');
    settingsRevision = snapshot.revision;
    settingsSnapshot = snapshot.settings;
    renderSettings();
    setStatus('Settings loaded from local application state.', 'success');
  }

  async function refreshModels() {
    modelSelect.replaceChildren(node('option', { value: '', text: 'No model selected' }));
    if (!settingsSnapshot?.ai?.enabled) {
      modelSelect.disabled = true;
      return;
    }
    modelSelect.disabled = false;
    try {
      const result = unwrap(await bridge.listAiModels(), 'Local model list is unavailable.');
      for (const model of result.models || []) modelSelect.append(node('option', { value: model.id, text: model.id }));
      modelSelect.value = settingsSnapshot.ai.selectedModel || '';
    } catch {
      modelSelect.value = '';
    }
  }

  async function refreshAiStatus(force = false) {
    try {
      const status = force ? await bridge.refreshAiRuntimeStatus() : await bridge.getAiRuntimeStatus();
      const labels = { ready: 'Ready', unavailable: 'Ollama unavailable', 'no-model': 'No compatible local model', busy: 'Busy', error: 'Error', unsupported: 'Unsupported', disabled: 'Disabled' };
      aiStatus.textContent = labels[status?.state] || 'Unknown';
      if (force) await refreshModels();
    } catch {
      aiStatus.textContent = 'Ollama unavailable';
    }
  }

  async function loadStorageInfo() {
    try {
      const info = unwrap(await bridge.getStoragePrivacyInfo(), 'Storage information could not be loaded.');
      storageSummary.replaceChildren();
      for (const [label, value] of [
        ['Application data', info.applicationData],
        ['Managed media', info.mediaStorage],
        ['Projects', info.projectCount],
        ['Media items', info.mediaCount]
      ]) storageSummary.append(node('div', {}, [node('dt', { text: label }), node('dd', { text: String(value) })]));
    } catch (error) {
      storageSummary.textContent = error.message;
    }
  }

  async function loadDiagnostics() {
    diagnosticsList.replaceChildren();
    try {
      const result = unwrap(await bridge.listDiagnostics(), 'Diagnostics could not be loaded.');
      if (!result.events.length) {
        diagnosticsList.append(node('p', { className: 'settings-help', text: result.available ? 'No local diagnostic events recorded.' : 'Diagnostics storage is unavailable; core SwayForge features remain usable.' }));
        return;
      }
      for (const event of result.events.slice(0, 50)) {
        const metadata = Object.entries(event.metadata || {}).map(([key, value]) => `${key}=${String(value)}`).join(' · ');
        diagnosticsList.append(node('article', { className: 'diagnostic-event' }, [
          node('div', {}, [node('strong', { text: event.code }), node('span', { className: 'status-badge', text: event.severity })]),
          node('p', { text: `${event.component} · ${new Date(event.timestamp).toLocaleString()}` }),
          metadata ? node('small', { text: metadata }) : null
        ]));
      }
    } catch (error) {
      diagnosticsList.append(node('p', { className: 'settings-help', text: error.message }));
    }
  }

  async function loadAbout() {
    try {
      const info = await bridge.getApplicationInfo();
      const facts = document.querySelector('#settings-about-facts');
      facts.replaceChildren();
      for (const [label, value] of [['Version', info.version], ['Platform', `${info.platform} ${info.architecture}`], ['Electron', info.electron], ['Node', info.node]]) {
        facts.append(node('div', {}, [node('dt', { text: label }), node('dd', { text: value })]));
      }
    } catch {}
  }

  async function boot() {
    bridge = globalThis.swayForge;
    if (!bridge || !['getSettings', 'updateSettings', 'listAiModels', 'getStoragePrivacyInfo', 'openApplicationDataFolder', 'listDiagnostics', 'exportDiagnostics', 'clearDiagnostics'].every((name) => typeof bridge[name] === 'function')) {
      return;
    }
    buildSettingsView();
    try {
      await loadSettings();
      await Promise.allSettled([refreshModels(), refreshAiStatus(), loadStorageInfo(), loadDiagnostics(), loadAbout()]);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else void boot();
})();

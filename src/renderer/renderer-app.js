'use strict';

const versionElement = document.querySelector('#app-version');
const bridgeStatusElement = document.querySelector('#bridge-status');
const runtimeStatusElement = document.querySelector('#runtime-status');
const aiStatusElement = document.querySelector('#ai-status');
const bootErrorElement = document.querySelector('#boot-error');

const AI_STATUS_LABELS = Object.freeze({
  unavailable: 'Ollama unavailable',
  ready: 'Ready',
  'no-model': 'No local model',
  busy: 'Busy',
  error: 'Error',
  unsupported: 'Unsupported',
  disabled: 'Disabled'
});

function showBootError(message) {
  bridgeStatusElement.textContent = 'Unavailable';
  runtimeStatusElement.textContent = 'Unavailable';
  aiStatusElement.textContent = 'Unavailable';
  bootErrorElement.textContent = message;
  bootErrorElement.hidden = false;
}

async function bootRenderer() {
  const bridge = window.swayForge;
  if (
    !bridge ||
    typeof bridge.getApplicationInfo !== 'function' ||
    typeof bridge.healthCheck !== 'function' ||
    typeof bridge.getAiRuntimeStatus !== 'function'
  ) {
    showBootError('The secure application bridge is unavailable. Restart SwayForge.');
    return;
  }

  try {
    const [applicationInfo, health] = await Promise.all([
      bridge.getApplicationInfo(),
      bridge.healthCheck()
    ]);

    if (!applicationInfo || health?.status !== 'ok') {
      throw new Error('Foundation health check failed.');
    }

    versionElement.textContent = `v${applicationInfo.version}`;
    bridgeStatusElement.textContent = 'Ready';
    runtimeStatusElement.textContent = `${applicationInfo.platform} · ${applicationInfo.architecture}`;
  } catch {
    showBootError('SwayForge started, but its local foundation health check failed.');
    return;
  }

  try {
    const aiStatus = await bridge.getAiRuntimeStatus();
    aiStatusElement.textContent = AI_STATUS_LABELS[aiStatus?.state] || 'Unknown';
  } catch {
    aiStatusElement.textContent = 'Ollama unavailable';
  }
}

void bootRenderer();

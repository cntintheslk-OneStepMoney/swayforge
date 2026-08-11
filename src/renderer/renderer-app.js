'use strict';

const versionElement = document.querySelector('#app-version');
const bridgeStatusElement = document.querySelector('#bridge-status');
const runtimeStatusElement = document.querySelector('#runtime-status');
const bootErrorElement = document.querySelector('#boot-error');

function showBootError(message) {
  bridgeStatusElement.textContent = 'Unavailable';
  runtimeStatusElement.textContent = 'Unavailable';
  bootErrorElement.textContent = message;
  bootErrorElement.hidden = false;
}

async function bootRenderer() {
  const bridge = window.swayForge;
  if (
    !bridge ||
    typeof bridge.getApplicationInfo !== 'function' ||
    typeof bridge.healthCheck !== 'function'
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
  }
}

void bootRenderer();

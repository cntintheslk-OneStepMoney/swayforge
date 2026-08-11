'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed Electron preload scripts intentionally cannot require local project modules.
// Keep this tiny protocol mirror explicit and regression-tested against the trusted contract.
const BRIDGE_NAME = 'swayForge';
const IPC_CHANNELS = Object.freeze({
  applicationInfo: 'swayforge:application-info',
  healthCheck: 'swayforge:health-check'
});
const HEALTH_REQUEST = Object.freeze({ kind: 'renderer-health-check', version: 1 });

const bridge = Object.freeze({
  getApplicationInfo: () => ipcRenderer.invoke(IPC_CHANNELS.applicationInfo),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.healthCheck, HEALTH_REQUEST)
});

contextBridge.exposeInMainWorld(BRIDGE_NAME, bridge);

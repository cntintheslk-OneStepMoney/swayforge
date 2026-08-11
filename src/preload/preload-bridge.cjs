'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed Electron preload scripts intentionally cannot require local project modules.
// Keep this tiny protocol mirror explicit and regression-tested against the trusted contract.
const BRIDGE_NAME = 'swayForge';
const IPC_CHANNELS = Object.freeze({
  aiRuntimeRefresh: 'swayforge:ai-runtime-refresh',
  aiRuntimeStatus: 'swayforge:ai-runtime-status',
  applicationInfo: 'swayforge:application-info',
  healthCheck: 'swayforge:health-check'
});
const STORAGE_IPC_CHANNELS = Object.freeze({
  applicationStateRead: 'swayforge:storage:application-state:read',
  applicationStateUpdate: 'swayforge:storage:application-state:update',
  projectCreate: 'swayforge:storage:project:create',
  projectRead: 'swayforge:storage:project:read',
  projectUpdate: 'swayforge:storage:project:update',
  projectList: 'swayforge:storage:project:list',
  projectArchive: 'swayforge:storage:project:archive'
});
const SECRET_IPC_CHANNELS = Object.freeze({
  status: 'swayforge:secret-storage:status'
});
const HEALTH_REQUEST = Object.freeze({ kind: 'renderer-health-check', version: 1 });
const AI_STATUS_REQUEST = Object.freeze({ kind: 'ai-runtime-status', version: 1 });
const AI_REFRESH_REQUEST = Object.freeze({ kind: 'ai-runtime-refresh', version: 1 });
const SECRET_STATUS_REQUEST = Object.freeze({ kind: 'secret-storage-status', version: 1 });

const bridge = Object.freeze({
  getApplicationInfo: () => ipcRenderer.invoke(IPC_CHANNELS.applicationInfo),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.healthCheck, HEALTH_REQUEST),
  getAiRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeStatus, AI_STATUS_REQUEST),
  refreshAiRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeRefresh, AI_REFRESH_REQUEST),
  getSecretStorageStatus: () => ipcRenderer.invoke(SECRET_IPC_CHANNELS.status, SECRET_STATUS_REQUEST),
  getApplicationState: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.applicationStateRead),
  updateApplicationState: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.applicationStateUpdate, request),
  createProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectCreate, request),
  getProject: (projectId) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectRead, { projectId }),
  updateProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectUpdate, request),
  listProjects: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectList),
  archiveProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectArchive, request)
});

contextBridge.exposeInMainWorld(BRIDGE_NAME, bridge);

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed Electron preload scripts intentionally cannot require local project modules.
// Keep this tiny protocol mirror explicit and regression-tested against the trusted contract.
const BRIDGE_NAME = 'swayForge';
const IPC_CHANNELS = Object.freeze({
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
const HEALTH_REQUEST = Object.freeze({ kind: 'renderer-health-check', version: 1 });

const bridge = Object.freeze({
  getApplicationInfo: () => ipcRenderer.invoke(IPC_CHANNELS.applicationInfo),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.healthCheck, HEALTH_REQUEST),
  getApplicationState: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.applicationStateRead),
  updateApplicationState: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.applicationStateUpdate, request),
  createProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectCreate, request),
  getProject: (projectId) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectRead, { projectId }),
  updateProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectUpdate, request),
  listProjects: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectList),
  archiveProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectArchive, request)
});

contextBridge.exposeInMainWorld(BRIDGE_NAME, bridge);

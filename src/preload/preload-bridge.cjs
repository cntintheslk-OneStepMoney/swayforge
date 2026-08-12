'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
const SECRET_IPC_CHANNELS = Object.freeze({ status: 'swayforge:secret-storage:status' });
const MEDIA_IPC_CHANNELS = Object.freeze({
  chooseImport: 'swayforge:media:choose-import',
  list: 'swayforge:media:list',
  attach: 'swayforge:media:attach',
  detach: 'swayforge:media:detach',
  preview: 'swayforge:media:preview',
  previewRebuild: 'swayforge:media:preview-rebuild'
});
const MEDIA_INDEX_IPC_CHANNELS = Object.freeze({
  search: 'swayforge:media:index:search',
  status: 'swayforge:media:index:status',
  rebuild: 'swayforge:media:index:rebuild'
});
const SETTINGS_IPC_CHANNELS = Object.freeze({
  read: 'swayforge:settings:read',
  update: 'swayforge:settings:update',
  aiModels: 'swayforge:settings:ai-models',
  storageInfo: 'swayforge:settings:storage-info',
  openAppData: 'swayforge:settings:open-app-data'
});
const DIAGNOSTIC_IPC_CHANNELS = Object.freeze({
  list: 'swayforge:diagnostics:list',
  export: 'swayforge:diagnostics:export',
  clear: 'swayforge:diagnostics:clear'
});

const HEALTH_REQUEST = Object.freeze({ kind: 'renderer-health-check', version: 1 });
const AI_STATUS_REQUEST = Object.freeze({ kind: 'ai-runtime-status', version: 1 });
const AI_REFRESH_REQUEST = Object.freeze({ kind: 'ai-runtime-refresh', version: 1 });
const SECRET_STATUS_REQUEST = Object.freeze({ kind: 'secret-storage-status', version: 1 });
const MEDIA_CHOOSE_REQUEST = Object.freeze({ kind: 'choose-media-import', version: 1 });
const MEDIA_INDEX_STATUS_REQUEST = Object.freeze({ kind: 'media-index-status', version: 1 });
const MEDIA_INDEX_REBUILD_REQUEST = Object.freeze({ kind: 'media-index-rebuild', version: 1 });
const SETTINGS_READ_REQUEST = Object.freeze({ kind: 'settings-read', version: 1 });
const SETTINGS_AI_MODELS_REQUEST = Object.freeze({ kind: 'settings-ai-models', version: 1 });
const SETTINGS_STORAGE_INFO_REQUEST = Object.freeze({ kind: 'settings-storage-info', version: 1 });
const SETTINGS_OPEN_APP_DATA_REQUEST = Object.freeze({ kind: 'settings-open-app-data', version: 1 });
const DIAGNOSTIC_LIST_REQUEST = Object.freeze({ kind: 'diagnostics-list', version: 1 });
const DIAGNOSTIC_EXPORT_REQUEST = Object.freeze({ kind: 'diagnostics-export', version: 1 });
const DIAGNOSTIC_CLEAR_REQUEST = Object.freeze({ kind: 'diagnostics-clear', version: 1 });

function rejectedSettingsMutation() {
  return Promise.resolve(Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'INVALID_REQUEST', message: 'Settings must be changed through the typed Settings controls.' })
  }));
}

function previewRequest(kind, mediaId) {
  return Object.freeze({ kind, version: 1, mediaId });
}

function mediaIndexSearchRequest(options) {
  const fields = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  return Object.freeze({ ...fields, kind: 'media-index-search', version: 1 });
}

const bridge = Object.freeze({
  getApplicationInfo: () => ipcRenderer.invoke(IPC_CHANNELS.applicationInfo),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.healthCheck, HEALTH_REQUEST),
  getAiRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeStatus, AI_STATUS_REQUEST),
  refreshAiRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiRuntimeRefresh, AI_REFRESH_REQUEST),
  getSecretStorageStatus: () => ipcRenderer.invoke(SECRET_IPC_CHANNELS.status, SECRET_STATUS_REQUEST),
  getApplicationState: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.applicationStateRead),
  updateApplicationState: (request) => request?.patch && Object.hasOwn(request.patch, 'settings')
    ? rejectedSettingsMutation()
    : ipcRenderer.invoke(STORAGE_IPC_CHANNELS.applicationStateUpdate, request),
  createProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectCreate, request),
  getProject: (projectId) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectRead, { projectId }),
  updateProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectUpdate, request),
  listProjects: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectList),
  archiveProject: (request) => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.projectArchive, request),
  chooseAndImportMedia: () => ipcRenderer.invoke(MEDIA_IPC_CHANNELS.chooseImport, MEDIA_CHOOSE_REQUEST),
  listMedia: () => ipcRenderer.invoke(MEDIA_IPC_CHANNELS.list),
  attachMediaToProject: (request) => ipcRenderer.invoke(MEDIA_IPC_CHANNELS.attach, request),
  detachMediaFromProject: (request) => ipcRenderer.invoke(MEDIA_IPC_CHANNELS.detach, request),
  requestMediaPreview: (mediaId) => ipcRenderer.invoke(MEDIA_IPC_CHANNELS.preview, previewRequest('media-preview-request', mediaId)),
  rebuildMediaPreview: (mediaId) => ipcRenderer.invoke(MEDIA_IPC_CHANNELS.previewRebuild, previewRequest('media-preview-rebuild-request', mediaId)),
  searchMedia: (options = {}) => ipcRenderer.invoke(MEDIA_INDEX_IPC_CHANNELS.search, mediaIndexSearchRequest(options)),
  getMediaIndexStatus: () => ipcRenderer.invoke(MEDIA_INDEX_IPC_CHANNELS.status, MEDIA_INDEX_STATUS_REQUEST),
  rebuildMediaIndex: () => ipcRenderer.invoke(MEDIA_INDEX_IPC_CHANNELS.rebuild, MEDIA_INDEX_REBUILD_REQUEST),
  getSettings: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.read, SETTINGS_READ_REQUEST),
  updateSettings: (request) => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.update, request),
  listAiModels: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.aiModels, SETTINGS_AI_MODELS_REQUEST),
  getStoragePrivacyInfo: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.storageInfo, SETTINGS_STORAGE_INFO_REQUEST),
  openApplicationDataFolder: () => ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.openAppData, SETTINGS_OPEN_APP_DATA_REQUEST),
  listDiagnostics: () => ipcRenderer.invoke(DIAGNOSTIC_IPC_CHANNELS.list, DIAGNOSTIC_LIST_REQUEST),
  exportDiagnostics: () => ipcRenderer.invoke(DIAGNOSTIC_IPC_CHANNELS.export, DIAGNOSTIC_EXPORT_REQUEST),
  clearDiagnostics: () => ipcRenderer.invoke(DIAGNOSTIC_IPC_CHANNELS.clear, DIAGNOSTIC_CLEAR_REQUEST)
});

contextBridge.exposeInMainWorld(BRIDGE_NAME, bridge);

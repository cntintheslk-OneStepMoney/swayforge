'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron');
const {
  IPC_CHANNELS,
  createApplicationInfo,
  isAiRefreshRequest,
  isAiStatusRequest,
  isHealthRequest
} = require('../core/application-contracts.cjs');
const { AiRuntimeService } = require('../ai/ai-runtime-service.cjs');
const { OllamaProvider } = require('../ai/providers/ollama-provider.cjs');
const {
  STORAGE_IPC_CHANNELS,
  validateApplicationUpdateRequest,
  validateArchiveProjectRequest,
  validateCreateProjectRequest,
  validateProjectReadRequest,
  validateUpdateProjectRequest
} = require('../storage/storage-contracts.cjs');
const {
  LocalDataRepository,
  StorageCorruptionError
} = require('../storage/local-data-repository.cjs');
const {
  SECRET_IPC_CHANNELS,
  isSecretStorageStatusRequest
} = require('../security/secret-contracts.cjs');
const { ProtectedSecretStore } = require('../security/protected-secret-store.cjs');
const {
  WINDOW_WEB_PREFERENCES,
  installNavigationGuards
} = require('../security/electron-window-policy.cjs');

const RENDERER_DIRECTORY = path.join(__dirname, '..', 'renderer');
const RENDERER_ENTRY = path.join(RENDERER_DIRECTORY, 'index.html');
const FALLBACK_ENTRY = path.join(RENDERER_DIRECTORY, 'fallback.html');
const DATA_DIRECTORY_NAME = 'data';
const CREDENTIAL_DIRECTORY_NAME = 'credentials';

let primaryWindow = null;
let handlersRegistered = false;
let permissionsLockedDown = false;
let localDataRepository = null;
let protectedSecretStore = null;
let aiRuntime = null;

function getAiRuntime() {
  if (!aiRuntime) {
    aiRuntime = new AiRuntimeService({
      provider: new OllamaProvider(),
      logger: (event) => console.info('[ai-runtime]', event)
    });
  }
  return aiRuntime;
}

function getProtectedSecretStore() {
  if (!protectedSecretStore) throw new Error('Protected credential storage is not initialised.');
  return protectedSecretStore;
}

function sanitiseStorageError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'STORAGE_ERROR';
  const messages = Object.freeze({
    STORAGE_CONFLICT: 'Local data changed before this action could be saved. Reload and try again.',
    STORAGE_NOT_FOUND: 'The requested local project no longer exists.',
    PROJECT_ARCHIVED: 'This project is archived and cannot be edited.',
    STORAGE_CORRUPT: 'SwayForge local data could not be read safely. Existing data was preserved.',
    UNSUPPORTED_SCHEMA: 'This local data was created by an unsupported SwayForge data schema.'
  });
  return Object.freeze({
    code,
    message: messages[code] ?? 'The local data operation could not be completed safely.'
  });
}

async function storageResult(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch (error) {
    if (error instanceof TypeError) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({ code: 'INVALID_REQUEST', message: 'The local data request was invalid.' })
      });
    }
    return Object.freeze({ ok: false, error: sanitiseStorageError(error) });
  }
}

function registerIpcHandlers(repository = localDataRepository, secretStore = protectedSecretStore) {
  if (handlersRegistered) return;
  if (!repository) throw new Error('Local data repository must be ready before IPC registration.');
  if (!secretStore) throw new Error('Protected credential storage must be initialised before IPC registration.');
  handlersRegistered = true;

  ipcMain.handle(IPC_CHANNELS.applicationInfo, () =>
    createApplicationInfo({
      version: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    })
  );

  ipcMain.handle(IPC_CHANNELS.healthCheck, (_event, request) => {
    if (!isHealthRequest(request)) throw new TypeError('Invalid health-check request.');
    return Object.freeze({ status: 'ok' });
  });

  ipcMain.handle(IPC_CHANNELS.aiRuntimeStatus, (_event, request) => {
    if (!isAiStatusRequest(request)) throw new TypeError('Invalid AI status request.');
    return getAiRuntime().getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.aiRuntimeRefresh, (_event, request) => {
    if (!isAiRefreshRequest(request)) throw new TypeError('Invalid AI refresh request.');
    return getAiRuntime().getStatus({ refresh: true });
  });

  ipcMain.handle(SECRET_IPC_CHANNELS.status, (_event, request) => {
    if (!isSecretStorageStatusRequest(request)) throw new TypeError('Invalid secret-storage status request.');
    return secretStore.getStatus();
  });

  ipcMain.handle(STORAGE_IPC_CHANNELS.applicationStateRead, () =>
    storageResult(() => repository.readApplicationState())
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.applicationStateUpdate, (_event, request) =>
    storageResult(() => repository.updateApplicationState(validateApplicationUpdateRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectCreate, (_event, request) =>
    storageResult(() => repository.createProject(validateCreateProjectRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectRead, (_event, request) =>
    storageResult(() => repository.readProject(validateProjectReadRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectUpdate, (_event, request) =>
    storageResult(() => repository.updateProject(validateUpdateProjectRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectList, () =>
    storageResult(() => repository.listProjects())
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectArchive, (_event, request) =>
    storageResult(() => repository.archiveProject(validateArchiveProjectRequest(request)))
  );
}

async function initialiseLocalDataRepository() {
  if (localDataRepository) return localDataRepository;
  localDataRepository = await LocalDataRepository.open({
    rootDirectory: path.join(app.getPath('userData'), DATA_DIRECTORY_NAME)
  });
  return localDataRepository;
}

async function initialiseProtectedSecretStore() {
  if (protectedSecretStore) return protectedSecretStore;
  protectedSecretStore = await ProtectedSecretStore.open({
    rootDirectory: path.join(app.getPath('userData'), CREDENTIAL_DIRECTORY_NAME),
    applicationRootDirectory: app.getAppPath(),
    safeStorage
  });
  return protectedSecretStore;
}

function lockDownRendererPermissions() {
  if (permissionsLockedDown) return;
  permissionsLockedDown = true;

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createPrimaryWindow() {
  if (primaryWindow && !primaryWindow.isDestroyed()) return primaryWindow;

  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    title: 'SwayForge',
    webPreferences: {
      ...WINDOW_WEB_PREFERENCES,
      preload: path.join(__dirname, '..', 'preload', 'preload-bridge.cjs')
    }
  });

  primaryWindow = window;

  installNavigationGuards(window.webContents, [
    pathToFileURL(RENDERER_ENTRY).href,
    pathToFileURL(FALLBACK_ENTRY).href
  ]);

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  window.on('closed', () => {
    if (primaryWindow === window) primaryWindow = null;
  });

  window.loadFile(RENDERER_ENTRY).catch(async () => {
    console.error('[startup] Renderer entry failed to load.');
    try {
      await window.loadFile(FALLBACK_ENTRY);
      if (!window.isVisible()) window.show();
    } catch {
      dialog.showErrorBox(
        'SwayForge could not start',
        'The local application interface could not be loaded. No account, media, or AI data was accessed.'
      );
      app.quit();
    }
  });

  return window;
}

async function startApplication() {
  await initialiseLocalDataRepository();
  await initialiseProtectedSecretStore();
  registerIpcHandlers();
  lockDownRendererPermissions();
  createPrimaryWindow();
  void getAiRuntime().getStatus({ refresh: true }).catch(() => {});
}

app.whenReady().then(startApplication).catch((error) => {
  if (error instanceof StorageCorruptionError) {
    console.error('[startup] Local application data could not be validated; existing data was preserved.');
    dialog.showErrorBox(
      'SwayForge local data needs attention',
      'Existing local application data could not be read safely. SwayForge preserved it and did not replace it with blank data.'
    );
  } else {
    console.error('[startup] SwayForge failed during application bootstrap.');
    dialog.showErrorBox(
      'SwayForge could not start',
      'Application startup failed before the local workspace was ready.'
    );
  }
  app.quit();
});

app.on('before-quit', () => {
  aiRuntime?.shutdown();
});

app.on('window-all-closed', () => {
  app.quit();
});

module.exports = {
  createPrimaryWindow,
  getAiRuntime,
  getProtectedSecretStore,
  initialiseLocalDataRepository,
  initialiseProtectedSecretStore,
  lockDownRendererPermissions,
  registerIpcHandlers,
  sanitiseStorageError,
  startApplication,
  storageResult
};

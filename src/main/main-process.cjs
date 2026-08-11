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
  validateProjectReadRequest,
  validateRendererCreateProjectRequest,
  validateRendererUpdateProjectRequest
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
  MEDIA_IPC_CHANNELS,
  isChooseMediaRequest,
  validateProjectMediaRequest
} = require('../media/media-contracts.cjs');
const { MediaImportService } = require('../media/media-import-service.cjs');
const {
  WINDOW_WEB_PREFERENCES,
  installNavigationGuards
} = require('../security/electron-window-policy.cjs');

const RENDERER_DIRECTORY = path.join(__dirname, '..', 'renderer');
const RENDERER_ENTRY = path.join(RENDERER_DIRECTORY, 'index.html');
const FALLBACK_ENTRY = path.join(RENDERER_DIRECTORY, 'fallback.html');
const DATA_DIRECTORY_NAME = 'data';
const CREDENTIAL_DIRECTORY_NAME = 'credentials';
const MEDIA_DIRECTORY_NAME = 'media';

let primaryWindow = null;
let handlersRegistered = false;
let permissionsLockedDown = false;
let localDataRepository = null;
let protectedSecretStore = null;
let mediaImportService = null;
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

function getMediaImportService() {
  if (!mediaImportService) throw new Error('Media import service is not initialised.');
  return mediaImportService;
}

function sanitiseStorageError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'STORAGE_ERROR';
  const messages = Object.freeze({
    STORAGE_CONFLICT: 'Local data changed before this action could be saved. Reload and try again.',
    STORAGE_NOT_FOUND: 'The requested local project no longer exists.',
    PROJECT_ARCHIVED: 'This project is archived and cannot be edited.',
    STORAGE_CORRUPT: 'SwayForge local data could not be read safely. Existing data was preserved.',
    UNSUPPORTED_SCHEMA: 'This local data was created by an unsupported SwayForge data schema.',
    MEDIA_NOT_FOUND: 'The requested local media item no longer exists.',
    MEDIA_DUPLICATE: 'Identical local media is already registered.'
  });
  return Object.freeze({
    code,
    message: messages[code] ?? 'The local data operation could not be completed safely.'
  });
}

function sanitiseMediaError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'MEDIA_IMPORT_FAILED';
  const messages = Object.freeze({
    MEDIA_SOURCE_MISSING: 'The selected media file is no longer available.',
    MEDIA_SOURCE_INVALID: 'The selected item is not a supported regular media file.',
    MEDIA_SIZE_UNSUPPORTED: 'The selected media file size is not supported.',
    MEDIA_TYPE_UNSUPPORTED: 'That media format is not supported by this foundation.',
    MEDIA_SIGNATURE_INVALID: 'The selected file content does not match its supported media format.',
    MEDIA_COPY_VERIFY_FAILED: 'The local managed copy could not be verified safely.',
    MEDIA_PATH_INVALID: 'The managed media destination could not be resolved safely.',
    MEDIA_ID_INVALID: 'A safe local media identity could not be allocated.',
    STORAGE_CONFLICT: 'Local data changed during import. Try the import again.',
    STORAGE_CORRUPT: 'SwayForge local data could not be updated safely. Existing data was preserved.'
  });
  return Object.freeze({
    code,
    message: messages[code] ?? 'The selected media could not be imported safely.'
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

async function mediaResult(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch (error) {
    if (error instanceof TypeError) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({ code: 'INVALID_REQUEST', message: 'The media request was invalid.' })
      });
    }
    return Object.freeze({ ok: false, error: sanitiseMediaError(error) });
  }
}

async function chooseMediaFile() {
  const options = Object.freeze({
    title: 'Import media',
    properties: ['openFile'],
    filters: [
      { name: 'Supported media', extensions: ['jpg', 'jpeg', 'png', 'mp4', 'mov'] }
    ]
  });
  return primaryWindow && !primaryWindow.isDestroyed()
    ? dialog.showOpenDialog(primaryWindow, options)
    : dialog.showOpenDialog(options);
}

function registerIpcHandlers(
  repository = localDataRepository,
  secretStore = protectedSecretStore,
  mediaService = mediaImportService
) {
  if (handlersRegistered) return;
  if (!repository) throw new Error('Local data repository must be ready before IPC registration.');
  if (!secretStore) throw new Error('Protected credential storage must be initialised before IPC registration.');
  if (!mediaService) throw new Error('Media import service must be initialised before IPC registration.');
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
    storageResult(() => repository.createProject(validateRendererCreateProjectRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectRead, (_event, request) =>
    storageResult(() => repository.readProject(validateProjectReadRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectUpdate, (_event, request) =>
    storageResult(() => repository.updateProject(validateRendererUpdateProjectRequest(request)))
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectList, () =>
    storageResult(() => repository.listProjects())
  );
  ipcMain.handle(STORAGE_IPC_CHANNELS.projectArchive, (_event, request) =>
    storageResult(() => repository.archiveProject(validateArchiveProjectRequest(request)))
  );

  ipcMain.handle(MEDIA_IPC_CHANNELS.chooseImport, async (_event, request) => {
    if (!isChooseMediaRequest(request)) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({ code: 'INVALID_REQUEST', message: 'The media request was invalid.' })
      });
    }
    const selection = await chooseMediaFile();
    if (selection.canceled || selection.filePaths.length === 0) {
      return Object.freeze({ ok: true, value: Object.freeze({ status: 'cancelled' }) });
    }
    return mediaResult(() => mediaService.importFile(selection.filePaths[0]));
  });
  ipcMain.handle(MEDIA_IPC_CHANNELS.list, () => mediaResult(() => mediaService.listMedia()));
  ipcMain.handle(MEDIA_IPC_CHANNELS.attach, (_event, request) =>
    mediaResult(() => mediaService.attachMediaToProject(validateProjectMediaRequest(request)))
  );
  ipcMain.handle(MEDIA_IPC_CHANNELS.detach, (_event, request) =>
    mediaResult(() => mediaService.detachMediaFromProject(validateProjectMediaRequest(request)))
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

async function initialiseMediaImportService() {
  if (mediaImportService) return mediaImportService;
  if (!localDataRepository) throw new Error('Local data repository must be ready before media import initialisation.');
  mediaImportService = await MediaImportService.open({
    rootDirectory: path.join(app.getPath('userData'), MEDIA_DIRECTORY_NAME),
    repository: localDataRepository
  });
  return mediaImportService;
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
  await initialiseMediaImportService();
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
  getMediaImportService,
  getProtectedSecretStore,
  initialiseLocalDataRepository,
  initialiseMediaImportService,
  initialiseProteectedSecretStor,
  lockDownRendererPermissions,
  mediaResult,
  registerIpcHandlers,
  sanitiseMediaError,
  sanitiseStorageError,
  startApplication,
  storageResult
};

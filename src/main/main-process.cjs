'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const {
  IPC_CHANNELS,
  createApplicationInfo,
  isHealthRequest
} = require('../core/application-contracts.cjs');
const {
  WINDOW_WEB_PREFERENCES,
  installNavigationGuards
} = require('../security/electron-window-policy.cjs');

const RENDERER_DIRECTORY = path.join(__dirname, '..', 'renderer');
const RENDERER_ENTRY = path.join(RENDERER_DIRECTORY, 'index.html');
const FALLBACK_ENTRY = path.join(RENDERER_DIRECTORY, 'fallback.html');

let primaryWindow = null;
let handlersRegistered = false;
let permissionsLockedDown = false;

function registerIpcHandlers() {
  if (handlersRegistered) return;
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
  registerIpcHandlers();
  lockDownRendererPermissions();
  createPrimaryWindow();
}

app.whenReady().then(startApplication).catch(() => {
  console.error('[startup] SwayForge failed during application bootstrap.');
  dialog.showErrorBox(
    'SwayForge could not start',
    'Application startup failed before the local workspace was ready.'
  );
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

module.exports = {
  createPrimaryWindow,
  lockDownRendererPermissions,
  registerIpcHandlers,
  startApplication
};

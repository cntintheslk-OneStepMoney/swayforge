'use strict';

const WINDOW_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false
});

function normaliseLocalDocumentUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'file:') return null;
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function installNavigationGuards(webContents, allowedDocumentUrls) {
  if (!webContents || typeof webContents.setWindowOpenHandler !== 'function') {
    throw new TypeError('A valid Electron webContents instance is required.');
  }

  const allowlist = new Set(
    allowedDocumentUrls.map(normaliseLocalDocumentUrl).filter(Boolean)
  );

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const blockUnexpectedNavigation = (event, targetUrl) => {
    const normalised = normaliseLocalDocumentUrl(targetUrl);
    if (!normalised || !allowlist.has(normalised)) event.preventDefault();
  };

  webContents.on('will-navigate', blockUnexpectedNavigation);
  webContents.on('will-redirect', blockUnexpectedNavigation);

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

module.exports = {
  WINDOW_WEB_PREFERENCES,
  installNavigationGuards,
  normaliseLocalDocumentUrl
};

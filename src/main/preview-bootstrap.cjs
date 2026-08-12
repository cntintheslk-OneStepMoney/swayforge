'use strict';

const path = require('node:path');
const { app, ipcMain, protocol } = require('electron');
const {
  MEDIA_IPC_CHANNELS,
  MEDIA_PREVIEW_REBUILD_REQUEST_KIND,
  MEDIA_PREVIEW_REQUEST_KIND,
  validateMediaPreviewRequest
} = require('../media/media-contracts.cjs');
const {
  MEDIA_INDEX_IPC_CHANNELS,
  MEDIA_INDEX_REBUILD_REQUEST,
  MEDIA_INDEX_STATUS_REQUEST,
  isExactRequest: isExactMediaIndexRequest,
  validateMediaIndexSearchRequest
} = require('../media/media-index-contracts.cjs');
const { MediaPreviewService } = require('../media/media-preview-service.cjs');
const { MediaIndexService } = require('../media/media-index-service.cjs');
const { createElectronPreviewGenerators } = require('../media/electron-preview-generators.cjs');
const {
  installMediaPreviewProtocol,
  registerMediaPreviewScheme
} = require('../media/media-preview-protocol.cjs');

const CACHE_DIRECTORY_NAME = 'cache';
const MEDIA_DIRECTORY_NAME = 'media';
const MEDIA_PREVIEW_DIRECTORY_NAME = 'media-previews';
const MEDIA_INDEX_DIRECTORY_NAME = 'media-index';
const MEDIA_PREVIEW_GENERATOR_VERSION = 'electron-native-preview-v1';

registerMediaPreviewScheme(protocol);
const foundation = require('./main-process.cjs');

let mediaPreviewService = null;
let mediaPreviewServicePromise = null;
let mediaIndexService = null;
let mediaIndexServicePromise = null;
let previewProtocolInstalled = false;

function sanitisePreviewError(error) {
  const code = typeof error?.code === 'string' ? error.code : error instanceof TypeError ? 'INVALID_REQUEST' : 'PREVIEW_GENERATION_FAILED';
  const messages = Object.freeze({
    INVALID_REQUEST: 'The media preview request was invalid.',
    MEDIA_NOT_FOUND: 'The requested local media item is no longer available.',
    PREVIEW_MEDIA_NOT_FOUND: 'The requested local media item is no longer available.',
    PREVIEW_MEDIA_UNSUPPORTED: 'This media kind cannot be previewed locally.',
    PREVIEW_SOURCE_UNAVAILABLE: 'The local source media is unavailable for preview generation.',
    PREVIEW_SOURCE_INVALID: 'The local source media identity could not be validated.',
    PREVIEW_SOURCE_CHANGED: 'The managed media changed after import, so its preview was not generated.',
    PREVIEW_PATH_INVALID: 'The local preview path could not be resolved safely.',
    PREVIEW_QUEUE_FULL: 'The local preview queue is busy. The library remains usable while previews finish.',
    PREVIEW_CANCELLED: 'Local preview generation was cancelled safely.',
    PREVIEW_SHUTDOWN: 'Local preview generation is shutting down.',
    PREVIEW_GENERATION_INVALID: 'The generated local preview could not be validated.',
    PREVIEW_GENERATION_FAILED: 'Local preview generation failed. The source media was preserved.'
  });
  return Object.freeze({ code, message: messages[code] ?? 'The local media preview could not be generated safely.' });
}

function sanitiseIndexError(error) {
  const code = error instanceof TypeError ? 'INVALID_REQUEST' : typeof error?.code === 'string' ? error.code : 'MEDIA_INDEX_ERROR';
  return Object.freeze({
    code,
    message: code === 'INVALID_REQUEST'
      ? 'The media search request was invalid.'
      : 'The local media search index could not be used safely. Authoritative media data was preserved.'
  });
}

async function previewResult(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch (error) {
    return Object.freeze({ ok: false, error: sanitisePreviewError(error) });
  }
}

async function indexResult(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch (error) {
    return Object.freeze({ ok: false, error: sanitiseIndexError(error) });
  }
}

async function getMediaPreviewService() {
  if (mediaPreviewService) return mediaPreviewService;
  if (!mediaPreviewServicePromise) {
    mediaPreviewServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const service = await MediaPreviewService.open({
        rootDirectory: path.join(app.getPath('userData'), CACHE_DIRECTORY_NAME, MEDIA_PREVIEW_DIRECTORY_NAME),
        mediaRootDirectory: path.join(app.getPath('userData'), MEDIA_DIRECTORY_NAME),
        repository,
        generators: createElectronPreviewGenerators(),
        generatorVersion: MEDIA_PREVIEW_GENERATOR_VERSION
      });
      mediaPreviewService = service;
      return service;
    })().catch((error) => {
      mediaPreviewServicePromise = null;
      throw error;
    });
  }
  return mediaPreviewServicePromise;
}

async function getMediaIndexService() {
  if (mediaIndexService) return mediaIndexService;
  if (!mediaIndexServicePromise) {
    mediaIndexServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const service = await MediaIndexService.open({
        rootDirectory: path.join(app.getPath('userData'), CACHE_DIRECTORY_NAME, MEDIA_INDEX_DIRECTORY_NAME),
        repository
      });
      mediaIndexService = service;
      return service;
    })().catch((error) => {
      mediaIndexServicePromise = null;
      throw error;
    });
  }
  return mediaIndexServicePromise;
}

function registerPreviewIpcHandlers() {
  ipcMain.handle(MEDIA_IPC_CHANNELS.preview, (_event, request) =>
    previewResult(async () => {
      const validated = validateMediaPreviewRequest(request, MEDIA_PREVIEW_REQUEST_KIND);
      return (await getMediaPreviewService()).requestPreview(validated.mediaId);
    })
  );
  ipcMain.handle(MEDIA_IPC_CHANNELS.previewRebuild, (_event, request) =>
    previewResult(async () => {
      const validated = validateMediaPreviewRequest(request, MEDIA_PREVIEW_REBUILD_REQUEST_KIND);
      return (await getMediaPreviewService()).requestPreview(validated.mediaId, { force: true });
    })
  );
}

function registerMediaIndexIpcHandlers() {
  ipcMain.handle(MEDIA_INDEX_IPC_CHANNELS.search, (_event, request) =>
    indexResult(async () => (await getMediaIndexService()).search(validateMediaIndexSearchRequest(request)))
  );
  ipcMain.handle(MEDIA_INDEX_IPC_CHANNELS.status, (_event, request) =>
    indexResult(async () => {
      if (!isExactMediaIndexRequest(request, MEDIA_INDEX_STATUS_REQUEST)) throw new TypeError('Invalid media index status request.');
      const service = await getMediaIndexService();
      await service.refreshIfStale();
      return service.getStatus();
    })
  );
  ipcMain.handle(MEDIA_INDEX_IPC_CHANNELS.rebuild, (_event, request) =>
    indexResult(async () => {
      if (!isExactMediaIndexRequest(request, MEDIA_INDEX_REBUILD_REQUEST)) throw new TypeError('Invalid media index rebuild request.');
      return (await getMediaIndexService()).rebuild('explicit-request');
    })
  );
}

async function installPreviewProtocol() {
  if (previewProtocolInstalled) return;
  await installMediaPreviewProtocol({
    protocolModule: protocol,
    previewService: Object.freeze({
      resolveArtifact: async (artifactId) => (await getMediaPreviewService()).resolveArtifact(artifactId)
    })
  });
  previewProtocolInstalled = true;
}

registerPreviewIpcHandlers();
registerMediaIndexIpcHandlers();
app.whenReady().then(installPreviewProtocol).catch(() => {
  // The foundation app remains usable if the rebuildable preview cache cannot start.
});
app.whenReady().then(() => getMediaIndexService()).catch(() => {
  // Search remains safely unavailable; authoritative media/project data is untouched.
});

app.on('before-quit', () => {
  mediaPreviewService?.shutdown();
});

module.exports = {
  MEDIA_PREVIEW_GENERATOR_VERSION,
  getMediaIndexService,
  getMediaPreviewService,
  indexResult,
  installPreviewProtocol,
  previewResult,
  registerMediaIndexIpcHandlers,
  registerPreviewIpcHandlers,
  sanitiseIndexError,
  sanitisePreviewError
};

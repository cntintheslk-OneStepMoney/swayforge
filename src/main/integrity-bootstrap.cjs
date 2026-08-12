'use strict';

const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');
const foundation = require('./main-process.cjs');
const mediaFoundation = require('./preview-bootstrap.cjs');
const {
  MEDIA_INTEGRITY_IPC_CHANNELS,
  validateRebuildDerivedRequest,
  validateRepairRequest,
  validateScanRequest
} = require('../media/media-integrity-contracts.cjs');
const { MediaIntegrityService } = require('../media/media-integrity-service.cjs');

const CACHE_DIRECTORY_NAME = 'cache';
const DERIVED_DIRECTORY_NAME = 'derived';
const MEDIA_DIRECTORY_NAME = 'media';
const MEDIA_INTEGRITY_DIRECTORY_NAME = 'media-integrity';
const MEDIA_PREVIEW_DIRECTORY_NAME = 'media-previews';
const MEDIA_AI_DIRECTORY_NAME = 'media-ai';

let mediaIntegrityService = null;
let mediaIntegrityServicePromise = null;
let handlersRegistered = false;

function sanitiseIntegrityError(error) {
  const code = error instanceof TypeError ? 'INVALID_REQUEST' : typeof error?.code === 'string' ? error.code : 'MEDIA_INTEGRITY_ERROR';
  const messages = Object.freeze({
    INVALID_REQUEST: 'The media integrity request was invalid.',
    MEDIA_NOT_FOUND: 'The requested local media item is no longer registered.',
    MEDIA_INTEGRITY_CANCELLED: 'The media integrity check was cancelled safely.',
    MEDIA_INTEGRITY_PATH_INVALID: 'The managed media reference could not be resolved safely.',
    MEDIA_REPAIR_UNSUPPORTED: 'This media item cannot be restored through the managed-media recovery flow.',
    MEDIA_REPAIR_SOURCE_MISSING: 'The selected recovery file is no longer available.',
    MEDIA_REPAIR_SOURCE_INVALID: 'The selected recovery item is not a regular media file.',
    MEDIA_REPAIR_CONTENT_INVALID: 'The selected recovery file does not match the original media format.',
    MEDIA_REPAIR_VERIFY_FAILED: 'The recovery copy could not be verified safely; the previous managed file was preserved where available.',
    MEDIA_REPAIR_DESTINATION_INVALID: 'The managed media destination is not a safe regular file.',
    MEDIA_DELETE_DEFERRED: 'Managed source deletion is not exposed by this recovery workflow.'
  });
  return Object.freeze({ code, message: messages[code] ?? 'The local media integrity operation failed safely. Source media and creator metadata were preserved.' });
}

async function integrityResult(operation) {
  try { return Object.freeze({ ok: true, value: await operation() }); }
  catch (error) { return Object.freeze({ ok: false, error: sanitiseIntegrityError(error) }); }
}

async function getMediaIntegrityService() {
  if (mediaIntegrityService) return mediaIntegrityService;
  if (!mediaIntegrityServicePromise) {
    mediaIntegrityServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const service = await MediaIntegrityService.open({
        mediaRootDirectory: path.join(app.getPath('userData'), MEDIA_DIRECTORY_NAME),
        cacheDirectory: path.join(app.getPath('userData'), CACHE_DIRECTORY_NAME, MEDIA_INTEGRITY_DIRECTORY_NAME),
        previewCacheDirectory: path.join(app.getPath('userData'), CACHE_DIRECTORY_NAME, MEDIA_PREVIEW_DIRECTORY_NAME),
        aiDirectory: path.join(app.getPath('userData'), DERIVED_DIRECTORY_NAME, MEDIA_AI_DIRECTORY_NAME),
        repository,
        previewService: await mediaFoundation.getMediaPreviewService(),
        indexService: await mediaFoundation.getMediaIndexService(),
        similarityService: await mediaFoundation.getMediaSimilarityService(),
        aiAnalysisService: await mediaFoundation.getMediaAiAnalysisService()
      });
      mediaIntegrityService = service;
      return service;
    })().catch((error) => {
      mediaIntegrityServicePromise = null;
      throw error;
    });
  }
  return mediaIntegrityServicePromise;
}

async function chooseRecoveryFile() {
  const options = Object.freeze({
    title: 'Restore managed media',
    properties: ['openFile'],
    filters: [{ name: 'Supported media', extensions: ['jpg', 'jpeg', 'png', 'mp4', 'mov'] }]
  });
  return dialog.showOpenDialog(options);
}

function registerMediaIntegrityIpcHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(MEDIA_INTEGRITY_IPC_CHANNELS.scan, (_event, request) => integrityResult(async () => {
    const validated = validateScanRequest(request);
    return (await getMediaIntegrityService()).scan(validated);
  }));

  ipcMain.handle(MEDIA_INTEGRITY_IPC_CHANNELS.repair, async (_event, request) => {
    let validated;
    try { validated = validateRepairRequest(request); }
    catch (error) { return Object.freeze({ ok: false, error: sanitiseIntegrityError(error) }); }
    const selection = await chooseRecoveryFile();
    if (selection.canceled || selection.filePaths.length === 0) return Object.freeze({ ok: true, value: Object.freeze({ mediaId: validated.mediaId, status: 'cancelled' }) });
    return integrityResult(() => getMediaIntegrityService().then((service) => service.repairManagedMedia(validated.mediaId, selection.filePaths[0])));
  });

  ipcMain.handle(MEDIA_INTEGRITY_IPC_CHANNELS.rebuildDerived, (_event, request) => integrityResult(async () => {
    const validated = validateRebuildDerivedRequest(request);
    return (await getMediaIntegrityService()).rebuildDerived(validated);
  }));
}

registerMediaIntegrityIpcHandlers();

module.exports = {
  getMediaIntegrityService,
  integrityResult,
  registerMediaIntegrityIpcHandlers,
  sanitiseIntegrityError
};

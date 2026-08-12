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
const {
  MEDIA_SIMILARITY_IPC_CHANNELS,
  MEDIA_SIMILARITY_REBUILD_REQUEST,
  MEDIA_SIMILARITY_STATUS_REQUEST,
  isExactRequest: isExactSimilarityRequest,
  validateFindSimilarityRequest
} = require('../media/media-similarity-contracts.cjs');
const {
  MEDIA_AI_ANALYZE_REQUEST,
  MEDIA_AI_GET_REQUEST,
  MEDIA_AI_IPC_CHANNELS,
  validateMediaAiRequest
} = require('../media/media-ai-contracts.cjs');
const {
  MEDIA_ORGANISATION_IPC_CHANNELS,
  validateAiSuggestionsRequest,
  validateMutationRequest,
  validateSnapshotRequest
} = require('../media/media-organisation-contracts.cjs');
const { MediaPreviewService } = require('../media/media-preview-service.cjs');
const { MediaIndexService } = require('../media/media-index-service.cjs');
const { MediaSimilarityService } = require('../media/media-similarity-service.cjs');
const { MediaAiAnalysisService } = require('../media/media-ai-analysis-service.cjs');
const { MediaOrganisationService } = require('../media/media-organisation-service.cjs');
const { createElectronPreviewGenerators } = require('../media/electron-preview-generators.cjs');
const { createElectronSimilarityFingerprintProvider } = require('../media/electron-similarity-fingerprints.cjs');
const { createElectronMediaAnalysisFrameProvider } = require('../media/electron-media-analysis-frames.cjs');
const { installMediaPreviewProtocol, registerMediaPreviewScheme } = require('../media/media-preview-protocol.cjs');

const CACHE_DIRECTORY_NAME = 'cache';
const DERIVED_DIRECTORY_NAME = 'derived';
const MEDIA_DIRECTORY_NAME = 'media';
const MEDIA_PREVIEW_DIRECTORY_NAME = 'media-previews';
const MEDIA_INDEX_DIRECTORY_NAME = 'media-index';
const MEDIA_SIMILARITY_DIRECTORY_NAME = 'media-similarity';
const MEDIA_AI_DIRECTORY_NAME = 'media-ai';
const MEDIA_PREVIEW_GENERATOR_VERSION = 'electron-native-preview-v1';

registerMediaPreviewScheme(protocol);
const foundation = require('./main-process.cjs');

let mediaPreviewService = null;
let mediaPreviewServicePromise = null;
let mediaIndexService = null;
let mediaIndexServicePromise = null;
let mediaSimilarityService = null;
let mediaSimilarityServicePromise = null;
let mediaAiAnalysisService = null;
let mediaAiAnalysisServicePromise = null;
let mediaOrganisationService = null;
let mediaOrganisationServicePromise = null;
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
  return Object.freeze({ code, message: code === 'INVALID_REQUEST' ? 'The media search request was invalid.' : 'The local media search index could not be used safely. Authoritative media data was preserved.' });
}

function sanitiseSimilarityError(error) {
  const code = error instanceof TypeError ? 'INVALID_REQUEST' : typeof error?.code === 'string' ? error.code : 'MEDIA_SIMILARITY_ERROR';
  const messages = Object.freeze({
    INVALID_REQUEST: 'The media similarity request was invalid.',
    MEDIA_NOT_FOUND: 'The requested local media item is no longer available.',
    SIMILARITY_SOURCE_UNAVAILABLE: 'The local source media is unavailable for similarity analysis.',
    SIMILARITY_SOURCE_INVALID: 'The local source media identity could not be validated.',
    SIMILARITY_SOURCE_CHANGED: 'The managed media changed after import, so similarity analysis was not run.',
    SIMILARITY_PATH_INVALID: 'The local media path could not be resolved safely.',
    SIMILARITY_FINGERPRINT_INVALID: 'A local perceptual fingerprint could not be produced safely.'
  });
  return Object.freeze({ code, message: messages[code] ?? 'Local media similarity analysis failed. Source media and user decisions were preserved.' });
}

function sanitiseMediaAiError(error) {
  const code = error instanceof TypeError ? 'INVALID_REQUEST' : typeof error?.code === 'string' ? error.code : 'MEDIA_AI_ERROR';
  const messages = Object.freeze({
    INVALID_REQUEST: 'The local media AI request was invalid.',
    MEDIA_NOT_FOUND: 'The requested local media item is no longer available.',
    MEDIA_AI_UNSUPPORTED: 'This media kind is not supported for local AI understanding.',
    MEDIA_AI_SOURCE_UNAVAILABLE: 'The local source media is unavailable for AI understanding.',
    MEDIA_AI_SOURCE_INVALID: 'The local source media identity could not be validated.',
    MEDIA_AI_SOURCE_CHANGED: 'The managed media changed after import, so AI understanding was not run.',
    MEDIA_AI_PATH_INVALID: 'The local media path could not be resolved safely.'
  });
  return Object.freeze({ code, message: messages[code] ?? 'Local media AI understanding failed safely. Source media and user-authored metadata were preserved.' });
}

function sanitiseOrganisationError(error) {
  const code = error instanceof TypeError ? 'INVALID_REQUEST' : typeof error?.code === 'string' ? error.code : 'MEDIA_ORGANISATION_ERROR';
  const messages = Object.freeze({
    INVALID_REQUEST: 'The media organisation request was invalid.',
    STORAGE_CONFLICT: 'Media organisation changed before this action could be saved. Reload and try again.',
    STORAGE_CORRUPT: 'Local media organisation could not be read safely. Existing data was preserved.',
    MEDIA_NOT_FOUND: 'One of the selected local media items no longer exists.',
    TAG_NOT_FOUND: 'The requested tag no longer exists.',
    TAG_NAME_CONFLICT: 'Another tag already uses that name.',
    COLLECTION_NOT_FOUND: 'The requested collection no longer exists.',
    COLLECTION_NAME_CONFLICT: 'Another collection already uses that name.',
    COLLECTION_ARCHIVED: 'Archived collections cannot be edited.',
    SAVED_VIEW_NOT_FOUND: 'The requested saved view no longer exists.',
    AI_SUGGESTION_NOT_FOUND: 'That AI suggestion is no longer current.'
  });
  return Object.freeze({ code, message: messages[code] ?? 'Media organisation could not be changed safely. Source media was preserved.' });
}

async function resultOf(operation, sanitiser) {
  try { return Object.freeze({ ok: true, value: await operation() }); }
  catch (error) { return Object.freeze({ ok: false, error: sanitiser(error) }); }
}
const previewResult = (operation) => resultOf(operation, sanitisePreviewError);
const indexResult = (operation) => resultOf(operation, sanitiseIndexError);
const similarityResult = (operation) => resultOf(operation, sanitiseSimilarityError);
const mediaAiResult = (operation) => resultOf(operation, sanitiseMediaAiError);
const organisationResult = (operation) => resultOf(operation, sanitiseOrganisationError);

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
    })().catch((error) => { mediaPreviewServicePromise = null; throw error; });
  }
  return mediaPreviewServicePromise;
}

async function getMediaAiAnalysisService() {
  if (mediaAiAnalysisService) return mediaAiAnalysisService;
  if (!mediaAiAnalysisServicePromise) {
    mediaAiAnalysisServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const service = await MediaAiAnalysisService.open({
        rootDirectory: path.join(app.getPath('userData'), DERIVED_DIRECTORY_NAME, MEDIA_AI_DIRECTORY_NAME),
        mediaRootDirectory: path.join(app.getPath('userData'), MEDIA_DIRECTORY_NAME),
        repository,
        runtimeProvider: () => foundation.getAiRuntime(),
        previewService: await getMediaPreviewService(),
        videoFrameProvider: createElectronMediaAnalysisFrameProvider()
      });
      mediaAiAnalysisService = service;
      return service;
    })().catch((error) => { mediaAiAnalysisServicePromise = null; throw error; });
  }
  return mediaAiAnalysisServicePromise;
}

async function getMediaOrganisationService() {
  if (mediaOrganisationService) return mediaOrganisationService;
  if (!mediaOrganisationServicePromise) {
    mediaOrganisationServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const service = await MediaOrganisationService.open({
        repository,
        aiAnalysisProvider: async (mediaId) => (await getMediaAiAnalysisService()).getAnalysis(mediaId)
      });
      mediaOrganisationService = service;
      return service;
    })().catch((error) => { mediaOrganisationServicePromise = null; throw error; });
  }
  return mediaOrganisationServicePromise;
}

async function getMediaIndexService() {
  if (mediaIndexService) return mediaIndexService;
  if (!mediaIndexServicePromise) {
    mediaIndexServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const organisation = await getMediaOrganisationService();
      const service = await MediaIndexService.open({
        rootDirectory: path.join(app.getPath('userData'), CACHE_DIRECTORY_NAME, MEDIA_INDEX_DIRECTORY_NAME),
        repository,
        derivedMetadataProviders: [
          async (media) => organisation.getIndexMetadata(media),
          async (media) => (await getMediaAiAnalysisService()).getIndexMetadata(media)
        ]
      });
      mediaIndexService = service;
      return service;
    })().catch((error) => { mediaIndexServicePromise = null; throw error; });
  }
  return mediaIndexServicePromise;
}

async function getMediaSimilarityService() {
  if (mediaSimilarityService) return mediaSimilarityService;
  if (!mediaSimilarityServicePromise) {
    mediaSimilarityServicePromise = (async () => {
      const repository = await foundation.initialiseLocalDataRepository();
      const service = await MediaSimilarityService.open({
        rootDirectory: path.join(app.getPath('userData'), CACHE_DIRECTORY_NAME, MEDIA_SIMILARITY_DIRECTORY_NAME),
        mediaRootDirectory: path.join(app.getPath('userData'), MEDIA_DIRECTORY_NAME),
        repository,
        fingerprintProvider: createElectronSimilarityFingerprintProvider()
      });
      mediaSimilarityService = service;
      return service;
    })().catch((error) => { mediaSimilarityServicePromise = null; throw error; });
  }
  return mediaSimilarityServicePromise;
}

function registerPreviewIpcHandlers() {
  ipcMain.handle(MEDIA_IPC_CHANNELS.preview, (_event, request) => previewResult(async () => {
    const validated = validateMediaPreviewRequest(request, MEDIA_PREVIEW_REQUEST_KIND);
    return (await getMediaPreviewService()).requestPreview(validated.mediaId);
  }));
  ipcMain.handle(MEDIA_IPC_CHANNELS.previewRebuild, (_event, request) => previewResult(async () => {
    const validated = validateMediaPreviewRequest(request, MEDIA_PREVIEW_REBUILD_REQUEST_KIND);
    return (await getMediaPreviewService()).requestPreview(validated.mediaId, { force: true });
  }));
}

function registerMediaIndexIpcHandlers() {
  ipcMain.handle(MEDIA_INDEX_IPC_CHANNELS.search, (_event, request) => indexResult(async () => (await getMediaIndexService()).search(validateMediaIndexSearchRequest(request))));
  ipcMain.handle(MEDIA_INDEX_IPC_CHANNELS.status, (_event, request) => indexResult(async () => {
    if (!isExactMediaIndexRequest(request, MEDIA_INDEX_STATUS_REQUEST)) throw new TypeError('Invalid media index status request.');
    const service = await getMediaIndexService();
    await service.refreshIfStale();
    return service.getStatus();
  }));
  ipcMain.handle(MEDIA_INDEX_IPC_CHANNELS.rebuild, (_event, request) => indexResult(async () => {
    if (!isExactMediaIndexRequest(request, MEDIA_INDEX_REBUILD_REQUEST)) throw new TypeError('Invalid media index rebuild request.');
    return (await getMediaIndexService()).rebuild('explicit-request');
  }));
}

function registerMediaSimilarityIpcHandlers() {
  ipcMain.handle(MEDIA_SIMILARITY_IPC_CHANNELS.find, (_event, request) => similarityResult(async () => (await getMediaSimilarityService()).findSimilar(validateFindSimilarityRequest(request))));
  ipcMain.handle(MEDIA_SIMILARITY_IPC_CHANNELS.status, (_event, request) => similarityResult(async () => {
    if (!isExactSimilarityRequest(request, MEDIA_SIMILARITY_STATUS_REQUEST)) throw new TypeError('Invalid media similarity status request.');
    return (await getMediaSimilarityService()).getStatus();
  }));
  ipcMain.handle(MEDIA_SIMILARITY_IPC_CHANNELS.rebuild, (_event, request) => similarityResult(async () => {
    if (!isExactSimilarityRequest(request, MEDIA_SIMILARITY_REBUILD_REQUEST)) throw new TypeError('Invalid media similarity rebuild request.');
    return (await getMediaSimilarityService()).rebuild();
  }));
}

function registerMediaAiIpcHandlers() {
  ipcMain.handle(MEDIA_AI_IPC_CHANNELS.analyze, (_event, request) => mediaAiResult(async () => {
    const validated = validateMediaAiRequest(request, MEDIA_AI_ANALYZE_REQUEST);
    const value = await (await getMediaAiAnalysisService()).analyse(validated.mediaId);
    await (await getMediaIndexService()).rebuild('ai-derived-metadata-updated');
    return value;
  }));
  ipcMain.handle(MEDIA_AI_IPC_CHANNELS.get, (_event, request) => mediaAiResult(async () => {
    const validated = validateMediaAiRequest(request, MEDIA_AI_GET_REQUEST);
    return (await getMediaAiAnalysisService()).getAnalysis(validated.mediaId);
  }));
}

function registerMediaOrganisationIpcHandlers() {
  ipcMain.handle(MEDIA_ORGANISATION_IPC_CHANNELS.snapshot, (_event, request) => organisationResult(async () => {
    validateSnapshotRequest(request);
    return (await getMediaOrganisationService()).getSnapshot();
  }));
  ipcMain.handle(MEDIA_ORGANISATION_IPC_CHANNELS.aiSuggestions, (_event, request) => organisationResult(async () => {
    const validated = validateAiSuggestionsRequest(request);
    return (await getMediaOrganisationService()).getAiSuggestions(validated.mediaId);
  }));
  ipcMain.handle(MEDIA_ORGANISATION_IPC_CHANNELS.mutate, (_event, request) => organisationResult(async () => {
    const validated = validateMutationRequest(request);
    const outcome = await (await getMediaOrganisationService()).performMutation(validated);
    if (outcome.changed) await (await getMediaIndexService()).rebuild('media-organisation-updated');
    return outcome;
  }));
}

async function installPreviewProtocol() {
  if (previewProtocolInstalled) return;
  await installMediaPreviewProtocol({
    protocolModule: protocol,
    previewService: Object.freeze({ resolveArtifact: async (artifactId) => (await getMediaPreviewService()).resolveArtifact(artifactId) })
  });
  previewProtocolInstalled = true;
}

registerPreviewIpcHandlers();
registerMediaIndexIpcHandlers();
registerMediaSimilarityIpcHandlers();
registerMediaAiIpcHandlers();
registerMediaOrganisationIpcHandlers();
app.whenReady().then(installPreviewProtocol).catch(() => {});
app.whenReady().then(() => getMediaIndexService()).catch(() => {});
app.whenReady().then(() => getMediaSimilarityService()).catch(() => {});

app.on('before-quit', () => { mediaPreviewService?.shutdown(); });

module.exports = {
  MEDIA_PREVIEW_GENERATOR_VERSION,
  getMediaAiAnalysisService,
  getMediaIndexService,
  getMediaOrganisationService,
  getMediaPreviewService,
  getMediaSimilarityService,
  indexResult,
  installPreviewProtocol,
  mediaAiResult,
  organisationResult,
  previewResult,
  registerMediaAiIpcHandlers,
  registerMediaIndexIpcHandlers,
  registerMediaOrganisationIpcHandlers,
  registerMediaSimilarityIpcHandlers,
  registerPreviewIpcHandlers,
  sanitiseIndexError,
  sanitiseMediaAiError,
  sanitiseOrganisationError,
  sanitisePreviewError,
  sanitiseSimilarityError,
  similarityResult
};

'use strict';

const { ipcMain } = require('electron');
const foundation = require('./integrity-bootstrap.cjs');
const { ContentProjectService } = require('../content/content-project-service.cjs');
const {
  CONTENT_IPC_CHANNELS,
  validateArchiveRequest,
  validateCreateRequest,
  validateListRequest,
  validateReadRequest,
  validateUpdateRequest
} = require('../content/content-ipc-contracts.cjs');

let servicePromise = null;
let handlersRegistered = false;

async function getContentProjectService() {
  if (!servicePromise) {
    servicePromise = foundation.initialiseLocalDataRepository()
      .then((repository) => new ContentProjectService({ repository }))
      .catch((error) => { servicePromise = null; throw error; });
  }
  return servicePromise;
}

function sanitiseContentError(error) {
  const code = error instanceof TypeError ? 'INVALID_REQUEST' : typeof error?.code === 'string' ? error.code : 'CONTENT_PROJECT_ERROR';
  const messages = Object.freeze({
    INVALID_REQUEST: 'The Content Studio request was invalid.',
    STORAGE_CONFLICT: 'The local project changed before this edit could be saved. Reload the project and try again.',
    CONTENT_PROJECT_CONFLICT: 'The content project changed before this edit could be saved. Reload the project and try again.',
    STORAGE_NOT_FOUND: 'The requested local project no longer exists.',
    PROJECT_ARCHIVED: 'This project is archived and cannot be edited.'
  });
  return Object.freeze({ code, message: messages[code] || 'The Content Studio project operation failed safely.' });
}

async function contentResult(operation) {
  try { return Object.freeze({ ok: true, value: await operation() }); }
  catch (error) { return Object.freeze({ ok: false, error: sanitiseContentError(error) }); }
}

function registerContentProjectIpcHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  ipcMain.handle(CONTENT_IPC_CHANNELS.list, (_event, request) => contentResult(async () => {
    validateListRequest(request);
    const repository = await foundation.initialiseLocalDataRepository();
    return repository.listProjects();
  }));
  ipcMain.handle(CONTENT_IPC_CHANNELS.create, (_event, request) => contentResult(async () => {
    const validated = validateCreateRequest(request);
    return (await getContentProjectService()).create({ title: validated.title, mediaIds: validated.mediaIds, brief: validated.brief, expectedRevision: (await foundation.initialiseLocalDataRepository()).getStorageSummary().revision });
  }));
  ipcMain.handle(CONTENT_IPC_CHANNELS.read, (_event, request) => contentResult(async () => {
    const validated = validateReadRequest(request);
    return (await getContentProjectService()).read(validated.projectId);
  }));
  ipcMain.handle(CONTENT_IPC_CHANNELS.update, (_event, request) => contentResult(async () => {
    const validated = validateUpdateRequest(request);
    return (await getContentProjectService()).update({
      projectId: validated.projectId,
      expectedStoreRevision: validated.expectedStoreRevision,
      expectedContentRevision: validated.expectedContentRevision,
      patch: validated.patch
    });
  }));
  ipcMain.handle(CONTENT_IPC_CHANNELS.archive, (_event, request) => contentResult(async () => {
    const validated = validateArchiveRequest(request);
    return (await getContentProjectService()).archive({ projectId: validated.projectId, expectedStoreRevision: validated.expectedStoreRevision });
  }));
}

registerContentProjectIpcHandlers();

module.exports = {
  ...foundation,
  contentResult,
  getContentProjectService,
  registerContentProjectIpcHandlers,
  sanitiseContentError
};

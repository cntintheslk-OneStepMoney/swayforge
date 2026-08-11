'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  APPLICATION_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  assertManagedMediaId,
  assertProjectId,
  assertRevision,
  validateApplicationUpdateRequest,
  validateArchiveProjectRequest,
  validateCreateProjectRequest,
  validateDocument,
  validateMediaRecord,
  validateProjectReadRequest,
  validateUpdateProjectRequest
} = require('./storage-contracts.cjs');
const { UnsupportedSchemaError, runMigrations } = require('./migrations.cjs');

class LocalDataError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'LocalDataError';
    this.code = code;
  }
}

class StorageCorruptionError extends LocalDataError {
  constructor(message, options = {}) {
    super('STORAGE_CORRUPT', message, options);
    this.name = 'StorageCorruptionError';
  }
}

class StorageConflictError extends LocalDataError {
  constructor() {
    super('STORAGE_CONFLICT', 'The local store changed after this caller read it.');
    this.name = 'StorageConflictError';
  }
}

class StorageNotFoundError extends LocalDataError {
  constructor(message = 'The requested local project does not exist.') {
    super('STORAGE_NOT_FOUND', message);
    this.name = 'StorageNotFoundError';
  }
}

function clone(value) {
  return structuredClone(value);
}

function createFreshDocument(timestamp) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    application: {
      schemaVersion: APPLICATION_SCHEMA_VERSION,
      settings: {},
      selectedProjectId: null,
      recentProjectIds: []
    },
    projects: {},
    media: {}
  };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

class LocalDataRepository {
  static async open(options) {
    const repository = new LocalDataRepository(options);
    await repository.#initialise();
    return repository;
  }

  constructor({ rootDirectory, now = () => new Date(), idFactory = randomUUID, faultInjector = () => {} } = {}) {
    if (typeof rootDirectory !== 'string' || rootDirectory.length === 0 || !path.isAbsolute(rootDirectory)) {
      throw new TypeError('rootDirectory must be an absolute trusted path.');
    }
    if (typeof now !== 'function' || typeof idFactory !== 'function' || typeof faultInjector !== 'function') {
      throw new TypeError('Invalid repository dependency injection.');
    }

    this.rootDirectory = path.resolve(rootDirectory);
    this.statePath = path.join(this.rootDirectory, 'workspace.json');
    this.previousStatePath = path.join(this.rootDirectory, 'workspace.previous.json');
    this.now = now;
    this.idFactory = idFactory;
    this.faultInjector = faultInjector;
    this.document = null;
    this.writeQueue = Promise.resolve();
  }

  async #initialise() {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const primaryExists = await this.#exists(this.statePath);

    if (!primaryExists) {
      if (await this.#exists(this.previousStatePath)) {
        const recovered = await this.#readAndMigrate(this.previousStatePath);
        await this.#writeNewPrimary(recovered.document);
        this.document = recovered.document;
        return;
      }

      const fresh = createFreshDocument(this.#timestamp());
      validateDocument(fresh);
      await this.#writeNewPrimary(fresh);
      this.document = fresh;
      return;
    }

    const loaded = await this.#readAndMigrate(this.statePath);
    this.document = loaded.document;
    if (loaded.applied.length > 0) await this.#commit(this.document);
  }

  #timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  async #exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async #readAndMigrate(filePath) {
    let source;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw new StorageCorruptionError('Existing local data could not be read safely.', { cause: error });
    }

    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new StorageCorruptionError('Existing local data is not valid JSON and was preserved.', { cause: error });
    }

    try {
      return runMigrations(parsed);
    } catch (error) {
      if (error instanceof UnsupportedSchemaError || error instanceof TypeError) {
        throw new StorageCorruptionError('Existing local data failed schema validation and was preserved.', { cause: error });
      }
      throw error;
    }
  }

  async #writeNewPrimary(document) {
    const tempPath = `${this.statePath}.staging-${process.pid}-${randomUUID()}`;
    await this.#writeSyncedFile(tempPath, document);
    try {
      await this.faultInjector('after-staging-sync');
      await fs.rename(tempPath, this.statePath);
      await syncDirectory(this.rootDirectory);
      await this.#verifyPrimary(document.revision);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async #writeSyncedFile(filePath, document) {
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    const handle = await fs.open(filePath, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #verifyPrimary(expectedRevision) {
    const verified = await this.#readAndMigrate(this.statePath);
    if (verified.document.revision !== expectedRevision) {
      throw new StorageCorruptionError('Committed local data could not be verified safely.');
    }
  }

  async #commit(candidate) {
    validateDocument(candidate);
    const tempPath = `${this.statePath}.staging-${process.pid}-${randomUUID()}`;
    await this.#writeSyncedFile(tempPath, candidate);

    let primaryMoved = false;
    try {
      await this.faultInjector('after-staging-sync');
      await fs.rm(this.previousStatePath, { force: true });
      await fs.rename(this.statePath, this.previousStatePath);
      primaryMoved = true;
      await syncDirectory(this.rootDirectory);
      await this.faultInjector('after-primary-moved-to-previous');
      await fs.rename(tempPath, this.statePath);
      await syncDirectory(this.rootDirectory);
      await this.#verifyPrimary(candidate.revision);
      this.document = candidate;
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      if (primaryMoved && (await this.#exists(this.previousStatePath))) {
        await fs.rm(this.statePath, { force: true }).catch(() => {});
        await fs.rename(this.previousStatePath, this.statePath).catch(() => {});
        await syncDirectory(this.rootDirectory).catch(() => {});
      }
      throw error;
    }
  }

  #enqueueMutation(operation) {
    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.catch(() => {});
    return queued;
  }

  #assertExpectedRevision(expectedRevision) {
    if (this.document.revision !== expectedRevision) throw new StorageConflictError();
  }

  getStorageSummary() {
    return Object.freeze({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: this.document.revision,
      storageKind: 'local-json',
      location: 'per-user-application-data'
    });
  }

  async readApplicationState() {
    return clone({ revision: this.document.revision, ...this.document.application });
  }

  async updateApplicationState(request) {
    validateApplicationUpdateRequest(request);
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(request.expectedRevision);
      const candidate = clone(this.document);
      candidate.application = { ...candidate.application, ...clone(request.patch) };
      const knownIds = new Set(Object.keys(candidate.projects));
      if (candidate.application.selectedProjectId && !knownIds.has(candidate.application.selectedProjectId)) {
        throw new TypeError('selectedProjectId does not reference an existing project.');
      }
      for (const projectId of candidate.application.recentProjectIds) {
        if (!knownIds.has(projectId)) throw new TypeError('recentProjectIds contains an unknown project.');
      }
      candidate.revision += 1;
      candidate.updatedAt = this.#timestamp();
      validateDocument(candidate);
      await this.#commit(candidate);
      return this.readApplicationState();
    });
  }

  async createProject(request) {
    validateCreateProjectRequest(request);
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(request.expectedRevision);
      let id;
      for (let attempts = 0; attempts < 8; attempts += 1) {
        id = this.idFactory();
        if (!(id in this.document.projects)) break;
        id = null;
      }
      if (!id) throw new LocalDataError('PROJECT_ID_COLLISION', 'Could not allocate a unique project id.');

      const timestamp = this.#timestamp();
      const project = {
        id,
        schemaVersion: PROJECT_SCHEMA_VERSION,
        title: request.title,
        status: 'draft',
        mediaIds: clone(request.mediaIds ?? []),
        extensions: clone(request.extensions ?? {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 0
      };

      const candidate = clone(this.document);
      candidate.projects[id] = project;
      candidate.application.selectedProjectId = id;
      candidate.application.recentProjectIds = [
        id,
        ...candidate.application.recentProjectIds.filter((projectId) => projectId !== id)
      ].slice(0, 50);
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      validateDocument(candidate);
      await this.#commit(candidate);
      return clone({ storeRevision: candidate.revision, project });
    });
  }

  async readProject(request) {
    validateProjectReadRequest(request);
    const project = this.document.projects[request.projectId];
    if (!project) throw new StorageNotFoundError();
    return clone({ storeRevision: this.document.revision, project });
  }

  async updateProject(request) {
    validateUpdateProjectRequest(request);
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(request.expectedRevision);
      const existing = this.document.projects[request.projectId];
      if (!existing) throw new StorageNotFoundError();
      if (existing.status === 'archived') throw new LocalDataError('PROJECT_ARCHIVED', 'Archived projects cannot be edited.');

      const timestamp = this.#timestamp();
      const candidate = clone(this.document);
      candidate.projects[request.projectId] = {
        ...existing,
        ...clone(request.patch),
        updatedAt: timestamp,
        revision: existing.revision + 1
      };
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      validateDocument(candidate);
      await this.#commit(candidate);
      return clone({ storeRevision: candidate.revision, project: candidate.projects[request.projectId] });
    });
  }

  async listProjects() {
    return clone({
      storeRevision: this.document.revision,
      projects: Object.values(this.document.projects)
        .map((project) => ({
          id: project.id,
          title: project.title,
          status: project.status,
          updatedAt: project.updatedAt,
          revision: project.revision,
          mediaCount: project.mediaIds.length
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    });
  }

  async archiveProject(request) {
    validateArchiveProjectRequest(request);
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(request.expectedRevision);
      const existing = this.document.projects[request.projectId];
      if (!existing) throw new StorageNotFoundError();
      if (existing.status === 'archived') {
        return clone({ storeRevision: this.document.revision, project: existing });
      }

      const timestamp = this.#timestamp();
      const candidate = clone(this.document);
      candidate.projects[request.projectId] = {
        ...existing,
        status: 'archived',
        updatedAt: timestamp,
        revision: existing.revision + 1
      };
      if (candidate.application.selectedProjectId === request.projectId) {
        candidate.application.selectedProjectId = null;
      }
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      validateDocument(candidate);
      await this.#commit(candidate);
      return clone({ storeRevision: candidate.revision, project: candidate.projects[request.projectId] });
    });
  }

  async findMediaByHash(sha256) {
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new TypeError('sha256 is invalid.');
    }
    const media = Object.values(this.document.media ?? {}).find((item) => item.sha256 === sha256);
    return media ? clone(media) : null;
  }

  async getMediaRecord(mediaId) {
    assertManagedMediaId(mediaId);
    const media = (this.document.media ?? {})[mediaId];
    if (!media) throw new LocalDataError('MEDIA_NOT_FOUND', 'The requested media item does not exist.');
    return clone({ storeRevision: this.document.revision, media });
  }

  async listMedia() {
    return clone({
      storeRevision: this.document.revision,
      media: Object.values(this.document.media ?? {})
        .map(({ id, kind, originalFilename, fileSize, importedAt, width, height, durationSeconds, availability }) => ({
          id,
          kind,
          originalFilename,
          fileSize,
          importedAt,
          width,
          height,
          durationSeconds,
          availability
        }))
        .sort((left, right) => right.importedAt.localeCompare(left.importedAt) || left.id.localeCompare(right.id))
    });
  }

  async createMediaRecord({ expectedRevision, media }) {
    assertRevision(expectedRevision, 'expectedRevision');
    validateMediaRecord(media);
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(expectedRevision);
      if ((this.document.media ?? {})[media.id]) {
        throw new LocalDataError('MEDIA_ID_COLLISION', 'Media id already exists.');
      }
      const duplicate = Object.values(this.document.media ?? {}).find((item) => item.sha256 === media.sha256);
      if (duplicate) throw new LocalDataError('MEDIA_DUPLICATE', 'Identical media already exists.');

      const candidate = clone(this.document);
      candidate.media ??= {};
      candidate.media[media.id] = clone(media);
      candidate.revision += 1;
      candidate.updatedAt = this.#timestamp();
      validateDocument(candidate);
      await this.#commit(candidate);
      return clone({ storeRevision: candidate.revision, media: candidate.media[media.id] });
    });
  }

  async attachMediaToProject({ projectId, mediaId, expectedRevision }) {
    assertProjectId(projectId);
    assertManagedMediaId(mediaId);
    assertRevision(expectedRevision, 'expectedRevision');
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(expectedRevision);
      const project = this.document.projects[projectId];
      if (!project) throw new StorageNotFoundError();
      if (project.status === 'archived') throw new LocalDataError('PROJECT_ARCHIVED', 'Archived projects cannot be edited.');
      if (!(this.document.media ?? {})[mediaId]) {
        throw new LocalDataError('MEDIA_NOT_FOUND', 'The requested media item does not exist.');
      }
      if (project.mediaIds.includes(mediaId)) {
        return clone({ storeRevision: this.document.revision, project });
      }

      const timestamp = this.#timestamp();
      const candidate = clone(this.document);
      candidate.projects[projectId] = {
        ...project,
        mediaIds: [...project.mediaIds, mediaId],
        updatedAt: timestamp,
        revision: project.revision + 1
      };
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      validateDocument(candidate);
      await this.#commit(candidate);
      return clone({ storeRevision: candidate.revision, project: candidate.projects[projectId] });
    });
  }

  async detachMediaFromProject({ projectId, mediaId, expectedRevision }) {
    assertProjectId(projectId);
    assertManagedMediaId(mediaId);
    assertRevision(expectedRevision, 'expectedRevision');
    return this.#enqueueMutation(async () => {
      this.#assertExpectedRevision(expectedRevision);
      const project = this.document.projects[projectId];
      if (!project) throw new StorageNotFoundError();
      if (project.status === 'archived') throw new LocalDataError('PROJECT_ARCHIVED', 'Archived projects cannot be edited.');
      if (!project.mediaIds.includes(mediaId)) {
        return clone({ storeRevision: this.document.revision, project });
      }

      const timestamp = this.#timestamp();
      const candidate = clone(this.document);
      candidate.projects[projectId] = {
        ...project,
        mediaIds: project.mediaIds.filter((id) => id !== mediaId),
        updatedAt: timestamp,
        revision: project.revision + 1
      };
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      validateDocument(candidate);
      await this.#commit(candidate);
      return clone({ storeRevision: candidate.revision, project: candidate.projects[projectId] });
    });
  }
}

module.exports = {
  LocalDataError,
  LocalDataRepository,
  StorageConflictError,
  StorageCorruptionError,
  StorageNotFoundError,
  createFreshDocument
};

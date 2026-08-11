'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  SECRET_STORE_SCHEMA_VERSION,
  assertSecretId,
  toSecretMetadata,
  validateCreateSecretRequest,
  validateReplaceSecretRequest,
  validateSecretStoreDocument
} = require('./secret-contracts.cjs');

class SecretStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'SecretStoreError';
    this.code = code;
  }
}

function clone(value) {
  return structuredClone(value);
}

function isPathInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
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

class ProtectedSecretStore {
  static async open(options) {
    const store = new ProtectedSecretStore(options);
    await store.#initialise();
    return store;
  }

  constructor({
    rootDirectory,
    applicationRootDirectory = null,
    safeStorage,
    now = () => new Date(),
    idFactory = randomUUID,
    faultInjector = () => {}
  } = {}) {
    if (typeof rootDirectory !== 'string' || rootDirectory.length === 0 || !path.isAbsolute(rootDirectory)) {
      throw new TypeError('rootDirectory must be an absolute trusted path.');
    }
    if (applicationRootDirectory !== null) {
      if (typeof applicationRootDirectory !== 'string' || !path.isAbsolute(applicationRootDirectory)) {
        throw new TypeError('applicationRootDirectory must be an absolute trusted path when supplied.');
      }
      if (isPathInside(rootDirectory, applicationRootDirectory)) {
        throw new TypeError('Protected credentials must be stored outside the application/source tree.');
      }
    }
    if (
      !safeStorage ||
      (typeof safeStorage.isAsyncEncryptionAvailable !== 'function' && typeof safeStorage.isEncryptionAvailable !== 'function') ||
      (typeof safeStorage.encryptStringAsync !== 'function' && typeof safeStorage.encryptString !== 'function') ||
      (typeof safeStorage.decryptStringAsync !== 'function' && typeof safeStorage.decryptString !== 'function')
    ) {
      throw new TypeError('safeStorage must provide the Electron protected-storage interface.');
    }
    if (typeof now !== 'function' || typeof idFactory !== 'function' || typeof faultInjector !== 'function') {
      throw new TypeError('Invalid secret-store dependency injection.');
    }

    this.rootDirectory = path.resolve(rootDirectory);
    this.storePath = path.join(this.rootDirectory, 'credential-store.json');
    this.previousStorePath = path.join(this.rootDirectory, 'credential-store.previous.json');
    this.safeStorage = safeStorage;
    this.now = now;
    this.idFactory = idFactory;
    this.faultInjector = faultInjector;
    this.document = null;
    this.capabilityState = 'failed';
    this.writeQueue = Promise.resolve();
  }

  #timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  #freshDocument() {
    const timestamp = this.#timestamp();
    return {
      schemaVersion: SECRET_STORE_SCHEMA_VERSION,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      records: {}
    };
  }

  async #initialise() {
    try {
      await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
      if (await this.#exists(this.storePath)) {
        this.document = await this.#readDocument(this.storePath);
      } else if (await this.#exists(this.previousStorePath)) {
        this.document = await this.#readDocument(this.previousStorePath);
      } else {
        this.document = this.#freshDocument();
      }

      let available = false;
      try {
        if (typeof this.safeStorage.getSelectedStorageBackend === 'function') {
          const backend = this.safeStorage.getSelectedStorageBackend();
          if (backend === 'basic_text') {
            this.capabilityState = 'unavailable';
            return;
          }
        }
        available = typeof this.safeStorage.isAsyncEncryptionAvailable === 'function'
          ? await this.safeStorage.isAsyncEncryptionAvailable() === true
          : this.safeStorage.isEncryptionAvailable() === true;
      } catch {
        this.capabilityState = 'failed';
        return;
      }
      this.capabilityState = available ? 'available' : 'unavailable';
    } catch {
      this.document = null;
      this.capabilityState = 'failed';
    }
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

  async #readDocument(filePath) {
    let source;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw new SecretStoreError('SECRET_STORE_CORRUPT', 'Protected credential metadata could not be read.', { cause: error });
    }
    let parsed;
    try {
      parsed = JSON.parse(source);
      validateSecretStoreDocument(parsed);
    } catch (error) {
      throw new SecretStoreError('SECRET_STORE_CORRUPT', 'Protected credential metadata failed validation.', { cause: error });
    }
    return parsed;
  }

  #assertAvailable() {
    if (this.capabilityState === 'unavailable') {
      throw new SecretStoreError('SECRET_STORAGE_UNAVAILABLE', 'Protected credential storage is unavailable.');
    }
    if (this.capabilityState !== 'available' || !this.document) {
      throw new SecretStoreError('SECRET_STORAGE_FAILED', 'Protected credential storage is not ready.');
    }
  }

  async #encrypt(value) {
    this.#assertAvailable();
    try {
      const encrypted = typeof this.safeStorage.encryptStringAsync === 'function'
        ? await this.safeStorage.encryptStringAsync(value)
        : this.safeStorage.encryptString(value);
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new TypeError('safeStorage returned invalid protected bytes.');
      return encrypted.toString('base64');
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError('SECRET_PROTECTION_FAILED', 'Credential protection failed.', { cause: error });
    }
  }

  async #decrypt(protectedPayload) {
    this.#assertAvailable();
    try {
      const encrypted = Buffer.from(protectedPayload, 'base64');
      const decrypted = typeof this.safeStorage.decryptStringAsync === 'function'
        ? await this.safeStorage.decryptStringAsync(encrypted)
        : this.safeStorage.decryptString(encrypted);
      const value = typeof decrypted === 'string' ? decrypted : decrypted?.result;
      if (typeof value !== 'string' || value.length === 0) throw new TypeError('safeStorage returned an invalid credential.');
      return value;
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError('SECRET_DECRYPTION_FAILED', 'Credential decryption failed.', { cause: error });
    }
  }

  async #writeSyncedFile(filePath, document) {
    const handle = await fs.open(filePath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #verifyPrimary(expectedRevision) {
    const verified = await this.#readDocument(this.storePath);
    if (verified.revision !== expectedRevision) {
      throw new SecretStoreError('SECRET_STORE_CORRUPT', 'Committed protected credential metadata could not be verified.');
    }
  }

  async #commit(candidate) {
    validateSecretStoreDocument(candidate);
    const stagingPath = `${this.storePath}.staging-${process.pid}-${randomUUID()}`;
    await this.#writeSyncedFile(stagingPath, candidate);

    const hadPrimary = await this.#exists(this.storePath);
    let primaryMoved = false;
    try {
      await this.faultInjector('after-staging-sync');
      if (hadPrimary) {
        await fs.rm(this.previousStorePath, { force: true });
        await fs.rename(this.storePath, this.previousStorePath);
        primaryMoved = true;
        await syncDirectory(this.rootDirectory);
        await this.faultInjector('after-primary-moved-to-previous');
      }
      await fs.rename(stagingPath, this.storePath);
      await syncDirectory(this.rootDirectory);
      await this.#verifyPrimary(candidate.revision);
      this.document = candidate;
    } catch (error) {
      await fs.rm(stagingPath, { force: true }).catch(() => {});
      if (primaryMoved && (await this.#exists(this.previousStorePath))) {
        await fs.rm(this.storePath, { force: true }).catch(() => {});
        await fs.rename(this.previousStorePath, this.storePath).catch(() => {});
        await syncDirectory(this.rootDirectory).catch(() => {});
      } else if (!hadPrimary) {
        await fs.rm(this.storePath, { force: true }).catch(() => {});
      }
      throw error;
    }
  }

  #enqueueMutation(operation) {
    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.catch(() => {});
    return queued;
  }

  getStatus() {
    return Object.freeze({
      state: this.capabilityState,
      storageKind: 'electron-safe-storage',
      schemaVersion: SECRET_STORE_SCHEMA_VERSION,
      location: 'per-user-protected-application-data',
      recordCount: this.document ? Object.keys(this.document.records).length : 0
    });
  }

  async createSecret(request) {
    validateCreateSecretRequest(request);
    return this.#enqueueMutation(async () => {
      this.#assertAvailable();
      let id;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        id = this.idFactory();
        if (!(id in this.document.records)) break;
        id = null;
      }
      if (!id) throw new SecretStoreError('SECRET_ID_COLLISION', 'Could not allocate a unique credential identifier.');

      const timestamp = this.#timestamp();
      const record = {
        id,
        provider: request.provider,
        accountRefId: request.accountRefId ?? null,
        kind: request.kind,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: request.expiresAt ?? null,
        protectedPayload: await this.#encrypt(request.value)
      };
      const candidate = clone(this.document);
      candidate.records[id] = record;
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      await this.#commit(candidate);
      return toSecretMetadata(record);
    });
  }

  async replaceSecret(request) {
    validateReplaceSecretRequest(request);
    return this.#enqueueMutation(async () => {
      this.#assertAvailable();
      const existing = this.document.records[request.secretId];
      if (!existing) throw new SecretStoreError('SECRET_NOT_FOUND', 'Credential does not exist.');

      const protectedPayload = await this.#encrypt(request.value);
      const timestamp = this.#timestamp();
      const candidate = clone(this.document);
      candidate.records[request.secretId] = {
        ...existing,
        protectedPayload,
        expiresAt: 'expiresAt' in request ? request.expiresAt : existing.expiresAt,
        updatedAt: timestamp
      };
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      await this.#commit(candidate);
      return toSecretMetadata(candidate.records[request.secretId]);
    });
  }

  async readSecret(secretId) {
    assertSecretId(secretId);
    this.#assertAvailable();
    const record = this.document.records[secretId];
    if (!record) throw new SecretStoreError('SECRET_NOT_FOUND', 'Credential does not exist.');
    return this.#decrypt(record.protectedPayload);
  }

  async withSecret(secretId, operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function.');
    const value = await this.readSecret(secretId);
    return operation(value);
  }

  async hasSecret(secretId) {
    assertSecretId(secretId);
    return Boolean(this.document?.records?.[secretId]);
  }

  async getSecretMetadata(secretId) {
    assertSecretId(secretId);
    const record = this.document?.records?.[secretId];
    if (!record) return null;
    return toSecretMetadata(record);
  }

  async deleteSecret(secretId) {
    assertSecretId(secretId);
    return this.#enqueueMutation(async () => {
      if (this.capabilityState === 'failed' || !this.document) {
        throw new SecretStoreError('SECRET_STORAGE_FAILED', 'Protected credential storage is not ready.');
      }
      if (!this.document.records[secretId]) return Object.freeze({ secretId, deleted: false });
      const candidate = clone(this.document);
      delete candidate.records[secretId];
      candidate.revision += 1;
      candidate.updatedAt = this.#timestamp();
      await this.#commit(candidate);
      return Object.freeze({ secretId, deleted: true });
    });
  }
}

module.exports = {
  ProtectedSecretStore,
  SecretStoreError,
  isPathInside
};

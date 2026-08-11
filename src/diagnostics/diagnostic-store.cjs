'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  DIAGNOSTIC_SCHEMA_VERSION,
  createDiagnosticEvent,
  validateDiagnosticDocument
} = require('./diagnostic-contracts.cjs');

function clone(value) {
  return structuredClone(value);
}

function createEmptyDocument() {
  return { schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, events: [] };
}

class DiagnosticStore {
  static async open(options) {
    const store = new DiagnosticStore(options);
    await store.#initialise();
    return store;
  }

  constructor({
    rootDirectory,
    applicationVersion,
    now = () => new Date(),
    retentionDays = 7,
    maxEvents = 250
  } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) {
      throw new TypeError('diagnostic rootDirectory must be an absolute trusted path.');
    }
    if (typeof applicationVersion !== 'string' || applicationVersion.length === 0 || applicationVersion.length > 64) {
      throw new TypeError('diagnostic applicationVersion is invalid.');
    }
    if (typeof now !== 'function') throw new TypeError('diagnostic clock must be a function.');
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      throw new TypeError('diagnostic retentionDays is invalid.');
    }
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 25 || maxEvents > 1000) {
      throw new TypeError('diagnostic maxEvents is invalid.');
    }

    this.rootDirectory = path.resolve(rootDirectory);
    this.filePath = path.join(this.rootDirectory, 'events.json');
    this.applicationVersion = applicationVersion;
    this.now = now;
    this.retentionDays = retentionDays;
    this.maxEvents = maxEvents;
    this.available = true;
    this.document = createEmptyDocument();
    this.writeQueue = Promise.resolve();
  }

  async #initialise() {
    try {
      await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
      let raw;
      try {
        raw = await fs.readFile(this.filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          await this.#writeDocument(this.document);
          return;
        }
        throw error;
      }

      try {
        const parsed = JSON.parse(raw);
        validateDiagnosticDocument(parsed);
        this.document = this.#prune(parsed);
      } catch {
        const quarantine = path.join(this.rootDirectory, `events.corrupt-${Date.now()}.json`);
        await fs.rename(this.filePath, quarantine).catch(() => {});
        this.document = createEmptyDocument();
        await this.#writeDocument(this.document).catch(() => {});
      }
    } catch {
      this.available = false;
      this.document = createEmptyDocument();
    }
  }

  #timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('diagnostic clock returned an invalid date.');
    return value;
  }

  #prune(document) {
    const cutoff = this.#timestamp().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    const events = document.events
      .filter((event) => Date.parse(event.timestamp) >= cutoff)
      .slice(-this.maxEvents);
    return { schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, events };
  }

  async #writeDocument(document) {
    validateDiagnosticDocument(document);
    const tempPath = `${this.filePath}.staging-${process.pid}-${randomUUID()}`;
    const handle = await fs.open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  #enqueue(operation) {
    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.catch(() => {});
    return queued;
  }

  configureRetention({ retentionDays, maxEvents } = {}) {
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      throw new TypeError('diagnostic retentionDays is invalid.');
    }
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 25 || maxEvents > 1000) {
      throw new TypeError('diagnostic maxEvents is invalid.');
    }
    this.retentionDays = retentionDays;
    this.maxEvents = maxEvents;
  }

  getStatus() {
    return Object.freeze({
      available: this.available,
      retentionDays: this.retentionDays,
      maxEvents: this.maxEvents,
      eventCount: this.document.events.length,
      location: 'per-user-application-data/diagnostics'
    });
  }

  async append(input, { enabled = true } = {}) {
    if (!enabled || !this.available) return false;
    const event = createDiagnosticEvent(input, {
      applicationVersion: this.applicationVersion,
      now: this.now
    });
    return this.#enqueue(async () => {
      const candidate = this.#prune({
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        events: [...this.document.events, clone(event)]
      });
      try {
        await this.#writeDocument(candidate);
        this.document = candidate;
        return true;
      } catch {
        this.available = false;
        return false;
      }
    });
  }

  async list() {
    const document = this.#prune(this.document);
    this.document = document;
    return Object.freeze({
      ...this.getStatus(),
      events: Object.freeze(clone(document.events).reverse())
    });
  }

  async clear() {
    if (!this.available) {
      this.document = createEmptyDocument();
      return this.getStatus();
    }
    return this.#enqueue(async () => {
      const empty = createEmptyDocument();
      try {
        await this.#writeDocument(empty);
        this.document = empty;
      } catch {
        this.available = false;
        this.document = empty;
      }
      return this.getStatus();
    });
  }

  async exportTo(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') {
      throw new TypeError('diagnostic export path must be an absolute JSON file selected by the application.');
    }
    const snapshot = await this.list();
    const payload = {
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      product: 'SwayForge',
      privacyNotice: 'Local structural diagnostics only. No prompts, model responses, credentials, creator content, raw media, or private source paths are included.',
      retention: {
        days: this.retentionDays,
        maxEvents: this.maxEvents
      },
      events: snapshot.events
    };
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return Object.freeze({ exportedEvents: snapshot.events.length, fileName: path.basename(filePath) });
  }
}

module.exports = { DiagnosticStore, createEmptyDocument };

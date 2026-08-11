'use strict';

const {
  APPLICATION_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  isPlainObject,
  validateDocument
} = require('./storage-contracts.cjs');

class UnsupportedSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedSchemaError';
    this.code = 'UNSUPPORTED_SCHEMA';
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function migrateZeroToOne(source) {
  if (!isPlainObject(source) || source.schemaVersion !== 0) {
    throw new UnsupportedSchemaError('Migration input is not schema version 0.');
  }

  const now = typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString();
  const createdAt = typeof source.createdAt === 'string' ? source.createdAt : now;
  const legacyApplication = isPlainObject(source.application) ? source.application : {};
  const legacyProjects = isPlainObject(source.projects) ? source.projects : {};
  const projects = {};

  for (const [id, legacyProject] of Object.entries(legacyProjects)) {
    if (!isPlainObject(legacyProject)) throw new UnsupportedSchemaError('Legacy project is structurally invalid.');
    projects[id] = {
      id,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      title: legacyProject.title,
      status: legacyProject.status === 'archived' ? 'archived' : 'draft',
      mediaIds: Array.isArray(legacyProject.mediaIds) ? legacyProject.mediaIds : [],
      extensions: isPlainObject(legacyProject.extensions) ? legacyProject.extensions : {},
      createdAt: typeof legacyProject.createdAt === 'string' ? legacyProject.createdAt : createdAt,
      updatedAt: typeof legacyProject.updatedAt === 'string' ? legacyProject.updatedAt : now,
      revision: Number.isSafeInteger(legacyProject.revision) && legacyProject.revision >= 0 ? legacyProject.revision : 0
    };
  }

  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    createdAt,
    updatedAt: now,
    application: {
      schemaVersion: APPLICATION_SCHEMA_VERSION,
      settings: isPlainObject(legacyApplication.settings) ? legacyApplication.settings : {},
      selectedProjectId: legacyApplication.selectedProjectId ?? null,
      recentProjectIds: Array.isArray(legacyApplication.recentProjectIds) ? legacyApplication.recentProjectIds : []
    },
    projects
  };
}

const MIGRATIONS = new Map([[0, migrateZeroToOne]]);

function runMigrations(input) {
  if (!isPlainObject(input) || !Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 0) {
    throw new UnsupportedSchemaError('Store schema version is missing or invalid.');
  }
  if (input.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaError('Store schema version is newer than this application supports.');
  }

  let current = cloneJson(input);
  const applied = [];
  while (current.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.get(current.schemaVersion);
    if (!migration) throw new UnsupportedSchemaError('No safe migration is available for this store schema.');
    const from = current.schemaVersion;
    current = migration(current);
    if (current.schemaVersion <= from) throw new UnsupportedSchemaError('Migration did not advance the schema version.');
    applied.push(`${from}->${current.schemaVersion}`);
  }

  validateDocument(current);
  return Object.freeze({ document: current, applied: Object.freeze(applied) });
}

module.exports = {
  MIGRATIONS,
  UnsupportedSchemaError,
  migrateZeroToOne,
  runMigrations
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  CURRENT_SCHEMA_VERSION,
  STORAGE_IPC_CHANNELS,
  validateCreateProjectRequest
} = require('../src/storage/storage-contracts.cjs');
const { runMigrations } = require('../src/storage/migrations.cjs');
const {
  LocalDataRepository,
  StorageConflictError,
  StorageCorruptionError
} = require('../src/storage/local-data-repository.cjs');

const PROJECT_ID_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID_B = '22222222-2222-4222-8222-222222222222';

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swayforge-storage-'));
}

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 11, 12, 0, tick++));
}

async function openRepository(root, options = {}) {
  return LocalDataRepository.open({ rootDirectory: root, now: fixedClock(), ...options });
}

async function readStore(root) {
  return JSON.parse(await fsp.readFile(path.join(root, 'workspace.json'), 'utf8'));
}

test('fresh store initialises once with explicit schema metadata outside the repository', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = await openRepository(root);
  const initial = await readStore(root);
  assert.equal(initial.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.projects, {});
  assert.equal(initial.application.schemaVersion, 1);
  assert.equal(repository.getStorageSummary().location, 'per-user-application-data');
  assert.equal(root.startsWith(path.resolve(__dirname, '..')), false);

  const before = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  await openRepository(root);
  const after = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  assert.equal(after, before);
});

test('application state persists and reloads using optimistic store revisions', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = await openRepository(root);
  const updated = await repository.updateApplicationState({
    expectedRevision: 0,
    patch: { settings: { appearance: 'dark', compactMode: true } }
  });
  assert.equal(updated.revision, 1);
  const reopened = await openRepository(root);
  const state = await reopened.readApplicationState();
  assert.deepEqual(state.settings, { appearance: 'dark', compactMode: true });
  assert.equal(state.revision, 1);
});

test('project create read update list and archive use stable unique identities', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = [PROJECT_ID_A, PROJECT_ID_B];
  const repository = await openRepository(root, { idFactory: () => ids.shift() });

  const first = await repository.createProject({
    expectedRevision: 0,
    title: 'Launch teaser',
    mediaIds: ['media:alpha'],
    extensions: { brief: { format: 'short-form' } }
  });
  assert.equal(first.project.id, PROJECT_ID_A);
  assert.equal(first.project.status, 'draft');
  assert.equal(first.project.schemaVersion, 1);

  const second = await repository.createProject({ expectedRevision: 1, title: 'Behind the scenes' });
  assert.equal(second.project.id, PROJECT_ID_B);
  assert.notEqual(first.project.id, second.project.id);

  const edited = await repository.updateProject({
    projectId: PROJECT_ID_A,
    expectedRevision: 2,
    patch: { title: 'Launch teaser revised', mediaIds: ['media:alpha', 'media:beta'] }
  });
  assert.equal(edited.project.title, 'Launch teaser revised');
  assert.equal(edited.project.revision, 1);

  const read = await repository.readProject({ projectId: PROJECT_ID_A });
  assert.deepEqual(read.project.mediaIds, ['media:alpha', 'media:beta']);
  const listed = await repository.listProjects();
  assert.equal(listed.projects.length, 2);
  assert.equal(listed.projects.find((project) => project.id === PROJECT_ID_A).mediaCount, 2);

  const archived = await repository.archiveProject({ projectId: PROJECT_ID_A, expectedRevision: 3 });
  assert.equal(archived.project.status, 'archived');
  await assert.rejects(
    repository.updateProject({ projectId: PROJECT_ID_A, expectedRevision: 4, patch: { title: 'Nope' } }),
    (error) => error.code === 'PROJECT_ARCHIVED'
  );
});

test('invalid project and application payloads are rejected before persistence', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = await openRepository(root, { idFactory: () => PROJECT_ID_A });

  await assert.rejects(
    repository.createProject({ expectedRevision: 0, title: '', mediaIds: [] }),
    TypeError
  );
  await assert.rejects(
    repository.createProject({ expectedRevision: 0, title: 'Unsafe', extensions: { accessToken: 'fictional' } }),
    TypeError
  );
  await assert.rejects(
    repository.createProject({ expectedRevision: 0, title: 'Binary', extensions: { payload: Buffer.from('not-media') } }),
    TypeError
  );
  await assert.rejects(
    repository.updateApplicationState({ expectedRevision: 0, patch: { settings: { refreshToken: 'fictional' } } }),
    TypeError
  );
  await assert.rejects(repository.readProject({ projectId: '../workspace.json' }), TypeError);
  assert.equal((await readStore(root)).revision, 0);
});

test('staged-write failure preserves the previous authoritative state', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let armed = false;
  const repository = await openRepository(root, {
    idFactory: () => PROJECT_ID_A,
    faultInjector: (stage) => {
      if (armed && stage === 'after-staging-sync') throw new Error('synthetic interruption');
    }
  });
  const before = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  armed = true;
  await assert.rejects(
    repository.createProject({ expectedRevision: 0, title: 'Interrupted save' }),
    /synthetic interruption/
  );
  const after = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  assert.equal(after, before);
  const reopened = await openRepository(root);
  assert.equal((await reopened.listProjects()).projects.length, 0);
});

test('interruption after moving primary to previous restores the prior valid state', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let armed = false;
  const repository = await openRepository(root, {
    idFactory: () => PROJECT_ID_A,
    faultInjector: (stage) => {
      if (armed && stage === 'after-primary-moved-to-previous') throw new Error('synthetic rename interruption');
    }
  });
  const before = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  armed = true;
  await assert.rejects(
    repository.createProject({ expectedRevision: 0, title: 'Interrupted rename' }),
    /synthetic rename interruption/
  );
  const after = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  assert.equal(after, before);
});

test('unreadable existing state is distinguished from a fresh install and never blanked', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const corrupt = '{"schemaVersion":1,"projects":';
  await fsp.writeFile(path.join(root, 'workspace.json'), corrupt, 'utf8');
  await assert.rejects(openRepository(root), StorageCorruptionError);
  assert.equal(await fsp.readFile(path.join(root, 'workspace.json'), 'utf8'), corrupt);
});

test('stale revision conflicts fail instead of overwriting newer state', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = await openRepository(root);
  await repository.updateApplicationState({ expectedRevision: 0, patch: { settings: { theme: 'dark' } } });
  await assert.rejects(
    repository.updateApplicationState({ expectedRevision: 0, patch: { settings: { theme: 'light' } } }),
    StorageConflictError
  );
  assert.deepEqual((await repository.readApplicationState()).settings, { theme: 'dark' });
});

test('migration runner advances schema zero deterministically and is not repeated on reopen', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = {
    schemaVersion: 0,
    revision: 4,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:30:00.000Z',
    application: { settings: { appearance: 'system' }, selectedProjectId: PROJECT_ID_A, recentProjectIds: [PROJECT_ID_A] },
    projects: {
      [PROJECT_ID_A]: {
        title: 'Legacy synthetic project',
        mediaIds: ['media:legacy'],
        createdAt: '2026-08-11T10:05:00.000Z',
        updatedAt: '2026-08-11T10:20:00.000Z'
      }
    }
  };
  const migrated = runMigrations(legacy);
  assert.deepEqual(migrated.applied, ['0->1']);
  assert.equal(migrated.document.schemaVersion, 1);

  await fsp.writeFile(path.join(root, 'workspace.json'), `${JSON.stringify(legacy)}\n`, 'utf8');
  const repository = await openRepository(root);
  assert.equal((await repository.readProject({ projectId: PROJECT_ID_A })).project.schemaVersion, 1);
  const firstReopenBytes = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  await openRepository(root);
  const secondReopenBytes = await fsp.readFile(path.join(root, 'workspace.json'), 'utf8');
  assert.equal(secondReopenBytes, firstReopenBytes);
});

test('successful commit retains the previous valid generation', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = await openRepository(root);
  await repository.updateApplicationState({ expectedRevision: 0, patch: { settings: { appearance: 'light' } } });
  const current = await readStore(root);
  const previous = JSON.parse(await fsp.readFile(path.join(root, 'workspace.previous.json'), 'utf8'));
  assert.equal(current.revision, 1);
  assert.equal(previous.revision, 0);
});

test('storage IPC surface is named and does not expose filesystem/query primitives', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src/preload/preload-bridge.cjs'), 'utf8');
  for (const channel of Object.values(STORAGE_IPC_CHANNELS)) assert.match(preload, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const capability of ['getApplicationState', 'updateApplicationState', 'createProject', 'getProject', 'updateProject', 'listProjects', 'archiveProject']) {
    assert.match(preload, new RegExp(`${capability}:`));
  }
  assert.doesNotMatch(preload, /readFile|writeFile|query\s*:|execute\s*:|filesystem|rootDirectory/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/main/main-process.cjs'), 'utf8');
  assert.match(main, /app\.getPath\('userData'\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\([^\n]*=>\s*fs\./);
});

test('ordinary schema excludes credential and raw-media fields by contract', () => {
  assert.throws(
    () => validateCreateProjectRequest({ expectedRevision: 0, title: 'Synthetic', extensions: { clientSecret: 'fictional' } }),
    /secret or binary-media/
  );
  assert.throws(
    () => validateCreateProjectRequest({ expectedRevision: 0, title: 'Synthetic', extensions: { mediaBytes: 'AAAA' } }),
    /secret or binary-media/
  );
});

test('archive is explicit and malformed identifiers cannot trigger it', async (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = await openRepository(root, { idFactory: () => PROJECT_ID_A });
  await repository.createProject({ expectedRevision: 0, title: 'Archive me' });
  await assert.rejects(repository.archiveProject({ projectId: '../../etc/passwd', expectedRevision: 1 }), TypeError);
  const before = await repository.readProject({ projectId: PROJECT_ID_A });
  assert.equal(before.project.status, 'draft');
  const after = await repository.archiveProject({ projectId: PROJECT_ID_A, expectedRevision: 1 });
  assert.equal(after.project.status, 'archived');
});

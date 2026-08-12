'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MediaIndexService } = require('../src/media/media-index-service.cjs');
const { validateMediaIndexSearchRequest, MEDIA_INDEX_SCHEMA_VERSION } = require('../src/media/media-index-contracts.cjs');

function media(id, name, overrides = {}) {
  return {
    id,
    kind: 'video',
    originalFilename: name,
    fileSize: 100,
    importedAt: '2026-08-12T10:00:00.000Z',
    width: 1920,
    height: 1080,
    durationSeconds: 42,
    availability: 'ready',
    ...overrides
  };
}

function repository(initial) {
  const state = { revision: 1, media: [...initial], projects: [] };
  return {
    state,
    getStorageSummary: () => ({ revision: state.revision }),
    listMedia: async () => ({ storeRevision: state.revision, media: structuredClone(state.media) }),
    listProjects: async () => ({ storeRevision: state.revision, projects: state.projects.map((p) => ({ id: p.id })) }),
    readProject: async ({ projectId }) => ({ storeRevision: state.revision, project: structuredClone(state.projects.find((p) => p.id === projectId)) })
  };
}

function request(extra = {}) {
  return validateMediaIndexSearchRequest({ kind: 'media-index-search', version: 1, ...extra });
}

async function open(t, repo, providers = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-media-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, service: await MediaIndexService.open({ rootDirectory: root, repository: repo, derivedMetadataProviders: providers }) };
}

test('builds and searches filename tokens case-insensitively', async (t) => {
  const repo = repository([media('00000000-0000-4000-8000-000000000001', 'Beach_Drive.MOV')]);
  const { service } = await open(t, repo);
  const result = await service.search(request({ query: 'BEACH drive' }));
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].matchSources, ['filename']);
});

test('filters and deterministic pagination work', async (t) => {
  const repo = repository([
    media('00000000-0000-4000-8000-000000000001', 'b.mp4', { durationSeconds: 10 }),
    media('00000000-0000-4000-8000-000000000002', 'a.jpg', { kind: 'image', durationSeconds: null, width: 800, height: 1200 }),
    media('00000000-0000-4000-8000-000000000003', 'c.mp4', { durationSeconds: 90 })
  ]);
  const { service } = await open(t, repo);
  const filtered = await service.search(request({ mediaKind: 'video', availability: 'ready', importedAfter: '2026-08-12T00:00:00.000Z', minDurationSeconds: 20, minWidth: 1000, maxHeight: 1200, sort: 'filename-asc', limit: 1 }));
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].originalFilename, 'c.mp4');
  assert.equal(filtered.hasMore, false);
});

test('stale revision refresh removes deleted records and adds changed records once', async (t) => {
  const repo = repository([media('00000000-0000-4000-8000-000000000001', 'old.mp4')]);
  let scans = 0;
  const original = repo.listMedia;
  repo.listMedia = async () => { scans += 1; return original(); };
  const { service } = await open(t, repo);
  assert.equal(scans, 1);
  await service.search(request());
  assert.equal(scans, 1);
  repo.state.media = [media('00000000-0000-4000-8000-000000000002', 'new.mp4')];
  repo.state.revision += 1;
  const result = await service.search(request());
  assert.equal(scans, 2);
  assert.deepEqual(result.items.map((item) => item.originalFilename), ['new.mp4']);
  await service.search(request());
  assert.equal(scans, 2);
});

test('incremental synchronisation reuses unchanged rows after unrelated workspace revisions', async (t) => {
  const repo = repository([media('00000000-0000-4000-8000-000000000001', 'unchanged.mp4')]);
  let derivedCalls = 0;
  const { service } = await open(t, repo, [async () => { derivedCalls += 1; return { aiLabels: ['stable'] }; }]);
  assert.equal(derivedCalls, 1);
  repo.state.revision += 1;
  const result = await service.search(request({ query: 'stable' }));
  assert.equal(result.total, 1);
  assert.equal(derivedCalls, 1);
  assert.equal(service.getStatus().lastSyncChangedCount, 0);
});

test('corrupt or schema-mismatched index is rebuilt without source mutation', async (t) => {
  const repo = repository([media('00000000-0000-4000-8000-000000000001', 'safe.mp4')]);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-media-index-corrupt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.json'), JSON.stringify({ schemaVersion: MEDIA_INDEX_SCHEMA_VERSION + 1, sourceRevision: 1, entries: [] }));
  const before = structuredClone(repo.state);
  const service = await MediaIndexService.open({ rootDirectory: root, repository: repo });
  assert.equal((await service.search(request())).total, 1);
  assert.deepEqual(repo.state, before);
  assert.ok((await fs.readdir(root)).some((name) => name.startsWith('index.corrupt-')));
});

test('index payload excludes private metadata and arbitrary source fields', async (t) => {
  const repo = repository([media('00000000-0000-4000-8000-000000000001', 'camera.jpg', {
    kind: 'image', durationSeconds: null, gps: { lat: 1, lng: 2 }, sourcePath: 'C:/private/person/camera.jpg', owner: 'Private Person'
  })]);
  const { root } = await open(t, repo);
  const stored = await fs.readFile(path.join(root, 'index.json'), 'utf8');
  assert.doesNotMatch(stored, /gps|sourcePath|Private Person|C:\\/i);
});

test('typed contract rejects raw query language and unbounded requests', () => {
  assert.throws(() => validateMediaIndexSearchRequest({ kind: 'media-index-search', version: 1, sql: 'DROP TABLE media' }), /unsupported fields/);
  assert.throws(() => validateMediaIndexSearchRequest({ kind: 'media-index-search', version: 1, limit: 1000 }), /limit is invalid/);
  assert.throws(() => validateMediaIndexSearchRequest({ kind: 'media-index-search', version: 2 }), /version/);
});

test('approved future derived fields are source-attributed without replacing authority', async (t) => {
  const repo = repository([media('00000000-0000-4000-8000-000000000001', 'clip.mp4')]);
  const providers = [async () => ({ userTags: ['car club'], aiLabels: ['sunset'], aiDescription: 'Orange sky' })];
  const { service } = await open(t, repo, providers);
  assert.deepEqual((await service.search(request({ query: 'club' }))).items[0].matchSources, ['user-tag']);
  assert.deepEqual((await service.search(request({ query: 'sunset' }))).items[0].matchSources, ['ai-label']);
  assert.equal(repo.state.media[0].userTags, undefined);
});

test('project references are indexed by stable IDs without project content', async (t) => {
  const id = '00000000-0000-4000-8000-000000000001';
  const repo = repository([media(id, 'project-clip.mp4')]);
  repo.state.projects = [{ id: 'project-safe-id', title: 'Private project title', mediaIds: [id] }];
  const { root, service } = await open(t, repo);
  const result = await service.search(request());
  assert.deepEqual(result.items[0].projectIds, ['project-safe-id']);
  const stored = await fs.readFile(path.join(root, 'index.json'), 'utf8');
  assert.doesNotMatch(stored, /Private project title/);
});

test('preload search boundary exposes named methods without generic IPC access', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'src', 'preload', 'preload-bridge.cjs'), 'utf8');
  assert.match(source, /searchMedia:/);
  assert.match(source, /getMediaIndexStatus:/);
  assert.match(source, /rebuildMediaIndex:/);
  assert.doesNotMatch(source, /invoke\s*:\s*\(/);
  assert.doesNotMatch(source, /readFile|writeFile|deleteFile/);
});

test('moderate synthetic library search remains bounded', async (t) => {
  const records = Array.from({ length: 5000 }, (_, index) => media(
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    index % 100 === 0 ? `target-${index}.mp4` : `clip-${index}.mp4`,
    { importedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString() }
  ));
  const repo = repository(records);
  const { service } = await open(t, repo);
  const started = performance.now();
  const result = await service.search(request({ query: 'target', limit: 25 }));
  const elapsed = performance.now() - started;
  assert.equal(result.items.length, 25);
  assert.equal(result.total, 50);
  assert.ok(elapsed < 1000, `search took ${elapsed.toFixed(1)} ms`);
});

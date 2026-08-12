'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { LocalDataRepository } = require('../src/storage/local-data-repository.cjs');
const { runMigrations } = require('../src/storage/migrations.cjs');
const { MediaOrganisationService } = require('../src/media/media-organisation-service.cjs');
const { MediaIndexService } = require('../src/media/media-index-service.cjs');
const { validateMediaIndexSearchRequest } = require('../src/media/media-index-contracts.cjs');
const { validateMutationRequest, validateSavedViewCriteria } = require('../src/media/media-organisation-contracts.cjs');

const MEDIA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEDIA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEDIA_MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TAG_A = '11111111-1111-4111-8111-111111111111';
const TAG_B = '22222222-2222-4222-8222-222222222222';
const COLLECTION_A = '33333333-3333-4333-8333-333333333333';
const COLLECTION_B = '44444444-4444-4444-8444-444444444444';
const VIEW_A = '55555555-5555-4555-8555-555555555555';

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 12, 20, 0, tick++));
}

function media(id, filename, sha, overrides = {}) {
  return {
    id,
    schemaVersion: 1,
    kind: 'video',
    originalFilename: filename,
    managedReference: `files/${id}.mp4`,
    fileSize: 1234,
    sha256: sha,
    importedAt: '2026-08-12T18:00:00.000Z',
    importMode: 'managed-copy',
    width: 1920,
    height: 1080,
    durationSeconds: 42,
    container: 'mp4',
    codec: null,
    availability: 'ready',
    ...overrides
  };
}

async function fixture(t, { ai = new Map() } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-org-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = await LocalDataRepository.open({ rootDirectory: root, now: fixedClock() });
  let revision = repository.getStorageSummary().revision;
  await repository.createMediaRecord({ expectedRevision: revision, media: media(MEDIA_A, 'Beach Drive.mp4', 'a'.repeat(64)) });
  revision = repository.getStorageSummary().revision;
  await repository.createMediaRecord({ expectedRevision: revision, media: media(MEDIA_B, 'Garage.mp4', 'b'.repeat(64), { width: 1080, height: 1920 }) });
  const ids = [TAG_A, TAG_B, COLLECTION_A, COLLECTION_B, VIEW_A];
  let generatedId = 0;
  const organisation = await MediaOrganisationService.open({
    repository,
    now: fixedClock(),
    idFactory: () => ids.shift() ?? `90000000-0000-4000-8000-${String(generatedId++).padStart(12, '0')}`,
    aiAnalysisProvider: async (mediaId) => ai.get(mediaId) ?? null
  });
  return { root, repository, organisation };
}

function search(extra = {}) {
  return validateMediaIndexSearchRequest({ kind: 'media-index-search', version: 1, ...extra });
}

test('schema 1 migrates to authoritative organisation schema 2 without losing existing data', () => {
  const old = {
    schemaVersion: 1,
    revision: 7,
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-08-12T10:01:00.000Z',
    application: { schemaVersion: 1, settings: {}, selectedProjectId: null, recentProjectIds: [] },
    projects: {},
    media: {}
  };
  const migrated = runMigrations(old);
  assert.deepEqual(migrated.applied, ['1->2']);
  assert.equal(migrated.document.schemaVersion, 2);
  assert.deepEqual(migrated.document.mediaOrganisation.tags, {});
  assert.equal(migrated.document.revision, 7);
});

test('tag creation normalises case/whitespace and assignment/removal never mutates media records', async (t) => {
  const { repository, organisation } = await fixture(t);
  const before = await repository.getMediaRecord(MEDIA_A);
  const first = await organisation.createTag('  Car   Club ');
  const duplicate = await organisation.createTag('car club');
  assert.equal(first.value.id, duplicate.value.id);
  assert.equal(first.value.name, 'Car Club');
  assert.equal(duplicate.changed, false);

  await organisation.assignTags([first.value.id], [MEDIA_A, MEDIA_B]);
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_A }).userTags, ['Car Club']);
  await organisation.removeTags([first.value.id], [MEDIA_B]);
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_B }).userTags, []);

  await organisation.renameTag(first.value.id, 'Road Trips');
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_A }).userTags, ['Road Trips']);
  await organisation.deleteTag(first.value.id);
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_A }).userTags, []);
  assert.deepEqual((await repository.getMediaRecord(MEDIA_A)).media, before.media);
});

test('collections allow multi-membership, archive safely and delete without deleting media', async (t) => {
  const { repository, organisation } = await fixture(t);
  const road = await organisation.createCollection('Road clips');
  const best = await organisation.createCollection('Best takes');
  await organisation.addMediaToCollection(road.value.id, [MEDIA_A, MEDIA_B]);
  await organisation.addMediaToCollection(best.value.id, [MEDIA_A]);
  assert.deepEqual(new Set(organisation.getIndexMetadata({ id: MEDIA_A }).collectionNames), new Set(['Road clips', 'Best takes']));

  await organisation.archiveCollection(best.value.id);
  await assert.rejects(() => organisation.addMediaToCollection(best.value.id, [MEDIA_B]), (error) => error.code === 'COLLECTION_ARCHIVED');
  await organisation.deleteCollection(road.value.id);
  assert.equal((await repository.getMediaRecord(MEDIA_A)).media.id, MEDIA_A);
  assert.equal((await repository.getMediaRecord(MEDIA_B)).media.id, MEDIA_B);
});

test('missing collection members remain represented explicitly instead of disappearing', async (t) => {
  const { repository, organisation } = await fixture(t);
  const snapshot = await repository.readMediaOrganisation();
  snapshot.organisation.collections[COLLECTION_A] = {
    id: COLLECTION_A,
    name: 'Recovery queue',
    normalisedName: 'recovery queue',
    status: 'active',
    mediaIds: [MEDIA_A, MEDIA_MISSING],
    createdAt: '2026-08-12T20:00:00.000Z',
    updatedAt: '2026-08-12T20:00:00.000Z'
  };
  await repository.replaceMediaOrganisation({ expectedRevision: snapshot.storeRevision, organisation: snapshot.organisation });
  const view = await organisation.getSnapshot();
  const collection = view.collections.find((item) => item.id === COLLECTION_A);
  assert.deepEqual(collection.mediaIds, [MEDIA_A, MEDIA_MISSING]);
  assert.deepEqual(collection.missingMediaIds, [MEDIA_MISSING]);
});

test('AI suggestions stay derived until explicitly accepted and regeneration preserves user tags', async (t) => {
  const ai = new Map([[MEDIA_A, {
    status: 'ready', generatedAt: '2026-08-12T19:00:00.000Z', labels: ['sunset', 'car'], scene: 'coast', activity: '', visualQualities: []
  }]]);
  const { organisation } = await fixture(t, { ai });
  let suggestions = await organisation.getAiSuggestions(MEDIA_A);
  assert.deepEqual(suggestions.suggestions.map((item) => item.label), ['sunset', 'car', 'coast']);
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_A }).userTags, []);

  await organisation.acceptAiSuggestion(MEDIA_A, 'sunset');
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_A }).userTags, ['sunset']);
  await organisation.dismissAiSuggestion(MEDIA_A, 'car');
  suggestions = await organisation.getAiSuggestions(MEDIA_A);
  assert.deepEqual(suggestions.suggestions.map((item) => item.label), ['coast']);

  ai.set(MEDIA_A, { status: 'ready', generatedAt: '2026-08-12T20:00:00.000Z', labels: ['sunset', 'night'], scene: '', activity: '', visualQualities: [] });
  suggestions = await organisation.getAiSuggestions(MEDIA_A);
  assert.deepEqual(suggestions.suggestions.map((item) => item.label), ['night']);
  assert.deepEqual(organisation.getIndexMetadata({ id: MEDIA_A }).userTags, ['sunset']);
});

test('saved views persist validated filter criteria only', async (t) => {
  const { organisation } = await fixture(t);
  const tag = await organisation.createTag('Cars');
  const collection = await organisation.createCollection('Launch');
  const criteria = validateSavedViewCriteria({ query: 'drive', tagIds: [tag.value.id], collectionId: collection.value.id, orientation: 'landscape', sort: 'filename-asc' });
  const saved = await organisation.saveView('Launch shortlist', criteria);
  const snapshot = await organisation.getSnapshot();
  assert.deepEqual(snapshot.savedViews[0].criteria, criteria);
  await organisation.deleteSavedView(saved.value.id);
  assert.equal((await organisation.getSnapshot()).savedViews.length, 0);
});

test('combined search uses user tags, collection, deterministic filters and clearly attributes AI matches', async (t) => {
  const ai = new Map([[MEDIA_A, { status: 'ready', generatedAt: '2026-08-12T19:00:00.000Z', labels: ['sunset'], scene: '', activity: '', visualQualities: [], description: 'Orange sky' }]]);
  const { root, repository, organisation } = await fixture(t, { ai });
  const tag = await organisation.createTag('Cars');
  const collection = await organisation.createCollection('Road');
  await organisation.assignTags([tag.value.id], [MEDIA_A]);
  await organisation.addMediaToCollection(collection.value.id, [MEDIA_A]);

  const index = await MediaIndexService.open({
    rootDirectory: path.join(root, 'index'),
    repository,
    derivedMetadataProviders: [
      async (mediaRecord) => organisation.getIndexMetadata(mediaRecord),
      async (mediaRecord) => mediaRecord.id === MEDIA_A ? { aiLabels: ['sunset'], aiDescription: 'Orange sky' } : {}
    ]
  });
  const combined = await index.search(search({
    query: 'sunset', tagIds: [tag.value.id], collectionId: collection.value.id, mediaKind: 'video', orientation: 'landscape'
  }));
  assert.equal(combined.total, 1);
  assert.deepEqual(combined.items[0].matchSources, ['ai-label']);
  assert.deepEqual(combined.items[0].userTags, ['Cars']);
  assert.deepEqual(combined.items[0].collectionNames, ['Road']);

  const userMatch = await index.search(search({ query: 'cars' }));
  assert.deepEqual(userMatch.items[0].matchSources, ['user-tag']);
  const collectionMatch = await index.search(search({ query: 'road' }));
  assert.deepEqual(collectionMatch.items[0].matchSources, ['collection']);
});

test('authoritative organisation revision refreshes derived index metadata after a store change', async (t) => {
  const { root, repository, organisation } = await fixture(t);
  const index = await MediaIndexService.open({
    rootDirectory: path.join(root, 'index-refresh'),
    repository,
    derivedMetadataProviders: [async (mediaRecord) => organisation.getIndexMetadata(mediaRecord)]
  });
  assert.equal((await index.search(search({ query: 'travel' }))).total, 0);
  const tag = await organisation.createTag('Travel');
  await organisation.assignTags([tag.value.id], [MEDIA_A]);
  await organisation.refresh();
  const result = await index.search(search({ query: 'travel' }));
  assert.equal(result.total, 1);
});

test('large tag/collection snapshots remain alphabetic and bounded request validation rejects raw operations', async (t) => {
  const { organisation } = await fixture(t);
  for (let index = 0; index < 200; index += 1) await organisation.createTag(`Tag ${String(199 - index).padStart(3, '0')}`);
  const snapshot = await organisation.getSnapshot();
  const names = snapshot.tags.map((tag) => tag.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  assert.throws(() => validateMutationRequest({ kind: 'media-organisation-mutation', version: 1, action: 'raw-json', payload: '{}' }), /unsupported/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalDataRepository } = require('../src/storage/local-data-repository.cjs');
const { runMigrations } = require('../src/storage/migrations.cjs');
const {
  CURRENT_SCHEMA_VERSION,
  validateRendererCreateProjectRequest,
  validateRendererUpdateProjectRequest
} = require('../src/storage/storage-contracts.cjs');
const { MediaImportService, hashFile, ensureInside } = require('../src/media/media-import-service.cjs');

const PROJECT_ID_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID_B = '22222222-2222-4222-8222-222222222222';
const MEDIA_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEDIA_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swayforge-media-'));
}

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 11, 16, 0, tick++));
}

function png(width = 2, height = 3, tail = '') {
  const buffer = Buffer.alloc(24 + Buffer.byteLength(tail));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  if (tail) Buffer.from(tail).copy(buffer, 24);
  return buffer;
}

function mp4() {
  return Buffer.from([
    0, 0, 0, 24,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0, 0, 0, 0,
    0x69, 0x73, 0x6f, 0x6d,
    0x6d, 0x70, 0x34, 0x32
  ]);
}

function jpeg(width = 4, height = 5) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 17, 8,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    0xff, 0xd9
  ]);
}

async function setup(root, projectIds = [PROJECT_ID_A, PROJECT_ID_B], mediaIds = [MEDIA_ID_A, MEDIA_ID_B]) {
  const repository = await LocalDataRepository.open({
    rootDirectory: path.join(root, 'data'),
    now: clock(),
    idFactory: () => projectIds.shift()
  });
  const service = await MediaImportService.open({
    rootDirectory: path.join(root, 'media'),
    repository,
    now: clock(),
    idFactory: () => mediaIds.shift()
  });
  return { repository, service };
}

test('existing schema-one stores migrate safely to the additive media organisation schema', () => {
  const source = {
    schemaVersion: 1,
    revision: 0,
    createdAt: '2026-08-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    application: { schemaVersion: 1, settings: {}, selectedProjectId: null, recentProjectIds: [] },
    projects: {}
  };
  const result = runMigrations(source);
  assert.equal(result.document.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(result.applied, ['1->2']);
  assert.deepEqual(result.document.media, {});
  assert.equal(result.document.mediaOrganisation.schemaVersion, 1);
  assert.deepEqual(result.document.mediaOrganisation.tags, {});
  assert.deepEqual(result.document.mediaOrganisation.collections, {});
});

test('supported PNG imports as managed copy with minimal metadata', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'portrait.png');
  const fixture = png(1080, 1920, 'GPSLatitude=51.000 CameraOwner=Private');
  await fsp.writeFile(source, fixture);
  const { repository, service } = await setup(root);

  const result = await service.importFile(source);
  assert.equal(result.status, 'imported');
  assert.equal(result.media.kind, 'image');
  assert.equal(result.media.width, 1080);
  assert.equal(result.media.height, 1920);

  const stored = await repository.getMediaRecord(result.media.id);
  assert.equal(stored.media.originalFilename, 'portrait.png');
  assert.equal(stored.media.managedReference, `files/${MEDIA_ID_A}.png`);
  assert.doesNotMatch(JSON.stringify(stored.media), /GPSLatitude|CameraOwner|Private/);
  assert.equal(await hashFile(path.join(root, 'media', stored.media.managedReference)), stored.media.sha256);
  assert.equal((await fsp.readFile(source)).equals(fixture), true);
});

test('supported JPEG imports with bounded header dimensions', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'frame.jpeg');
  await fsp.writeFile(source, jpeg(640, 480));
  const { repository, service } = await setup(root);

  const result = await service.importFile(source);
  assert.equal(result.status, 'imported');
  assert.equal(result.media.width, 640);
  assert.equal(result.media.height, 480);
  const stored = (await repository.getMediaRecord(result.media.id)).media;
  assert.equal(stored.container, 'jpeg');
  assert.equal(stored.managedReference, `files/${MEDIA_ID_A}.jpg`);
});

test('supported MP4 container imports without claiming unavailable probe metadata', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'clip.mp4');
  await fsp.writeFile(source, mp4());
  const { repository, service } = await setup(root);

  const result = await service.importFile(source);
  assert.equal(result.status, 'imported');
  assert.equal(result.media.kind, 'video');
  assert.equal(result.media.width, null);
  assert.equal(result.media.height, null);
  assert.equal(result.media.durationSeconds, null);
  assert.equal((await repository.getMediaRecord(result.media.id)).media.container, 'mp4');
});

test('supported MOV container uses the same local ISO-BMFF validation path', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'clip.mov');
  await fsp.writeFile(source, mp4());
  const { repository, service } = await setup(root);

  const result = await service.importFile(source);
  assert.equal(result.status, 'imported');
  assert.equal(result.media.kind, 'video');
  assert.equal((await repository.getMediaRecord(result.media.id)).media.container, 'quicktime');
});

test('unsupported and extension-spoofed files fail without a media record', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bad = path.join(root, 'fake.png');
  const unsupported = path.join(root, 'notes.txt');
  await fsp.writeFile(bad, 'not a png');
  await fsp.writeFile(unsupported, 'hello');
  const { repository, service } = await setup(root);

  await assert.rejects(service.importFile(bad), (error) => error.code === 'MEDIA_SIGNATURE_INVALID');
  await assert.rejects(service.importFile(unsupported), (error) => error.code === 'MEDIA_TYPE_UNSUPPORTED');
  assert.equal((await repository.listMedia()).media.length, 0);
});

test('identical renamed bytes are duplicates while same filename with different bytes stays distinct', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const firstPath = path.join(root, 'a.png');
  const renamedPath = path.join(root, 'renamed.png');
  await fsp.writeFile(firstPath, png(2, 2, 'one'));
  await fsp.writeFile(renamedPath, png(2, 2, 'one'));
  const { service } = await setup(root);

  assert.equal((await service.importFile(firstPath)).status, 'imported');
  const duplicate = await service.importFile(renamedPath);
  assert.equal(duplicate.status, 'duplicate');

  await fsp.writeFile(firstPath, png(2, 2, 'different'));
  const second = await service.importFile(firstPath);
  assert.equal(second.status, 'imported');
  assert.notEqual(second.media.id, duplicate.media.id);
});

test('managed path is derived from opaque id and traversal-like source name is metadata only', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, '..evil..png');
  await fsp.writeFile(source, png());
  const { repository, service } = await setup(root);

  const result = await service.importFile(source);
  const stored = (await repository.getMediaRecord(result.media.id)).media;
  assert.equal(stored.originalFilename, '..evil..png');
  assert.equal(stored.managedReference, `files/${MEDIA_ID_A}.png`);
  assert.throws(() => ensureInside(path.join(root, 'media'), path.join(root, 'outside.png')), /escaped/);
});

test('managed finalisation never overwrites an existing opaque-id file', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'collision.png');
  await fsp.writeFile(source, png());
  const { repository, service } = await setup(root);
  const existing = path.join(root, 'media', 'files', `${MEDIA_ID_A}.png`);
  await fsp.writeFile(existing, 'preserve-me');

  await assert.rejects(service.importFile(source), (error) => error.code === 'MEDIA_ID_COLLISION');
  assert.equal(await fsp.readFile(existing, 'utf8'), 'preserve-me');
  assert.equal((await repository.listMedia()).media.length, 0);
});

test('failure before metadata commit leaves no healthy record or managed file', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'clip.png');
  await fsp.writeFile(source, png());
  const repository = await LocalDataRepository.open({
    rootDirectory: path.join(root, 'data'),
    now: clock(),
    idFactory: () => PROJECT_ID_A
  });
  const service = await MediaImportService.open({
    rootDirectory: path.join(root, 'media'),
    repository,
    now: clock(),
    idFactory: () => MEDIA_ID_A,
    faultInjector: (stage) => {
      if (stage === 'after-final-copy-before-metadata') throw new Error('synthetic pre-metadata failure');
    }
  });

  await assert.rejects(service.importFile(source), /synthetic/);
  assert.equal((await repository.listMedia()).media.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'media', 'files', `${MEDIA_ID_A}.png`)), false);
});

test('projects attach and detach stable media IDs without deleting shared media', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'shared.png');
  await fsp.writeFile(source, png());
  const { repository, service } = await setup(root);
  const imported = await service.importFile(source);
  const firstProject = await repository.createProject({ expectedRevision: 1, title: 'One' });
  const secondProject = await repository.createProject({ expectedRevision: 2, title: 'Two' });

  await service.attachMediaToProject({ projectId: firstProject.project.id, mediaId: imported.media.id, expectedRevision: 3 });
  await service.attachMediaToProject({ projectId: secondProject.project.id, mediaId: imported.media.id, expectedRevision: 4 });
  await service.detachMediaFromProject({ projectId: firstProject.project.id, mediaId: imported.media.id, expectedRevision: 5 });

  assert.deepEqual((await repository.readProject({ projectId: firstProject.project.id })).project.mediaIds, []);
  assert.deepEqual((await repository.readProject({ projectId: secondProject.project.id })).project.mediaIds, [imported.media.id]);
  assert.equal((await repository.getMediaRecord(imported.media.id)).media.availability, 'ready');
});

test('hashing path uses streams rather than whole-file read buffering', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'large.bin');
  await fsp.writeFile(file, Buffer.alloc(3 * 1024 * 1024, 7));

  const digest = await hashFile(file);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, require('node:crypto').createHash('sha256').update(await fsp.readFile(file)).digest('hex'));
});

test('generic renderer project mutations cannot bypass managed media attachment validation', () => {
  assert.throws(
    () => validateRendererCreateProjectRequest({ expectedRevision: 0, title: 'Unsafe', mediaIds: [MEDIA_ID_A] }),
    /media service/
  );
  assert.throws(
    () => validateRendererUpdateProjectRequest({ projectId: PROJECT_ID_A, expectedRevision: 0, patch: { mediaIds: [MEDIA_ID_A] } }),
    /media service/
  );
  assert.doesNotThrow(() =>
    validateRendererUpdateProjectRequest({ projectId: PROJECT_ID_A, expectedRevision: 0, patch: { title: 'Safe title' } })
  );
});

test('renderer media bridge exposes typed operations but no arbitrary filesystem path import', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload-bridge.cjs'), 'utf8');
  for (const capability of ['chooseAndImportMedia', 'listMedia', 'attachMediaToProject', 'detachMediaFromProject']) {
    assert.match(preload, new RegExp(`${capability}:`));
  }
  assert.doesNotMatch(preload, /readFile|writeFile|deleteFile|listDirectory|destinationPath|sourcePath/);
  assert.match(preload, /swayforge:media:choose-import/);

  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main-process.cjs'), 'utf8');
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /app\.getPath\('userData'\).*MEDIA_DIRECTORY_NAME/s);
  assert.doesNotMatch(main, /ipcMain\.handle\([^\n]*=>\s*fs\./);
});

test('repository guard requires media foundation sources and rejects creator video files', () => {
  const checkSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-project.cjs'), 'utf8');
  assert.match(checkSource, /src\/media\/media-contracts\.cjs/);
  assert.match(checkSource, /src\/media\/media-import-service\.cjs/);
  assert.match(checkSource, /'\.mp4'/);
  assert.match(checkSource, /'\.mov'/);
});

test('failure after create-exclusive final copy removes the owned final file and record', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'final-copy.png');
  await fsp.writeFile(source, png());
  const repository = await LocalDataRepository.open({
    rootDirectory: path.join(root, 'data'),
    now: clock(),
    idFactory: () => PROJECT_ID_A
  });
  const service = await MediaImportService.open({
    rootDirectory: path.join(root, 'media'),
    repository,
    now: clock(),
    idFactory: () => MEDIA_ID_A,
    faultInjector: (stage) => {
      if (stage === 'after-final-copy') throw new Error('synthetic final-copy failure');
    }
  });

  await assert.rejects(service.importFile(source), /synthetic final-copy failure/);
  assert.equal((await repository.listMedia()).media.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'media', 'files', `${MEDIA_ID_A}.png`)), false);
});

test('media metadata and project references persist after repository restart', async (t) => {
  const root = temp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'persist.png');
  await fsp.writeFile(source, png(12, 34));
  const { repository, service } = await setup(root, [PROJECT_ID_A], [MEDIA_ID_A]);
  const imported = await service.importFile(source);
  const project = await repository.createProject({ expectedRevision: 1, title: 'Persistent' });
  await service.attachMediaToProject({
    projectId: project.project.id,
    mediaId: imported.media.id,
    expectedRevision: 2
  });

  const reopened = await LocalDataRepository.open({ rootDirectory: path.join(root, 'data'), now: clock() });
  const media = await reopened.getMediaRecord(imported.media.id);
  const persistedProject = await reopened.readProject({ projectId: project.project.id });
  assert.equal(media.media.sha256, await hashFile(source));
  assert.deepEqual(persistedProject.project.mediaIds, [imported.media.id]);
});

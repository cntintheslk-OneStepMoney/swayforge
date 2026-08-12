'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const {
  MediaIntegrityService,
  MediaIntegrityError
} = require('../src/media/media-integrity-service.cjs');
const {
  validateRebuildDerivedRequest,
  validateRepairRequest,
  validateScanRequest
} = require('../src/media/media-integrity-contracts.cjs');

const MEDIA_A = '11111111-1111-4111-8111-111111111111';
const MEDIA_B = '22222222-2222-4222-8222-222222222222';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  Buffer.from('fixture')
]);

function sha(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

function mediaRecord(id, buffer = PNG, overrides = {}) {
  return {
    id,
    schemaVersion: 1,
    kind: 'image',
    originalFilename: `${id}.png`,
    managedReference: `files/${id}.png`,
    fileSize: buffer.length,
    sha256: sha(buffer),
    importedAt: '2026-08-12T20:00:00.000Z',
    importMode: 'managed-copy',
    width: 1,
    height: 1,
    durationSeconds: null,
    container: 'png',
    codec: null,
    availability: 'ready',
    ...overrides
  };
}

async function fixture({ media = [mediaRecord(MEDIA_A)], maxScanItems = 250 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-integrity-'));
  const mediaRoot = path.join(root, 'media');
  const files = path.join(mediaRoot, 'files');
  const cache = path.join(root, 'cache', 'media-integrity');
  const previews = path.join(root, 'cache', 'media-previews');
  const similarityRoot = path.join(root, 'cache', 'media-similarity');
  const aiRoot = path.join(root, 'derived', 'media-ai');
  await Promise.all([fs.mkdir(files, { recursive: true }), fs.mkdir(previews, { recursive: true }), fs.mkdir(similarityRoot, { recursive: true }), fs.mkdir(aiRoot, { recursive: true })]);
  let revision = 7;
  const records = new Map(media.map((item) => [item.id, structuredClone(item)]));
  const authority = { projects: { p: [MEDIA_A] }, organisation: { tags: ['keep-me'], collections: ['keep-me-too'] } };
  const repository = {
    listMedia: async () => ({ storeRevision: revision, media: [...records.values()].map((item) => ({ id: item.id, kind: item.kind, originalFilename: item.originalFilename, fileSize: item.fileSize, importedAt: item.importedAt, width: item.width, height: item.height, durationSeconds: item.durationSeconds, availability: item.availability })) }),
    getMediaRecord: async (id) => ({ storeRevision: revision, media: structuredClone(records.get(id)) }),
    getStorageSummary: () => ({ revision }),
    authority
  };
  const indexService = {
    getStatus: () => ({ sourceRevision: revision, state: 'ready' }),
    rebuild: async () => ({ sourceRevision: revision, state: 'ready' })
  };
  const previewService = {
    clearMediaCache: async (mediaId) => {
      const indexPath = path.join(previews, 'preview-index.json');
      let doc = { schemaVersion: 1, generatorVersion: 'fixture', artifacts: {} };
      try { doc = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch {}
      for (const [key, value] of Object.entries(doc.artifacts ?? {})) if (value.mediaId === mediaId) delete doc.artifacts[key];
      await fs.writeFile(indexPath, JSON.stringify(doc));
      return { mediaId, removed: 1 };
    },
    requestPreview: async (mediaId) => {
      const record = records.get(mediaId);
      const artifactId = 'a'.repeat(64);
      const relativePath = `artifacts/${artifactId}.png`;
      await fs.mkdir(path.join(previews, 'artifacts'), { recursive: true });
      await fs.writeFile(path.join(previews, relativePath), PNG);
      await fs.writeFile(path.join(previews, 'preview-index.json'), JSON.stringify({ schemaVersion: 1, generatorVersion: 'fixture', artifacts: { [artifactId]: { artifactId, mediaId, sourceHash: record.sha256, kind: 'image-thumbnail', status: 'ready', relativePath } } }));
      return { status: 'ready', artifactId };
    }
  };
  const similarityService = {
    rootDirectory: similarityRoot,
    getStatus: () => ({ methodVersion: 'fixture-v1' }),
    rebuild: async () => {
      await fs.writeFile(path.join(similarityRoot, 'fingerprints.json'), JSON.stringify({ schemaVersion: 1, methodVersion: 'fixture-v1', fingerprints: [...records.values()].map((item) => ({ cacheKey: `${item.sha256}:fixture-v1` })) }));
      return { state: 'ready' };
    }
  };
  const aiAnalysisService = {
    analyse: async (mediaId) => {
      const record = records.get(mediaId);
      const value = { mediaId, sourceHash: record.sha256, status: 'ready' };
      await fs.writeFile(path.join(aiRoot, 'analyses.json'), JSON.stringify({ schemaVersion: 1, records: { [mediaId]: value } }));
      return value;
    }
  };
  const service = await MediaIntegrityService.open({
    mediaRootDirectory: mediaRoot,
    cacheDirectory: cache,
    previewCacheDirectory: previews,
    aiDirectory: aiRoot,
    repository,
    previewService,
    indexService,
    similarityService,
    aiAnalysisService,
    maxScanItems,
    now: () => new Date('2026-08-12T21:00:00.000Z')
  });
  return { root, mediaRoot, files, cache, previews, similarityRoot, aiRoot, records, repository, service };
}

async function writeManaged(fx, id, buffer = PNG) {
  await fs.writeFile(path.join(fx.files, `${id}.png`), buffer);
}

async function cleanup(fx) { await fs.rm(fx.root, { recursive: true, force: true }); }

test('contracts reject arbitrary renderer paths and bound integrity requests', () => {
  assert.deepEqual(validateRepairRequest({ kind: 'media-integrity-repair', version: 1, mediaId: MEDIA_A }), { mediaId: MEDIA_A });
  assert.throws(() => validateRepairRequest({ kind: 'media-integrity-repair', version: 1, mediaId: MEDIA_A, path: 'C:\\secret' }), TypeError);
  assert.deepEqual(validateScanRequest({ kind: 'media-integrity-scan', version: 1, forceHash: true }).forceHash, true);
  assert.throws(() => validateRebuildDerivedRequest({ kind: 'media-integrity-rebuild-derived', version: 1, mediaId: MEDIA_A, targets: ['preview', 'preview'] }), TypeError);
});

test('missing managed source is classified missing', async () => {
  const fx = await fixture();
  try { assert.equal((await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0].state, 'missing'); }
  finally { await cleanup(fx); }
});

test('same-size hash mismatch is classified changed rather than healthy', async () => {
  const fx = await fixture();
  try {
    const changed = Buffer.from(PNG); changed[changed.length - 1] ^= 1;
    await writeManaged(fx, MEDIA_A, changed);
    const item = (await fx.service.scan({ mediaIds: [MEDIA_A], forceHash: true })).items[0];
    assert.equal(item.state, 'changed'); assert.equal(item.reason, 'hash-mismatch');
  } finally { await cleanup(fx); }
});

test('invalid media signature is classified corrupt without exposing a path', async () => {
  const broken = Buffer.alloc(PNG.length, 1);
  const record = mediaRecord(MEDIA_A, broken);
  record.sha256 = sha(broken);
  const fx = await fixture({ media: [record] });
  try {
    await writeManaged(fx, MEDIA_A, broken);
    const item = (await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0];
    assert.equal(item.state, 'corrupt'); assert.equal(item.reason, 'content-signature-invalid'); assert.equal(JSON.stringify(item).includes(fx.root), false);
  } finally { await cleanup(fx); }
});

test('exact-content repair restores the managed source under the same media ID', async () => {
  const fx = await fixture();
  const recovery = path.join(fx.root, 'recovery.png');
  try {
    await fs.writeFile(recovery, PNG);
    const result = await fx.service.repairManagedMedia(MEDIA_A, recovery);
    assert.equal(result.status, 'restored'); assert.equal(result.identityPreserved, true);
    assert.deepEqual(await fs.readFile(path.join(fx.files, `${MEDIA_A}.png`)), PNG);
    assert.equal(fx.records.size, 1);
  } finally { await cleanup(fx); }
});

test('different-content repair cannot silently replace the existing identity', async () => {
  const fx = await fixture();
  const recovery = path.join(fx.root, 'different.png');
  try {
    const different = Buffer.concat([PNG, Buffer.from('different')]);
    await fs.writeFile(recovery, different);
    const result = await fx.service.repairManagedMedia(MEDIA_A, recovery);
    assert.equal(result.status, 'different-content'); assert.equal(result.nextAction, 'import-as-new');
    await assert.rejects(fs.stat(path.join(fx.files, `${MEDIA_A}.png`)), { code: 'ENOENT' });
    assert.equal(fx.records.get(MEDIA_A).sha256, sha(PNG));
  } finally { await cleanup(fx); }
});

test('derived rebuild leaves authoritative revision, projects, tags and collections unchanged', async () => {
  const fx = await fixture();
  try {
    await writeManaged(fx, MEDIA_A);
    const before = structuredClone(fx.repository.authority);
    const result = await fx.service.rebuildDerived({ mediaId: MEDIA_A, targets: ['preview', 'index', 'similarity', 'ai'] });
    assert.equal(result.authoritativeStatePreserved, true); assert.deepEqual(fx.repository.authority, before); assert.equal(result.sourceBytesDeleted, false);
  } finally { await cleanup(fx); }
});

test('managed missing media remains represented as missing on repeated scans', async () => {
  const fx = await fixture();
  try {
    assert.equal((await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0].state, 'missing');
    assert.equal((await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0].state, 'missing');
    assert.equal(fx.records.has(MEDIA_A), true);
  } finally { await cleanup(fx); }
});

test('normal cleanup/rebuild never deletes an unrelated external source', async () => {
  const fx = await fixture();
  const external = path.join(fx.root, 'external-owned-by-user.png');
  try {
    await writeManaged(fx, MEDIA_A); await fs.writeFile(external, PNG);
    const result = await fx.service.rebuildDerived({ mediaId: MEDIA_A, targets: ['preview', 'index'] });
    assert.equal(result.externalSourceDeleted, false); assert.deepEqual(await fs.readFile(external), PNG);
    assert.equal(fx.service.getPolicy().externalSourceDeletion, false);
  } finally { await cleanup(fx); }
});

test('managed hard delete is explicitly deferred and cannot report false completion', async () => {
  const fx = await fixture();
  try {
    await writeManaged(fx, MEDIA_A);
    assert.throws(() => fx.service.requestManagedDelete(MEDIA_A), (error) => error instanceof MediaIntegrityError && error.code === 'MEDIA_DELETE_DEFERRED');
    assert.deepEqual(await fs.readFile(path.join(fx.files, `${MEDIA_A}.png`)), PNG);
    assert.equal(fx.service.getPolicy().sourceDeletionExposed, false);
  } finally { await cleanup(fx); }
});

test('scan is bounded, incremental after verification, force-hashable and cancellation-safe', async () => {
  const fx = await fixture({ media: [mediaRecord(MEDIA_A), mediaRecord(MEDIA_B)], maxScanItems: 1 });
  try {
    await writeManaged(fx, MEDIA_A); await writeManaged(fx, MEDIA_B);
    const first = await fx.service.scan();
    assert.equal(first.checked, 1); assert.equal(first.truncated, true); assert.equal(first.hashedCount, 1);
    const second = await fx.service.scan();
    assert.equal(second.incrementalHashSkips, 1); assert.equal(second.hashedCount, 0);
    const forced = await fx.service.scan({ forceHash: true }); assert.equal(forced.hashedCount, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fx.service.scan({ signal: controller.signal }), (error) => error.code === 'MEDIA_INTEGRITY_CANCELLED');
  } finally { await cleanup(fx); }
});

test('observed missing source invalidates prior incremental trust before later recovery', async () => {
  const fx = await fixture();
  const managedPath = path.join(fx.files, `${MEDIA_A}.png`);
  try {
    await writeManaged(fx, MEDIA_A);
    const first = await fx.service.scan({ mediaIds: [MEDIA_A] });
    assert.equal(first.items[0].state, 'healthy');
    await fs.rm(managedPath);
    assert.equal((await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0].state, 'missing');

    const changed = Buffer.from(PNG);
    changed[changed.length - 1] ^= 0x01;
    await fs.writeFile(managedPath, changed);
    const recovered = await fx.service.scan({ mediaIds: [MEDIA_A] });
    assert.equal(recovered.items[0].incremental, false);
    assert.equal(recovered.items[0].state, 'changed');
    assert.equal(recovered.items[0].reason, 'hash-mismatch');
  } finally { await cleanup(fx); }
});

test('integrity cache stores no source paths or filenames', async () => {
  const fx = await fixture();
  try {
    await writeManaged(fx, MEDIA_A); await fx.service.scan({ mediaIds: [MEDIA_A] });
    const cache = await fs.readFile(path.join(fx.cache, 'integrity-cache.json'), 'utf8');
    assert.equal(cache.includes(fx.root), false); assert.equal(cache.includes(`${MEDIA_A}.png`), false); assert.equal(cache.includes('managedReference'), false);
  } finally { await cleanup(fx); }
});

test('derived status moves from missing to recoverable/ready after explicit rebuild', async () => {
  const fx = await fixture();
  try {
    await writeManaged(fx, MEDIA_A);
    const before = (await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0].derived;
    assert.equal(before.preview, 'missing'); assert.equal(before.ai, 'missing');
    await fx.service.rebuildDerived({ mediaId: MEDIA_A, targets: ['preview', 'similarity', 'ai', 'index'] });
    const after = (await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0].derived;
    assert.equal(after.preview, 'ready'); assert.equal(after.similarity, 'ready'); assert.equal(after.ai, 'ready'); assert.equal(after.index, 'ready');
  } finally { await cleanup(fx); }
});

test('path traversal in an authoritative managed reference is surfaced as corrupt, never followed', async () => {
  const record = mediaRecord(MEDIA_A, PNG, { managedReference: `files/../${MEDIA_A}.png` });
  const fx = await fixture({ media: [record] });
  try {
    const item = (await fx.service.scan({ mediaIds: [MEDIA_A] })).items[0];
    assert.equal(item.state, 'corrupt'); assert.equal(item.reason, 'managed-reference-invalid');
  } finally { await cleanup(fx); }
});

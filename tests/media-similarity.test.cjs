'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const test = require('node:test');
const {
  MediaSimilarityService,
  fingerprintSimilarity,
  hammingSimilarity
} = require('../src/media/media-similarity-service.cjs');

const HASH_A = 'f0f0f0f0f0f0f0f0';
const HASH_A_NEAR = 'f0f0f0f0f0f0f0e0';
const HASH_B = '0f0f0f0f0f0f0f0f';

function media(id, overrides = {}) {
  return {
    id,
    kind: 'image',
    originalFilename: `${id}.jpg`,
    width: 1920,
    height: 1080,
    durationSeconds: null,
    importedAt: '2026-08-12T12:00:00.000Z',
    availability: 'ready',
    sha256: id.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/g, 'a'),
    importMode: 'managed-copy',
    managedReference: `${id}.jpg`,
    ...overrides
  };
}

function repository(items, mutationSpy = []) {
  const records = new Map(items.map((item) => [item.id, item]));
  return {
    async listMedia() { return { storeRevision: 1, media: [...records.values()] }; },
    async getMediaRecord(id) { return records.has(id) ? { media: records.get(id) } : null; },
    async deleteMedia() { mutationSpy.push('delete'); },
    async updateMedia() { mutationSpy.push('update'); },
    records
  };
}

async function openService(items, fingerprints, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-similarity-'));
  const mediaRoot = path.join(root, 'media');
  await fs.mkdir(mediaRoot, { recursive: true });
  for (const item of items) {
    const seed = `fixture:${item.sha256}`;
    const bytes = Buffer.from(seed, 'utf8');
    item.sha256 = createHash('sha256').update(bytes).digest('hex');
    item.fileSize = bytes.length;
    await fs.writeFile(path.join(mediaRoot, item.managedReference), bytes);
  }
  const calls = [];
  const repo = repository(items, options.mutationSpy);
  const service = await MediaSimilarityService.open({
    rootDirectory: path.join(root, 'cache'),
    mediaRootDirectory: mediaRoot,
    repository: repo,
    methodVersion: options.methodVersion ?? 'test-dhash-v1',
    maxCandidateComparisons: options.maxCandidateComparisons ?? 128,
    fingerprintProvider: async ({ media: item }) => {
      calls.push(item.id);
      return fingerprints[item.id];
    }
  });
  return { root, mediaRoot, repo, service, calls };
}

test('exact duplicate uses authoritative SHA-256 instead of perceptual evidence', async (t) => {
  const sharedHash = 'a'.repeat(64);
  const items = [media('source', { sha256: sharedHash }), media('copy', { sha256: sharedHash })];
  const { root, service, calls } = await openService(items, {});
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await service.findSimilar({ mediaId: 'source' });
  assert.equal(result.results[0].category, 'exact-duplicate');
  assert.equal(result.results[0].method, 'sha256');
  assert.deepEqual(calls, []);
});

test('resized/compressed-style image perturbation is highly similar', () => {
  assert.ok(hammingSimilarity(HASH_A, HASH_A_NEAR) >= 0.9);
  assert.ok(fingerprintSimilarity({ kind: 'image', hashes: [HASH_A] }, { kind: 'image', hashes: [HASH_A_NEAR] }) >= 0.9);
});

test('clearly different images are not classified as duplicates', async (t) => {
  const items = [media('source'), media('different', { sha256: 'b'.repeat(64) })];
  const { root, service } = await openService(items, {
    source: { kind: 'image', hashes: [HASH_A] },
    different: { kind: 'image', hashes: [HASH_B] }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await service.findSimilar({ mediaId: 'source' });
  assert.equal(result.results.length, 0);
});

test('same filename with different media is not similarity evidence', async (t) => {
  const items = [media('source', { originalFilename: 'same.jpg' }), media('other', { originalFilename: 'same.jpg', sha256: 'c'.repeat(64) })];
  const { root, service } = await openService(items, {
    source: { kind: 'image', hashes: [HASH_A] },
    other: { kind: 'image', hashes: [HASH_B] }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await service.findSimilar({ mediaId: 'source' })).results.length, 0);
});

test('deterministic sampled video signatures identify a recompressed-style variant', async (t) => {
  const items = [
    media('source', { kind: 'video', managedReference: 'source.mp4', durationSeconds: 30 }),
    media('variant', { kind: 'video', managedReference: 'variant.mp4', durationSeconds: 30.2, sha256: 'd'.repeat(64) })
  ];
  const { root, service } = await openService(items, {
    source: { kind: 'video', hashes: [HASH_A, HASH_A, HASH_A] },
    variant: { kind: 'video', hashes: [HASH_A_NEAR, HASH_A, HASH_A_NEAR] }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await service.findSimilar({ mediaId: 'source' });
  const second = await service.findSimilar({ mediaId: 'source' });
  assert.equal(first.results[0].category, 'highly-similar');
  assert.deepEqual(first.results, second.results);
});

test('method version invalidates stale fingerprint cache', async (t) => {
  const items = [media('source')];
  const first = await openService(items, { source: { kind: 'image', hashes: [HASH_A] } }, { methodVersion: 'method-v1' });
  await first.service.rebuild();
  const cacheDir = path.join(first.root, 'cache');
  const second = await MediaSimilarityService.open({
    rootDirectory: cacheDir,
    mediaRootDirectory: path.join(first.root, 'media'),
    repository: first.repo,
    methodVersion: 'method-v2',
    fingerprintProvider: async () => ({ kind: 'image', hashes: [HASH_A_NEAR] })
  });
  t.after(() => fs.rm(first.root, { recursive: true, force: true }));
  assert.equal(second.getStatus().fingerprintCount, 0);
  assert.equal(second.getStatus().methodVersion, 'method-v2');
});

test('source removal cleans derived similarity state safely', async (t) => {
  const items = [media('source')];
  const { root, repo, service } = await openService(items, { source: { kind: 'image', hashes: [HASH_A] } });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await service.rebuild();
  assert.equal(service.getStatus().fingerprintCount, 1);
  repo.records.delete('source');
  await service.cleanupForActiveMedia([]);
  assert.equal(service.getStatus().fingerprintCount, 0);
});

test('large library bounds candidate comparisons instead of all-pairs work', async (t) => {
  const items = [media('source')];
  for (let index = 0; index < 5000; index += 1) {
    items.push(media(`m${index}`, { sha256: index.toString(16).padStart(64, '0') }));
  }
  const fingerprints = Object.fromEntries(items.map((item) => [item.id, { kind: 'image', hashes: [HASH_B] }]));
  fingerprints.source = { kind: 'image', hashes: [HASH_A] };
  const { root, service } = await openService(items, fingerprints, { maxCandidateComparisons: 32 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await service.findSimilar({ mediaId: 'source' });
  assert.equal(result.comparisonsPerformed, 32);
  assert.ok(result.candidatePoolSize > result.comparisonsPerformed);
});

test('similarity never calls destructive repository operations', async (t) => {
  const mutations = [];
  const items = [media('source'), media('near', { sha256: 'e'.repeat(64) })];
  const { root, service } = await openService(items, {
    source: { kind: 'image', hashes: [HASH_A] },
    near: { kind: 'image', hashes: [HASH_A_NEAR] }
  }, { mutationSpy: mutations });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await service.findSimilar({ mediaId: 'source' });
  assert.equal(result.destructiveActions, false);
  assert.deepEqual(mutations, []);
});

test('changed managed source is rejected before a new perceptual fingerprint is generated', async (t) => {
  const items = [media('source'), media('near', { sha256: 'e'.repeat(64) })];
  const { root, mediaRoot, service, calls } = await openService(items, {
    source: { kind: 'image', hashes: [HASH_A] },
    near: { kind: 'image', hashes: [HASH_A_NEAR] }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(mediaRoot, 'source.jpg'), 'changed-after-import');
  await assert.rejects(
    service.findSimilar({ mediaId: 'source' }),
    (error) => error?.code === 'SIMILARITY_SOURCE_CHANGED'
  );
  assert.deepEqual(calls, []);
});

test('video representative sampling fractions are deterministic and bounded', () => {
  const { VIDEO_SIMILARITY_SAMPLE_FRACTIONS } = require('../src/media/media-similarity-contracts.cjs');
  assert.deepEqual([...VIDEO_SIMILARITY_SAMPLE_FRACTIONS], [0.1, 0.5, 0.9]);
  assert.ok(VIDEO_SIMILARITY_SAMPLE_FRACTIONS.length <= 5);
});

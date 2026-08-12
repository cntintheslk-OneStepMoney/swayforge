'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const {
  MediaPreviewError,
  MediaPreviewService,
  PNG_SIGNATURE,
  createArtifactId,
  hashFile
} = require('../src/media/media-preview-service.cjs');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fakePng(label = 'preview') {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(`synthetic-${label}`)]);
}

async function createFixture({ kind = 'image', filename = 'safe.jpg', bytes = Buffer.from('source-bytes'), id = randomUUID() } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'swayforge-preview-'));
  const mediaRoot = path.join(root, 'media');
  const cacheRoot = path.join(root, 'derived');
  const files = path.join(mediaRoot, 'files');
  await fsp.mkdir(files, { recursive: true });
  const extension = kind === 'video' ? '.mp4' : '.jpg';
  const managedReference = `files/${id}${extension}`;
  const sourcePath = path.join(mediaRoot, 'files', `${id}${extension}`);
  await fsp.writeFile(sourcePath, bytes);
  const media = {
    id,
    kind,
    originalFilename: filename,
    managedReference,
    fileSize: bytes.length,
    sha256: sha256(bytes),
    importMode: 'managed-copy',
    availability: 'ready'
  };
  const repository = {
    async getMediaRecord(mediaId) {
      if (mediaId !== media.id) throw Object.assign(new Error('not found'), { code: 'MEDIA_NOT_FOUND' });
      return { storeRevision: 1, media: { ...media } };
    }
  };
  const calls = [];
  const generators = {
    async imageThumbnail({ sourcePath: input, outputPath, maxDimension, signal }) {
      calls.push({ kind: 'image', input, outputPath, maxDimension, signal });
      await fsp.writeFile(outputPath, fakePng('image'));
      return { width: 320, height: 180 };
    },
    async videoPoster({ sourcePath: input, outputPath, maxDimension, signal }) {
      calls.push({ kind: 'video', input, outputPath, maxDimension, signal });
      await fsp.writeFile(outputPath, fakePng('video'));
      return { width: 320, height: 180, durationSeconds: 4.5 };
    }
  };
  return { root, mediaRoot, cacheRoot, sourcePath, media, repository, generators, calls };
}

async function openService(fixture, overrides = {}) {
  return MediaPreviewService.open({
    rootDirectory: fixture.cacheRoot,
    mediaRootDirectory: fixture.mediaRoot,
    repository: fixture.repository,
    generators: fixture.generators,
    generatorVersion: 'test-generator-v1',
    maxConcurrency: 2,
    maxQueueSize: 16,
    ...overrides
  });
}

async function cleanup(fixture) {
  await fsp.rm(fixture.root, { recursive: true, force: true });
}

test('image thumbnail generation succeeds and source remains byte-identical', async () => {
  const fixture = await createFixture({ bytes: Buffer.from('image-source-sensitive-metadata:GPS=51.5') });
  try {
    const before = await hashFile(fixture.sourcePath);
    const service = await openService(fixture);
    const result = await service.requestPreview(fixture.media.id);
    assert.equal(result.status, 'ready');
    assert.equal(result.kind, 'image-thumbnail');
    assert.equal(result.width, 320);
    assert.match(result.url, /^swayforge-preview:\/\/artifact\/[a-f0-9]{64}$/);
    assert.equal(await hashFile(fixture.sourcePath), before);
    const resolved = await service.resolveArtifact(result.artifactId);
    assert.ok(resolved.filePath.startsWith(path.resolve(fixture.cacheRoot)));
    const derived = await fsp.readFile(resolved.filePath);
    assert.equal(derived.includes(Buffer.from('GPS=51.5')), false, 'derived preview must not copy source metadata bytes');
  } finally {
    await cleanup(fixture);
  }
});

test('video poster generation succeeds with a safe synthetic fixture', async () => {
  const fixture = await createFixture({ kind: 'video', bytes: Buffer.from('synthetic-mp4-fixture') });
  try {
    const service = await openService(fixture);
    const result = await service.requestPreview(fixture.media.id);
    assert.equal(result.kind, 'video-poster');
    assert.equal(result.status, 'ready');
    assert.equal(result.durationSeconds, 4.5);
    assert.equal(fixture.calls[0].kind, 'video');
  } finally {
    await cleanup(fixture);
  }
});

test('artifact identity is keyed by media id, source hash, kind, artifact version and generator version', () => {
  const common = {
    mediaId: 'media-a',
    sourceHash: 'a'.repeat(64),
    artifactKind: 'image-thumbnail',
    artifactVersion: 1,
    generatorVersion: 'generator-a'
  };
  const first = createArtifactId(common);
  assert.notEqual(first, createArtifactId({ ...common, mediaId: 'media-b' }));
  assert.notEqual(first, createArtifactId({ ...common, sourceHash: 'b'.repeat(64) }));
  assert.notEqual(first, createArtifactId({ ...common, generatorVersion: 'generator-b' }));
});

test('unchanged healthy artifact is reused without regeneration', async () => {
  const fixture = await createFixture();
  try {
    const service = await openService(fixture);
    const first = await service.requestPreview(fixture.media.id);
    const second = await service.requestPreview(fixture.media.id);
    assert.equal(fixture.calls.length, 1);
    assert.equal(second.artifactId, first.artifactId);
    assert.equal(second.reused, true);
  } finally {
    await cleanup(fixture);
  }
});

test('missing or corrupt artifact is rebuilt deterministically', async () => {
  const fixture = await createFixture();
  try {
    const service = await openService(fixture);
    const first = await service.requestPreview(fixture.media.id);
    const resolved = await service.resolveArtifact(first.artifactId);
    await fsp.writeFile(resolved.filePath, Buffer.from('corrupt'));
    const rebuilt = await service.requestPreview(fixture.media.id);
    assert.equal(rebuilt.artifactId, first.artifactId);
    assert.equal(rebuilt.reused, false);
    assert.equal(fixture.calls.length, 2);
    const healthy = await service.resolveArtifact(first.artifactId);
    assert.ok(healthy);
  } finally {
    await cleanup(fixture);
  }
});

test('failed generation leaves no healthy artifact record and cleans staging output', async () => {
  const fixture = await createFixture();
  fixture.generators.imageThumbnail = async ({ outputPath }) => {
    await fsp.writeFile(outputPath, Buffer.from('partial-bad-output'));
    throw new Error('synthetic generator failure');
  };
  try {
    const service = await openService(fixture);
    await assert.rejects(service.requestPreview(fixture.media.id), (error) => error instanceof MediaPreviewError && error.code === 'PREVIEW_GENERATION_FAILED');
    const artifactId = createArtifactId({
      mediaId: fixture.media.id,
      sourceHash: fixture.media.sha256,
      artifactKind: 'image-thumbnail',
      artifactVersion: 1,
      generatorVersion: 'test-generator-v1'
    });
    assert.equal(await service.resolveArtifact(artifactId), null);
    assert.deepEqual(await fsp.readdir(path.join(fixture.cacheRoot, '.staging')), []);
  } finally {
    await cleanup(fixture);
  }
});

test('malicious managed reference cannot traverse trusted media root or reach generator arguments', async () => {
  const fixture = await createFixture({ filename: '--output=../../owned.jpg' });
  fixture.media.managedReference = '../outside.jpg';
  try {
    const service = await openService(fixture);
    await assert.rejects(service.requestPreview(fixture.media.id), (error) => error instanceof MediaPreviewError && error.code === 'PREVIEW_PATH_INVALID');
    assert.equal(fixture.calls.length, 0);
  } finally {
    await cleanup(fixture);
  }
});

test('generation concurrency is bounded', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'swayforge-preview-concurrency-'));
  const mediaRoot = path.join(root, 'media');
  const cacheRoot = path.join(root, 'cache');
  await fsp.mkdir(path.join(mediaRoot, 'files'), { recursive: true });
  const mediaRecords = new Map();
  for (let index = 0; index < 6; index += 1) {
    const id = randomUUID();
    const bytes = Buffer.from(`source-${index}`);
    await fsp.writeFile(path.join(mediaRoot, 'files', `${id}.jpg`), bytes);
    mediaRecords.set(id, {
      id, kind: 'image', managedReference: `files/${id}.jpg`, fileSize: bytes.length,
      sha256: sha256(bytes), importMode: 'managed-copy', availability: 'ready'
    });
  }
  let running = 0;
  let maximum = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const repository = { async getMediaRecord(id) { return { media: { ...mediaRecords.get(id) } }; } };
  const generators = {
    async imageThumbnail({ outputPath }) {
      running += 1;
      maximum = Math.max(maximum, running);
      await gate;
      await fsp.writeFile(outputPath, fakePng('concurrency'));
      running -= 1;
      return { width: 100, height: 100 };
    },
    async videoPoster() { throw new Error('not used'); }
  };
  try {
    const service = await MediaPreviewService.open({
      rootDirectory: cacheRoot, mediaRootDirectory: mediaRoot, repository, generators,
      generatorVersion: 'test-generator-v1', maxConcurrency: 2, maxQueueSize: 16
    });
    const jobs = [...mediaRecords.keys()].map((id) => service.requestPreview(id));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(service.getStatus().running, 2);
    assert.equal(maximum, 2);
    release();
    await Promise.all(jobs);
    assert.equal(maximum, 2);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('shutdown cancels queued/running generation without publishing healthy metadata', async () => {
  const fixture = await createFixture();
  fixture.generators.imageThumbnail = async ({ outputPath, signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
    await fsp.writeFile(outputPath, fakePng('late'));
    return { width: 100, height: 100 };
  };
  try {
    const service = await openService(fixture, { maxConcurrency: 1, maxQueueSize: 4 });
    const pending = service.requestPreview(fixture.media.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.shutdown();
    await assert.rejects(pending, (error) => error instanceof MediaPreviewError && ['PREVIEW_GENERATION_FAILED', 'PREVIEW_CANCELLED'].includes(error.code));
    const artifactId = createArtifactId({
      mediaId: fixture.media.id, sourceHash: fixture.media.sha256, artifactKind: 'image-thumbnail', artifactVersion: 1,
      generatorVersion: 'test-generator-v1'
    });
    assert.equal(await service.resolveArtifact(artifactId), null);
    assert.equal(service.getStatus().shuttingDown, true);
  } finally {
    await cleanup(fixture);
  }
});

test('source content mismatch is rejected before generation', async () => {
  const fixture = await createFixture();
  try {
    await fsp.writeFile(fixture.sourcePath, Buffer.from('tampered-source'));
    fixture.media.fileSize = Buffer.byteLength('tampered-source');
    const service = await openService(fixture);
    await assert.rejects(service.requestPreview(fixture.media.id), (error) => error instanceof MediaPreviewError && error.code === 'PREVIEW_SOURCE_CHANGED');
    assert.equal(fixture.calls.length, 0);
  } finally {
    await cleanup(fixture);
  }
});

test('generator version changes invalidate artifact identity', async () => {
  const fixture = await createFixture();
  try {
    const firstService = await openService(fixture, { generatorVersion: 'generator-v1' });
    const first = await firstService.requestPreview(fixture.media.id);
    const secondService = await openService(fixture, { generatorVersion: 'generator-v2' });
    const second = await secondService.requestPreview(fixture.media.id);
    assert.notEqual(second.artifactId, first.artifactId);
    assert.equal(fixture.calls.length, 2);
  } finally {
    await cleanup(fixture);
  }
});

test('cache deletion removes only derived files and never deletes source media', async () => {
  const fixture = await createFixture();
  try {
    const before = await hashFile(fixture.sourcePath);
    const service = await openService(fixture);
    const result = await service.requestPreview(fixture.media.id);
    const resolved = await service.resolveArtifact(result.artifactId);
    await service.clearMediaCache(fixture.media.id);
    assert.equal(await service.resolveArtifact(result.artifactId), null);
    await assert.rejects(fsp.stat(resolved.filePath), { code: 'ENOENT' });
    assert.equal(await hashFile(fixture.sourcePath), before);
  } finally {
    await cleanup(fixture);
  }
});

test('preview protocol serves only known artifact ids and never exposes a filesystem path', async () => {
  const { installMediaPreviewProtocol, parseArtifactRequest } = require('../src/media/media-preview-protocol.cjs');
  const artifactId = 'a'.repeat(64);
  assert.equal(parseArtifactRequest(`swayforge-preview://artifact/${artifactId}`), artifactId);
  assert.equal(parseArtifactRequest('swayforge-preview://artifact/../../secret'), null);
  assert.equal(parseArtifactRequest(`swayforge-preview://other/${artifactId}`), null);

  let handler;
  const protocolModule = {
    handle(scheme, candidate) {
      assert.equal(scheme, 'swayforge-preview');
      handler = candidate;
    }
  };
  const previewService = {
    async resolveArtifact(id) {
      return id === artifactId ? { artifactId: id, filePath: '/trusted/cache/preview.png', contentType: 'image/png' } : null;
    }
  };
  const reads = [];
  await installMediaPreviewProtocol({
    protocolModule,
    previewService,
    readFile: async (filePath) => {
      reads.push(filePath);
      return fakePng('protocol');
    }
  });
  const response = await handler({ url: `swayforge-preview://artifact/${artifactId}` });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(reads, ['/trusted/cache/preview.png']);
  assert.equal(response.headers.has('x-swayforge-path'), false);

  const rejected = await handler({ url: 'swayforge-preview://artifact/not-an-id' });
  assert.equal(rejected.status, 404);
  assert.equal(reads.length, 1);
});

test('JPEG EXIF orientation is parsed and bitmap rotation preserves pixel identity', () => {
  const { orientBitmap, readExifOrientation } = require('../src/media/image-orientation.cjs');
  const app1Payload = Buffer.alloc(6 + 8 + 2 + 12 + 4);
  Buffer.from('Exif\0\0', 'binary').copy(app1Payload, 0);
  app1Payload.write('II', 6, 'ascii');
  app1Payload.writeUInt16LE(42, 8);
  app1Payload.writeUInt32LE(8, 10);
  app1Payload.writeUInt16LE(1, 14);
  app1Payload.writeUInt16LE(0x0112, 16);
  app1Payload.writeUInt16LE(3, 18);
  app1Payload.writeUInt32LE(1, 20);
  app1Payload.writeUInt16LE(6, 24);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    Buffer.from([(app1Payload.length + 2) >> 8, (app1Payload.length + 2) & 0xff]),
    app1Payload,
    Buffer.from([0xff, 0xd9])
  ]);
  assert.equal(readExifOrientation(jpeg), 6);

  const pixel = (value) => Buffer.from([value, value, value, 255]);
  const bitmap = Buffer.concat([pixel(1), pixel(2), pixel(3), pixel(4), pixel(5), pixel(6)]);
  const rotated = orientBitmap(bitmap, 3, 2, 6);
  assert.deepEqual({ width: rotated.width, height: rotated.height }, { width: 2, height: 3 });
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => rotated.bitmap[index * 4]),
    [4, 1, 5, 2, 6, 3]
  );
});

test('preview scheme is registered with least privilege and no filesystem API capability', () => {
  const { registerMediaPreviewScheme } = require('../src/media/media-preview-protocol.cjs');
  let schemes;
  registerMediaPreviewScheme({ registerSchemesAsPrivileged(value) { schemes = value; } });
  assert.deepEqual(schemes, [{ scheme: 'swayforge-preview', privileges: { secure: true } }]);
});

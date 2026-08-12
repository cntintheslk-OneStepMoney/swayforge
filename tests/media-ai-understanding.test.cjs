'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const { normaliseGenerationRequest, LIMITS } = require('../src/ai/runtime-contracts.cjs');
const {
  MEDIA_AI_RESPONSE_SCHEMA,
  VIDEO_SAMPLE_FRACTIONS,
  VIDEO_SAMPLING_VERSION,
  buildMediaAiContext,
  buildMediaAiRuntimeRequest,
  validateMediaAiResponse
} = require('../src/media/media-ai-contracts.cjs');
const { MediaAiAnalysisService } = require('../src/media/media-ai-analysis-service.cjs');

const IMAGE_ID = '11111111-1111-4111-8111-111111111111';
const VIDEO_ID = '22222222-2222-4222-8222-222222222222';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function validResponse(mediaId, overrides = {}) {
  return {
    responseType: 'swayforge.media_visual_understanding',
    schemaVersion: '1.0.0',
    mediaId,
    description: 'A car parked beside a road in daylight.',
    labels: ['car', 'road'],
    scene: 'roadside',
    activity: 'parked',
    visualQualities: ['wide shot', 'bright'],
    suitabilityNotes: 'Useful establishing footage.',
    limitations: 'Only visible frame content was assessed.',
    ...overrides
  };
}

function makeRuntime({ status, output } = {}) {
  const calls = [];
  return {
    calls,
    async getStatus() {
      return status ?? { provider: 'ollama', state: 'ready', model: 'vision-local', capabilities: ['completion', 'vision'] };
    },
    startGeneration(request) {
      calls.push(request);
      const content = typeof output === 'function' ? output(request) : output ?? JSON.stringify(validResponse(IMAGE_ID));
      return {
        requestId: `runtime-${calls.length}`,
        result: Promise.resolve({ ok: true, requestId: `runtime-${calls.length}`, model: request.model, content })
      };
    }
  };
}

async function createFixture({ kind = 'image', runtime, frameProvider } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-media-ai-'));
  const derivedRoot = path.join(root, 'derived');
  const mediaRoot = path.join(root, 'media');
  const previewRoot = path.join(root, 'preview');
  await fs.mkdir(mediaRoot, { recursive: true });
  await fs.mkdir(previewRoot, { recursive: true });

  const imagePreviewPath = path.join(previewRoot, 'image.png');
  await fs.writeFile(imagePreviewPath, Buffer.from('bounded synthetic preview'));

  const videoBytes = Buffer.alloc(1024 * 1024, 0x5a);
  const videoPath = path.join(mediaRoot, 'video.mp4');
  await fs.writeFile(videoPath, videoBytes);

  const media = kind === 'video'
    ? {
        id: VIDEO_ID,
        kind: 'video',
        availability: 'ready',
        sha256: sha256(videoBytes),
        fileSize: videoBytes.length,
        importMode: 'managed-copy',
        managedReference: 'video.mp4',
        width: 1920,
        height: 1080,
        durationSeconds: 7200,
        userTags: ['user-kept']
      }
    : {
        id: IMAGE_ID,
        kind: 'image',
        availability: 'ready',
        sha256: 'a'.repeat(64),
        fileSize: 100,
        importMode: 'managed-copy',
        managedReference: 'image.jpg',
        width: 1200,
        height: 800,
        durationSeconds: null,
        userTags: ['user-kept']
      };

  const repository = {
    media,
    async getMediaRecord(mediaId) {
      return mediaId === this.media.id ? { media: this.media } : null;
    }
  };
  const previewService = {
    requests: 0,
    async requestPreview(mediaId) {
      this.requests += 1;
      assert.equal(mediaId, IMAGE_ID);
      return { status: 'ready', artifactId: 'artifact-1' };
    },
    async resolveArtifact(artifactId) {
      assert.equal(artifactId, 'artifact-1');
      return { filePath: imagePreviewPath, contentType: 'image/png' };
    }
  };
  const defaultFrames = async ({ sampleFractions, maxDimension }) => ({
    frames: sampleFractions.map((fraction, index) => ({
      fraction,
      pngBase64: Buffer.from(`frame-${index}`).toString('base64'),
      width: maxDimension,
      height: Math.round(maxDimension * 9 / 16)
    }))
  });
  const selectedRuntime = runtime ?? makeRuntime({
    output: () => JSON.stringify(validResponse(kind === 'video' ? VIDEO_ID : IMAGE_ID))
  });
  const service = await MediaAiAnalysisService.open({
    rootDirectory: derivedRoot,
    mediaRootDirectory: mediaRoot,
    repository,
    runtimeProvider: () => selectedRuntime,
    previewService,
    videoFrameProvider: frameProvider ?? defaultFrames,
    now: () => new Date('2026-08-12T18:00:00.000Z')
  });
  return { root, derivedRoot, mediaRoot, media, repository, previewService, runtime: selectedRuntime, service, videoBytes };
}

test('unsupported multimodal model produces a clear unavailable state without touching media inputs', async () => {
  const runtime = makeRuntime({ status: { provider: 'ollama', state: 'ready', model: 'text-local', capabilities: ['completion'] } });
  const fixture = await createFixture({ runtime });
  const result = await fixture.service.analyse(IMAGE_ID);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error.code, 'VISION_CAPABILITY_UNAVAILABLE');
  assert.equal(fixture.previewService.requests, 0);
  assert.equal(runtime.calls.length, 0);
});

test('valid synthetic image analysis passes schema and sends only one bounded preview image', async () => {
  const fixture = await createFixture();
  const result = await fixture.service.analyse(IMAGE_ID);
  assert.equal(result.status, 'ready');
  assert.equal(result.description, 'A car parked beside a road in daylight.');
  assert.deepEqual(result.labels, ['car', 'road']);
  assert.equal(fixture.runtime.calls.length, 1);
  const request = normaliseGenerationRequest(fixture.runtime.calls[0]);
  assert.equal(request.messages[1].images.length, 1);
  assert.equal(request.messages[1].images[0].includes('file:'), false);
});

test('invented media ID from model output is rejected and never becomes ready derived metadata', async () => {
  const runtime = makeRuntime({ output: JSON.stringify(validResponse('33333333-3333-4333-8333-333333333333')) });
  const fixture = await createFixture({ runtime });
  const result = await fixture.service.analyse(IMAGE_ID);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'VALIDATION_UNKNOWN_REFERENCE');
  assert.deepEqual(fixture.service.getIndexMetadata(fixture.media), {});
});

test('malformed model output fails safely and persists no accepted AI description', async () => {
  const fixture = await createFixture({ runtime: makeRuntime({ output: 'not-json' }) });
  const result = await fixture.service.analyse(IMAGE_ID);
  assert.equal(result.status, 'failed');
  assert.equal(result.description, '');
  assert.equal(result.error.code, 'VALIDATION_MALFORMED_JSON');
});

test('video sampling is deterministic and bounded to the configured representative fractions', async () => {
  let observed = null;
  const frameProvider = async (input) => {
    observed = input;
    return {
      frames: input.sampleFractions.map((fraction, index) => ({
        fraction,
        pngBase64: Buffer.from(`sample-${index}`).toString('base64'),
        width: input.maxDimension,
        height: 288
      }))
    };
  };
  const fixture = await createFixture({ kind: 'video', frameProvider });
  const result = await fixture.service.analyse(VIDEO_ID);
  assert.equal(result.status, 'ready');
  assert.deepEqual(observed.sampleFractions, VIDEO_SAMPLE_FRACTIONS);
  assert.equal(result.sampling.version, VIDEO_SAMPLING_VERSION);
  assert.deepEqual(result.sampling.sourceFrames.map((frame) => frame.fraction), VIDEO_SAMPLE_FRACTIONS);
  assert.equal(fixture.runtime.calls[0].messages[1].images.length, 3);
});

test('long video is never attached wholesale to the model request', async () => {
  const fixture = await createFixture({ kind: 'video' });
  const result = await fixture.service.analyse(VIDEO_ID);
  assert.equal(result.status, 'ready');
  const requestJson = JSON.stringify(fixture.runtime.calls[0]);
  assert.ok(Buffer.byteLength(requestJson, 'utf8') < 50_000);
  assert.doesNotMatch(requestJson, /video\.mp4|file:\/\//i);
  assert.equal(fixture.runtime.calls[0].messages[1].images.length, 3);
  assert.ok(fixture.videoBytes.length > Buffer.byteLength(requestJson, 'utf8'));
});

test('source hash change marks stored analysis stale and removes it from index-derived fields', async () => {
  const fixture = await createFixture();
  const ready = await fixture.service.analyse(IMAGE_ID);
  assert.equal(ready.status, 'ready');
  fixture.repository.media = { ...fixture.repository.media, sha256: 'b'.repeat(64) };
  const stale = await fixture.service.getAnalysis(IMAGE_ID);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.error.code, 'SOURCE_CHANGED');
  assert.deepEqual(fixture.service.getIndexMetadata(fixture.repository.media), {});
});

test('user-authored tags remain untouched while index receives separate AI-derived fields', async () => {
  const fixture = await createFixture();
  const before = structuredClone(fixture.repository.media.userTags);
  await fixture.service.analyse(IMAGE_ID);
  assert.deepEqual(fixture.repository.media.userTags, before);
  const derived = fixture.service.getIndexMetadata(fixture.repository.media);
  assert.equal(derived.aiDescription, 'A car parked beside a road in daylight.');
  assert.ok(derived.aiLabels.includes('car'));
  assert.equal(Object.hasOwn(derived, 'userTags'), false);
});

test('AI output remains bounded inert text and unsupported authority fields are rejected', () => {
  const markup = '<script>globalThis.pwned=true</script>';
  const inert = validateMediaAiResponse(JSON.stringify(validResponse(IMAGE_ID, { description: markup })), IMAGE_ID);
  assert.equal(inert.ok, true);
  assert.equal(inert.value.description, markup);
  assert.equal(globalThis.pwned, undefined);

  const overlong = validateMediaAiResponse(JSON.stringify(validResponse(IMAGE_ID, { description: 'x'.repeat(601) })), IMAGE_ID);
  assert.equal(overlong.ok, false);
  assert.equal(overlong.error.code, 'too-long');

  const authority = validateMediaAiResponse(JSON.stringify(validResponse(IMAGE_ID, { action: 'publish' })), IMAGE_ID);
  assert.equal(authority.ok, false);
  assert.equal(authority.error.code, 'unexpected-field');
});

test('schema deliberately excludes identity, biometric, emotion and sensitive-trait fields', () => {
  const keys = Object.keys(MEDIA_AI_RESPONSE_SCHEMA.properties).join(' ').toLowerCase();
  for (const forbidden of ['identity', 'biometric', 'emotion', 'race', 'ethnicity', 'religion', 'sexuality', 'health', 'political']) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
  assert.equal(MEDIA_AI_RESPONSE_SCHEMA.additionalProperties, false);
  const response = validateMediaAiResponse(JSON.stringify(validResponse(IMAGE_ID, { personIdentity: 'Jane Doe' })), IMAGE_ID);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'unexpected-field');
});

test('prompt injection in media context cannot add tools, endpoints, filesystem paths or publishing authority', () => {
  const media = { id: IMAGE_ID, kind: 'image', width: 10, height: 10, durationSeconds: null };
  const context = buildMediaAiContext(media, [{ kind: 'image-preview', artifactId: 'artifact' }]);
  const request = buildMediaAiRuntimeRequest({ model: 'vision-local', context, images: [Buffer.from('image').toString('base64')] });
  const serialised = JSON.stringify(request);
  assert.match(request.messages[0].content, /untrusted content/i);
  assert.match(request.messages[0].content, /Do not identify a person/i);
  assert.equal(request.tools, undefined);
  assert.equal(request.endpoint, undefined);
  assert.equal(request.providerOptions, undefined);
  assert.doesNotMatch(serialised, /oauth|accessToken|sourcePath/);
});

test('media AI implementation has no diagnostics payload, cloud fallback or automatic model-download path', async () => {
  const files = [
    path.join(__dirname, '..', 'src', 'media', 'media-ai-analysis-service.cjs'),
    path.join(__dirname, '..', 'src', 'media', 'media-ai-contracts.cjs')
  ];
  const source = (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /DiagnosticStore|diagnosticStore|logger\s*\(/);
  assert.doesNotMatch(source, /ollama\.com|\/api\/pull|cloud fallback|https:\/\//i);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('runtime image contract accepts bounded base64 only and rejects paths, URLs and oversized frame payloads', () => {
  const base = {
    model: 'vision-local',
    messages: [{ role: 'user', content: 'analyse', images: [Buffer.from('frame').toString('base64')] }]
  };
  const valid = normaliseGenerationRequest(base);
  assert.equal(valid.messages[0].images.length, 1);
  assert.throws(() => normaliseGenerationRequest({ ...base, messages: [{ role: 'user', content: 'analyse', images: ['file:///secret.jpg'] }] }), /Invalid AI image payload/);
  assert.throws(() => normaliseGenerationRequest({ ...base, messages: [{ role: 'user', content: 'analyse', images: [Buffer.alloc(LIMITS.maxImageBytes + 1).toString('base64')] }] }), /exceeds its configured bound/);
  assert.throws(() => normaliseGenerationRequest({ ...base, messages: [{ role: 'system', content: 'analyse', images: [Buffer.from('frame').toString('base64')] }] }), /only permitted on bounded user messages/);
});

test('Media Inspector exposes explicit local analysis while ordinary library render does not auto-run inference', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'src', 'renderer', 'media-library.js'), 'utf8');
  assert.match(source, /Local AI understanding/);
  assert.match(source, /Analyze locally/);
  assert.match(source, /bridge\.analyzeMediaLocally\(item\.id\)/);
  const renderStart = source.indexOf('    render() {');
  const showStateStart = source.indexOf('    showState(', renderStart);
  assert.doesNotMatch(source.slice(renderStart, showStateStart), /analyzeMediaLocally/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
});

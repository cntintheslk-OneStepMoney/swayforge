'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LIMITS, normaliseImagePayload } = require('../ai/runtime-contracts.cjs');
const {
  IMAGE_SAMPLING_VERSION,
  MEDIA_AI_MAX_FRAME_DIMENSION,
  VIDEO_SAMPLE_FRACTIONS,
  VIDEO_SAMPLING_VERSION,
  buildMediaAiContext,
  buildMediaAiRuntimeRequest,
  taskMetadata,
  validateMediaAiResponse
} = require('./media-ai-contracts.cjs');

const MEDIA_AI_STORE_SCHEMA_VERSION = 1;
const MEDIA_AI_RECORD_VERSION = 1;
const STORE_FILENAME = 'analyses.json';

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new MediaAiAnalysisError('MEDIA_AI_PATH_INVALID', 'Derived analysis path escaped its trusted root.');
  }
  return resolved;
}

async function hashFile(filePath) {
  const { createHash } = require('node:crypto');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

class MediaAiAnalysisError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MediaAiAnalysisError';
    this.code = code;
  }
}

function createEmptyStore() {
  return { schemaVersion: MEDIA_AI_STORE_SCHEMA_VERSION, records: {} };
}

function samplingVersionFor(media) {
  return media?.kind === 'video' ? VIDEO_SAMPLING_VERSION : IMAGE_SAMPLING_VERSION;
}

function isStoreShape(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.schemaVersion === MEDIA_AI_STORE_SCHEMA_VERSION &&
    value.records &&
    typeof value.records === 'object' &&
    !Array.isArray(value.records)
  );
}

function isCurrentRecord(record, media) {
  const task = taskMetadata();
  return Boolean(
    record &&
    record.recordVersion === MEDIA_AI_RECORD_VERSION &&
    record.mediaId === media.id &&
    record.sourceHash === media.sha256 &&
    record.task?.id === task.id &&
    record.task?.taskVersion === task.taskVersion &&
    record.task?.schemaVersion === task.schemaVersion &&
    record.sampling?.version === samplingVersionFor(media)
  );
}

function publicAnalysis(record) {
  if (!record) return null;
  return Object.freeze({
    mediaId: record.mediaId,
    status: record.status,
    provider: record.provider,
    model: record.model,
    generatedAt: record.generatedAt,
    task: Object.freeze({ ...record.task }),
    sampling: Object.freeze({
      ...record.sampling,
      sourceFrames: Object.freeze((record.sampling?.sourceFrames ?? []).map((frame) => Object.freeze({ ...frame })))
    }),
    description: record.description,
    labels: Object.freeze([...(record.labels ?? [])]),
    scene: record.scene,
    activity: record.activity,
    visualQualities: Object.freeze([...(record.visualQualities ?? [])]),
    suitabilityNotes: record.suitabilityNotes,
    limitations: record.limitations,
    error: record.error ? Object.freeze({ ...record.error }) : null
  });
}

function analysisFailureRecord({ media, status, provider = 'ollama', model = null, code, message, generatedAt }) {
  return {
    recordVersion: MEDIA_AI_RECORD_VERSION,
    mediaId: media.id,
    sourceHash: media.sha256,
    status,
    provider,
    model,
    generatedAt,
    task: taskMetadata(),
    sampling: {
      version: samplingVersionFor(media),
      sourceFrames: []
    },
    description: '',
    labels: [],
    scene: '',
    activity: '',
    visualQualities: [],
    suitabilityNotes: '',
    limitations: '',
    error: { code, message }
  };
}

class MediaAiAnalysisService {
  static async open(options) {
    const service = new MediaAiAnalysisService(options);
    await service.initialise();
    return service;
  }

  constructor({
    rootDirectory,
    mediaRootDirectory,
    repository,
    runtimeProvider,
    previewService,
    videoFrameProvider,
    now = () => new Date()
  } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) throw new TypeError('rootDirectory must be an absolute trusted path.');
    if (typeof mediaRootDirectory !== 'string' || !path.isAbsolute(mediaRootDirectory)) throw new TypeError('mediaRootDirectory must be an absolute trusted path.');
    if (!repository || typeof repository.getMediaRecord !== 'function') throw new TypeError('repository must provide getMediaRecord(mediaId).');
    if (typeof runtimeProvider !== 'function') throw new TypeError('runtimeProvider must be a function.');
    if (!previewService || typeof previewService.requestPreview !== 'function' || typeof previewService.resolveArtifact !== 'function') {
      throw new TypeError('previewService is invalid.');
    }
    if (typeof videoFrameProvider !== 'function') throw new TypeError('videoFrameProvider must be a function.');
    if (typeof now !== 'function') throw new TypeError('now must be a function.');

    this.rootDirectory = path.resolve(rootDirectory);
    this.mediaRootDirectory = path.resolve(mediaRootDirectory);
    this.storePath = path.join(this.rootDirectory, STORE_FILENAME);
    this.repository = repository;
    this.runtimeProvider = runtimeProvider;
    this.previewService = previewService;
    this.videoFrameProvider = videoFrameProvider;
    this.now = now;
    this.store = createEmptyStore();
    this.writeTail = Promise.resolve();
    this.inFlight = new Map();
  }

  async initialise() {
    await fsp.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.storePath, 'utf8'));
      if (!isStoreShape(parsed)) throw new Error('Derived media AI store is invalid.');
      this.store = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') await this.quarantineStore().catch(() => {});
      this.store = createEmptyStore();
    }
  }

  timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('now() must return a valid Date.');
    return value.toISOString();
  }

  async quarantineStore() {
    const target = path.join(this.rootDirectory, `analyses.corrupt-${Date.now()}-${randomUUID()}.json`);
    await fsp.rename(this.storePath, target).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  async persist() {
    const snapshot = `${JSON.stringify(this.store, null, 2)}\n`;
    const write = async () => {
      const temporary = ensureInside(this.rootDirectory, path.join(this.rootDirectory, `.analyses-${randomUUID()}.tmp`));
      try {
        await fsp.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        try {
          await fsp.rename(temporary, this.storePath);
        } catch (error) {
          if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
          await fsp.rm(this.storePath, { force: true });
          await fsp.rename(temporary, this.storePath);
        }
      } finally {
        await fsp.rm(temporary, { force: true }).catch(() => {});
      }
    };
    this.writeTail = this.writeTail.then(write, write);
    return this.writeTail;
  }

  async getMedia(mediaId) {
    const snapshot = await this.repository.getMediaRecord(mediaId);
    const media = snapshot?.media;
    if (!media || media.id !== mediaId) throw new MediaAiAnalysisError('MEDIA_NOT_FOUND', 'Media record is unavailable.');
    if (!['image', 'video'].includes(media.kind)) throw new MediaAiAnalysisError('MEDIA_AI_UNSUPPORTED', 'Media kind is not supported for local AI analysis.');
    if (media.availability !== 'ready') throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_UNAVAILABLE', 'Media source is not ready for local AI analysis.');
    if (typeof media.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(media.sha256)) {
      throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_INVALID', 'Media content identity is invalid.');
    }
    return media;
  }

  async getAnalysis(mediaId) {
    const media = await this.getMedia(mediaId);
    const record = this.store.records[mediaId] ?? null;
    if (!record) return null;
    if (isCurrentRecord(record, media)) return publicAnalysis(record);

    const stale = {
      ...record,
      status: 'stale',
      error: {
        code: record.sourceHash === media.sha256 ? 'ANALYSIS_VERSION_CHANGED' : 'SOURCE_CHANGED',
        message: 'Stored AI-derived analysis is stale and must be regenerated.'
      }
    };
    this.store.records[mediaId] = stale;
    await this.persist();
    return publicAnalysis(stale);
  }

  async collectImageInput(media) {
    const preview = await this.previewService.requestPreview(media.id);
    if (!preview || preview.status !== 'ready' || typeof preview.artifactId !== 'string') {
      throw new MediaAiAnalysisError('MEDIA_AI_PREVIEW_UNAVAILABLE', 'A bounded local image preview is unavailable.');
    }
    const artifact = await this.previewService.resolveArtifact(preview.artifactId);
    if (!artifact || artifact.contentType !== 'image/png' || typeof artifact.filePath !== 'string') {
      throw new MediaAiAnalysisError('MEDIA_AI_PREVIEW_UNAVAILABLE', 'A bounded local image preview is unavailable.');
    }
    const stat = await fsp.stat(artifact.filePath);
    if (!stat.isFile() || stat.size < 1 || stat.size > LIMITS.maxImageBytes) {
      throw new MediaAiAnalysisError('MEDIA_AI_PREVIEW_INVALID', 'The bounded local image preview exceeded the analysis limit.');
    }
    const payload = (await fsp.readFile(artifact.filePath)).toString('base64');
    normaliseImagePayload(payload);
    return Object.freeze({
      images: Object.freeze([payload]),
      sourceFrames: Object.freeze([Object.freeze({ kind: 'image-preview', artifactId: preview.artifactId })])
    });
  }

  resolveManagedSource(media) {
    if (media.importMode !== 'managed-copy' || typeof media.managedReference !== 'string') {
      throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_UNAVAILABLE', 'Video analysis requires trusted managed media.');
    }
    const segments = media.managedReference.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
      throw new MediaAiAnalysisError('MEDIA_AI_PATH_INVALID', 'Managed media reference is invalid.');
    }
    return ensureInside(this.mediaRootDirectory, path.join(this.mediaRootDirectory, ...segments));
  }

  async collectVideoInput(media) {
    const sourcePath = this.resolveManagedSource(media);
    const stat = await fsp.stat(sourcePath).catch((error) => {
      if (error?.code === 'ENOENT') throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_UNAVAILABLE', 'Managed video is missing.', { cause: error });
      throw error;
    });
    if (!stat.isFile()) throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_UNAVAILABLE', 'Managed video is not a regular file.');
    if (Number.isSafeInteger(media.fileSize) && stat.size !== media.fileSize) {
      throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_CHANGED', 'Managed video size no longer matches its authoritative record.');
    }
    if (await hashFile(sourcePath) !== media.sha256) {
      throw new MediaAiAnalysisError('MEDIA_AI_SOURCE_CHANGED', 'Managed video content no longer matches its authoritative hash.');
    }

    const sampled = await this.videoFrameProvider({
      media,
      sourcePath,
      sampleFractions: VIDEO_SAMPLE_FRACTIONS,
      maxDimension: MEDIA_AI_MAX_FRAME_DIMENSION
    });
    if (!sampled || !Array.isArray(sampled.frames) || sampled.frames.length !== VIDEO_SAMPLE_FRACTIONS.length) {
      throw new MediaAiAnalysisError('MEDIA_AI_FRAME_INVALID', 'Representative video frame extraction returned an invalid result.');
    }

    const images = [];
    const sourceFrames = [];
    for (let index = 0; index < sampled.frames.length; index += 1) {
      const frame = sampled.frames[index];
      const expectedFraction = VIDEO_SAMPLE_FRACTIONS[index];
      if (!frame || frame.fraction !== expectedFraction || typeof frame.pngBase64 !== 'string') {
        throw new MediaAiAnalysisError('MEDIA_AI_FRAME_INVALID', 'Representative video frame extraction was not deterministic.');
      }
      normaliseImagePayload(frame.pngBase64);
      images.push(frame.pngBase64);
      sourceFrames.push(Object.freeze({
        kind: 'video-frame',
        fraction: expectedFraction,
        width: Number.isFinite(frame.width) ? frame.width : null,
        height: Number.isFinite(frame.height) ? frame.height : null
      }));
    }
    return Object.freeze({ images: Object.freeze(images), sourceFrames: Object.freeze(sourceFrames) });
  }

  async analyse(mediaId) {
    if (this.inFlight.has(mediaId)) return this.inFlight.get(mediaId);
    const operation = this.runAnalysis(mediaId).finally(() => this.inFlight.delete(mediaId));
    this.inFlight.set(mediaId, operation);
    return operation;
  }

  async runAnalysis(mediaId) {
    const media = await this.getMedia(mediaId);
    const runtime = this.runtimeProvider();
    if (!runtime || typeof runtime.getStatus !== 'function' || typeof runtime.startGeneration !== 'function') {
      throw new MediaAiAnalysisError('MEDIA_AI_RUNTIME_INVALID', 'Local AI runtime is unavailable.');
    }

    const status = await runtime.getStatus({ refresh: true });
    const generatedAt = this.timestamp();
    const provider = typeof status?.provider === 'string' ? status.provider : 'ollama';
    const model = typeof status?.model === 'string' ? status.model : null;
    if (status?.state !== 'ready' || !model) {
      const record = analysisFailureRecord({
        media,
        status: 'unavailable',
        provider,
        model,
        code: `RUNTIME_${String(status?.state ?? 'unavailable').toUpperCase().replaceAll('-', '_')}`,
        message: 'Local multimodal analysis is unavailable with the current runtime configuration.',
        generatedAt
      });
      this.store.records[mediaId] = record;
      await this.persist();
      return publicAnalysis(record);
    }
    if (!Array.isArray(status.capabilities) || !status.capabilities.includes('vision')) {
      const record = analysisFailureRecord({
        media,
        status: 'unavailable',
        provider,
        model,
        code: 'VISION_CAPABILITY_UNAVAILABLE',
        message: 'The selected local model does not declare vision capability.',
        generatedAt
      });
      this.store.records[mediaId] = record;
      await this.persist();
      return publicAnalysis(record);
    }

    let input;
    try {
      input = media.kind === 'image' ? await this.collectImageInput(media) : await this.collectVideoInput(media);
    } catch (error) {
      const record = analysisFailureRecord({
        media,
        status: 'failed',
        provider,
        model,
        code: typeof error?.code === 'string' ? error.code : 'MEDIA_AI_INPUT_FAILED',
        message: 'Bounded local media inputs could not be prepared safely. Source media was preserved.',
        generatedAt
      });
      this.store.records[mediaId] = record;
      await this.persist();
      return publicAnalysis(record);
    }

    const context = buildMediaAiContext(media, input.sourceFrames);
    const request = buildMediaAiRuntimeRequest({ model, context, images: input.images });
    const handle = runtime.startGeneration(request);
    const result = await handle.result;
    if (!result?.ok) {
      const record = analysisFailureRecord({
        media,
        status: result?.error?.category === 'unsupported' || result?.error?.category === 'model-unavailable' ? 'unavailable' : 'failed',
        provider,
        model,
        code: `RUNTIME_${String(result?.error?.category ?? 'error').toUpperCase().replaceAll('-', '_')}`,
        message: 'The local multimodal model could not complete media analysis safely.',
        generatedAt
      });
      record.sampling.sourceFrames = input.sourceFrames.map((frame) => ({ ...frame }));
      this.store.records[mediaId] = record;
      await this.persist();
      return publicAnalysis(record);
    }

    const validation = validateMediaAiResponse(result.content, media.id);
    if (!validation.ok) {
      const record = analysisFailureRecord({
        media,
        status: 'failed',
        provider,
        model,
        code: `VALIDATION_${validation.error.code.toUpperCase().replaceAll('-', '_')}`,
        message: 'The local model response did not match the bounded media-analysis contract.',
        generatedAt
      });
      record.sampling.sourceFrames = input.sourceFrames.map((frame) => ({ ...frame }));
      this.store.records[mediaId] = record;
      await this.persist();
      return publicAnalysis(record);
    }

    const value = validation.value;
    const record = {
      recordVersion: MEDIA_AI_RECORD_VERSION,
      mediaId: media.id,
      sourceHash: media.sha256,
      status: 'ready',
      provider,
      model,
      generatedAt,
      task: taskMetadata(),
      sampling: {
        version: samplingVersionFor(media),
        sourceFrames: input.sourceFrames.map((frame) => ({ ...frame }))
      },
      description: value.description,
      labels: [...value.labels],
      scene: value.scene,
      activity: value.activity,
      visualQualities: [...value.visualQualities],
      suitabilityNotes: value.suitabilityNotes,
      limitations: value.limitations,
      error: null
    };
    this.store.records[mediaId] = record;
    await this.persist();
    return publicAnalysis(record);
  }

  getIndexMetadata(media) {
    const record = media && this.store.records[media.id];
    if (!media || !record || record.status !== 'ready' || !isCurrentRecord(record, media)) return Object.freeze({});
    const aiLabels = [...new Set([
      ...(record.labels ?? []),
      record.scene,
      record.activity,
      ...(record.visualQualities ?? [])
    ].filter(Boolean))];
    return Object.freeze({ aiLabels: Object.freeze(aiLabels), aiDescription: record.description });
  }
}

module.exports = {
  MEDIA_AI_RECORD_VERSION,
  MEDIA_AI_STORE_SCHEMA_VERSION,
  MediaAiAnalysisError,
  MediaAiAnalysisService,
  analysisFailureRecord,
  createEmptyStore,
  isCurrentRecord,
  publicAnalysis,
  samplingVersionFor
};

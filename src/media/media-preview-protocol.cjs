'use strict';

const fsp = require('node:fs/promises');

const MEDIA_PREVIEW_SCHEME = 'swayforge-preview';
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;

function registerMediaPreviewScheme(protocolModule) {
  if (!protocolModule || typeof protocolModule.registerSchemesAsPrivileged !== 'function') {
    throw new TypeError('Electron protocol module is required.');
  }
  protocolModule.registerSchemesAsPrivileged([{
    scheme: MEDIA_PREVIEW_SCHEME,
    privileges: { secure: true }
  }]);
}

function parseArtifactRequest(requestUrl) {
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== `${MEDIA_PREVIEW_SCHEME}:` || parsed.hostname !== 'artifact') return null;
    if (parsed.search || parsed.hash) return null;
    const artifactId = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
    return ARTIFACT_ID_PATTERN.test(artifactId) ? artifactId : null;
  } catch {
    return null;
  }
}

function response(ResponseClass, body, status, headers = {}) {
  return new ResponseClass(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

async function installMediaPreviewProtocol({
  protocolModule,
  previewService,
  readFile = fsp.readFile,
  ResponseClass = globalThis.Response
} = {}) {
  if (!protocolModule || typeof protocolModule.handle !== 'function') {
    throw new TypeError('Electron protocol module must support handle().');
  }
  if (!previewService || typeof previewService.resolveArtifact !== 'function') {
    throw new TypeError('previewService must support resolveArtifact().');
  }
  if (typeof readFile !== 'function' || typeof ResponseClass !== 'function') {
    throw new TypeError('Preview protocol dependencies are invalid.');
  }

  await protocolModule.handle(MEDIA_PREVIEW_SCHEME, async (request) => {
    const artifactId = parseArtifactRequest(request?.url);
    if (!artifactId) return response(ResponseClass, null, 404);
    const artifact = await previewService.resolveArtifact(artifactId);
    if (!artifact) return response(ResponseClass, null, 404);
    try {
      const bytes = await readFile(artifact.filePath);
      return response(ResponseClass, bytes, 200, { 'Content-Type': artifact.contentType });
    } catch {
      return response(ResponseClass, null, 404);
    }
  });
}

module.exports = {
  ARTIFACT_ID_PATTERN,
  MEDIA_PREVIEW_SCHEME,
  installMediaPreviewProtocol,
  parseArtifactRequest,
  registerMediaPreviewScheme
};

'use strict';

const MEDIA_IPC_CHANNELS = Object.freeze({
  chooseImport: 'swayforge:media:choose-import',
  list: 'swayforge:media:list',
  attach: 'swayforge:media:attach',
  detach: 'swayforge:media:detach',
  preview: 'swayforge:media:preview',
  previewRebuild: 'swayforge:media:preview-rebuild'
});

const MEDIA_CHOOSE_REQUEST = Object.freeze({ kind: 'choose-media-import', version: 1 });
const MEDIA_PREVIEW_REQUEST_KIND = 'media-preview-request';
const MEDIA_PREVIEW_REBUILD_REQUEST_KIND = 'media-preview-rebuild-request';
const MEDIA_PREVIEW_REQUEST_VERSION = 1;
const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPPORTED_MEDIA = Object.freeze({
  '.jpg': Object.freeze({ kind: 'image', canonicalExtension: '.jpg', container: 'jpeg' }),
  '.jpeg': Object.freeze({ kind: 'image', canonicalExtension: '.jpg', container: 'jpeg' }),
  '.png': Object.freeze({ kind: 'image', canonicalExtension: '.png', container: 'png' }),
  '.mp4': Object.freeze({ kind: 'video', canonicalExtension: '.mp4', container: 'mp4' }),
  '.mov': Object.freeze({ kind: 'video', canonicalExtension: '.mov', container: 'quicktime' })
});

function isChooseMediaRequest(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.kind === MEDIA_CHOOSE_REQUEST.kind &&
    value.version === MEDIA_CHOOSE_REQUEST.version &&
    Object.keys(value).length === 2
  );
}

function validateProjectMediaRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('media project request must be an object.');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'expectedRevision,mediaId,projectId') throw new TypeError('media project request contains unsupported fields.');
  if (
    typeof value.projectId !== 'string' ||
    !MEDIA_ID_PATTERN.test(value.mediaId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  ) {
    throw new TypeError('media project request is invalid.');
  }
  return value;
}

function validateMediaPreviewRequest(value, expectedKind = MEDIA_PREVIEW_REQUEST_KIND) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('media preview request must be an object.');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'kind,mediaId,version') throw new TypeError('media preview request contains unsupported fields.');
  if (
    value.kind !== expectedKind ||
    value.version !== MEDIA_PREVIEW_REQUEST_VERSION ||
    !MEDIA_ID_PATTERN.test(value.mediaId)
  ) {
    throw new TypeError('media preview request is invalid.');
  }
  return value;
}

module.exports = {
  MEDIA_CHOOSE_REQUEST,
  MEDIA_ID_PATTERN,
  MEDIA_IPC_CHANNELS,
  MEDIA_PREVIEW_REBUILD_REQUEST_KIND,
  MEDIA_PREVIEW_REQUEST_KIND,
  MEDIA_PREVIEW_REQUEST_VERSION,
  SUPPORTED_MEDIA,
  isChooseMediaRequest,
  validateMediaPreviewRequest,
  validateProjectMediaRequest
};

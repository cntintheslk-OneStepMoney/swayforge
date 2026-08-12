'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, nativeImage } = require('electron');
const { WINDOW_WEB_PREFERENCES, installNavigationGuards } = require('../security/electron-window-policy.cjs');
const { orientBitmap, readExifOrientation } = require('./image-orientation.cjs');

const VIDEO_POSTER_WORKER = path.join(__dirname, 'video-poster-worker.html');
const EXIF_HEADER_LIMIT = 256 * 1024;

function fitWithin(width, height, maxDimension) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Preview source dimensions are invalid.');
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function readBoundedHeader(filePath, maxBytes = EXIF_HEADER_LIMIT) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function imageThumbnail({ sourcePath, outputPath, maxDimension, signal }) {
  if (signal?.aborted) throw Object.assign(new Error('Preview generation aborted.'), { name: 'AbortError' });
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('Electron could not decode the image preview source.');
  const sourceSize = image.getSize();
  const target = fitWithin(sourceSize.width, sourceSize.height, maxDimension);
  let resized = image.resize({ width: target.width, height: target.height, quality: 'good' });
  let outputSize = target;

  if (path.extname(sourcePath).toLowerCase() === '.jpg') {
    const orientation = readExifOrientation(await readBoundedHeader(sourcePath));
    if (orientation !== 1) {
      const transformed = orientBitmap(resized.toBitmap(), target.width, target.height, orientation);
      resized = nativeImage.createFromBitmap(transformed.bitmap, {
        width: transformed.width,
        height: transformed.height,
        scaleFactor: 1
      });
      if (resized.isEmpty()) throw new Error('Electron could not apply image orientation safely.');
      outputSize = { width: transformed.width, height: transformed.height };
    }
  }

  const png = resized.toPNG();
  if (!png || png.length === 0) throw new Error('Electron produced an empty image preview.');
  if (signal?.aborted) throw Object.assign(new Error('Preview generation aborted.'), { name: 'AbortError' });
  await fsp.writeFile(outputPath, png, { mode: 0o600, flag: 'wx' });
  return outputSize;
}

async function videoPoster({ sourcePath, outputPath, maxDimension, signal }) {
  if (signal?.aborted) throw Object.assign(new Error('Preview generation aborted.'), { name: 'AbortError' });
  const workerUrl = pathToFileURL(VIDEO_POSTER_WORKER).href;
  const sourceUrl = pathToFileURL(sourcePath).href;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      ...WINDOW_WEB_PREFERENCES,
      offscreen: true,
      backgroundThrottling: false
    }
  });
  installNavigationGuards(window.webContents, [workerUrl]);

  const abort = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    await window.loadFile(VIDEO_POSTER_WORKER);
    if (signal?.aborted || window.isDestroyed()) {
      throw Object.assign(new Error('Preview generation aborted.'), { name: 'AbortError' });
    }
    const result = await window.webContents.executeJavaScript(
      `globalThis.swayForgeExtractVideoPoster(${JSON.stringify({ sourceUrl, maxDimension })})`,
      true
    );
    if (!result || typeof result.pngBase64 !== 'string') throw new Error('Video poster worker returned an invalid result.');
    const png = Buffer.from(result.pngBase64, 'base64');
    if (png.length === 0) throw new Error('Video poster worker produced an empty preview.');
    if (signal?.aborted) throw Object.assign(new Error('Preview generation aborted.'), { name: 'AbortError' });
    await fsp.writeFile(outputPath, png, { mode: 0o600, flag: 'wx' });
    return {
      width: result.width,
      height: result.height,
      durationSeconds: result.durationSeconds
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!window.isDestroyed()) window.destroy();
  }
}

function createElectronPreviewGenerators() {
  return Object.freeze({ imageThumbnail, videoPoster });
}

module.exports = {
  EXIF_HEADER_LIMIT,
  createElectronPreviewGenerators,
  fitWithin,
  imageThumbnail,
  readBoundedHeader,
  videoPoster
};

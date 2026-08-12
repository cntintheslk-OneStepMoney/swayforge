'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, nativeImage } = require('electron');
const { WINDOW_WEB_PREFERENCES, installNavigationGuards } = require('../security/electron-window-policy.cjs');
const { VIDEO_SIMILARITY_SAMPLE_FRACTIONS } = require('./media-similarity-contracts.cjs');

const VIDEO_POSTER_WORKER = path.join(__dirname, 'video-poster-worker.html');
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

function bitmapDHash(bitmap, width = HASH_WIDTH, height = HASH_HEIGHT) {
  if (!Buffer.isBuffer(bitmap) || bitmap.length < width * height * 4) throw new TypeError('bitmap is invalid.');
  let bits = '';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const left = (y * width + x) * 4;
      const right = left + 4;
      const leftGray = (bitmap[left] + bitmap[left + 1] + bitmap[left + 2]) / 3;
      const rightGray = (bitmap[right] + bitmap[right + 1] + bitmap[right + 2]) / 3;
      bits += leftGray > rightGray ? '1' : '0';
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

function imageHashes(sourcePath) {
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('Electron could not decode similarity image source.');
  const size = image.getSize();
  const variants = [image];
  if (size.width >= 16 && size.height >= 16) {
    variants.push(image.crop({
      x: Math.floor(size.width * 0.1),
      y: Math.floor(size.height * 0.1),
      width: Math.max(1, Math.floor(size.width * 0.8)),
      height: Math.max(1, Math.floor(size.height * 0.8))
    }));
  }
  return [...new Set(variants.map((variant) => {
    const resized = variant.resize({ width: HASH_WIDTH, height: HASH_HEIGHT, quality: 'good' });
    if (resized.isEmpty()) throw new Error('Electron could not resize similarity image source.');
    return bitmapDHash(resized.toBitmap());
  }))];
}

async function videoHashes(sourcePath) {
  const workerUrl = pathToFileURL(VIDEO_POSTER_WORKER).href;
  const sourceUrl = pathToFileURL(sourcePath).href;
  const window = new BrowserWindow({
    show: false,
    webPreferences: { ...WINDOW_WEB_PREFERENCES, offscreen: true, backgroundThrottling: false }
  });
  installNavigationGuards(window.webContents, [workerUrl]);
  try {
    await window.loadFile(VIDEO_POSTER_WORKER);
    const result = await window.webContents.executeJavaScript(
      `globalThis.swayForgeExtractVideoPerceptualHashes(${JSON.stringify({ sourceUrl, sampleFractions: VIDEO_SIMILARITY_SAMPLE_FRACTIONS })})`,
      true
    );
    if (!result || !Array.isArray(result.hashes) || result.hashes.length === 0) throw new Error('Video similarity worker returned invalid hashes.');
    return result.hashes;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

function createElectronSimilarityFingerprintProvider() {
  return async ({ media, sourcePath }) => {
    if (media.kind === 'image') return Object.freeze({ kind: 'image', hashes: Object.freeze(imageHashes(sourcePath)) });
    if (media.kind === 'video') return Object.freeze({ kind: 'video', hashes: Object.freeze(await videoHashes(sourcePath)) });
    throw new TypeError('Unsupported media kind for similarity fingerprinting.');
  };
}

module.exports = {
  HASH_HEIGHT,
  HASH_WIDTH,
  VIDEO_SIMILARITY_SAMPLE_FRACTIONS,
  bitmapDHash,
  createElectronSimilarityFingerprintProvider,
  imageHashes,
  videoHashes
};

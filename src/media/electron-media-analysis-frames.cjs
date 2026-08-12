'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow } = require('electron');
const { WINDOW_WEB_PREFERENCES, installNavigationGuards } = require('../security/electron-window-policy.cjs');

const VIDEO_POSTER_WORKER = path.join(__dirname, 'video-poster-worker.html');

function validateSampleFractions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new TypeError('sampleFractions are invalid.');
  if (value.some((fraction) => !Number.isFinite(fraction) || fraction < 0 || fraction > 1)) throw new TypeError('sampleFractions are invalid.');
  return Object.freeze([...value]);
}

function createElectronMediaAnalysisFrameProvider() {
  return async ({ sourcePath, sampleFractions, maxDimension }) => {
    const fractions = validateSampleFractions(sampleFractions);
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 64 || maxDimension > 1024) throw new TypeError('maxDimension is invalid.');
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
        `globalThis.swayForgeExtractVideoAnalysisFrames(${JSON.stringify({ sourceUrl, sampleFractions: fractions, maxDimension })})`,
        true
      );
      if (!result || !Array.isArray(result.frames) || result.frames.length !== fractions.length) {
        throw new Error('Video analysis worker returned invalid frames.');
      }
      return Object.freeze({
        durationSeconds: Number.isFinite(result.durationSeconds) ? result.durationSeconds : null,
        frames: Object.freeze(result.frames.map((frame, index) => Object.freeze({
          fraction: fractions[index],
          pngBase64: frame.pngBase64,
          width: frame.width,
          height: frame.height
        })))
      });
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  };
}

module.exports = {
  VIDEO_POSTER_WORKER,
  createElectronMediaAnalysisFrameProvider,
  validateSampleFractions
};

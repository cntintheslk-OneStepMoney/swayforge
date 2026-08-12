'use strict';

(function installVideoPosterWorker(root) {
  function fitWithin(width, height, maxDimension) {
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function waitFor(target, eventName, errorName = 'error') {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        target.removeEventListener(eventName, onSuccess);
        target.removeEventListener(errorName, onError);
      };
      const onSuccess = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error(`Video preview worker failed during ${eventName}.`)); };
      target.addEventListener(eventName, onSuccess, { once: true });
      target.addEventListener(errorName, onError, { once: true });
    });
  }

  async function loadVideo(sourceUrl) {
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('file:')) throw new TypeError('sourceUrl must be a local file URL.');
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = sourceUrl;
    await waitFor(video, 'loadedmetadata');
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video has no decodable dimensions.');
    return video;
  }

  async function seekVideo(video, target) {
    if (target > 0) {
      video.currentTime = target;
      await waitFor(video, 'seeked');
    } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitFor(video, 'loadeddata');
    }
  }

  function sampleTime(video, fraction) {
    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    if (!durationSeconds || durationSeconds <= 0.1) return 0;
    return Math.min(Math.max(durationSeconds * fraction, 0.05), Math.max(0.05, durationSeconds - 0.05));
  }

  function currentFrameDHash(video) {
    const width = 9;
    const height = 8;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Video similarity canvas is unavailable.');
    context.drawImage(video, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let bits = '';
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const left = (y * width + x) * 4;
        const right = left + 4;
        const leftGray = (pixels[left] + pixels[left + 1] + pixels[left + 2]) / 3;
        const rightGray = (pixels[right] + pixels[right + 1] + pixels[right + 2]) / 3;
        bits += leftGray > rightGray ? '1' : '0';
      }
    }
    return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
  }

  function currentFramePng(video, maxDimension) {
    const target = fitWithin(video.videoWidth, video.videoHeight, maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Video analysis canvas is unavailable.');
    context.drawImage(video, 0, 0, target.width, target.height);
    const dataUrl = canvas.toDataURL('image/png');
    return {
      pngBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: target.width,
      height: target.height
    };
  }

  function releaseVideo(video) {
    video.removeAttribute('src');
    video.load();
  }

  root.swayForgeExtractVideoPoster = async function swayForgeExtractVideoPoster({ sourceUrl, maxDimension }) {
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 64 || maxDimension > 2048) throw new TypeError('maxDimension is invalid.');
    const video = await loadVideo(sourceUrl);
    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    const seekTarget = durationSeconds && durationSeconds > 0.2
      ? Math.min(Math.max(durationSeconds * 0.1, 0.1), Math.max(0.1, durationSeconds - 0.1))
      : 0;
    await seekVideo(video, seekTarget);
    const frame = currentFramePng(video, maxDimension);
    releaseVideo(video);
    return { ...frame, durationSeconds };
  };

  root.swayForgeExtractVideoPerceptualHashes = async function swayForgeExtractVideoPerceptualHashes({ sourceUrl, sampleFractions }) {
    if (!Array.isArray(sampleFractions) || sampleFractions.length < 1 || sampleFractions.length > 5
      || sampleFractions.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError('sampleFractions are invalid.');
    }
    const video = await loadVideo(sourceUrl);
    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const hashes = [];
    for (const fraction of sampleFractions) {
      await seekVideo(video, sampleTime(video, fraction));
      hashes.push(currentFrameDHash(video));
    }
    releaseVideo(video);
    return {
      hashes,
      width: sourceWidth,
      height: sourceHeight,
      durationSeconds,
      sampleFractions: [...sampleFractions]
    };
  };

  root.swayForgeExtractVideoAnalysisFrames = async function swayForgeExtractVideoAnalysisFrames({ sourceUrl, sampleFractions, maxDimension }) {
    if (!Array.isArray(sampleFractions) || sampleFractions.length < 1 || sampleFractions.length > 4
      || sampleFractions.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError('sampleFractions are invalid.');
    }
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 64 || maxDimension > 1024) throw new TypeError('maxDimension is invalid.');
    const video = await loadVideo(sourceUrl);
    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    const frames = [];
    for (const fraction of sampleFractions) {
      await seekVideo(video, sampleTime(video, fraction));
      frames.push({ fraction, ...currentFramePng(video, maxDimension) });
    }
    releaseVideo(video);
    return { durationSeconds, frames };
  };
})(globalThis);

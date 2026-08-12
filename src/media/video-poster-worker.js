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

  root.swayForgeExtractVideoPoster = async function swayForgeExtractVideoPoster({ sourceUrl, maxDimension }) {
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('file:')) throw new TypeError('sourceUrl must be a local file URL.');
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 64 || maxDimension > 2048) throw new TypeError('maxDimension is invalid.');

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = sourceUrl;
    await waitFor(video, 'loadedmetadata');
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video has no decodable dimensions.');

    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    const seekTarget = durationSeconds && durationSeconds > 0.2
      ? Math.min(Math.max(durationSeconds * 0.1, 0.1), Math.max(0.1, durationSeconds - 0.1))
      : 0;
    if (seekTarget > 0) {
      video.currentTime = seekTarget;
      await waitFor(video, 'seeked');
    } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitFor(video, 'loadeddata');
    }

    const target = fitWithin(video.videoWidth, video.videoHeight, maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Video preview canvas is unavailable.');
    context.drawImage(video, 0, 0, target.width, target.height);
    const dataUrl = canvas.toDataURL('image/png');
    video.removeAttribute('src');
    video.load();
    return {
      pngBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: target.width,
      height: target.height,
      durationSeconds
    };
  };
})(globalThis);

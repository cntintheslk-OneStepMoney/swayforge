'use strict';

(function installMediaPreviewLibrary(root) {
  const baseLibrary = root.SwayForgeMediaLibrary;
  if (!baseLibrary || typeof baseLibrary.createMediaLibrary !== 'function') return;
  const createBaseLibrary = baseLibrary.createMediaLibrary;
  const PREVIEW_URL_PATTERN = /^swayforge-preview:\/\/artifact\/[a-f0-9]{64}$/;

  function previewBridge() {
    const bridge = root.swayForge;
    return bridge && typeof bridge.requestMediaPreview === 'function' ? bridge : null;
  }

  function normalisePreviewResult(result, mediaId) {
    if (!result || result.ok !== true) {
      return Object.freeze({ status: 'failed', message: result?.error?.message || 'Local preview generation failed.' });
    }
    const value = result.value;
    if (
      !value ||
      value.mediaId !== mediaId ||
      value.status !== 'ready' ||
      typeof value.url !== 'string' ||
      !PREVIEW_URL_PATTERN.test(value.url)
    ) {
      return Object.freeze({ status: 'failed', message: 'Local preview response was invalid.' });
    }
    return Object.freeze({
      status: 'ready',
      url: value.url,
      kind: value.kind,
      width: Number.isFinite(value.width) ? value.width : null,
      height: Number.isFinite(value.height) ? value.height : null,
      reused: value.reused === true
    });
  }

  function setPreviewContent(container, item, state) {
    container.replaceChildren();
    container.classList.toggle('media-card__preview--ready', state?.status === 'ready');

    if (state?.status === 'ready') {
      const image = document.createElement('img');
      image.className = 'media-card__preview-image';
      image.src = state.url;
      image.alt = `${item.kind === 'video' ? 'Video poster' : 'Image thumbnail'} for ${item.originalFilename}`;
      image.loading = 'lazy';
      image.decoding = 'async';
      container.setAttribute('aria-label', image.alt);
      container.append(image);
      return;
    }

    const kind = document.createElement('span');
    kind.className = 'media-card__preview-kind';
    kind.textContent = item.kind === 'video' ? 'VID' : item.kind === 'image' ? 'IMG' : 'MEDIA';
    const note = document.createElement('span');
    note.className = 'media-card__preview-note';
    note.textContent = state?.status === 'pending'
      ? 'Generating local preview…'
      : state?.status === 'failed'
        ? 'Preview unavailable'
        : 'Preview pending';
    container.setAttribute('aria-label', `${item.kind === 'video' ? 'Video' : 'Image'} ${note.textContent.toLowerCase()}`);
    container.append(kind, note);
  }

  function installPreviewSupport(controller) {
    controller.previewStates = new Map();
    controller.previewRequests = new Set();

    const baseSetItems = controller.setItems.bind(controller);
    controller.setItems = function setItemsWithPreviews(payload) {
      const items = baseSetItems(payload);
      const currentIds = new Set(items.map((item) => item.id));
      for (const id of this.previewStates.keys()) if (!currentIds.has(id)) this.previewStates.delete(id);
      for (const id of this.previewRequests) if (!currentIds.has(id)) this.previewRequests.delete(id);
      return items;
    };

    const baseRenderItem = controller.renderItem.bind(controller);
    controller.renderItem = function renderItemWithPreview(item) {
      const card = baseRenderItem(item);
      const container = card.querySelector('.media-card__preview');
      if (container) setPreviewContent(container, item, this.previewStates.get(item.id));
      return card;
    };

    controller.updatePreviewCard = function updatePreviewCard(mediaId) {
      const item = this.items.find((candidate) => candidate.id === mediaId);
      if (!item) return;
      const card = this.itemsElement.querySelector(`[data-media-id="${CSS.escape(mediaId)}"]`);
      const container = card?.querySelector('.media-card__preview');
      if (container) setPreviewContent(container, item, this.previewStates.get(mediaId));
    };

    controller.hydrateVisiblePreviews = function hydrateVisiblePreviews() {
      const bridge = previewBridge();
      if (!bridge) return;
      const visibleIds = Array.from(this.itemsElement.querySelectorAll('[data-media-id]'))
        .map((element) => element.dataset.mediaId)
        .filter(Boolean);
      for (const mediaId of visibleIds) {
        const item = this.items.find((candidate) => candidate.id === mediaId);
        if (!item || item.availability !== 'ready') continue;
        const state = this.previewStates.get(mediaId);
        if (state?.status === 'ready' || state?.status === 'failed' || this.previewRequests.has(mediaId)) continue;
        this.previewStates.set(mediaId, Object.freeze({ status: 'pending' }));
        this.previewRequests.add(mediaId);
        this.updatePreviewCard(mediaId);
        void bridge.requestMediaPreview(mediaId)
          .then((result) => this.previewStates.set(mediaId, normalisePreviewResult(result, mediaId)))
          .catch(() => this.previewStates.set(mediaId, Object.freeze({ status: 'failed', message: 'Local preview generation failed.' })))
          .finally(() => {
            this.previewRequests.delete(mediaId);
            this.updatePreviewCard(mediaId);
          });
      }
    };

    const baseRender = controller.render.bind(controller);
    controller.render = function renderWithPreviews() {
      const result = baseRender();
      this.hydrateVisiblePreviews();
      return result;
    };

    const baseOpenDetails = controller.openDetails.bind(controller);
    controller.openDetails = function openDetailsWithPreview(mediaId, trigger) {
      baseOpenDetails(mediaId, trigger);
      const labels = Array.from(this.detailsBody.querySelectorAll('.media-details__label'));
      const previewLabel = labels.find((element) => element.textContent === 'Preview');
      const previewValue = previewLabel?.nextElementSibling;
      const state = this.previewStates.get(mediaId);
      if (!previewValue) return;
      previewValue.textContent = state?.status === 'ready'
        ? 'Ready from the local rebuildable preview cache.'
        : state?.status === 'failed'
          ? 'Preview unavailable; source media was preserved.'
          : state?.status === 'pending'
            ? 'Generating locally in the bounded preview queue.'
            : 'Will generate locally when this item becomes visible.';
    };

    return controller;
  }

  root.SwayForgeMediaLibrary = Object.freeze({
    createMediaLibrary: (options) => installPreviewSupport(createBaseLibrary(options))
  });
})(globalThis);

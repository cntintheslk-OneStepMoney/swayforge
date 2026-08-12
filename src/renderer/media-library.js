'use strict';

(function initialiseMediaLibrary(root) {
  const model = root.SwayForgeMediaLibraryModel;
  if (!model) return;

  function setText(element, value) {
    if (element) element.textContent = String(value ?? '');
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function appendDetailRow(list, label, value) {
    const term = createElement('dt', 'media-details__label', label);
    const description = createElement('dd', 'media-details__value', value);
    list.append(term, description);
  }

  function appendDetailContent(list, label, content) {
    const term = createElement('dt', 'media-details__label', label);
    const description = createElement('dd', 'media-details__value');
    description.append(content);
    list.append(term, description);
    return description;
  }

  class MediaLibraryController {
    constructor({ rootElement }) {
      if (!rootElement) throw new TypeError('Media Library root element is required.');
      this.rootElement = rootElement;
      this.stateElement = rootElement.querySelector('#media-state');
      this.itemsElement = rootElement.querySelector('#media-library-items');
      this.resultSummaryElement = rootElement.querySelector('#media-result-summary');
      this.loadMoreButton = rootElement.querySelector('#media-load-more');
      this.kindFilter = rootElement.querySelector('#media-kind-filter');
      this.availabilityFilter = rootElement.querySelector('#media-state-filter');
      this.sortControl = rootElement.querySelector('#media-sort');
      this.gridButton = rootElement.querySelector('#media-view-grid');
      this.listButton = rootElement.querySelector('#media-view-list');
      this.clearFiltersButton = rootElement.querySelector('#media-clear-filters');
      this.clearSelectionButton = rootElement.querySelector('#media-clear-selection');
      this.selectedCountElement = rootElement.querySelector('#media-selected-count');
      this.detailsElement = rootElement.querySelector('#media-details');
      this.detailsTitle = rootElement.querySelector('#media-details-title');
      this.detailsBody = rootElement.querySelector('#media-details-body');
      this.detailsCloseButton = rootElement.querySelector('#media-details-close');
      this.items = Object.freeze([]);
      this.selectedIds = new Set();
      this.viewMode = 'grid';
      this.renderLimit = model.DEFAULT_RENDER_LIMIT;
      this.activeDetailsId = null;
      this.registerHandlers();
      this.updateViewMode();
      this.updateSelectionSummary();
    }

    registerHandlers() {
      this.itemsElement.addEventListener('change', (event) => this.handleItemChange(event));
      this.itemsElement.addEventListener('click', (event) => this.handleItemClick(event));
      this.kindFilter.addEventListener('change', () => this.handleQueryChange());
      this.availabilityFilter.addEventListener('change', () => this.handleQueryChange());
      this.sortControl.addEventListener('change', () => this.handleQueryChange());
      this.gridButton.addEventListener('click', () => this.setViewMode('grid'));
      this.listButton.addEventListener('click', () => this.setViewMode('list'));
      this.clearFiltersButton.addEventListener('click', () => this.clearFilters());
      this.clearSelectionButton.addEventListener('click', () => this.clearSelection());
      this.loadMoreButton.addEventListener('click', () => this.showMore());
      this.detailsCloseButton.addEventListener('click', () => this.closeDetails({ restoreFocus: true }));
    }

    setLoading() {
      this.closeDetails();
      this.itemsElement.replaceChildren();
      this.stateElement.hidden = false;
      this.stateElement.replaceChildren(
        createElement('strong', '', 'Loading media…'),
        createElement('span', '', 'Reading local media summaries.')
      );
      this.loadMoreButton.hidden = true;
      setText(this.resultSummaryElement, 'Loading local media…');
    }

    setError(message) {
      this.items = Object.freeze([]);
      this.selectedIds.clear();
      this.itemsElement.replaceChildren();
      this.stateElement.hidden = false;
      this.stateElement.replaceChildren(
        createElement('strong', '', 'Media unavailable'),
        createElement('span', '', message || 'Managed media could not be read safely.')
      );
      this.loadMoreButton.hidden = true;
      setText(this.resultSummaryElement, 'Media unavailable');
      this.updateSelectionSummary();
      this.closeDetails();
    }

    setItems(payload) {
      this.items = model.extractMediaItems(payload);
      this.selectedIds = model.reconcileSelection(this.selectedIds, this.items);
      if (this.activeDetailsId && !this.items.some((item) => item.id === this.activeDetailsId)) this.closeDetails();
      this.render();
      return this.items;
    }

    getQueryOptions() {
      return Object.freeze({
        kind: this.kindFilter.value,
        availability: this.availabilityFilter.value,
        sort: this.sortControl.value
      });
    }

    handleQueryChange() {
      this.renderLimit = model.DEFAULT_RENDER_LIMIT;
      this.render();
    }

    clearFilters() {
      this.kindFilter.value = 'all';
      this.availabilityFilter.value = 'all';
      this.sortControl.value = 'newest';
      this.renderLimit = model.DEFAULT_RENDER_LIMIT;
      this.render();
      this.kindFilter.focus();
    }

    clearSelection() {
      this.selectedIds.clear();
      this.render();
    }

    setViewMode(mode) {
      if (mode !== 'grid' && mode !== 'list') return;
      this.viewMode = mode;
      this.updateViewMode();
    }

    updateViewMode() {
      this.itemsElement.dataset.layout = this.viewMode;
      this.gridButton.setAttribute('aria-pressed', String(this.viewMode === 'grid'));
      this.listButton.setAttribute('aria-pressed', String(this.viewMode === 'list'));
    }

    handleItemChange(event) {
      const checkbox = event.target.closest?.('[data-media-select]');
      if (!checkbox || !this.itemsElement.contains(checkbox)) return;
      const mediaId = checkbox.dataset.mediaSelect;
      if (!this.items.some((item) => item.id === mediaId)) return;
      if (checkbox.checked) this.selectedIds.add(mediaId);
      else this.selectedIds.delete(mediaId);
      this.render();
      const replacement = this.itemsElement.querySelector(`[data-media-select="${CSS.escape(mediaId)}"]`);
      replacement?.focus({ preventScroll: true });
    }

    handleItemClick(event) {
      const inspectButton = event.target.closest?.('[data-media-inspect]');
      if (!inspectButton || !this.itemsElement.contains(inspectButton)) return;
      this.openDetails(inspectButton.dataset.mediaInspect, inspectButton);
    }

    showMore() {
      const filtered = model.applyLibraryQuery(this.items, this.getQueryOptions());
      this.renderLimit = model.nextRenderLimit(this.renderLimit, filtered.length);
      this.render();
    }

    render() {
      const filtered = model.applyLibraryQuery(this.items, this.getQueryOptions());
      const visible = model.visibleItems(filtered, this.renderLimit);
      this.itemsElement.replaceChildren();

      if (this.items.length === 0) {
        this.showState('No managed media yet', 'Import supported creator-owned media to create a verified managed copy.');
      } else if (filtered.length === 0) {
        this.showState('No media matches these filters', 'Change or clear the Media Library filters to show other local items.');
      } else {
        this.stateElement.hidden = true;
        for (const item of visible) this.itemsElement.append(this.renderItem(item));
      }

      const shown = visible.length;
      const total = filtered.length;
      const overall = this.items.length;
      setText(
        this.resultSummaryElement,
        total === overall
          ? `Showing ${shown} of ${overall} local media items.`
          : `Showing ${shown} of ${total} matching items from ${overall} total.`
      );
      this.loadMoreButton.hidden = shown >= total;
      if (!this.loadMoreButton.hidden) this.loadMoreButton.textContent = `Show ${Math.min(model.RENDER_STEP, total - shown)} more`;
      this.updateSelectionSummary();
    }

    showState(title, body) {
      this.stateElement.hidden = false;
      this.stateElement.replaceChildren(
        createElement('strong', '', title),
        createElement('span', '', body)
      );
    }

    renderItem(item) {
      const listItem = createElement('li', 'media-card');
      listItem.dataset.mediaId = item.id;
      listItem.dataset.selected = String(this.selectedIds.has(item.id));

      const placeholder = createElement('div', 'media-card__preview');
      placeholder.setAttribute('aria-label', `${model.kindLabel(item.kind)} preview unavailable`);
      placeholder.append(
        createElement('span', 'media-card__preview-kind', item.kind === 'video' ? 'VID' : item.kind === 'image' ? 'IMG' : 'MEDIA'),
        createElement('span', 'media-card__preview-note', 'Preview unavailable')
      );

      const body = createElement('div', 'media-card__body');
      const heading = createElement('h4', 'media-card__title', item.originalFilename);
      const facts = createElement('p', 'media-card__facts');
      const kind = model.kindLabel(item.kind);
      const dimensions = model.formatDimensions(item);
      const duration = item.kind === 'video' ? ` · ${model.formatDuration(item.durationSeconds)}` : '';
      facts.textContent = `${kind} · ${dimensions}${duration}`;
      const importDate = createElement('p', 'media-card__date', `Imported ${model.formatDate(item.importedAt)}`);
      body.append(heading, facts, importDate);

      const status = createElement('span', `media-status media-status--${item.availability}`, model.availabilityLabel(item.availability));
      status.setAttribute('aria-label', `Availability: ${model.availabilityLabel(item.availability)}`);

      const actions = createElement('div', 'media-card__actions');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'media-card__checkbox';
      checkbox.dataset.mediaSelect = item.id;
      checkbox.checked = this.selectedIds.has(item.id);
      checkbox.setAttribute('aria-label', `Select ${item.originalFilename}`);
      const selectionText = createElement('span', 'media-card__selection-text', checkbox.checked ? 'Selected' : 'Not selected');
      const inspectButton = createElement('button', 'button button--secondary media-card__inspect', 'Inspect');
      inspectButton.type = 'button';
      inspectButton.dataset.mediaInspect = item.id;
      inspectButton.setAttribute('aria-label', `Inspect ${item.originalFilename}`);
      actions.append(checkbox, selectionText, inspectButton);

      listItem.append(placeholder, body, status, actions);
      return listItem;
    }

    updateSelectionSummary() {
      const count = this.selectedIds.size;
      setText(this.selectedCountElement, `${count} selected`);
      this.clearSelectionButton.disabled = count === 0;
    }

    renderAiAnalysis(container, analysis, actionButton) {
      container.replaceChildren();
      if (!analysis) {
        container.append(createElement('p', '', 'Not analysed. Local AI runs only when you choose it.'));
        actionButton.textContent = 'Analyze locally';
        container.append(actionButton);
        return;
      }

      if (analysis.status === 'ready') {
        container.append(
          createElement('p', '', analysis.description),
          createElement('p', '', `AI-derived · ${analysis.provider || 'local'} · ${analysis.model || 'configured model'}`)
        );
        if (analysis.labels?.length) container.append(createElement('p', '', `Suggested labels: ${analysis.labels.join(', ')}`));
        if (analysis.limitations) container.append(createElement('p', '', `Limitations: ${analysis.limitations}`));
        actionButton.textContent = 'Re-analyze locally';
        container.append(actionButton);
        return;
      }

      const label = analysis.status === 'unavailable'
        ? 'Local AI understanding is unavailable with the current model/runtime.'
        : analysis.status === 'stale'
          ? 'Stored AI understanding is stale because the source or analysis version changed.'
          : 'Local AI understanding failed safely; source media was preserved.';
      container.append(createElement('p', '', label));
      if (analysis.error?.message) container.append(createElement('p', '', analysis.error.message));
      actionButton.textContent = analysis.status === 'unavailable' ? 'Check again' : 'Analyze locally';
      container.append(actionButton);
    }

    async loadAiAnalysis(item, container, actionButton) {
      const bridge = root.swayForge;
      if (!bridge?.getMediaAiAnalysis || this.activeDetailsId !== item.id) return;
      try {
        const result = await bridge.getMediaAiAnalysis(item.id);
        if (this.activeDetailsId !== item.id) return;
        if (!result?.ok) {
          container.replaceChildren(createElement('p', '', result?.error?.message || 'Local AI status could not be read safely.'));
          return;
        }
        this.renderAiAnalysis(container, result.value, actionButton);
      } catch {
        if (this.activeDetailsId === item.id) container.replaceChildren(createElement('p', '', 'Local AI status could not be read safely.'));
      }
    }

    async runAiAnalysis(item, container, actionButton) {
      const bridge = root.swayForge;
      if (!bridge?.analyzeMediaLocally || this.activeDetailsId !== item.id) return;
      actionButton.disabled = true;
      actionButton.textContent = 'Analyzing locally…';
      try {
        const result = await bridge.analyzeMediaLocally(item.id);
        if (this.activeDetailsId !== item.id) return;
        if (!result?.ok) {
          container.replaceChildren(createElement('p', '', result?.error?.message || 'Local AI understanding failed safely.'));
          return;
        }
        this.renderAiAnalysis(container, result.value, actionButton);
      } catch {
        if (this.activeDetailsId === item.id) container.replaceChildren(createElement('p', '', 'Local AI understanding failed safely. Source media was preserved.'));
      } finally {
        actionButton.disabled = false;
      }
    }

    openDetails(mediaId, trigger) {
      const item = this.items.find((candidate) => candidate.id === mediaId);
      if (!item) return;
      this.activeDetailsId = item.id;
      this.detailsTrigger = trigger || null;
      setText(this.detailsTitle, item.originalFilename);
      this.detailsBody.replaceChildren();
      appendDetailRow(this.detailsBody, 'Media ID', item.id);
      appendDetailRow(this.detailsBody, 'Kind', model.kindLabel(item.kind));
      appendDetailRow(this.detailsBody, 'Availability', model.availabilityLabel(item.availability));
      appendDetailRow(this.detailsBody, 'Dimensions', model.formatDimensions(item));
      if (item.kind === 'video') appendDetailRow(this.detailsBody, 'Duration', model.formatDuration(item.durationSeconds));
      appendDetailRow(this.detailsBody, 'File size', model.formatFileSize(item.fileSize));
      appendDetailRow(this.detailsBody, 'Imported', model.formatDate(item.importedAt));
      appendDetailRow(this.detailsBody, 'Preview', 'Generated locally from the managed source when needed.');
      appendDetailRow(this.detailsBody, 'Exact duplicate handling', 'Checked by trusted local import; content hashes are not exposed here.');

      const aiContainer = createElement('div', 'media-details__ai');
      const analyzeButton = createElement('button', 'button button--secondary', 'Analyze locally');
      analyzeButton.type = 'button';
      analyzeButton.addEventListener('click', () => this.runAiAnalysis(item, aiContainer, analyzeButton));
      aiContainer.append(createElement('p', '', 'Reading local AI status…'));
      appendDetailContent(this.detailsBody, 'Local AI understanding', aiContainer);

      this.detailsElement.hidden = false;
      this.detailsCloseButton.focus({ preventScroll: true });
      void this.loadAiAnalysis(item, aiContainer, analyzeButton);
    }

    closeDetails({ restoreFocus = false } = {}) {
      const trigger = this.detailsTrigger;
      this.activeDetailsId = null;
      this.detailsTrigger = null;
      this.detailsElement.hidden = true;
      this.detailsBody.replaceChildren();
      if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  }

  root.SwayForgeMediaLibrary = Object.freeze({
    createMediaLibrary: (options) => new MediaLibraryController(options)
  });
})(globalThis);

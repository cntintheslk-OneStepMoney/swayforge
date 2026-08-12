'use strict';

(function installMediaOrganisation(root) {
  const baseLibrary = root.SwayForgeMediaLibrary;
  const model = root.SwayForgeMediaOrganisationModel;
  if (!baseLibrary?.createMediaLibrary || !model) return;
  const createBaseLibrary = baseLibrary.createMediaLibrary;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function unwrap(result, fallback) {
    if (!result?.ok) throw new Error(result?.error?.message || fallback);
    return result.value;
  }
  function selectedValues(select) { return Array.from(select?.selectedOptions || []).map((option) => option.value).filter(Boolean); }

  function install(controller) {
    const bridge = root.swayForge;
    const view = controller.rootElement;
    const controls = {
      search: view.querySelector('#media-search'), tagFilter: view.querySelector('#media-tag-filter'), collectionFilter: view.querySelector('#media-collection-filter'),
      orientation: view.querySelector('#media-orientation-filter'), importedAfter: view.querySelector('#media-imported-after'), importedBefore: view.querySelector('#media-imported-before'),
      durationMin: view.querySelector('#media-duration-min'), durationMax: view.querySelector('#media-duration-max'), activeFilters: view.querySelector('#media-active-filters'),
      savedView: view.querySelector('#media-saved-view'), deleteSavedView: view.querySelector('#media-delete-saved-view'), saveViewForm: view.querySelector('#media-save-view-form'),
      savedViewName: view.querySelector('#media-saved-view-name'), organisationPanel: view.querySelector('#media-organisation-panel'), organisationStatus: view.querySelector('#media-organisation-status'),
      tagCreateForm: view.querySelector('#media-tag-create-form'), tagName: view.querySelector('#media-tag-name'), tagList: view.querySelector('#media-tag-list'),
      collectionCreateForm: view.querySelector('#media-collection-create-form'), collectionName: view.querySelector('#media-collection-name'), collectionList: view.querySelector('#media-collection-list'),
      organiseSelected: view.querySelector('#media-organise-selected')
    };
    if (!controls.search || typeof bridge?.searchMedia !== 'function' || typeof bridge?.getMediaOrganisation !== 'function') return controller;

    controller.organisation = Object.freeze({ tags: Object.freeze([]), collections: Object.freeze([]), savedViews: Object.freeze([]) });
    controller.organisationMetadata = new Map();
    controller.organisationSearchToken = 0;
    controller.organisationSearchTimer = null;
    controller.tagListQuery = '';
    controller.collectionListQuery = '';
    const tagListSearch = createElement('input'); tagListSearch.type = 'search'; tagListSearch.placeholder = 'Filter tags'; tagListSearch.setAttribute('aria-label', 'Filter user tags'); controls.tagList.before(tagListSearch);
    const collectionListSearch = createElement('input'); collectionListSearch.type = 'search'; collectionListSearch.placeholder = 'Filter collections'; collectionListSearch.setAttribute('aria-label', 'Filter collections'); controls.collectionList.before(collectionListSearch);

    controller.readOrganisationCriteria = function readOrganisationCriteria() {
      return model.criteriaFromControls({
        query: controls.search.value,
        tagIds: selectedValues(controls.tagFilter),
        collectionId: controls.collectionFilter.value,
        mediaKind: this.kindFilter.value,
        availability: this.availabilityFilter.value,
        orientation: controls.orientation.value,
        importedAfter: controls.importedAfter.value,
        importedBefore: controls.importedBefore.value,
        minDurationSeconds: controls.durationMin.value,
        maxDurationSeconds: controls.durationMax.value,
        sort: this.sortControl.value
      });
    };

    controller.renderActiveOrganisationFilters = function renderActiveOrganisationFilters() {
      const criteria = this.readOrganisationCriteria();
      const labels = model.activeFilterLabels(criteria, this.organisation);
      controls.activeFilters.replaceChildren();
      if (!labels.length) controls.activeFilters.append(createElement('span', 'media-filter-chips__empty', 'No active filters'));
      else for (const label of labels) controls.activeFilters.append(createElement('span', 'media-filter-chip', label));
    };

    controller.runOrganisationSearch = async function runOrganisationSearch() {
      const token = ++this.organisationSearchToken;
      const criteria = this.readOrganisationCriteria();
      this.renderActiveOrganisationFilters();
      try {
        const items = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total && items.length < 6000) {
          const result = unwrap(await bridge.searchMedia(model.toSearchRequest(criteria, { offset, limit: 100 })), 'Local media search failed.');
          if (token !== this.organisationSearchToken) return;
          const page = Array.isArray(result?.items) ? result.items : [];
          total = Number.isSafeInteger(result?.total) ? result.total : page.length;
          items.push(...page);
          if (!result?.hasMore || page.length === 0) break;
          offset += page.length;
        }
        if (token !== this.organisationSearchToken) return;
        this.organisationMetadata = new Map(items.map((item) => [item.id, item]));
        this.setItems({ media: items });
      } catch (error) {
        if (token === this.organisationSearchToken) this.setError(error.message || 'Local media search failed safely.');
      }
    };

    controller.scheduleOrganisationSearch = function scheduleOrganisationSearch() {
      clearTimeout(this.organisationSearchTimer);
      this.organisationSearchTimer = setTimeout(() => void this.runOrganisationSearch(), 180);
    };

    controller.populateOrganisationControls = function populateOrganisationControls() {
      const currentTags = new Set(selectedValues(controls.tagFilter));
      controls.tagFilter.replaceChildren();
      for (const tag of this.organisation.tags || []) {
        const option = createElement('option', '', tag.name); option.value = tag.id; option.selected = currentTags.has(tag.id); controls.tagFilter.append(option);
      }
      const currentCollection = controls.collectionFilter.value;
      controls.collectionFilter.replaceChildren(Object.assign(createElement('option', '', 'All collections'), { value: '' }));
      for (const collection of (this.organisation.collections || []).filter((item) => item.status !== 'archived')) {
        const option = createElement('option', '', collection.name); option.value = collection.id; controls.collectionFilter.append(option);
      }
      controls.collectionFilter.value = (this.organisation.collections || []).some((item) => item.id === currentCollection) ? currentCollection : '';
      const selectedView = controls.savedView.value;
      controls.savedView.replaceChildren(Object.assign(createElement('option', '', 'Choose a saved view'), { value: '' }));
      for (const savedView of this.organisation.savedViews || []) { const option = createElement('option', '', savedView.name); option.value = savedView.id; controls.savedView.append(option); }
      controls.savedView.value = (this.organisation.savedViews || []).some((item) => item.id === selectedView) ? selectedView : '';
      controls.deleteSavedView.disabled = !controls.savedView.value;
      this.renderOrganisationLists();
      this.renderActiveOrganisationFilters();
    };

    controller.reloadOrganisation = async function reloadOrganisation({ rerunSearch = false } = {}) {
      try {
        this.organisation = unwrap(await bridge.getMediaOrganisation(), 'Media organisation could not be loaded.');
        controls.organisationStatus.textContent = 'User tags, collections and saved views are stored locally.';
        this.populateOrganisationControls();
        if (rerunSearch) await this.runOrganisationSearch();
      } catch (error) {
        controls.organisationStatus.textContent = error.message || 'Media organisation is unavailable.';
      }
    };

    controller.selectedMediaIds = function selectedMediaIds() { return [...this.selectedIds]; };
    controller.organisationMutation = async function organisationMutation(action, successMessage) {
      try { const result = await action(); if (result && Object.hasOwn(result, 'ok')) unwrap(result, 'The organisation change could not be saved safely.'); controls.organisationStatus.textContent = successMessage; await this.reloadOrganisation({ rerunSearch: true }); }
      catch (error) { controls.organisationStatus.textContent = error.message || 'The organisation change could not be saved safely.'; }
    };

    controller.renderOrganisationLists = function renderOrganisationLists() {
      controls.tagList.replaceChildren();
      const visibleTags = (this.organisation.tags || []).filter((tag) => tag.name.toLocaleLowerCase().includes(this.tagListQuery));
      for (const tag of visibleTags) {
        const row = createElement('div', 'media-organisation-row');
        const summary = createElement('div', 'media-organisation-row__label'); summary.append(createElement('strong', '', tag.name), createElement('span', '', `${tag.mediaCount || 0} media`));
        const input = createElement('input'); input.value = tag.name; input.maxLength = 80; input.setAttribute('aria-label', `Rename tag ${tag.name}`);
        const actions = createElement('div', 'media-organisation-row__actions');
        const rename = createElement('button', 'button button--quiet', 'Rename'); rename.type = 'button'; rename.addEventListener('click', () => this.organisationMutation(() => bridge.renameMediaTag(tag.id, input.value), 'Tag renamed.'));
        const add = createElement('button', 'button button--secondary', 'Add to selected'); add.type = 'button'; add.disabled = this.selectedIds.size === 0; add.addEventListener('click', () => this.organisationMutation(() => bridge.assignMediaTags([tag.id], this.selectedMediaIds()), 'Tag assigned to selected media.'));
        const remove = createElement('button', 'button button--quiet', 'Remove from selected'); remove.type = 'button'; remove.disabled = this.selectedIds.size === 0; remove.addEventListener('click', () => this.organisationMutation(() => bridge.removeMediaTags([tag.id], this.selectedMediaIds()), 'Tag removed from selected media.'));
        const del = createElement('button', 'button button--quiet', 'Delete'); del.type = 'button'; del.addEventListener('click', () => this.organisationMutation(() => bridge.deleteMediaTag(tag.id), 'Tag deleted. Media was preserved.'));
        actions.append(rename, add, remove, del); row.append(summary, input, actions); controls.tagList.append(row);
      }
      if (!visibleTags.length) controls.tagList.append(createElement('p', 'media-organisation-empty', (this.organisation.tags || []).length ? 'No tags match this filter.' : 'No user tags yet.'));

      controls.collectionList.replaceChildren();
      const visibleCollections = (this.organisation.collections || []).filter((collection) => collection.name.toLocaleLowerCase().includes(this.collectionListQuery));
      for (const collection of visibleCollections) {
        const row = createElement('div', 'media-organisation-row');
        const summary = createElement('div', 'media-organisation-row__label'); summary.append(createElement('strong', '', collection.name), createElement('span', '', `${collection.mediaCount || 0} media · ${collection.status}${collection.missingMediaIds?.length ? ` · ${collection.missingMediaIds.length} missing` : ''}`));
        const input = createElement('input'); input.value = collection.name; input.maxLength = 80; input.setAttribute('aria-label', `Rename collection ${collection.name}`);
        const actions = createElement('div', 'media-organisation-row__actions');
        const rename = createElement('button', 'button button--quiet', 'Rename'); rename.type = 'button'; rename.addEventListener('click', () => this.organisationMutation(() => bridge.renameMediaCollection(collection.id, input.value), 'Collection renamed.'));
        const add = createElement('button', 'button button--secondary', 'Add selected'); add.type = 'button'; add.disabled = this.selectedIds.size === 0 || collection.status === 'archived'; add.addEventListener('click', () => this.organisationMutation(() => bridge.addMediaToCollection(collection.id, this.selectedMediaIds()), 'Selected media added to collection.'));
        const remove = createElement('button', 'button button--quiet', 'Remove selected'); remove.type = 'button'; remove.disabled = this.selectedIds.size === 0 || collection.status === 'archived'; remove.addEventListener('click', () => this.organisationMutation(() => bridge.removeMediaFromCollection(collection.id, this.selectedMediaIds()), 'Selected media removed from collection.'));
        const archive = createElement('button', 'button button--quiet', collection.status === 'archived' ? 'Archived' : 'Archive'); archive.type = 'button'; archive.disabled = collection.status === 'archived'; archive.addEventListener('click', () => this.organisationMutation(() => bridge.archiveMediaCollection(collection.id), 'Collection archived. Media was preserved.'));
        const del = createElement('button', 'button button--quiet', 'Delete'); del.type = 'button'; del.addEventListener('click', () => this.organisationMutation(() => bridge.deleteMediaCollection(collection.id), 'Collection deleted. Media was preserved.'));
        actions.append(rename, add, remove, archive, del); row.append(summary, input, actions); controls.collectionList.append(row);
      }
      if (!visibleCollections.length) controls.collectionList.append(createElement('p', 'media-organisation-empty', (this.organisation.collections || []).length ? 'No collections match this filter.' : 'No collections yet.'));
    };

    const baseRenderItem = controller.renderItem.bind(controller);
    controller.renderItem = function renderItemWithOrganisation(item) {
      const card = baseRenderItem(item); const metadata = this.organisationMetadata.get(item.id);
      if (!metadata) return card;
      const body = card.querySelector('.media-card__body');
      if (metadata.userTags?.length) body?.append(createElement('p', 'media-card__date', `Tags: ${metadata.userTags.join(', ')}`));
      if (metadata.collectionNames?.length) body?.append(createElement('p', 'media-card__date', `Collections: ${metadata.collectionNames.join(', ')}`));
      if (metadata.matchSources?.includes('ai-label')) { const badge = createElement('span', 'media-status', 'AI-derived match'); badge.setAttribute('aria-label', 'Search matched local AI-derived metadata'); card.append(badge); }
      return card;
    };

    const baseUpdateSelectionSummary = controller.updateSelectionSummary.bind(controller);
    controller.updateSelectionSummary = function updateSelectionSummaryWithOrganisation() { baseUpdateSelectionSummary(); this.renderOrganisationLists(); };

    const baseOpenDetails = controller.openDetails.bind(controller);
    controller.openDetails = function openDetailsWithOrganisation(mediaId, trigger) {
      baseOpenDetails(mediaId, trigger);
      const metadata = this.organisationMetadata.get(mediaId) || {};
      if (metadata.userTags?.length) { const dt = createElement('dt', 'media-details__label', 'User tags'); const dd = createElement('dd', 'media-details__value', metadata.userTags.join(', ')); this.detailsBody.append(dt, dd); }
      const collections = (this.organisation.collections || []).filter((item) => item.mediaIds?.includes(mediaId)).map((item) => item.name);
      if (collections.length) { const dt = createElement('dt', 'media-details__label', 'Collections'); const dd = createElement('dd', 'media-details__value', collections.join(', ')); this.detailsBody.append(dt, dd); }
      const dt = createElement('dt', 'media-details__label', 'AI tag suggestions'); const dd = createElement('dd', 'media-details__value'); dd.append(createElement('p', '', 'Loading local suggestions…')); this.detailsBody.append(dt, dd); void this.loadOrganisationSuggestions(mediaId, dd);
    };

    controller.loadOrganisationSuggestions = async function loadOrganisationSuggestions(mediaId, container) {
      try {
        const snapshot = unwrap(await bridge.getMediaAiSuggestions(mediaId), 'AI suggestions could not be loaded.');
        if (this.activeDetailsId !== mediaId) return;
        container.replaceChildren();
        if (!snapshot.suggestions?.length) { container.append(createElement('p', '', snapshot.analysisStatus === 'ready' ? 'No pending AI tag suggestions.' : 'No current local AI suggestions.')); return; }
        const list = createElement('div', 'media-ai-suggestions');
        for (const suggestion of snapshot.suggestions) {
          const row = createElement('div', 'media-ai-suggestion'); row.append(createElement('span', '', `${suggestion.label} · AI suggestion`));
          const accept = createElement('button', 'button button--secondary', 'Accept as tag'); accept.type = 'button'; accept.addEventListener('click', () => this.organisationMutation(async () => { unwrap(await bridge.acceptMediaAiSuggestion(mediaId, suggestion.label), 'AI suggestion could not be accepted.'); }, 'AI suggestion accepted as a user tag.').then(() => { if (this.activeDetailsId === mediaId) void this.loadOrganisationSuggestions(mediaId, container); }));
          const dismiss = createElement('button', 'button button--quiet', 'Dismiss'); dismiss.type = 'button'; dismiss.addEventListener('click', () => this.organisationMutation(async () => { unwrap(await bridge.dismissMediaAiSuggestion(mediaId, suggestion.label), 'AI suggestion could not be dismissed.'); }, 'AI suggestion dismissed locally.').then(() => { if (this.activeDetailsId === mediaId) void this.loadOrganisationSuggestions(mediaId, container); }));
          row.append(accept, dismiss); list.append(row);
        }
        container.append(list);
      } catch (error) { if (this.activeDetailsId === mediaId) container.replaceChildren(createElement('p', 'media-ai-suggestions__error', error.message || 'AI suggestions are unavailable.')); }
    };

    for (const control of [controller.kindFilter, controller.availabilityFilter, controller.sortControl, controls.tagFilter, controls.collectionFilter, controls.orientation, controls.importedAfter, controls.importedBefore, controls.durationMin, controls.durationMax]) control?.addEventListener('change', () => void controller.runOrganisationSearch());
    controls.search.addEventListener('input', () => controller.scheduleOrganisationSearch());
    tagListSearch.addEventListener('input', () => { controller.tagListQuery = tagListSearch.value.trim().toLocaleLowerCase(); controller.renderOrganisationLists(); });
    collectionListSearch.addEventListener('input', () => { controller.collectionListQuery = collectionListSearch.value.trim().toLocaleLowerCase(); controller.renderOrganisationLists(); });
    controller.clearFiltersButton.addEventListener('click', () => { controls.search.value=''; controls.tagFilter.selectedIndex=-1; controls.collectionFilter.value=''; controls.orientation.value=''; controls.importedAfter.value=''; controls.importedBefore.value=''; controls.durationMin.value=''; controls.durationMax.value=''; void controller.runOrganisationSearch(); });
    controls.organiseSelected.addEventListener('click', () => { controls.organisationPanel.open = true; controls.organisationPanel.scrollIntoView({ block: 'nearest' }); });
    controls.tagCreateForm.addEventListener('submit', (event) => { event.preventDefault(); const name=controls.tagName.value; void controller.organisationMutation(() => bridge.createMediaTag(name), 'Tag created.').then(() => { controls.tagName.value=''; }); });
    controls.collectionCreateForm.addEventListener('submit', (event) => { event.preventDefault(); const name=controls.collectionName.value; void controller.organisationMutation(() => bridge.createMediaCollection(name), 'Collection created.').then(() => { controls.collectionName.value=''; }); });
    controls.saveViewForm.addEventListener('submit', (event) => { event.preventDefault(); const name=controls.savedViewName.value; const criteria=model.toSavedViewCriteria(controller.readOrganisationCriteria()); void controller.organisationMutation(() => bridge.saveMediaView(name, criteria), 'Saved view updated.').then(() => { controls.savedViewName.value=''; }); });
    controls.savedView.addEventListener('change', () => {
      controls.deleteSavedView.disabled = !controls.savedView.value;
      const saved=(controller.organisation.savedViews||[]).find((item)=>item.id===controls.savedView.value); if(!saved) return; const c=saved.criteria||{};
      controls.search.value=c.query||''; for(const option of controls.tagFilter.options) option.selected=(c.tagIds||[]).includes(option.value); controls.collectionFilter.value=c.collectionId||''; controller.kindFilter.value=c.mediaKind||'all'; controller.availabilityFilter.value=c.availability||'all'; controls.orientation.value=c.orientation||''; controls.importedAfter.value=model.isoToDate(c.importedAfter); controls.importedBefore.value=model.isoToDate(c.importedBefore); controls.durationMin.value=c.minDurationSeconds??''; controls.durationMax.value=c.maxDurationSeconds??'';
      const sortEntry=Object.entries(model.SORT_MAP).find(([,value])=>value===(c.sort||'imported-desc')); controller.sortControl.value=sortEntry?.[0]||'newest'; void controller.runOrganisationSearch();
    });
    controls.deleteSavedView.addEventListener('click', () => { const id=controls.savedView.value; if(id) void controller.organisationMutation(() => bridge.deleteMediaView(id), 'Saved view deleted.'); });

    void controller.reloadOrganisation({ rerunSearch: true });
    return controller;
  }

  root.SwayForgeMediaLibrary = Object.freeze({ createMediaLibrary: (options) => install(createBaseLibrary(options)) });
})(globalThis);

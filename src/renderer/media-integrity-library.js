'use strict';

(function initialiseMediaIntegrityLibrary(root) {
  const library = root.SwayForgeMediaLibrary;
  if (!library?.createMediaLibrary) return;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function appendIntegritySection(controller, item) {
    const bridge = root.swayForge;
    if (!controller?.detailsBody || !item) return;

    const term = createElement('dt', 'media-details__label', 'Media integrity');
    const description = createElement('dd', 'media-details__value');
    const container = createElement('div', 'media-details__integrity');
    const status = createElement('p', '', 'Integrity has not been checked in this session.');
    const actions = createElement('div', 'button-group');
    const checkButton = createElement('button', 'button button--secondary', 'Check integrity');
    const forceButton = createElement('button', 'button button--secondary', 'Force hash');
    const repairButton = createElement('button', 'button button--secondary', 'Choose recovery file');
    const rebuildButton = createElement('button', 'button button--secondary', 'Rebuild derived');
    const aiButton = createElement('button', 'button button--secondary', 'Regenerate local AI');
    for (const button of [checkButton, forceButton, repairButton, rebuildButton, aiButton]) button.type = 'button';
    repairButton.hidden = true;

    const stillActive = () => controller.activeDetailsId === item.id && description.isConnected;
    const setBusy = (busy) => {
      for (const button of [checkButton, forceButton, repairButton, rebuildButton, aiButton]) button.disabled = busy;
    };

    const showHealth = (health) => {
      if (!stillActive()) return;
      const derived = health?.derived && typeof health.derived === 'object'
        ? ` Preview ${health.derived.preview ?? 'unknown'}; index ${health.derived.index ?? 'unknown'}; similarity ${health.derived.similarity ?? 'unknown'}; AI ${health.derived.ai ?? 'unknown'}.`
        : '';
      const label = health?.state ? `${health.state}${health.reason ? ` — ${health.reason}` : ''}` : 'unknown';
      status.textContent = `Local health: ${label}.${derived}`;
      repairButton.hidden = !['missing', 'changed', 'corrupt', 'needs-relink'].includes(health?.state);
    };

    async function scan(forceHash) {
      if (!bridge?.scanMediaIntegrity || !stillActive()) return;
      setBusy(true);
      status.textContent = forceHash ? 'Verifying source hash locally…' : 'Checking local media health…';
      try {
        const result = await bridge.scanMediaIntegrity([item.id], { forceHash });
        if (!stillActive()) return;
        if (!result?.ok) {
          status.textContent = result?.error?.message || 'Media integrity could not be checked safely.';
          return;
        }
        const health = result.value?.items?.[0];
        if (!health) {
          status.textContent = 'No matching media record was available for the integrity check.';
          return;
        }
        showHealth(health);
      } catch {
        if (stillActive()) status.textContent = 'Media integrity could not be checked safely. No source was changed.';
      } finally {
        if (stillActive()) setBusy(false);
      }
    }

    async function repair() {
      if (!bridge?.repairManagedMedia || !stillActive()) return;
      setBusy(true);
      status.textContent = 'Choose the exact original file to restore this managed media item.';
      try {
        const result = await bridge.repairManagedMedia(item.id);
        if (!stillActive()) return;
        if (!result?.ok) {
          status.textContent = result?.error?.message || 'Managed media recovery failed safely.';
          return;
        }
        if (result.value?.status === 'cancelled') {
          status.textContent = 'Recovery cancelled. Nothing was changed.';
          return;
        }
        if (result.value?.status === 'different-content') {
          status.textContent = 'That file has different content. The existing media ID and references were left unchanged; import it as new media instead.';
          return;
        }
        status.textContent = 'Exact-content recovery restored the managed source under the existing media ID.';
        await scan(true);
      } catch {
        if (stillActive()) status.textContent = 'Managed media recovery failed safely. Existing metadata and source bytes were preserved where available.';
      } finally {
        if (stillActive()) setBusy(false);
      }
    }

    async function rebuildDerived() {
      if (!bridge?.rebuildMediaDerived || !stillActive()) return;
      setBusy(true);
      status.textContent = 'Rebuilding local preview, search index and similarity fingerprints…';
      try {
        const result = await bridge.rebuildMediaDerived(item.id, ['preview', 'index', 'similarity']);
        if (!stillActive()) return;
        if (!result?.ok) {
          status.textContent = result?.error?.message || 'Derived media data could not be rebuilt safely.';
          return;
        }
        const failed = (result.value?.results ?? []).filter((entry) => entry?.ok === false);
        status.textContent = failed.length === 0
          ? 'Derived media data rebuilt locally. Source media and creator organisation were unchanged.'
          : `Derived rebuild completed with ${failed.length} failed component${failed.length === 1 ? '' : 's'}. Source media and creator organisation were preserved.`;
      } catch {
        if (stillActive()) status.textContent = 'Derived media rebuild failed safely. Source media was preserved.';
      } finally {
        if (stillActive()) setBusy(false);
      }
    }

    async function regenerateAi() {
      if (!bridge?.rebuildMediaDerived || !stillActive()) return;
      setBusy(true);
      status.textContent = 'Regenerating local AI analysis with the configured Ollama runtime…';
      try {
        const result = await bridge.rebuildMediaDerived(item.id, ['ai']);
        if (!stillActive()) return;
        if (!result?.ok) {
          status.textContent = result?.error?.message || 'Local AI analysis could not be regenerated safely.';
          return;
        }
        const failed = (result.value?.results ?? []).some((entry) => entry?.ok === false);
        status.textContent = failed
          ? 'Local AI regeneration failed safely. Source media and creator organisation were preserved.'
          : 'Local AI analysis regenerated. Source media and creator organisation were unchanged.';
      } catch {
        if (stillActive()) status.textContent = 'Local AI regeneration failed safely. Source media was preserved.';
      } finally {
        if (stillActive()) setBusy(false);
      }
    }

    checkButton.addEventListener('click', () => void scan(false));
    forceButton.addEventListener('click', () => void scan(true));
    repairButton.addEventListener('click', () => void repair());
    rebuildButton.addEventListener('click', () => void rebuildDerived());
    aiButton.addEventListener('click', () => void regenerateAi());
    actions.append(checkButton, forceButton, repairButton, rebuildButton, aiButton);
    container.append(
      status,
      createElement('p', '', 'Managed source deletion is not available in this recovery workflow.'),
      actions
    );
    description.append(container);
    controller.detailsBody.append(term, description);
  }

  const createMediaLibrary = library.createMediaLibrary.bind(library);
  root.SwayForgeMediaLibrary = Object.freeze({
    createMediaLibrary(options) {
      const controller = createMediaLibrary(options);
      const openDetails = controller.openDetails.bind(controller);
      controller.openDetails = function openDetailsWithIntegrity(mediaId, trigger) {
        openDetails(mediaId, trigger);
        const item = controller.items.find((candidate) => candidate.id === mediaId);
        if (item && controller.activeDetailsId === item.id) appendIntegritySection(controller, item);
      };
      return controller;
    }
  });
})(globalThis);

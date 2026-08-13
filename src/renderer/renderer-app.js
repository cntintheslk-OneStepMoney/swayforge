'use strict';

const versionElement = document.querySelector('#app-version');
const pageHeadingElement = document.querySelector('#page-heading');
const pageContextElement = document.querySelector('#page-context');
const mainContentElement = document.querySelector('#main-content');
const globalStatusElement = document.querySelector('#global-status');
const projectCountElement = document.querySelector('#project-count');
const mediaCountElement = document.querySelector('#media-count');
const aiStatusElement = document.querySelector('#ai-status');
const secretStatusElement = document.querySelector('#secret-status');
const projectStateElement = document.querySelector('#projects-state');
const projectListElement = document.querySelector('#project-list');
const navigationButtons = Array.from(document.querySelectorAll('[data-route]'));
const navigation = globalThis.SwayForgeNavigation;
const mediaLibraryUi = globalThis.SwayForgeMediaLibrary;

const AI_STATUS_LABELS = Object.freeze({
  unavailable: 'Ollama unavailable',
  ready: 'Ready',
  'no-model': 'No local model',
  busy: 'Busy',
  error: 'Error',
  unsupported: 'Unsupported',
  disabled: 'Disabled'
});

let currentRouteKey = 'home';
let booted = false;
let loadToken = 0;
let mediaLibrary = null;

function setText(element, value, fallback = 'Unknown') {
  element.textContent = typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}
function showGlobalError(message) { setText(globalStatusElement, message, 'The local workspace could not be loaded.'); globalStatusElement.hidden = false; }
function clearGlobalError() { globalStatusElement.hidden = true; globalStatusElement.textContent = ''; }
function unwrapResult(result, fallbackMessage) { if (!result || result.ok !== true) throw new Error(result?.error?.message || fallbackMessage); return result.value; }
function formatDate(value) { if (typeof value !== 'string') return 'No date'; const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) return 'No date'; return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp)); }
function projectArray(value) { return Array.isArray(value) ? value : Array.isArray(value?.projects) ? value.projects : []; }

function createCard({ title, description, meta }) {
  const article = document.createElement('article');
  const heading = document.createElement('h3');
  const body = document.createElement('p');
  const metadata = document.createElement('span');
  heading.textContent = title; body.textContent = description; metadata.className = 'card-meta'; metadata.textContent = meta;
  article.append(heading, body, metadata); return article;
}
function renderProjectList(payload) {
  projectListElement.replaceChildren();
  const safeProjects = projectArray(payload);
  projectStateElement.hidden = safeProjects.length > 0;
  if (safeProjects.length === 0) {
    projectStateElement.replaceChildren();
    const title = document.createElement('strong'); const body = document.createElement('span');
    title.textContent = 'No projects yet'; body.textContent = 'Create your first local content project from the Create page.'; projectStateElement.append(title, body); return safeProjects;
  }
  for (const project of safeProjects) {
    projectListElement.append(createCard({
      title: typeof project?.title === 'string' ? project.title : 'Untitled project',
      description: project?.status === 'archived' ? 'Archived local project' : 'Active local project',
      meta: formatDate(project?.updatedAt || project?.createdAt)
    }));
  }
  return safeProjects;
}
async function loadProjects(bridge, token = loadToken) {
  projectStateElement.hidden = false;
  const loading = projectStateElement.querySelector('strong'); if (loading) setText(loading, 'Loading projects…');
  try {
    const payload = unwrapResult(await bridge.listProjects(), 'Local projects could not be read.');
    if (token !== loadToken) return;
    const projects = renderProjectList(payload); setText(projectCountElement, projects.length);
  } catch (error) {
    projectListElement.replaceChildren(); projectStateElement.hidden = false; projectStateElement.replaceChildren();
    const title = document.createElement('strong'); const body = document.createElement('span'); title.textContent = 'Projects unavailable'; body.textContent = error.message; projectStateElement.append(title, body); setText(projectCountElement, 'Unavailable');
  }
}
async function loadMedia(bridge, token = loadToken) {
  mediaLibrary.setLoading();
  try {
    const mediaPayload = unwrapResult(await bridge.listMedia(), 'Managed media could not be read.');
    if (token !== loadToken) return;
    const mediaItems = mediaLibrary.setItems(mediaPayload); setText(mediaCountElement, mediaItems.length);
  } catch (error) { if (token !== loadToken) return; mediaLibrary.setError(error.message); setText(mediaCountElement, 'Unavailable'); }
}
function secretStatusLabel(status) { if (!status || typeof status !== 'object') return 'Unavailable'; if (status.available === true || status.state === 'ready') return 'Ready'; if (status.available === false || status.state === 'unavailable') return 'Unavailable'; return 'Protected'; }
async function refreshHome(bridge) {
  const token = ++loadToken; clearGlobalError(); const tasks = [loadProjects(bridge, token), loadMedia(bridge, token)];
  tasks.push(bridge.getAiRuntimeStatus().then((status) => setText(aiStatusElement, AI_STATUS_LABELS[status?.state] || 'Unknown')).catch(() => setText(aiStatusElement, 'Ollama unavailable')));
  tasks.push(bridge.getSecretStorageStatus().then((status) => setText(secretStatusElement, secretStatusLabel(status))).catch(() => setText(secretStatusElement, 'Unavailable')));
  await Promise.allSettled(tasks);
}
function updateNavigationSelection(routeKey) {
  for (const button of navigationButtons) {
    const route = navigation.getRoute(button.dataset.route);
    button.disabled = route?.enabled !== true;
    if (button.disabled) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    const selected = button.dataset.route === routeKey;
    button.classList.toggle('is-selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); if (!button.disabled) button.tabIndex = selected ? 0 : -1;
  }
}
function showView(routeKey, bridge, { focusMain = false } = {}) {
  const route = navigation.getRoute(routeKey); if (!route?.enabled) return false;
  if (route.key === 'create') void globalThis.SwayForgeContentStudio?.activate?.(bridge);
  currentRouteKey = route.key; updateNavigationSelection(route.key); setText(pageHeadingElement, route.heading); setText(pageContextElement, route.context);
  for (const view of document.querySelectorAll('[data-view]')) view.hidden = view.dataset.view !== route.key;
  if (route.key === 'projects') void loadProjects(bridge, ++loadToken);
  if (route.key === 'media') void loadMedia(bridge, ++loadToken);
  if (route.key === 'home') void refreshHome(bridge);
  if (focusMain) mainContentElement.focus({ preventScroll: true }); return true;
}
function focusRouteButton(routeKey) { navigationButtons.find((button) => button.dataset.route === routeKey && !button.disabled)?.focus(); }
function handleNavigationKeydown(event) {
  const button = event.target.closest?.('[data-route]'); if (!button || button.disabled) return;
  const directions = Object.freeze({ ArrowDown: 'next', ArrowRight: 'next', ArrowUp: 'previous', ArrowLeft: 'previous', Home: 'first', End: 'last' });
  const direction = directions[event.key]; if (!direction) return; event.preventDefault(); focusRouteButton(navigation.moveEnabledRoute(button.dataset.route, direction));
}
function registerNavigationHandlers(bridge) {
  updateNavigationSelection(currentRouteKey);
  for (const button of navigationButtons) { if (button.disabled) continue; button.addEventListener('click', () => showView(button.dataset.route, bridge, { focusMain: true })); }
  document.querySelector('.primary-nav').addEventListener('keydown', handleNavigationKeydown);
  for (const shortcut of document.querySelectorAll('[data-nav-target]')) shortcut.addEventListener('click', () => showView(shortcut.dataset.navTarget, bridge, { focusMain: true }));
}
function registerActionHandlers(bridge) {
  document.querySelector('#refresh-status').addEventListener('click', () => refreshHome(bridge));
  document.querySelector('#reload-projects').addEventListener('click', () => loadProjects(bridge, ++loadToken));
  document.querySelector('#reload-media').addEventListener('click', () => loadMedia(bridge, ++loadToken));
  document.querySelector('#import-media').addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Importing…';
    try { const result = unwrapResult(await bridge.chooseAndImportMedia(), 'Media import failed.'); if (result?.status !== 'cancelled') await loadMedia(bridge, ++loadToken); }
    catch (error) { showGlobalError(error.message); }
    finally { button.disabled = false; button.textContent = 'Import media'; }
  });
}
function validBridge(bridge) {
  return bridge && ['getApplicationInfo','healthCheck','getAiRuntimeStatus','getSecretStorageStatus','listProjects','listMedia','chooseAndImportMedia','listContentProjects','createContentProject','getContentProject','updateContentProject','archiveContentProject'].every((name) => typeof bridge[name] === 'function');
}
async function bootRenderer() {
  if (booted) return; booted = true; const bridge = window.swayForge;
  if (!navigation || !mediaLibraryUi || !validBridge(bridge)) { showGlobalError('The secure application bridge is unavailable. Restart SwayForge.'); return; }
  mediaLibrary = mediaLibraryUi.createMediaLibrary({ rootElement: document.querySelector('#view-media') });
  registerNavigationHandlers(bridge); registerActionHandlers(bridge); updateNavigationSelection(currentRouteKey);
  try { const [applicationInfo, health] = await Promise.all([bridge.getApplicationInfo(), bridge.healthCheck()]); if (!applicationInfo || health?.status !== 'ok') throw new Error('Foundation health check failed.'); setText(versionElement, `v${applicationInfo.version}`); }
  catch { setText(versionElement, 'Unavailable'); showGlobalError('SwayForge started, but its local foundation health check failed.'); }
  await refreshHome(bridge);
}

void bootRenderer();

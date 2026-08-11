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
const mediaStateElement = document.querySelector('#media-state');
const mediaListElement = document.querySelector('#media-list');
const navigationButtons = Array.from(document.querySelectorAll('[data-route]'));
const views = Array.from(document.querySelectorAll('[data-view]'));
const navigation = globalThis.SwayForgeNavigation;

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

function setText(element, value, fallback = 'Unknown') {
  element.textContent = typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function showGlobalError(message) {
  setText(globalStatusElement, message, 'The local workspace could not be loaded.');
  globalStatusElement.hidden = false;
}

function clearGlobalError() {
  globalStatusElement.hidden = true;
  globalStatusElement.textContent = '';
}

function unwrapResult(result, fallbackMessage) {
  if (!result || result.ok !== true) {
    throw new Error(result?.error?.message || fallbackMessage);
  }
  return result.value;
}

function formatDate(value) {
  if (typeof value !== 'string') return 'No date';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'No date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp));
}

function createCard({ title, description, meta }) {
  const article = document.createElement('article');
  const heading = document.createElement('h3');
  const body = document.createElement('p');
  const metadata = document.createElement('span');
  heading.textContent = title;
  body.textContent = description;
  metadata.className = 'card-meta';
  metadata.textContent = meta;
  article.append(heading, body, metadata);
  return article;
}

function renderProjectList(projects) {
  projectListElement.replaceChildren();
  const safeProjects = Array.isArray(projects) ? projects : [];
  projectStateElement.hidden = safeProjects.length > 0;
  if (safeProjects.length === 0) {
    projectStateElement.replaceChildren();
    const title = document.createElement('strong');
    const body = document.createElement('span');
    title.textContent = 'No projects yet';
    body.textContent = 'Your local project list is empty. Project creation remains owned by the existing storage workflow.';
    projectStateElement.append(title, body);
    return;
  }

  for (const project of safeProjects) {
    projectListElement.append(createCard({
      title: typeof project?.name === 'string' ? project.name : 'Untitled project',
      description: project?.archivedAt ? 'Archived local project' : 'Active local project',
      meta: formatDate(project?.updatedAt || project?.createdAt)
    }));
  }
}

function mediaDescription(media) {
  const kind = media?.kind === 'video' ? 'Video' : media?.kind === 'image' ? 'Image' : 'Media';
  const dimensions = Number.isInteger(media?.width) && Number.isInteger(media?.height)
    ? ` · ${media.width}×${media.height}`
    : '';
  return `${kind}${dimensions} · Managed local copy`;
}

function renderMediaList(mediaItems) {
  mediaListElement.replaceChildren();
  const safeMediaItems = Array.isArray(mediaItems) ? mediaItems : [];
  mediaStateElement.hidden = safeMediaItems.length > 0;
  if (safeMediaItems.length === 0) {
    mediaStateElement.replaceChildren();
    const title = document.createElement('strong');
    const body = document.createElement('span');
    title.textContent = 'No managed media yet';
    body.textContent = 'Import supported creator-owned media to create a verified managed copy.';
    mediaStateElement.append(title, body);
    return;
  }

  for (const media of safeMediaItems) {
    mediaListElement.append(createCard({
      title: typeof media?.originalFilename === 'string' ? media.originalFilename : 'Unnamed media',
      description: mediaDescription(media),
      meta: formatDate(media?.importedAt)
    }));
  }
}

async function loadProjects(bridge, token = loadToken) {
  projectStateElement.hidden = false;
  setText(projectStateElement.querySelector('strong'), 'Loading projects…');
  try {
    const projects = unwrapResult(await bridge.listProjects(), 'Local projects could not be read.');
    if (token !== loadToken) return;
    renderProjectList(projects);
    setText(projectCountElement, Array.isArray(projects) ? projects.length : 0);
  } catch (error) {
    projectListElement.replaceChildren();
    projectStateElement.hidden = false;
    projectStateElement.replaceChildren();
    const title = document.createElement('strong');
    const body = document.createElement('span');
    title.textContent = 'Projects unavailable';
    body.textContent = error.message;
    projectStateElement.append(title, body);
    setText(projectCountElement, 'Unavailable');
  }
}

async function loadMedia(bridge, token = loadToken) {
  mediaStateElement.hidden = false;
  setText(mediaStateElement.querySelector('strong'), 'Loading media…');
  try {
    const mediaItems = unwrapResult(await bridge.listMedia(), 'Managed media could not be read.');
    if (token !== loadToken) return;
    renderMediaList(mediaItems);
    setText(mediaCountElement, Array.isArray(mediaItems) ? mediaItems.length : 0);
  } catch (error) {
    mediaListElement.replaceChildren();
    mediaStateElement.hidden = false;
    mediaStateElement.replaceChildren();
    const title = document.createElement('strong');
    const body = document.createElement('span');
    title.textContent = 'Media unavailable';
    body.textContent = error.message;
    mediaStateElement.append(title, body);
    setText(mediaCountElement, 'Unavailable');
  }
}

function secretStatusLabel(status) {
  if (!status || typeof status !== 'object') return 'Unavailable';
  if (status.available === true || status.state === 'ready') return 'Ready';
  if (status.available === false || status.state === 'unavailable') return 'Unavailable';
  return 'Protected';
}

async function refreshHome(bridge) {
  const token = ++loadToken;
  clearGlobalError();
  const tasks = [loadProjects(bridge, token), loadMedia(bridge, token)];

  tasks.push(bridge.getAiRuntimeStatus()
    .then((status) => setText(aiStatusElement, AI_STATUS_LABELS[status?.state] || 'Unknown'))
    .catch(() => setText(aiStatusElement, 'Ollama unavailable')));

  tasks.push(bridge.getSecretStorageStatus()
    .then((status) => setText(secretStatusElement, secretStatusLabel(status)))
    .catch(() => setText(secretStatusElement, 'Unavailable')));

  await Promise.allSettled(tasks);
}

function updateNavigationSelection(routeKey) {
  for (const button of navigationButtons) {
    const selected = button.dataset.route === routeKey;
    button.classList.toggle('is-selected', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    if (!button.disabled) button.tabIndex = selected ? 0 : -1;
  }
}

function showView(routeKey, bridge, { focusMain = false } = {}) {
  const route = navigation.getRoute(routeKey);
  if (!route?.enabled) return false;
  currentRouteKey = route.key;
  updateNavigationSelection(route.key);
  setText(pageHeadingElement, route.heading);
  setText(pageContextElement, route.context);
  for (const view of views) view.hidden = view.dataset.view !== route.key;
  if (route.key === 'projects') void loadProjects(bridge, ++loadToken);
  if (route.key === 'media') void loadMedia(bridge, ++loadToken);
  if (route.key === 'home') void refreshHome(bridge);
  if (focusMain) mainContentElement.focus({ preventScroll: true });
  return true;
}

function focusRouteButton(routeKey) {
  const target = navigationButtons.find((button) => button.dataset.route === routeKey && !button.disabled);
  target?.focus();
}

function handleNavigationKeydown(event) {
  const button = event.target.closest?.('[data-route]');
  if (!button || button.disabled) return;
  const directions = Object.freeze({ ArrowDown: 'next', ArrowRight: 'next', ArrowUp: 'previous', ArrowLeft: 'previous', Home: 'first', End: 'last' });
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  focusRouteButton(navigation.moveEnabledRoute(button.dataset.route, direction));
}

function registerNavigationHandlers(bridge) {
  for (const button of navigationButtons) {
    if (button.disabled) continue;
    button.addEventListener('click', () => showView(button.dataset.route, bridge, { focusMain: true }));
  }
  document.querySelector('.primary-nav').addEventListener('keydown', handleNavigationKeydown);
  for (const shortcut of document.querySelectorAll('[data-nav-target]')) {
    shortcut.addEventListener('click', () => showView(shortcut.dataset.navTarget, bridge, { focusMain: true }));
  }
}

function registerActionHandlers(bridge) {
  document.querySelector('#refresh-status').addEventListener('click', () => refreshHome(bridge));
  document.querySelector('#reload-projects').addEventListener('click', () => loadProjects(bridge, ++loadToken));
  document.querySelector('#reload-media').addEventListener('click', () => loadMedia(bridge, ++loadToken));
  document.querySelector('#import-media').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Importing…';
    try {
      const result = unwrapResult(await bridge.chooseAndImportMedia(), 'Media import failed.');
      if (result?.status !== 'cancelled') await loadMedia(bridge, ++loadToken);
    } catch (error) {
      showGlobalError(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Import media';
    }
  });
}

function validBridge(bridge) {
  return bridge && [
    'getApplicationInfo',
    'healthCheck',
    'getAiRuntimeStatus',
    'getSecretStorageStatus',
    'listProjects',
    'listMedia',
    'chooseAndImportMedia'
  ].every((name) => typeof bridge[name] === 'function');
}

async function bootRenderer() {
  if (booted) return;
  booted = true;
  const bridge = window.swayForge;
  if (!navigation || !validBridge(bridge)) {
    showGlobalError('The secure application bridge is unavailable. Restart SwayForge.');
    return;
  }

  registerNavigationHandlers(bridge);
  registerActionHandlers(bridge);
  updateNavigationSelection(currentRouteKey);

  try {
    const [applicationInfo, health] = await Promise.all([bridge.getApplicationInfo(), bridge.healthCheck()]);
    if (!applicationInfo || health?.status !== 'ok') throw new Error('Foundation health check failed.');
    setText(versionElement, `v${applicationInfo.version}`);
  } catch {
    setText(versionElement, 'Unavailable');
    showGlobalError('SwayForge started, but its local foundation health check failed.');
  }

  await refreshHome(bridge);
}

void bootRenderer();

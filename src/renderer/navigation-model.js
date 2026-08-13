'use strict';

(function attachNavigationModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SwayForgeNavigation = api;
  if (root?.document) {
    for (const source of ['./settings-page.js', './content-studio-ui.js', './content-writing-ui.js']) {
      const script = root.document.createElement('script');
      script.src = source;
      script.async = false;
      root.document.head.append(script);
    }
  }
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const ROUTES = Object.freeze([
    Object.freeze({ key: 'home', label: 'Home', enabled: true, heading: 'Home', context: 'Your local SwayForge workspace at a glance.' }),
    Object.freeze({ key: 'projects', label: 'Projects', enabled: true, heading: 'Projects', context: 'Organise local content work without leaving your device.' }),
    Object.freeze({ key: 'media', label: 'Media', enabled: true, heading: 'Media', context: 'Review creator-owned media managed by SwayForge.' }),
    Object.freeze({ key: 'create', label: 'Create', enabled: true, heading: 'Create', context: 'Build and edit local Content Studio projects while keeping creator media and decisions on-device.' }),
    Object.freeze({ key: 'trends', label: 'Trends', enabled: false, heading: 'Trends', context: 'Trend Intelligence is planned for v0.5.0.' }),
    Object.freeze({ key: 'publishing', label: 'Publishing', enabled: false, heading: 'Publishing', context: 'Social publishing is planned for v0.4.0.' }),
    Object.freeze({ key: 'settings', label: 'Settings', enabled: true, heading: 'Settings', context: 'Configure local appearance, Ollama, storage information and privacy-safe diagnostics.' })
  ]);
  const ROUTE_BY_KEY = new Map(ROUTES.map((route) => [route.key, route]));
  const ENABLED_ROUTE_KEYS = Object.freeze(ROUTES.filter((route) => route.enabled).map((route) => route.key));
  function getRoute(key) { return ROUTE_BY_KEY.get(key) ?? null; }
  function normaliseRouteKey(key) { const route = getRoute(key); return route?.enabled ? route.key : 'home'; }
  function moveEnabledRoute(currentKey, direction) {
    const current = normaliseRouteKey(currentKey); const index = ENABLED_ROUTE_KEYS.indexOf(current);
    if (direction === 'first') return ENABLED_ROUTE_KEYS[0];
    if (direction === 'last') return ENABLED_ROUTE_KEYS[ENABLED_ROUTE_KEYS.length - 1];
    const delta = direction === 'previous' ? -1 : 1;
    return ENABLED_ROUTE_KEYS[(index + delta + ENABLED_ROUTE_KEYS.length) % ENABLED_ROUTE_KEYS.length];
  }
  return Object.freeze({ ROUTES, getRoute, moveEnabledRoute, normaliseRouteKey });
});

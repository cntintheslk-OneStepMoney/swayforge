'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  inferMetadata,
  inferStatus,
  inferType,
  parseIndexRows,
  mergeMetadata,
  buildUpdates,
  fieldUpdate,
  validateConfig,
  projectBase,
  redactSensitive
} = require('../scripts/project-board-sync.cjs');

const root = path.resolve(__dirname, '..');

function issue(overrides = {}) {
  return {
    number: 24,
    id: 2400,
    node_id: 'I_24',
    title: '[Roadmap][Design Brief][v0.3.0] Content project and creative brief model',
    body: [
      '- **Planned type:** Feature',
      '- **Planned branch:** `feature/content-projects`',
      '- **Priority:** Critical',
      '- **Complexity:** Large',
      '- **Area:** Content Studio / Projects / Data'
    ].join('\n'),
    state: 'open',
    state_reason: null,
    ...overrides
  };
}

test('planned Design Brief reads type from body rather than Design Brief title token', () => {
  assert.equal(inferType(issue().title, issue().body), 'Feature');
});

test('planned work does not expose a branch or start date before commencement', () => {
  const metadata = inferMetadata(issue());
  assert.equal(metadata.status, 'Planned');
  assert.equal(metadata.branch, null);
  assert.equal(metadata.startDate, null);
  assert.equal(metadata.targetRelease, 'v0.3.0');
});

test('active work reads actual branch and dates', () => {
  const metadata = inferMetadata(issue({
    title: '[Work][Maintenance][v0.2.1] Automate Project board',
    body: [
      '- **Type:** Maintenance',
      '- **Branch:** `maintenance/project-board-sync`',
      '- **Priority:** Critical',
      '- **Complexity:** Large',
      '- **Area:** Project Management / Automation / GitHub',
      '- **Status:** In Progress',
      '- **Start Date:** 2026-08-13',
      '- **Target Date:** 2026-08-13'
    ].join('\n')
  }));
  assert.equal(metadata.status, 'In Progress');
  assert.equal(metadata.branch, 'maintenance/project-board-sync');
  assert.equal(metadata.startDate, '2026-08-13');
  assert.equal(metadata.targetDate, '2026-08-13');
});

test('closed completed work overrides stale Review text', () => {
  const closed = issue({
    state: 'closed',
    state_reason: 'completed',
    body: '- **Status:** Review\n- **Start Date:** 2026-08-12'
  });
  assert.equal(inferStatus(closed, closed.body), 'Done');
});

test('closed not-planned issue does not become Done', () => {
  const closed = issue({ state: 'closed', state_reason: 'not_planned', body: '' });
  assert.equal(inferStatus(closed, ''), 'Backlog');
});

test('Index roadmap table is parsed into canonical Project metadata', () => {
  const rows = parseIndexRows([
    '| Priority | Complexity | Title | Status | Type | Target Release | Area | Branch | Start Date | Target Date |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| Critical | Large | #24 — Content project and creative brief model | Planned | Feature | v0.3.0 | Content Studio / Projects / Data | — | — | — |',
    '| Critical | Large | #131 — Project board automation | In Progress | Maintenance | v0.2.1 | Project Management / Automation / GitHub | `maintenance/project-board-sync` | 2026-08-13 | 2026-08-13 |'
  ].join('\n'));

  assert.equal(rows.get(24).priority, 'Critical');
  assert.equal(rows.get(24).branch, null);
  assert.equal(rows.get(131).status, 'In Progress');
  assert.equal(rows.get(131).branch, 'maintenance/project-board-sync');
});

test('Index values override Issue planning metadata but closed state remains Done', () => {
  const current = issue({ state: 'closed', state_reason: 'completed' });
  const indexMetadata = parseIndexRows('| Critical | Large | #24 — Work | Review | Feature | v0.3.0 | Content Studio | `feature/content-projects` | 2026-08-13 | — |').get(24);
  const merged = mergeMetadata(current, inferMetadata(current), indexMetadata);
  assert.equal(merged.status, 'Done');
  assert.equal(merged.priority, 'Critical');
});

test('planned Index row authoritatively clears stale branch and dates', () => {
  const current = issue({
    title: '[Work][Feature][v0.3.0] Content projects',
    body: '- **Status:** In Progress\n- **Branch:** `feature/content-projects`\n- **Start Date:** 2026-08-13'
  });
  const indexMetadata = parseIndexRows('| Critical | Large | #24 — Work | Planned | Feature | v0.3.0 | Content Studio | — | — | — |').get(24);
  const merged = mergeMetadata(current, inferMetadata(current), indexMetadata);
  assert.equal(merged.status, 'Planned');
  assert.equal(merged.branch, null);
  assert.equal(merged.startDate, null);
  assert.ok(merged.authoritativeKeys.includes('branch'));
});

test('single-select field resolves named option IDs', () => {
  const field = {
    id: 10,
    name: 'Status',
    data_type: 'single_select',
    options: [{ id: 'planned-id', name: { raw: 'Planned' } }]
  };
  assert.deepEqual(fieldUpdate(field, 'Planned'), { id: 10, value: 'planned-id' });
});

test('field update can explicitly clear an authoritative Project value', () => {
  assert.deepEqual(fieldUpdate({ id: 9, data_type: 'text' }, null), { id: 9, value: null });
});

test('buildUpdates fails visibly when canonical Project field is missing', () => {
  const metadata = {
    priority: 'Critical',
    complexity: null,
    status: 'Planned',
    type: null,
    targetRelease: null,
    area: null,
    branch: null,
    startDate: null,
    targetDate: null,
    authoritativeKeys: ['priority', 'status']
  };
  const config = { fieldNames: { priority: 'Priority', status: 'Status' } };
  const fields = new Map([['Priority', { id: 1, name: 'Priority', data_type: 'single_select', options: [{ id: 'p1', name: 'Critical' }] }]]);
  assert.throws(() => buildUpdates(metadata, fields, config), /Required Project field is missing: Status/);
});

test('configuration requires a real Project number rather than a guessed default', () => {
  assert.throws(() => validateConfig({ projectOwner: 'owner', projectOwnerType: 'user', projectNumber: 0, fieldNames: {} }), /positive integer/);
  assert.doesNotThrow(() => validateConfig({ projectOwner: 'owner', projectOwnerType: 'user', projectNumber: 3, fieldNames: {} }));
});

test('Project REST base is selected from owner type', () => {
  assert.equal(
    projectBase({ projectOwner: 'owner', projectOwnerType: 'user', projectNumber: 2 }),
    'https://api.github.com/users/owner/projectsV2/2'
  );
  assert.equal(
    projectBase({ projectOwner: 'org', projectOwnerType: 'organization', projectNumber: 5 }),
    'https://api.github.com/orgs/org/projectsV2/5'
  );
});

test('Project token-like values are redacted from API failure text', () => {
  const sentinel = 'ghp_swayforge_project_token_sentinel';
  assert.equal(redactSensitive(`failure ${sentinel}`, [sentinel]), 'failure [REDACTED]');
});

test('application release version stays independent from the dependency snapshot version', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockJson = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const rootPackage = lockJson.packages?.[''];

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(rootPackage?.name, packageJson.name);
  assert.deepEqual(rootPackage?.dependencies ?? {}, packageJson.dependencies ?? {});
  assert.deepEqual(rootPackage?.devDependencies ?? {}, packageJson.devDependencies ?? {});
  assert.deepEqual(rootPackage?.optionalDependencies ?? {}, packageJson.optionalDependencies ?? {});
});

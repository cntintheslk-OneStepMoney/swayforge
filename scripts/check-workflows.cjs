'use strict';

const fs = require('node:fs');
const path = require('node:path');

const QUALITY_WORKFLOW = '.github/workflows/quality.yml';
const PROJECT_SYNC_WORKFLOW = '.github/workflows/project-board-sync.yml';
const PROJECT_SYNC_SECRET = 'SWAYFORGE_PROJECT_TOKEN';
const DEVOPS_PROJECT_SYNC_WORKFLOW = '.github/workflows/project-sync.yml';
const DEVOPS_PROJECT_SYNC_SECRET = 'DEVOPS_PROJECT_TOKEN';

function readWorkflowFiles(root) {
  const workflowDirectory = path.join(root, '.github', 'workflows');
  return fs.readdirSync(workflowDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => ({
      relativePath: `.github/workflows/${entry.name}`,
      source: fs.readFileSync(path.join(workflowDirectory, entry.name), 'utf8')
    }));
}

function secretReferences(source) {
  return [...source.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
}

function topLevelPermissions(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'permissions:' && !/^\s/.test(line));
  if (start < 0) return new Map();

  const permissions = new Map();
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(read|write|none)\s*$/);
    if (match) permissions.set(match[1], match[2]);
  }
  return permissions;
}

function assertWorkflowPolicy(root = process.cwd()) {
  const workflows = readWorkflowFiles(root);
  const violations = [];

  for (const workflow of workflows) {
    const permissions = topLevelPermissions(workflow.source);
    if (permissions.get('contents') !== 'read') {
      violations.push(`${workflow.relativePath} (missing explicit read-only contents permission)`);
    }
    for (const [scope, access] of permissions) {
      if (access === 'write') violations.push(`${workflow.relativePath} (${scope}: write permission not allowed in normal CI)`);
    }
    if (/pull_request_target\s*:/m.test(workflow.source)) {
      violations.push(`${workflow.relativePath} (pull_request_target is not allowed)`);
    }

    const secrets = secretReferences(workflow.source);
    for (const secret of secrets) {
      const allowedProjectSecret = workflow.relativePath === PROJECT_SYNC_WORKFLOW && secret === PROJECT_SYNC_SECRET;
      const allowedDevOpsProjectSecret = workflow.relativePath === DEVOPS_PROJECT_SYNC_WORKFLOW && secret === DEVOPS_PROJECT_SYNC_SECRET;
      if (!allowedProjectSecret && !allowedDevOpsProjectSecret) {
        violations.push(`${workflow.relativePath} (Actions secret ${secret} is not allowlisted)`);
      }
    }
  }

  const quality = workflows.find((workflow) => workflow.relativePath === QUALITY_WORKFLOW);
  if (!quality) {
    violations.push(`${QUALITY_WORKFLOW} (missing)`);
  } else {
    const requiredMarkers = [
      'pull_request:',
      'jobs:',
      'core:',
      'windows:',
      'runs-on: ubuntu-latest',
      'runs-on: windows-latest',
      'actions/checkout@v6',
      'actions/setup-node@v6',
      'npm ci',
      'npm test',
      'npm run check:privacy',
      'npm run check:security',
      'npm run check:workflow',
      'npm run lint',
      'npm run test:windows',
      'npm run smoke:electron',
      'git diff --check'
    ];
    for (const marker of requiredMarkers) {
      if (!quality.source.includes(marker)) violations.push(`${QUALITY_WORKFLOW} (missing ${marker})`);
    }
    if (/OLLAMA_|TIKTOK_|INSTAGRAM_|YOUTUBE_|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN/.test(quality.source)) {
      violations.push(`${QUALITY_WORKFLOW} (must not depend on live Ollama/social credentials)`);
    }
  }

  const projectSync = workflows.find((workflow) => workflow.relativePath === PROJECT_SYNC_WORKFLOW);
  if (!projectSync) {
    violations.push(`${PROJECT_SYNC_WORKFLOW} (missing)`);
  } else {
    const requiredMarkers = [
      'workflow_dispatch:',
      'issues:',
      'schedule:',
      'permissions:',
      'contents: read',
      'issues: read',
      'actions/checkout@v6',
      'github.event.repository.default_branch',
      `secrets.${PROJECT_SYNC_SECRET}`,
      'vars.SWAYFORGE_PROJECT_OWNER',
      'vars.SWAYFORGE_PROJECT_NUMBER',
      'scripts/project-board-sync.cjs'
    ];
    for (const marker of requiredMarkers) {
      if (!projectSync.source.includes(marker)) violations.push(`${PROJECT_SYNC_WORKFLOW} (missing ${marker})`);
    }
    if (/^\s*pull_request\s*:/m.test(projectSync.source) || /pull_request_target\s*:/m.test(projectSync.source)) {
      violations.push(`${PROJECT_SYNC_WORKFLOW} (must not expose Project credentials to PR-triggered execution)`);
    }
    if (secretReferences(projectSync.source).some((secret) => secret !== PROJECT_SYNC_SECRET)) {
      violations.push(`${PROJECT_SYNC_WORKFLOW} (contains a non-Project secret reference)`);
    }
  }

  if (violations.length > 0) throw new Error(`Workflow policy rejected: ${violations.join(', ')}`);
  return true;
}

if (require.main === module) {
  try {
    assertWorkflowPolicy(process.cwd());
    process.stdout.write('Workflow policy check passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  QUALITY_WORKFLOW,
  PROJECT_SYNC_WORKFLOW,
  PROJECT_SYNC_SECRET,
  DEVOPS_PROJECT_SYNC_WORKFLOW,
  DEVOPS_PROJECT_SYNC_SECRET,
  assertWorkflowPolicy,
  readWorkflowFiles,
  secretReferences,
  topLevelPermissions
};

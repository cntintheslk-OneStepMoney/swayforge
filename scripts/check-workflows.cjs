'use strict';

const fs = require('node:fs');
const path = require('node:path');

const QUALITY_WORKFLOW = '.github/workflows/quality.yml';

function readWorkflowFiles(root) {
  const workflowDirectory = path.join(root, '.github', 'workflows');
  return fs.readdirSync(workflowDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => ({
      relativePath: `.github/workflows/${entry.name}`,
      source: fs.readFileSync(path.join(workflowDirectory, entry.name), 'utf8')
    }));
}

function assertWorkflowPolicy(root = process.cwd()) {
  const workflows = readWorkflowFiles(root);
  const violations = [];

  for (const workflow of workflows) {
    if (!/^permissions:\s*\n\s{2}contents:\s*read\s*$/m.test(workflow.source)) {
      violations.push(`${workflow.relativePath} (missing explicit read-only contents permission)`);
    }
    if (/^\s+[A-Za-z0-9_-]+:\s*write\s*$/m.test(workflow.source)) {
      violations.push(`${workflow.relativePath} (write permission not allowed in normal CI)`);
    }
    if (/pull_request_target\s*:/m.test(workflow.source)) {
      violations.push(`${workflow.relativePath} (pull_request_target is not allowed)`);
    }
    if (/\$\{\{\s*secrets\./.test(workflow.source)) {
      violations.push(`${workflow.relativePath} (production/user secrets are not allowed)`);
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
  assertWorkflowPolicy,
  readWorkflowFiles
};

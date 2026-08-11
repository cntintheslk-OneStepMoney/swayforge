'use strict';

const { spawnSync } = require('node:child_process');
const electronPath = require('electron');
const packageJson = require('../package.json');

const result = spawnSync(electronPath, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30_000
});

if (result.error) {
  process.stderr.write(`Electron preflight failed to start: ${result.error.code ?? result.error.name}\n`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.stderr.write(`Electron preflight exited with status ${result.status}.\n`);
  process.exitCode = 1;
} else {
  const actualVersion = result.stdout.trim().replace(/^v/, '');
  const expectedVersion = packageJson.devDependencies.electron;
  if (actualVersion !== expectedVersion) {
    process.stderr.write(`Electron preflight version mismatch: expected ${expectedVersion}, received ${actualVersion || 'unknown'}.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Electron non-interactive preflight passed (${actualVersion}).\n`);
  }
}

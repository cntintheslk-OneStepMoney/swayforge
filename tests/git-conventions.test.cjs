'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const conventionsPromise = import('../scripts/check-git-conventions.mjs');

function completePrBody(sections) {
  return sections.map((section) => `${section}\nContent`).join('\n\n');
}

test('accepts SwayForge titles using the OSM release/type scheme', async () => {
  const { validatePrMetadata, REQUIRED_PR_SECTIONS } = await conventionsPromise;
  const body = completePrBody(REQUIRED_PR_SECTIONS);

  assert.deepEqual(validatePrMetadata({ title: '[v0.1.0][Feature] Add structured AI contracts', body }), []);
  assert.deepEqual(validatePrMetadata({ title: '[Unscheduled][Maintenance] Standardise repository conventions', body }), []);
});

test('rejects legacy and free-form PR title styles', async () => {
  const { validatePrMetadata, REQUIRED_PR_SECTIONS } = await conventionsPromise;
  const body = completePrBody(REQUIRED_PR_SECTIONS);

  assert.ok(validatePrMetadata({ title: 'v0.1.0 local Ollama AI runtime', body }).some((failure) => failure.includes('PR title must match')));
  assert.ok(validatePrMetadata({ title: 'feat: add application shell', body }).some((failure) => failure.includes('PR title must match')));
});

test('requires the complete OSM-style PR description structure', async () => {
  const { validatePrMetadata } = await conventionsPromise;
  const failures = validatePrMetadata({ title: '[v0.1.0][Maintenance] Repository conventions', body: '## Purpose\nOnly one section' });

  assert.ok(failures.some((failure) => failure.includes('## Work completed')));
  assert.ok(failures.some((failure) => failure.includes('## Confirmations')));
});

test('accepts labelled commit bodies and rejects historical free-form commits', async () => {
  const { validateCommitMessage } = await conventionsPromise;
  const validBody = [
    'Purpose: Align SwayForge with OSM.',
    'Changes: Add repository convention checks.',
    'Verification: npm test.',
    'Issue: #111'
  ].join('\n');

  assert.deepEqual(validateCommitMessage({ sha: '1234567890', subject: '[v0.1.0][Maintenance] Standardise repository Git conventions', body: validBody }), []);

  const failures = validateCommitMessage({ sha: 'abcdef1234', subject: 'feat: add renderer bootstrap', body: '' });
  assert.ok(failures.some((failure) => failure.includes('commit title is not SwayForge/OSM-formatted')));
  assert.ok(failures.some((failure) => failure.includes('Purpose:')));
  assert.ok(failures.some((failure) => failure.includes('Issue:')));
});

test('merge commits are exempt from branch-commit formatting checks', async () => {
  const { validateCommitMessage } = await conventionsPromise;
  assert.deepEqual(validateCommitMessage({ sha: 'deadbeef', subject: 'Merge pull request #110 from example/branch', body: '' }), []);
});

test('parses git log records used by pull-request validation', async () => {
  const { parseGitLog } = await conventionsPromise;
  const log = 'abc\x1f[v0.1.0][Feature] Example\x1fPurpose: x\nChanges: y\nVerification: z\nIssue: #1\x1e';
  assert.deepEqual(parseGitLog(log), [{
    sha: 'abc',
    subject: '[v0.1.0][Feature] Example',
    body: 'Purpose: x\nChanges: y\nVerification: z\nIssue: #1'
  }]);
});

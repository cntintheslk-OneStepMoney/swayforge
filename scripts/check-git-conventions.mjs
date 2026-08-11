import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TITLE_PATTERN = /^\[(?:v\d+\.\d+\.\d+|Unscheduled|Historical|Superseded)\]\[(?:Feature|Bug|UI\/UX|Security|QOL|Maintenance)\] .+/;
export const REQUIRED_PR_SECTIONS = Object.freeze([
  '## Purpose',
  '## Work completed',
  '## Files changed',
  '## User-facing changes',
  '## Technical changes',
  '## Testing and verification',
  '## Data and migration impact',
  '## Known limitations',
  '## Excluded work',
  '## Branch details',
  '## Confirmations'
]);
export const REQUIRED_COMMIT_LABELS = Object.freeze(['Purpose:', 'Changes:', 'Verification:', 'Issue:']);
export const GRANDFATHER_THROUGH_PR = 110;

export function validatePrMetadata({ title = '', body = '' } = {}) {
  const failures = [];
  if (!TITLE_PATTERN.test(String(title))) {
    failures.push(`PR title must match [vX.Y.Z][Type] Concise title (or an allowed Unscheduled/Historical/Superseded prefix): ${title}`);
  }
  for (const section of REQUIRED_PR_SECTIONS) {
    if (!String(body).includes(section)) failures.push(`PR body is missing required section: ${section}`);
  }
  return failures;
}

export function validateCommitMessage({ sha = '', subject = '', body = '' } = {}) {
  if (String(subject).startsWith('Merge ')) return [];
  const failures = [];
  if (!TITLE_PATTERN.test(String(subject))) {
    failures.push(`${String(sha).slice(0, 7)} commit title is not SwayForge/OSM-formatted: ${subject}`);
  }
  for (const label of REQUIRED_COMMIT_LABELS) {
    if (!String(body).includes(label)) failures.push(`${String(sha).slice(0, 7)} commit body is missing ${label}`);
  }
  return failures;
}

export function parseGitLog(log = '') {
  return String(log)
    .split('\x1e')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f');
      return { sha, subject, body };
    });
}

export function runConventionCheck(env = process.env) {
  const prNumber = Number(env.PR_NUMBER || 0);
  const prTitle = String(env.PR_TITLE || '');
  const prBody = String(env.PR_BODY || '');
  const baseSha = String(env.BASE_SHA || '');
  const headSha = String(env.HEAD_SHA || '');

  if (!prNumber || !prTitle) {
    return { skipped: true, messages: ['Git convention check skipped outside pull requests.'], failures: [] };
  }

  const failures = validatePrMetadata({ title: prTitle, body: prBody });
  const messages = [];

  if (prNumber > GRANDFATHER_THROUGH_PR) {
    if (!baseSha || !headSha) {
      failures.push('BASE_SHA and HEAD_SHA are required to validate commit messages.');
    } else {
      try {
        const log = execFileSync('git', ['log', '--format=%H%x1f%s%x1f%b%x1e', `${baseSha}..${headSha}`], { encoding: 'utf8' });
        for (const commit of parseGitLog(log)) failures.push(...validateCommitMessage(commit));
      } catch (error) {
        failures.push(`Unable to inspect PR commits: ${error.message}`);
      }
    }
  } else {
    messages.push(`Commit-message enforcement is grandfathered through PR #${GRANDFATHER_THROUGH_PR}; PR metadata is still validated.`);
  }

  return { skipped: false, messages, failures };
}

function main() {
  const result = runConventionCheck(process.env);
  for (const message of result.messages) console.log(message);
  if (result.failures.length) {
    console.error('Git convention check failed:\n- ' + result.failures.join('\n- '));
    process.exitCode = 1;
    return;
  }
  if (!result.skipped) console.log('Git convention check passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

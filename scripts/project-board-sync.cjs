'use strict';

const fs = require('node:fs');

const API_VERSION = '2026-03-10';
const STATUS_VALUES = new Set(['Idea', 'Backlog', 'Planned', 'In Progress', 'Review', 'Done']);
const PRIORITY_VALUES = new Set(['Critical', 'High', 'Medium', 'Low']);
const COMPLEXITY_VALUES = new Set(['Small', 'Medium', 'Large']);
const TYPE_VALUES = new Set(['Feature', 'Bug', 'UI/UX', 'Security', 'QOL', 'Maintenance']);
const SYNC_KEYS = ['priority', 'complexity', 'status', 'type', 'targetRelease', 'area', 'branch', 'startDate', 'targetDate'];

function parseArgs(argv) {
  const args = { dryRun: false, issue: null, config: null };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--issue') args.issue = Number(argv[++index]);
    else if (value === '--config') args.config = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineValue(body, labels) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`^\\s*[-*]\\s*\\*\\*${escaped}:\\*\\*\\s*(.+?)\\s*$`, 'im'),
      new RegExp(`^\\s*[-*]\\s*${escaped}:\\s*(.+?)\\s*$`, 'im'),
      new RegExp(`^\\s*${escaped}:\\s*(.+?)\\s*$`, 'im')
    ];
    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) return cleanValue(match[1]);
    }
  }
  return null;
}

function cleanValue(value) {
  if (value == null) return null;
  const cleaned = value
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned === '—' || cleaned === '-' ? null : cleaned;
}

function inferRelease(title, body) {
  if (/^\[Roadmap\]\[Index\]/i.test(title)) return null;
  const source = `${title}\n${body}`;
  const match = source.match(/\bv(\d+\.\d+\.\d+)\b/i);
  return match ? `v${match[1]}` : null;
}

function inferType(title, body) {
  const workMatch = title.match(/^\[Work\]\[([^\]]+)\]/i);
  if (workMatch) {
    return [...TYPE_VALUES].find((value) => value.toLowerCase() === workMatch[1].toLowerCase()) || null;
  }
  if (/^\[Roadmap\]\[Design Brief\]/i.test(title)) {
    const raw = lineValue(body, ['Planned type', 'Type']);
    return raw ? [...TYPE_VALUES].find((value) => value.toLowerCase() === raw.toLowerCase()) || null : null;
  }
  if (/^\[Roadmap\]\[(?:Umbrella|Index)\]/i.test(title)) return null;
  const raw = lineValue(body, ['Planned type', 'Type']);
  return raw ? [...TYPE_VALUES].find((value) => value.toLowerCase() === raw.toLowerCase()) || null : null;
}

function inferStatus(issue, body) {
  if (issue.state === 'closed' && issue.state_reason !== 'not_planned') return 'Done';
  if (issue.state === 'closed' && issue.state_reason === 'not_planned') return 'Backlog';
  const explicit = lineValue(body, ['Status']);
  if (explicit && STATUS_VALUES.has(explicit)) return explicit;
  if (/\bDraft PR\b|\bReview Date\b|\bStatus:\s*Review\b/i.test(body)) return 'Review';
  if (/\bStatus:\s*In Progress\b/i.test(body)) return 'In Progress';
  if (/^\[Roadmap\]\[(?:Design Brief|Umbrella)\]/i.test(issue.title)) return 'Planned';
  if (/^\[Report\]\[Bug\]\[Unscheduled\]/i.test(issue.title)) return 'Backlog';
  if (/^\[Idea\]/i.test(issue.title)) return 'Idea';
  return 'Backlog';
}

function inferBranch(body, status) {
  if (!['In Progress', 'Review', 'Done'].includes(status)) return null;
  return lineValue(body, ['Branch', 'Actual branch']);
}

function inferStartDate(body, status) {
  if (!['In Progress', 'Review', 'Done'].includes(status)) return null;
  return lineValue(body, ['Start Date']);
}

function inferTargetDate(body) {
  return lineValue(body, ['Target Date']);
}

function inferMetadata(issue) {
  const body = issue.body || '';
  const status = inferStatus(issue, body);
  const metadata = {
    issueNumber: issue.number,
    priority: lineValue(body, ['Priority']),
    complexity: lineValue(body, ['Complexity']),
    status,
    type: inferType(issue.title, body),
    targetRelease: inferRelease(issue.title, body),
    area: lineValue(body, ['Area']),
    branch: inferBranch(body, status),
    startDate: inferStartDate(body, status),
    targetDate: inferTargetDate(body),
    authoritativeKeys: ['status']
  };

  if (metadata.priority && !PRIORITY_VALUES.has(metadata.priority)) metadata.priority = null;
  if (metadata.complexity && !COMPLEXITY_VALUES.has(metadata.complexity)) metadata.complexity = null;
  if (!['In Progress', 'Review', 'Done'].includes(status)) {
    metadata.authoritativeKeys.push('branch', 'startDate');
  }
  return metadata;
}

function parseIndexRows(body) {
  const rows = new Map();
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 10) continue;
    if (/^---/.test(cells[0])) continue;
    const issueMatch = cells[2].match(/#(\d+)\b/);
    if (!issueMatch) continue;
    const issueNumber = Number(issueMatch[1]);
    const metadata = {
      issueNumber,
      priority: cleanValue(cells[0]),
      complexity: cleanValue(cells[1]),
      status: cleanValue(cells[3]),
      type: cleanValue(cells[4]),
      targetRelease: cleanValue(cells[5]),
      area: cleanValue(cells[6]),
      branch: cleanValue(cells[7]),
      startDate: cleanValue(cells[8]),
      targetDate: cleanValue(cells[9]),
      authoritativeKeys: [...SYNC_KEYS]
    };
    if (metadata.status && !STATUS_VALUES.has(metadata.status)) continue;
    rows.set(issueNumber, metadata);
  }
  return rows;
}

function mergeMetadata(issue, issueMetadata, indexMetadata) {
  if (!indexMetadata) return issueMetadata;
  const merged = { ...issueMetadata, ...indexMetadata, issueNumber: issue.number };
  if (issue.state === 'closed' && issue.state_reason !== 'not_planned') merged.status = 'Done';
  if (issue.state === 'closed' && issue.state_reason === 'not_planned') merged.status = 'Backlog';
  if (!['In Progress', 'Review', 'Done'].includes(merged.status)) {
    merged.branch = null;
    merged.startDate = null;
  }
  merged.authoritativeKeys = [...new Set([...(issueMetadata.authoritativeKeys || []), ...(indexMetadata.authoritativeKeys || [])])];
  return merged;
}

function loadConfig(path) {
  if (!path) {
    return {
      projectOwner: process.env.SWAYFORGE_PROJECT_OWNER,
      projectOwnerType: process.env.SWAYFORGE_PROJECT_OWNER_TYPE || 'user',
      projectNumber: Number(process.env.SWAYFORGE_PROJECT_NUMBER || 0),
      fieldNames: {
        priority: 'Priority',
        complexity: 'Complexity',
        status: 'Status',
        type: 'Type',
        targetRelease: 'Target Release',
        area: 'Area',
        branch: 'Branch',
        startDate: 'Start Date',
        targetDate: 'Target Date'
      }
    };
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function validateConfig(config) {
  if (!config.projectOwner) throw new Error('SWAYFORGE_PROJECT_OWNER/projectOwner is required.');
  if (!['user', 'organization'].includes(config.projectOwnerType)) {
    throw new Error('projectOwnerType must be user or organization.');
  }
  if (!Number.isInteger(Number(config.projectNumber)) || Number(config.projectNumber) <= 0) {
    throw new Error('SWAYFORGE_PROJECT_NUMBER/projectNumber must be a positive integer.');
  }
  if (!config.fieldNames) throw new Error('fieldNames configuration is required.');
}

function authHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'swayforge-project-board-sync'
  };
}

function redactSensitive(text, sensitiveValues = []) {
  let result = String(text || '');
  for (const value of sensitiveValues) {
    if (value && typeof value === 'string') result = result.split(value).join('[REDACTED]');
  }
  return result;
}

async function request(url, { token, method = 'GET', body, sensitiveValues = [] } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...authHeaders(token),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = redactSensitive(await response.text(), [token, ...sensitiveValues]);
    throw new Error(`${method} ${url} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function projectBase(config) {
  const ownerSegment = config.projectOwnerType === 'organization' ? 'orgs' : 'users';
  return `https://api.github.com/${ownerSegment}/${encodeURIComponent(config.projectOwner)}/projectsV2/${Number(config.projectNumber)}`;
}

async function paginate(url, token) {
  const results = [];
  let nextUrl = new URL(url);
  nextUrl.searchParams.set('per_page', '100');
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: authHeaders(token) });
    if (!response.ok) {
      const text = redactSensitive(await response.text(), [token]);
      throw new Error(`GET ${nextUrl} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error(`Expected array from ${nextUrl}`);
    results.push(...payload);
    const link = response.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = next ? new URL(next[1]) : null;
  }
  return results;
}

async function listRepoIssues(repository, repoToken, issueNumber) {
  if (issueNumber) {
    return [await request(`https://api.github.com/repos/${repository}/issues/${issueNumber}`, { token: repoToken })];
  }
  const results = [];
  let page = 1;
  while (true) {
    const url = new URL(`https://api.github.com/repos/${repository}/issues`);
    url.searchParams.set('state', 'all');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const payload = await request(url, { token: repoToken });
    const issues = payload.filter((issue) => !issue.pull_request && issue.number !== 1);
    results.push(...issues);
    if (payload.length < 100) break;
    page += 1;
  }
  return results;
}

function optionId(field, desired) {
  if (!desired) return null;
  const option = (field.options || []).find((candidate) => {
    const name = typeof candidate.name === 'string' ? candidate.name : candidate.name?.raw;
    return name === desired;
  });
  if (!option) throw new Error(`Field ${field.name} has no option named ${desired}`);
  return option.id;
}

function fieldUpdate(field, value) {
  if (value == null) return { id: field.id, value: null };
  if (field.data_type === 'single_select') return { id: field.id, value: optionId(field, value) };
  if (field.data_type === 'date') return { id: field.id, value: String(value) };
  if (field.data_type === 'number') return { id: field.id, value: Number(value) };
  return { id: field.id, value: String(value) };
}

function buildUpdates(metadata, fieldsByName, config) {
  const mapping = {
    priority: metadata.priority,
    complexity: metadata.complexity,
    status: metadata.status,
    type: metadata.type,
    targetRelease: metadata.targetRelease,
    area: metadata.area,
    branch: metadata.branch,
    startDate: metadata.startDate,
    targetDate: metadata.targetDate
  };
  const authoritative = new Set(metadata.authoritativeKeys || []);
  const updates = [];
  for (const [key, value] of Object.entries(mapping)) {
    if ((value == null || value === '') && !authoritative.has(key)) continue;
    const fieldName = config.fieldNames[key];
    const field = fieldsByName.get(fieldName);
    if (!field) throw new Error(`Required Project field is missing: ${fieldName}`);
    updates.push(fieldUpdate(field, value));
  }
  return updates;
}

async function ensureItem(issue, items, config, projectToken, dryRun) {
  const existing = items.find((item) => item.content?.node_id === issue.node_id || item.content?.id === issue.id);
  if (existing) return existing;
  if (dryRun) return { id: null, content: issue, dryRunNewItem: true };
  const created = await request(`${projectBase(config)}/items`, {
    token: projectToken,
    method: 'POST',
    body: { type: 'Issue', id: issue.id }
  });
  return created.value || created;
}

async function reconcile({ repository, projectToken, repoToken, config, issueNumber = null, dryRun = false }) {
  validateConfig(config);
  if (!projectToken) throw new Error('SWAYFORGE_PROJECT_TOKEN is required.');
  if (!repoToken) throw new Error('GITHUB_TOKEN is required for repository Issue reads.');

  await request(projectBase(config), { token: projectToken });
  const fields = await paginate(`${projectBase(config)}/fields`, projectToken);
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const items = await paginate(`${projectBase(config)}/items`, projectToken);
  const indexIssue = await request(`https://api.github.com/repos/${repository}/issues/1`, { token: repoToken });
  const indexRows = parseIndexRows(indexIssue.body || '');
  const issues = await listRepoIssues(repository, repoToken, issueNumber);
  const audit = [];

  for (const issue of issues) {
    const metadata = mergeMetadata(issue, inferMetadata(issue), indexRows.get(issue.number));
    const item = await ensureItem(issue, items, config, projectToken, dryRun);
    const updates = buildUpdates(metadata, fieldsByName, config);

    audit.push({
      issue: issue.number,
      title: issue.title,
      metadata: { ...metadata, authoritativeKeys: metadata.authoritativeKeys },
      updates,
      itemId: item.id,
      dryRun
    });

    if (!dryRun && updates.length > 0) {
      await request(`${projectBase(config)}/items/${item.id}`, {
        token: projectToken,
        method: 'PATCH',
        body: { fields: updates }
      });
    }
  }
  return audit;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.config);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes('/')) throw new Error('GITHUB_REPOSITORY must be owner/repo.');

  const audit = await reconcile({
    repository,
    projectToken: process.env.SWAYFORGE_PROJECT_TOKEN,
    repoToken: process.env.GITHUB_TOKEN,
    config,
    issueNumber: args.issue,
    dryRun: args.dryRun
  });
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Project board sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  STATUS_VALUES,
  SYNC_KEYS,
  inferMetadata,
  inferStatus,
  inferRelease,
  inferType,
  inferBranch,
  inferStartDate,
  inferTargetDate,
  parseIndexRows,
  mergeMetadata,
  lineValue,
  cleanValue,
  buildUpdates,
  fieldUpdate,
  validateConfig,
  projectBase,
  redactSensitive,
  reconcile
};

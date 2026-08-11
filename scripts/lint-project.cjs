'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listFiles } = require('./check-project.cjs');

const root = process.cwd();
const files = listFiles(root);
const scriptFiles = files.filter((file) => /\.(?:cjs|js|mjs)$/.test(file));
const textFiles = files.filter((file) => /\.(?:cjs|js|mjs|json|html|css|md)$/.test(file));
const failures = [];

for (const relativePath of scriptFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, relativePath)], {
    encoding: 'utf8'
  });
  if (result.status !== 0) failures.push(`${relativePath}: JavaScript syntax check failed`);
}

for (const relativePath of textFiles) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  if (!content.endsWith('\n')) failures.push(`${relativePath}: missing final newline`);
  if (/[^\S\r\n]+$/m.test(content)) failures.push(`${relativePath}: trailing whitespace`);
  if (/\t/.test(content)) failures.push(`${relativePath}: tab indentation is not permitted`);
}

const rendererSource = fs.readFileSync(path.join(root, 'src/renderer/renderer-app.js'), 'utf8');
if (/\brequire\s*\(/.test(rendererSource) || /\bnode:/.test(rendererSource)) {
  failures.push('src/renderer/renderer-app.js: renderer must not import Node.js capabilities');
}

const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)/i.test(html)) failures.push('src/renderer/index.html: inline scripts are not permitted');
if (/<style\b/i.test(html)) failures.push('src/renderer/index.html: inline styles are not permitted');

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Lint passed for ${scriptFiles.length} JavaScript files.\n`);
}

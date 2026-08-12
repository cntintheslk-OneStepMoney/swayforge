'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('sidebar uses the compact local mark and canonical Sway Forge copy', () => {
  const html = read('src/renderer/index.html');
  assert.match(html, /class="brand-mark" src="\.\/brand\/sway-forge-mark\.svg"/);
  assert.doesNotMatch(html, /<span class="brand-mark"[^>]*>SF<\/span>/);
  assert.match(html, /<h1>Sway Forge<\/h1>/);
  assert.match(html, /Create smarter\. Stay in control\./);
  assert.doesNotMatch(html, /Catch the signal\. Forge the content\./);
});

test('renderer brand assets are local, dependency-light and allowed by CSP', () => {
  const html = read('src/renderer/index.html');
  const mark = read('src/renderer/brand/sway-forge-mark.svg');
  const lockup = read('src/renderer/brand/sway-forge-lockup.svg');
  const brandingCss = read('src/renderer/branding.css');
  const brandingJs = read('src/renderer/branding.js');
  assert.match(html, /img-src 'self' swayforge-preview:/);
  assert.match(html, /\.\/branding\.css/);
  assert.match(html, /\.\/branding\.js/);
  for (const source of [brandingCss, brandingJs]) {
    assert.doesNotMatch(source, /https?:\/\/|data:/i);
  }
  for (const source of [mark, lockup]) {
    assert.doesNotMatch(source, /(?:href|src)=["'](?:https?:|data:)/i);
    assert.doesNotMatch(source, /<image\b/i);
  }
});

test('About branding is theme-safe, compact and preserves local runtime facts', () => {
  const html = read('src/renderer/index.html');
  const source = read('src/renderer/branding.js');
  const css = read('src/renderer/branding.css');
  const settings = read('src/renderer/settings-page.js');
  assert.match(html, /settings-page\.js/);
  assert.match(source, /#settings-about-facts/);
  assert.match(source, /Sway Forge/);
  assert.match(source, /Create smarter\. Stay in control\./);
  assert.match(settings, /\['Version', info\.version\]/);
  assert.match(settings, /\['Platform', `\$\{info\.platform\} \$\{info\.architecture\}`\]/);
  assert.match(css, /max-width: 38rem/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /background:\s*#fff(?:fff)?\b/i);
});

test('branding retains minimum-width navigation behaviour', () => {
  const shellCss = read('src/renderer/styles.css');
  const brandCss = read('src/renderer/branding.css');
  assert.match(shellCss, /@media \(max-width: 840px\)/);
  assert.match(shellCss, /grid-template-columns: 5rem minmax\(0, 1fr\)/);
  assert.match(shellCss, /\.brand-lockup > div/);
  assert.match(brandCss, /@media \(max-width: 840px\)/);
});

test('fallback remains branded while preserving failure and recovery information', () => {
  const html = read('src/renderer/fallback.html');
  assert.match(html, /sway-forge-mark\.svg/);
  assert.match(html, /Sway Forge could not load its interface\./);
  assert.match(html, /No social account, private media, AI service, or publishing action was accessed\./);
  assert.match(html, /Close and restart the application\./);
  assert.match(html, /img-src 'self'/);
});

test('README uses the repository-local wide lockup', () => {
  const readme = read('README.md');
  assert.match(readme, /src\/renderer\/brand\/sway-forge-lockup\.svg/);
  assert.match(readme, /^!\[Sway Forge — Create smarter\. Stay in control\.\]/);
  assert.doesNotMatch(readme.split('\n').slice(0, 4).join('\n'), /https?:\/\//i);
});

test('Windows installer identity uses the compact mark derivatives', () => {
  const config = require(path.join(ROOT, 'build', 'electron-builder.config.cjs'));
  const svg = read('build/icon.svg');
  const icoPath = path.join(ROOT, 'build', 'icon.ico');
  const ico = fs.readFileSync(icoPath);
  assert.equal(config.win.icon, 'build/icon.svg');
  assert.equal(config.nsis.installerIcon, 'build/icon.ico');
  assert.equal(config.nsis.uninstallerIcon, 'build/icon.ico');
  assert.match(svg, /#102a43/i);
  assert.match(svg, /#f28c28/i);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4) >= 7, true);
});

test('branding introduces no compatibility-sensitive identity rename', () => {
  const packageJson = JSON.parse(read('package.json'));
  const config = require(path.join(ROOT, 'build', 'electron-builder.config.cjs'));
  assert.equal(packageJson.name, 'swayforge');
  assert.equal(packageJson.productName, 'SwayForge');
  assert.equal(config.appId, 'app.swayforge.desktop');
  assert.equal(config.win.executableName, 'SwayForge');
});

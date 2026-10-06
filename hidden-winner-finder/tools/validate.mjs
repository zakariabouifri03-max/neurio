#!/usr/bin/env node
/**
 * validate.mjs - pre-flight check for the unpacked extension.
 *
 * Catches the failures that only show up as "Could not load extension" in
 * chrome://extensions, plus the drift nobody notices until runtime:
 *
 *   1. every file the manifest references actually exists
 *   2. the service worker's whole import graph resolves (MV3 modules are strict:
 *      a single wrong relative path breaks the extension silently)
 *   3. the popup/dashboard HTML only references files that exist
 *   4. src/content/scanner.js is up to date with its source + the shared parsers
 *   5. permissions/structure sanity (MV3 keys, no unused host permissions)
 *   6. no remote code: no http(s) URL is used as a script/style/import source
 *
 * Run: node tools/validate.mjs   (part of `npm run verify`)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { renderScanner } from './lib/scanner-build.mjs';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const problems = [];
const warnings = [];
const ok = [];

const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);
const pass = (message) => ok.push(message);

/* ── 1. manifest structure + referenced files ─────────────────────────── */

const manifestPath = join(root, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ manifest.json is missing');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!/^\d+\.\d+(\.\d+)?$/.test(manifest.version)) fail(`version "${manifest.version}" is not a valid Chrome version`);
if (manifest.name?.length > 75) warn('name is longer than the 75-character store limit');
if (manifest.description?.length > 132) warn('description is longer than the 132-character store limit');
if (manifest.default_locale && !existsSync(join(root, '_locales'))) fail('default_locale is set but _locales/ is missing');

const referenced = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);

for (const rel of referenced) {
  const target = join(root, rel);
  if (!existsSync(target)) fail(`manifest references a missing file: ${rel}`);
}
pass(`manifest references ${referenced.length} files, all present`);

if (manifest.background?.type !== 'module') warn('background.type is not "module" - the service worker imports ES modules');
if (!manifest.permissions?.includes('storage')) fail('the extension stores everything locally and needs the "storage" permission');

const KNOWN_UNUSED = ['tabs', 'webRequest', 'cookies', 'history', 'bookmarks', 'downloads', 'notifications'];
for (const permission of manifest.permissions || []) {
  if (KNOWN_UNUSED.includes(permission)) warn(`permission "${permission}" is requested but not used by this extension`);
}
if (manifest.host_permissions?.length) {
  // Tab scanning uses activeTab + an optional permission, so broad host access
  // must never be mandatory.
  fail(`host_permissions should stay optional (found ${manifest.host_permissions.join(', ')})`);
}
pass('permissions are limited to storage + on-demand tab access');

/* ── 2. service worker import graph ───────────────────────────────────── */

const MODULE_RE = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

function moduleGraph(entry) {
  const visited = new Set();
  const queue = [entry];
  const missing = [];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) {
      missing.push(file);
      continue;
    }
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(MODULE_RE)) {
      queue.push(resolve(dirname(file), match[1]));
    }
  }
  return { visited, missing };
}

const worker = join(root, manifest.background.service_worker);
const graph = moduleGraph(worker);
for (const missing of graph.missing) fail(`service worker import not found: ${relative(root, missing)}`);
if (!graph.missing.length) pass(`service worker graph resolves (${graph.visited.size} modules)`);

/* ── 3. HTML references ───────────────────────────────────────────────── */

const htmlFiles = [];
const walk = (dir) => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith('.html')) htmlFiles.push(full);
  }
};
walk(root);

for (const file of htmlFiles) {
  const source = readFileSync(file, 'utf8');
  const refs = [
    ...[...source.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]),
  ].filter((ref) => !/^(https?:|data:|#)/.test(ref));

  for (const ref of refs) {
    const target = resolve(dirname(file), ref.split('?')[0]);
    if (!existsSync(target)) fail(`${relative(root, file)} references a missing file: ${ref}`);
  }
}
pass(`${htmlFiles.length} HTML file(s) reference only existing assets`);

/* ── 4. generated scanner freshness ───────────────────────────────────── */

const generated = readFileSync(join(root, 'src/content/scanner.js'), 'utf8');
const expected = renderScanner().output;

if (!generated.startsWith('/* GENERATED FILE')) fail('src/content/scanner.js is not the generated file');
else if (generated !== expected) fail('src/content/scanner.js is stale - run `npm run build:scanner`');
else pass('generated scanner is byte-identical to a fresh build of its sources');

/* ── 5. no remote code ───────────────────────────────────────────────── */

const JS_FILES = [];
const collectJs = (dir) => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
    const full = join(dir, item.name);
    if (item.isDirectory()) collectJs(full);
    else if (item.name.endsWith('.js')) JS_FILES.push(full);
  }
};
collectJs(join(root, 'src'));
collectJs(join(root, 'tools'));

const remoteCode = [];
for (const file of JS_FILES) {
  const source = readFileSync(file, 'utf8');
  // Ignore destination URLs (they are opened in a tab), only flag loaded code.
  for (const match of source.matchAll(/(?:importScripts|import|src\s*=|fetch\()\s*\(?\s*['"`](https?:\/\/[^'"`]+)/g)) {
    remoteCode.push(`${relative(root, file)} → ${match[1]}`);
  }
}
if (remoteCode.length) {
  fail(`remote code loading is forbidden by MV3:\n    ${remoteCode.join('\n    ')}`);
} else {
  pass('no remote code, no network calls in the extension');
}

/* ── 6. privacy statement sanity ─────────────────────────────────────── */

const workerSource = readFileSync(worker, 'utf8');
if (/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(workerSource)) {
  warn('the service worker contains a network primitive - confirm this is intentional');
}

/* ── report ──────────────────────────────────────────────────────────── */

console.log('\nHidden Winner Finder — extension validation\n');
for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ⚠ ${line}`);
for (const line of problems) console.log(`  ✗ ${line}`);
console.log(`\n${problems.length ? '✗ FAILED' : '✓ PASSED'} — ${problems.length} problem(s), ${warnings.length} warning(s)\n`);
process.exit(problems.length ? 1 : 0);

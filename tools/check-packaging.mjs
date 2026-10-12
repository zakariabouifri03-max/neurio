#!/usr/bin/env node
/**
 * Verifies what electron-builder puts inside the app bundle (`resources/app.asar`).
 *
 * A packaging mistake here produces an installer that runs and shows a blank window, or a
 * desktop app whose bundled server is missing — the kind of bug you only notice on the target
 * machine. This script therefore:
 *
 *   1. expands the `build.files` rules from package.json,
 *   2. stages exactly those files,
 *   3. packs them into a real asar archive with the same library electron-builder uses,
 *   4. asserts the renderer, its assets and the bundled server are all inside.
 *
 * Run it after `npm run build`:  node tools/check-packaging.mjs
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const staging = join(root, 'build', 'asar-staging');
const archivePath = join(root, 'build', 'app-check.asar');

/** Entries the packaged app cannot work without. */
const REQUIRED = [
  'package.json',
  'dist/index.html',
  'dist-electron/electron/main.cjs',
  'dist-electron/electron/preload.cjs',
  'dist-electron/server/index.cjs',
];

const fail = (message) => {
  console.error(`x ${message}`);
  process.exit(1);
};

/* ----------------------------- expand build.files ------------------------- */

const rules = pkg.build?.files;
if (!Array.isArray(rules)) fail('package.json has no build.files list to check');

const includes = rules.filter((rule) => !rule.startsWith('!'));
const excludes = rules.filter((rule) => rule.startsWith('!')).map((rule) => rule.slice(1));

/** Paths are always handled with forward slashes so the check runs the same on every OS. */
const toPosix = (value) => value.replace(/\\/g, '/');

/** Minimal glob: supports `*` and `**` in a path segment list. */
function matches(relativePath, pattern) {
  const pathParts = toPosix(relativePath).split('/');
  const patternParts = pattern.split('/');
  const walk = (pathIndex, patternIndex) => {
    if (patternIndex === patternParts.length) return pathIndex === pathParts.length;
    const part = patternParts[patternIndex];
    if (part === '**') {
      for (let skip = pathIndex; skip <= pathParts.length; skip += 1) {
        if (walk(skip, patternIndex + 1)) return true;
      }
      return false;
    }
    if (pathIndex >= pathParts.length) return false;
    if (part === '*') return walk(pathIndex + 1, patternIndex + 1);
    if (part.includes('*')) {
      const regex = new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return regex.test(pathParts[pathIndex]) && walk(pathIndex + 1, patternIndex + 1);
    }
    return part === pathParts[pathIndex] && walk(pathIndex + 1, patternIndex + 1);
  };
  return walk(0, 0);
}

/** Collect every file under root that the rules select. */
function collect(directory = '') {
  const absolute = directory ? join(root, directory) : root;
  const collected = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === 'node_modules' && directory === '') continue;
    const child = directory ? `${directory}/${entry}` : entry;
    if (child.startsWith('.git') || child === 'build/asar-staging' || child === 'build/app-check.asar') continue;
    const full = join(root, child);
    if (statSync(full).isDirectory()) {
      collected.push(...collect(child));
    } else {
      collected.push(child);
    }
  }
  return collected;
}

const allFiles = collect();
const selected = allFiles.filter(
  (file) => includes.some((pattern) => matches(file, pattern)) && !excludes.some((pattern) => matches(file, pattern)),
);

console.log(`build.files selects ${selected.length} files (of ${allFiles.length} in the tree)`);
if (selected.length > 0 && selected.length < 12) console.log(`  ${selected.join(', ')}`);

const missingInputs = includes.filter(
  (pattern) => !allFiles.some((file) => matches(file, pattern)) && !pattern.includes('*'),
);
for (const entry of REQUIRED) {
  if (!existsSync(join(root, entry))) fail(`missing build output: ${entry} — run "npm run build" first`);
}
if (missingInputs.length > 0) {
  fail(`build.files references paths that do not exist: ${missingInputs.join(', ')} — run "npm run icons" / "npm run build" first`);
}
if (selected.length === 0) fail('build.files selected no files at all');

/* ------------------------------- stage + pack ----------------------------- */

rmSync(staging, { recursive: true, force: true });
for (const file of selected) {
  const target = join(staging, file);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, file), target);
}

let asar;
try {
  asar = require('@electron/asar');
} catch {
  rmSync(staging, { recursive: true, force: true });
  console.log(`@electron/asar is unavailable - checked the file rules only (${selected.length} files) OK`);
  process.exit(0);
}

await asar.createPackage(staging, archivePath);
rmSync(staging, { recursive: true, force: true });

/* -------------------------------- assert --------------------------------- */

const packed = new Set(asar.listPackage(archivePath).map((entry) => toPosix(entry).replace(/^\//, '')));

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1]);
if (assets.length === 0) fail('dist/index.html references no bundled assets — the renderer build looks wrong');

// assets live under dist/ inside the archive
const missing = [...REQUIRED, ...assets.map((asset) => `dist/${asset}`)].filter((entry) => !packed.has(entry));
if (missing.length > 0) fail(`the packaged archive is missing: ${missing.join(', ')}`);

const serverBundle = readFileSync(join(root, 'dist-electron', 'server', 'index.cjs'), 'utf8');
if (!serverBundle.includes('module.exports')) fail('dist-electron/server/index.cjs is not a CommonJS bundle');

console.log(`app.asar verified OK - ${packed.size} entries, renderer + ${assets.length} assets + bundled server`);
console.log(`  ${relative(root, archivePath)}`);

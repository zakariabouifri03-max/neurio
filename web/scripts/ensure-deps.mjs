#!/usr/bin/env node
/**
 * Dependency guard.
 *
 * Some hosting/sandbox environments do not persist `node_modules` between runs.
 * Without this check a wiped folder turns into a stack of confusing build
 * errors in the browser instead of a simple reinstall, so every npm script that
 * needs dependencies (`dev`, `build`, `start`, `typecheck`, `db:seed`) runs this
 * first through npm's `pre*` hooks.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installed = ['next', 'react', 'react-dom'].every((pkg) => existsSync(resolve(root, 'node_modules', pkg)));

if (installed) process.exit(0);

console.log('[deps] node_modules is missing or incomplete — installing from package-lock.json …');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['ci'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[deps] npm ci failed — run it manually to see the full error.');
  process.exit(result.status ?? 1);
}

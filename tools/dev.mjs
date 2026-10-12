#!/usr/bin/env node
/**
 * One command to run Neurio in development:
 *
 *   npm run dev
 *
 * Starts
 *   1. the API + gateway server (tsx, port 8790),
 *   2. the Vite dev server for the React renderer (port 5173),
 *   3. the Electron desktop shell pointed at Vite (hot reload).
 *
 * `npm run dev:web` + a browser at http://localhost:5173 works too — Vite
 * proxies /api and /gateway to the server, so no CORS setup is required.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name + (process.platform === 'win32' ? '.cmd' : ''));
const children = [];

function run(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const prefix = `[${label}] `;
  child.stdout.on('data', (chunk) => process.stdout.write(chunk.toString().replace(/^/gm, prefix)));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk.toString().replace(/^/gm, prefix)));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) console.log(`${prefix}exited (${signal ?? code})`);
    if (!shuttingDown && label === 'server') shutdown(1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Neurio dev — starting server and renderer…');

const serverPort = process.env.NEURIO_PORT ?? '8790';
const server = run('server', process.execPath, [bin('tsx'), 'server/index.ts', '--port', serverPort, '--host', '0.0.0.0'], {
  NEURIO_LOG_LEVEL: process.env.NEURIO_LOG_LEVEL ?? 'info',
});

const vitePort = process.env.NEURIO_DEV_PORT ?? '5173';
const vite = run('vite', process.execPath, [bin('vite'), '--port', vitePort, '--host', '0.0.0.0']);

const devUrl = `http://127.0.0.1:${vitePort}`;

// Wait for Vite to answer before launching the desktop shell.
async function waitForVite(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(devUrl, { method: 'HEAD' });
      if (response.ok || response.status === 405) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

const ready = await waitForVite();
if (!ready) {
  console.error('[dev] Vite did not start in time — is port ' + vitePort + ' free?');
  shutdown(1);
} else if (process.argv.includes('--web-only')) {
  console.log(`\n  Neurio is running at ${devUrl}  (API on http://127.0.0.1:${serverPort})\n`);
} else {
  let electronPath = null;
  if (existsSync(join(root, 'node_modules', 'electron'))) {
    try {
      // The electron package exports the absolute path to the downloaded binary.
      const resolved = require('electron');
      if (typeof resolved === 'string' && existsSync(resolved)) electronPath = resolved;
    } catch {
      electronPath = null;
    }
  }
  const launcher = electronPath ?? join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

  if (!electronPath && !existsSync(launcher)) {
    console.log('\n[dev] The Electron binary is not installed yet (npm install downloads it).');
    console.log('[dev] Meanwhile the full app runs in a browser at:');
    console.log(`[dev]   ${devUrl}\n`);
  } else {
    const child = spawn(launcher, ['.'], {
      cwd: root,
      env: { ...process.env, NEURIO_DEV_URL: devUrl, NEURIO_PORT: serverPort },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    children.push(child);
    child.on('exit', () => shutdown(0));
    console.log(`\n  Neurio desktop shell loading ${devUrl}\n`);
  }
}

void server;
void vite;

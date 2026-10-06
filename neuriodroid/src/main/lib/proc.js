'use strict';
/**
 * Small process helpers used everywhere (spawn with env, run-and-capture,
 * long-lived shells, elevated PowerShell, safe kill on Windows).
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

/** Quote a single argv element for a Windows command line. */
function q(arg) {
  const s = String(arg);
  if (!IS_WIN) return `'${s.replace(/'/g, `'\\''`)}'`;
  if (s === '') return '""';
  if (!/[\s"&|<>^%]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
}

/**
 * Run a command, capture stdout/stderr, resolve with {code, stdout, stderr}.
 * Never throws on non-zero exit — callers decide.
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, Object.assign({
        windowsHide: true,
        env: process.env,
      }, opts));
    } catch (err) {
      return resolve({ code: -1, stdout, stderr: String(err && err.message || err), error: err });
    }
    const killer = opts.timeout ? setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
    }, opts.timeout) : null;

    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (killer) clearTimeout(killer);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + String(err.message || err), error: err });
    });
    child.on('close', (code) => {
      if (killer) clearTimeout(killer);
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });
  });
}

/** Run and return trimmed stdout, or null when it failed. */
async function tryRun(cmd, args, opts) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) return null;
  return r.stdout.trim();
}

/** Spawn a detached-ish long running process, wiring line events. */
function spawnLive(cmd, args, opts = {}) {
  const child = spawn(cmd, args, Object.assign({
    windowsHide: !!opts.hide,
    env: process.env,
    cwd: opts.cwd,
  }, opts.spawn || {}));
  return child;
}

/**
 * A persistent `adb -s <serial> shell` session. Writing commands to stdin is
 * ~10x faster than spawning adb for every input event — this is what makes
 * keyboard->touch mapping usable in games.
 */
class LiveShell {
  constructor(adb, serial, env) {
    this.adb = adb;
    this.serial = serial;
    this.env = env;
    this.child = null;
    this.alive = false;
    this.queue = [];
    this.busy = false;
  }

  start() {
    if (this.alive) return true;
    try {
      this.child = spawn(this.adb, ['-s', this.serial, 'shell'], {
        env: this.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (_) { return false; }
    this.child.on('close', () => { this.alive = false; this.child = null; });
    this.child.on('error', () => { this.alive = false; this.child = null; });
    this.child.stderr.on('data', () => {});
    this.child.stdout.on('data', () => {});
    this.alive = true;
    return true;
  }

  /** Fire-and-forget command (queued, one at a time to keep ordering). */
  send(command) {
    if (!this.alive && !this.start()) return false;
    try {
      this.child.stdin.write(command + '\n');
      return true;
    } catch (_) {
      this.alive = false;
      return false;
    }
  }

  stop() {
    this.alive = false;
    if (this.child) {
      try { this.child.stdin.end(); } catch (_) {}
      killTree(this.child);
      this.child = null;
    }
  }
}

/** Kill a process and, on Windows, its children (taskkill /T). */
function killTree(child, signal = 'SIGTERM') {
  if (!child || child.killed || child.exitCode != null) return;
  try {
    if (IS_WIN && child.pid) {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      tk.on('error', () => { try { child.kill('SIGKILL'); } catch (_) {} });
      return;
    }
    child.kill(signal);
  } catch (_) { /* ignore */ }
}

/** Ask UAC for an elevated PowerShell command. Returns the spawn result. */
function elevatedPowerShell(script, opts = {}) {
  if (!IS_WIN) return Promise.resolve({ code: -1, stderr: 'Windows only' });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-Command',
    `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`];
  return run('powershell.exe', args, opts);
}

/** Read a Windows optional-feature state (best effort, no admin needed). */
async function windowsFeature(name) {
  if (!IS_WIN) return null;
  const out = await tryRun('powershell.exe', ['-NoProfile', '-Command',
    `(Get-WindowsOptionalFeature -Online -FeatureName ${name} -ErrorAction SilentlyContinue).State`],
  { timeout: 25000 });
  if (!out) return null;
  return out.trim(); // Enabled / Disabled / null
}

function exists(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }
function basename(p) { return path.basename(p); }

module.exports = {
  IS_WIN, q, run, tryRun, spawnLive, spawn, LiveShell, killTree,
  elevatedPowerShell, windowsFeature, exists, dirExists, basename,
};

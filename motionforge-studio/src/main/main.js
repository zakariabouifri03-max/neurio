'use strict';
// MotionForge Studio — Electron main process.
// Owns: window, native dialogs, file I/O, autosave/recovery, secrets, AI network proxy, FFmpeg export.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');

const IS_SELFTEST = !!process.env.MF_SELFTEST;
const DEV = process.argv.includes('--dev');

if (!IS_SELFTEST && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (IS_SELFTEST) app.setPath('userData', path.join(os.tmpdir(), 'motionforge-selftest-' + process.pid));

app.setName('MotionForge Studio');
nativeTheme.themeSource = 'dark';

let win = null;
let forceClose = false;
let pendingOpenFile = findMfsArg(process.argv);

const U = () => app.getPath('userData');
const dirs = {
  autosave: () => path.join(U(), 'autosave'),
  library: () => path.join(U(), 'library'),
  tmp: () => path.join(os.tmpdir(), 'motionforge'),
};
const settingsFile = () => path.join(U(), 'settings.json');
try { // user preference: software rendering instead of the GPU (must be decided before the app is ready)
  const st = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  if (st && st.disableGpu) app.disableHardwareAcceleration();
} catch { /* first run */ }
const secretsFile = () => path.join(U(), 'secrets.bin.json');
const lockFile = () => path.join(U(), 'session.lock');

function findMfsArg(argv) {
  return argv.slice(1).find((a) => /\.mfs$/i.test(a) && fs.existsSync(a)) || null;
}
async function ensure(d) { await fsp.mkdir(d, { recursive: true }); return d; }
async function readJson(f, dflt) { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return dflt; } }
async function writeJsonAtomic(f, obj) {
  await ensure(path.dirname(f));
  const t = f + '.tmp';
  await fsp.writeFile(t, JSON.stringify(obj));
  await fsp.rename(t, f);
}
async function writeBytesAtomic(f, bytes) {
  await ensure(path.dirname(f));
  const t = f + '.tmp';
  await fsp.writeFile(t, Buffer.from(bytes.buffer ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes));
  await fsp.rename(t, f);
}

// ───────────────────────────── window ─────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700,
    show: false,
    backgroundColor: '#0f1116',
    title: 'MotionForge Studio',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14161c', symbolColor: '#c9cfdb', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!IS_SELFTEST) win.show(); else win.showInactive(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      if (DEV || IS_SELFTEST) win.webContents.toggleDevTools();
    }
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.on('close', (e) => {
    if (forceClose || IS_SELFTEST) return;
    e.preventDefault();
    win.webContents.send('app:request-close');
  });
  win.on('closed', () => { win = null; });
}

app.on('second-instance', (_e, argv) => {
  const f = findMfsArg(argv);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) win.webContents.send('app:open-file', f); }
});
app.on('open-file', (e, p) => { e.preventDefault(); if (win) win.webContents.send('app:open-file', p); else pendingOpenFile = p; });

app.whenReady().then(async () => {
  await ensure(U());
  const crashed = fs.existsSync(lockFile());
  await fsp.writeFile(lockFile(), String(Date.now()));
  global.__crashed = crashed;
  // GPU: use the platform default (hardware accelerated where available).
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { fs.unlinkSync(lockFile()); } catch {} });

// ───────────────────────────── IPC: app ─────────────────────────────
ipcMain.handle('app:info', async () => ({
  version: app.getVersion(), platform: process.platform, electron: process.versions.electron,
  chrome: process.versions.chrome, userData: U(), crashed: !!global.__crashed,
  launchFile: pendingOpenFile, selftest: IS_SELFTEST, selftestOut: process.env.MF_SELFTEST_OUT || null,
  documents: app.getPath('documents'), videos: app.getPath('videos'),
}));
ipcMain.handle('app:take-launch-file', () => { const f = pendingOpenFile; pendingOpenFile = null; return f; });
ipcMain.on('app:confirm-close', () => { forceClose = true; if (win) win.close(); });
ipcMain.on('app:set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.handle('app:toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('app:reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('app:open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('app:selftest-done', async (_e, report) => {
  const out = process.env.MF_SELFTEST_OUT;
  if (out) await fsp.writeFile(out, JSON.stringify(report, null, 2));
  setTimeout(() => { forceClose = true; app.exit(report && report.ok ? 0 : 1); }, 300);
});

// ───────────────────────────── IPC: files / dialogs ─────────────────────────────
ipcMain.handle('dialog:open', async (_e, o = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: o.title || 'Open', filters: o.filters, defaultPath: o.defaultPath,
    properties: ['openFile', ...(o.multi ? ['multiSelections'] : [])],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:save', async (_e, o = {}) => {
  const r = await dialog.showSaveDialog(win, { title: o.title || 'Save', defaultPath: o.defaultPath, filters: o.filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:folder', async (_e, o = {}) => {
  const r = await dialog.showOpenDialog(win, { title: o.title || 'Select folder', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:message', async (_e, o) => {
  const r = await dialog.showMessageBox(win, {
    type: o.type || 'question', buttons: o.buttons || ['OK'], defaultId: o.defaultId ?? 0,
    cancelId: o.cancelId ?? (o.buttons ? o.buttons.length - 1 : 0), title: o.title || 'MotionForge Studio', message: o.message, detail: o.detail,
  });
  return r.response;
});
ipcMain.handle('file:read', async (_e, p) => { const b = await fsp.readFile(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
ipcMain.handle('file:write', async (_e, p, bytes) => { await writeBytesAtomic(p, bytes); return true; });
ipcMain.handle('file:stat', async (_e, p) => { try { const s = await fsp.stat(p); return { size: s.size, mtime: s.mtimeMs }; } catch { return null; } });

// Project save with rotating backups (name.mfs.bak1 … bak3)
ipcMain.handle('project:write', async (_e, p, bytes) => {
  try {
    if (fs.existsSync(p)) {
      for (let i = 3; i >= 1; i--) {
        const from = i === 1 ? p : `${p}.bak${i - 1}`;
        const to = `${p}.bak${i}`;
        if (fs.existsSync(from)) { try { await fsp.copyFile(from, to); } catch {} }
      }
    }
    await writeBytesAtomic(p, bytes);
    return true;
  } catch (e) { throw new Error('Could not save: ' + e.message); }
});
ipcMain.handle('project:backups', async (_e, p) => {
  const out = [];
  for (let i = 1; i <= 3; i++) { const f = `${p}.bak${i}`; if (fs.existsSync(f)) out.push({ path: f, mtime: (await fsp.stat(f)).mtimeMs }); }
  return out;
});

// Autosave / crash recovery
ipcMain.handle('autosave:write', async (_e, id, meta, bytes) => {
  const d = await ensure(dirs.autosave());
  await writeBytesAtomic(path.join(d, id + '.mfs'), bytes);
  await writeJsonAtomic(path.join(d, id + '.json'), { ...meta, id, time: Date.now() });
  return true;
});
ipcMain.handle('autosave:list', async () => {
  const d = dirs.autosave();
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const f of await fsp.readdir(d)) {
    if (!f.endsWith('.json')) continue;
    const m = await readJson(path.join(d, f), null);
    if (m && fs.existsSync(path.join(d, m.id + '.mfs'))) out.push(m);
  }
  return out.sort((a, b) => b.time - a.time);
});
ipcMain.handle('autosave:read', async (_e, id) => { const b = await fsp.readFile(path.join(dirs.autosave(), id + '.mfs')); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
ipcMain.handle('autosave:remove', async (_e, id) => {
  for (const ext of ['.mfs', '.json']) { try { await fsp.unlink(path.join(dirs.autosave(), id + ext)); } catch {} }
  return true;
});

// Settings and secrets (API keys are encrypted with the OS keychain via safeStorage and never sent to the renderer)
ipcMain.handle('settings:get', async () => readJson(settingsFile(), {}));
ipcMain.handle('settings:set', async (_e, obj) => { await writeJsonAtomic(settingsFile(), obj); return true; });

const memSecrets = {};
async function loadSecrets() { return readJson(secretsFile(), {}); }
function getKey(provider, store) {
  if (memSecrets[provider]) return memSecrets[provider];
  const enc = store[provider];
  if (!enc) return '';
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
}
ipcMain.handle('secret:set', async (_e, provider, key) => {
  const store = await loadSecrets();
  if (!key) { delete store[provider]; delete memSecrets[provider]; await writeJsonAtomic(secretsFile(), store); return { stored: false }; }
  if (safeStorage.isEncryptionAvailable()) {
    store[provider] = safeStorage.encryptString(key).toString('base64');
    delete memSecrets[provider];
    await writeJsonAtomic(secretsFile(), store);
    return { stored: true, encrypted: true };
  }
  memSecrets[provider] = key; // OS encryption unavailable: keep in memory for this session only
  return { stored: true, encrypted: false, sessionOnly: true };
});
ipcMain.handle('secret:has', async (_e, provider) => !!getKey(provider, await loadSecrets()));

// AI network proxy — the renderer never sees stored keys; main injects the Authorization header.
ipcMain.handle('ai:request', async (_e, req) => {
  const { url, method = 'POST', headers = {}, body, provider, useKey = true, timeoutMs = 120000 } = req;
  if (!/^https?:\/\//i.test(url)) return { ok: false, status: 0, error: 'Invalid URL' };
  const h = { ...headers };
  if (useKey) {
    const key = getKey(provider, await loadSecrets());
    if (key) h['Authorization'] = 'Bearer ' + key;
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers: h, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), signal: ac.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'Request timed out' : String(e.message || e) };
  } finally { clearTimeout(t); }
});

// ───────────────────────────── Asset library ─────────────────────────────
const libIndexFile = () => path.join(dirs.library(), 'index.json');
async function libIndex() { return readJson(libIndexFile(), { folders: ['General'], items: [] }); }
ipcMain.handle('lib:list', async () => libIndex());
ipcMain.handle('lib:put', async (_e, meta, bytes) => {
  const idx = await libIndex();
  const i = idx.items.findIndex((x) => x.id === meta.id);
  if (i >= 0) idx.items[i] = { ...idx.items[i], ...meta }; else idx.items.push(meta);
  if (meta.folder && !idx.folders.includes(meta.folder)) idx.folders.push(meta.folder);
  if (bytes) await writeBytesAtomic(path.join(await ensure(dirs.library()), meta.id + '.mfa'), bytes);
  await writeJsonAtomic(libIndexFile(), idx);
  return idx;
});
ipcMain.handle('lib:get', async (_e, id) => { const b = await fsp.readFile(path.join(dirs.library(), id + '.mfa')); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
ipcMain.handle('lib:remove', async (_e, id) => {
  const idx = await libIndex();
  idx.items = idx.items.filter((x) => x.id !== id);
  try { await fsp.unlink(path.join(dirs.library(), id + '.mfa')); } catch {}
  await writeJsonAtomic(libIndexFile(), idx);
  return idx;
});
ipcMain.handle('lib:folders', async (_e, folders) => { const idx = await libIndex(); idx.folders = folders; await writeJsonAtomic(libIndexFile(), idx); return idx; });

// ───────────────────────────── FFmpeg ─────────────────────────────
function ffmpegPath() {
  let p;
  try { p = require('@ffmpeg-installer/ffmpeg').path; } catch { p = null; }
  if (!p) return null;
  p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
  return fs.existsSync(p) ? p : null;
}
let capsCache = null;
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { windowsHide: true, ...opts });
    const out = []; const err = [];
    c.stdout && c.stdout.on('data', (d) => out.push(d));
    c.stderr && c.stderr.on('data', (d) => err.push(d));
    c.on('error', reject);
    c.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }));
  });
}
async function ffCaps() {
  if (capsCache) return capsCache;
  const bin = ffmpegPath();
  if (!bin) return (capsCache = { available: false, encoders: [] });
  try {
    const r = await run(bin, ['-hide_banner', '-encoders']);
    const enc = r.stdout.toString('utf8');
    const has = (n) => new RegExp('\\s' + n + '\\s').test(enc);
    capsCache = { available: true, path: bin, h264: has('libx264'), vp9: has('libvpx-vp9'), vp8: has('libvpx'), gif: has('gif'), opus: has('libopus'), vorbis: has('libvorbis'), aac: has('aac'), mpeg4: has('mpeg4') };
  } catch (e) { capsCache = { available: false, error: String(e) }; }
  return capsCache;
}
ipcMain.handle('ffmpeg:caps', () => ffCaps());

const exportSessions = new Map();
let exportCounter = 0;

ipcMain.handle('export:begin', async (_e, o) => {
  const id = ++exportCounter;
  const s = { id, o, frames: 0, canceled: false };
  const fmt = o.format;
  if (fmt === 'png' || fmt === 'jpg') {
    await ensure(o.dir);
    s.kind = 'seq';
  } else {
    const caps = await ffCaps();
    if (!caps.available) throw new Error('FFmpeg is not available in this installation.');
    s.kind = 'video';
    const tmp = await ensure(dirs.tmp());
    let audioPath = null;
    if (o.audioWav && o.audioWav.byteLength) { audioPath = path.join(tmp, `mix-${process.pid}-${id}.wav`); await fsp.writeFile(audioPath, Buffer.from(o.audioWav)); s.audioPath = audioPath; }
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'png', '-i', '-'];
    if (audioPath && fmt !== 'gif') a.push('-i', audioPath);
    const even = '-vf';
    if (fmt === 'mp4') {
      if (!caps.h264 && !caps.mpeg4) throw new Error('This FFmpeg build has no H.264 encoder.');
      a.push(even, 'pad=ceil(iw/2)*2:ceil(ih/2)*2');
      if (caps.h264) a.push('-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf ?? 18), '-pix_fmt', 'yuv420p');
      else a.push('-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p');
      a.push('-movflags', '+faststart');
      if (audioPath) a.push('-c:a', caps.aac ? 'aac' : 'libmp3lame', '-b:a', '192k', '-shortest');
    } else if (fmt === 'webm') {
      if (!caps.vp9 && !caps.vp8) throw new Error('This FFmpeg build has no VP8/VP9 encoder.');
      const pix = o.transparent ? 'yuva420p' : 'yuv420p';
      a.push('-c:v', caps.vp9 ? 'libvpx-vp9' : 'libvpx', '-b:v', caps.vp9 ? '0' : '4M', ...(caps.vp9 ? ['-crf', String(o.crf ?? 30), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'] : []), '-pix_fmt', pix);
      if (o.transparent) a.push('-auto-alt-ref', '0');
      if (audioPath) a.push('-c:a', caps.opus ? 'libopus' : 'libvorbis', '-b:a', '160k', '-shortest');
    } else if (fmt === 'gif') {
      a.push('-filter_complex', `[0:v]split[a][b];[a]palettegen=reserve_transparent=${o.transparent ? 1 : 0}[p];[b][p]paletteuse=dither=bayer:bayer_scale=4${o.transparent ? ':alpha_threshold=128' : ''}`, '-loop', '0');
    }
    a.push(o.outPath);
    s.proc = spawn(caps.path, a, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    s.err = '';
    s.proc.stderr.on('data', (d) => { s.err += d.toString(); if (s.err.length > 8000) s.err = s.err.slice(-8000); });
    s.exit = new Promise((res) => s.proc.on('close', (code) => res(code)));
    s.proc.stdin.on('error', () => {});
  }
  exportSessions.set(id, s);
  return id;
});
ipcMain.handle('export:frame', async (_e, id, index, bytes) => {
  const s = exportSessions.get(id);
  if (!s || s.canceled) return false;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (s.kind === 'seq') {
    const n = String(index + (s.o.startNumber || 1)).padStart(5, '0');
    await fsp.writeFile(path.join(s.o.dir, `${s.o.baseName || 'frame'}_${n}.${s.o.format === 'jpg' ? 'jpg' : 'png'}`), buf);
  } else {
    if (s.proc.exitCode !== null) throw new Error('FFmpeg stopped unexpectedly:\n' + s.err);
    if (!s.proc.stdin.write(buf)) await new Promise((res) => s.proc.stdin.once('drain', res));
  }
  s.frames++;
  return true;
});
ipcMain.handle('export:finish', async (_e, id) => {
  const s = exportSessions.get(id);
  if (!s) return { ok: false };
  exportSessions.delete(id);
  if (s.kind === 'seq') return { ok: true, frames: s.frames, path: s.o.dir };
  s.proc.stdin.end();
  const code = await s.exit;
  if (s.audioPath) fsp.unlink(s.audioPath).catch(() => {});
  if (code !== 0) return { ok: false, error: s.err || ('ffmpeg exited with code ' + code) };
  const st = await fsp.stat(s.o.outPath);
  return { ok: true, frames: s.frames, path: s.o.outPath, size: st.size };
});
ipcMain.handle('export:cancel', async (_e, id) => {
  const s = exportSessions.get(id);
  if (!s) return false;
  s.canceled = true; exportSessions.delete(id);
  if (s.proc) { try { s.proc.stdin.destroy(); s.proc.kill(); } catch {} }
  if (s.audioPath) fsp.unlink(s.audioPath).catch(() => {});
  if (s.o.outPath) fsp.unlink(s.o.outPath).catch(() => {});
  return true;
});

// Probe/convert media for import (MP4 → audio / frames)
ipcMain.handle('media:extract-audio', async (_e, p) => {
  const caps = await ffCaps(); if (!caps.available) throw new Error('FFmpeg unavailable');
  const out = path.join(await ensure(dirs.tmp()), `ea-${Date.now()}.wav`);
  const r = await run(caps.path, ['-y', '-i', p, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', out]);
  if (r.code !== 0) throw new Error('This file has no readable audio track.');
  const b = await fsp.readFile(out); fsp.unlink(out).catch(() => {});
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
});
ipcMain.handle('media:extract-frames', async (_e, p, o = {}) => {
  const caps = await ffCaps(); if (!caps.available) throw new Error('FFmpeg unavailable');
  const d = path.join(await ensure(dirs.tmp()), 'fr-' + Date.now());
  await ensure(d);
  const vf = `fps=${o.fps || 12},scale='min(${o.maxWidth || 1280},iw)':-2`;
  const args = ['-y', '-i', p, '-vf', vf, '-frames:v', String(o.maxFrames || 240), path.join(d, 'f_%05d.png')];
  const r = await run(caps.path, args);
  if (r.code !== 0) throw new Error('Could not read video frames.');
  const files = (await fsp.readdir(d)).sort();
  const out = [];
  for (const f of files) { const b = await fsp.readFile(path.join(d, f)); out.push(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); }
  fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  return out;
});

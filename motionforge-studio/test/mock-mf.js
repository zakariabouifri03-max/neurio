// Node-side implementation of the `window.mf` bridge for headless tests (mirrors src/main/main.js behaviour with real files + real FFmpeg).
const fs = require('fs'), fsp = fs.promises, path = require('path'), cp = require('child_process'), os = require('os');
function ffmpegPath() { try { return require('@ffmpeg-installer/ffmpeg').path; } catch { return null; } }
function makeBridge(root, opts = {}) {
  fs.mkdirSync(root, { recursive: true });
  const mem = { settings: {}, secrets: {}, autosave: new Map(), lib: { folders: ['General'], items: [] }, libFiles: new Map() };
  const sessions = new Map(); let counter = 0; let caps = null;
  const run = (bin, args) => new Promise((res) => { const c = cp.spawn(bin, args); const o = []; c.stdout.on('data', (d) => o.push(d)); c.stderr.on('data', () => {}); c.on('close', () => res(Buffer.concat(o).toString())); });
  async function getCaps() { if (caps) return caps; const bin = ffmpegPath(); if (!bin) return (caps = { available: false }); const enc = await run(bin, ['-hide_banner', '-encoders']); const has = (n) => new RegExp('\\s' + n + '\\s').test(enc); return (caps = { available: true, path: bin, h264: has('libx264'), vp9: has('libvpx-vp9'), vp8: has('libvpx'), gif: has('gif'), aac: has('aac'), mpeg4: has('mpeg4'), opus: has('libopus'), vorbis: has('libvorbis') }); }
  const B = (b) => Buffer.from(b);
  const api = {
    'app.info': async () => ({ version: '1.0.0-test', platform: 'linux', electron: 'mock', chrome: 'mock', userData: root, crashed: false, launchFile: null, selftest: !!opts.selftest }),
    'app.takeLaunchFile': async () => null, 'app.reveal': async () => {}, 'app.openExternal': async () => {}, 'app.fullscreen': async () => {},
    'app.selftestDone': async (r) => { opts.onSelftest && opts.onSelftest(r); },
    'dialog.open': async () => opts.openPaths || [], 'dialog.save': async (o) => opts.savePath || null, 'dialog.folder': async () => opts.folder || null, 'dialog.message': async () => 0,
    'file.read': async (p) => new Uint8Array(await fsp.readFile(p)), 'file.write': async (p, b) => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, B(b)); return true; },
    'file.stat': async (p) => { try { const s = await fsp.stat(p); return { size: s.size, mtime: s.mtimeMs }; } catch { return null; } },
    'project.write': async (p, b) => { await fsp.mkdir(path.dirname(p), { recursive: true }); if (fs.existsSync(p)) await fsp.copyFile(p, p + '.bak'); await fsp.writeFile(p, B(b)); return true; },
    'project.backups': async (p) => (fs.existsSync(p + '.bak') ? [{ path: p + '.bak', mtime: fs.statSync(p + '.bak').mtimeMs }] : []),
    'autosave.write': async (id, meta, b) => { mem.autosave.set(id, { id, ...meta, time: Date.now(), bytes: B(b) }); return true; }, 'autosave.list': async () => [...mem.autosave.values()].map(({ bytes, ...m }) => m),
    'autosave.read': async (id) => new Uint8Array(mem.autosave.get(id).bytes), 'autosave.remove': async (id) => { mem.autosave.delete(id); return true; },
    'settings.get': async () => mem.settings, 'settings.set': async (o) => { mem.settings = o; return true; },
    'secret.set': async (p, k) => { if (k) mem.secrets[p] = k; else delete mem.secrets[p]; return { stored: !!k, encrypted: true }; }, 'secret.has': async (p) => !!mem.secrets[p],
    'ai.request': async (r) => (opts.aiRequest ? opts.aiRequest(r, mem.secrets) : { ok: false, status: 0, error: 'offline test' }),
    'lib.list': async () => mem.lib, 'lib.put': async (meta, bytes) => { const i = mem.lib.items.findIndex((x) => x.id === meta.id); if (i >= 0) mem.lib.items[i] = { ...mem.lib.items[i], ...meta }; else mem.lib.items.push(meta); if (meta.folder && !mem.lib.folders.includes(meta.folder)) mem.lib.folders.push(meta.folder); if (bytes) mem.libFiles.set(meta.id, B(bytes)); return mem.lib; },
    'lib.get': async (id) => new Uint8Array(mem.libFiles.get(id)), 'lib.remove': async (id) => { mem.lib.items = mem.lib.items.filter((x) => x.id !== id); mem.libFiles.delete(id); return mem.lib; }, 'lib.folders': async (f) => { mem.lib.folders = f; return mem.lib; },
    'ffmpeg.caps': async () => getCaps(),
    'export.begin': async (o) => {
      const id = ++counter; const s = { id, o, frames: 0 };
      if (o.format === 'png' || o.format === 'jpg') { await fsp.mkdir(o.dir, { recursive: true }); s.kind = 'seq'; }
      else {
        const c = await getCaps(); if (!c.available) throw new Error('FFmpeg unavailable'); s.kind = 'video'; let ap = null;
        if (o.audioWav && o.audioWav.length) { ap = path.join(root, `mix${id}.wav`); await fsp.writeFile(ap, B(o.audioWav)); s.ap = ap; }
        const a = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'png', '-i', '-']; if (ap && o.format !== 'gif') a.push('-i', ap);
        if (o.format === 'mp4') { a.push('-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2'); if (c.h264) a.push('-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf ?? 20), '-pix_fmt', 'yuv420p'); else a.push('-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p'); a.push('-movflags', '+faststart'); if (ap) a.push('-c:a', c.aac ? 'aac' : 'libmp3lame', '-shortest'); }
        else if (o.format === 'webm') { a.push('-c:v', c.vp9 ? 'libvpx-vp9' : 'libvpx', '-b:v', '1M', '-pix_fmt', o.transparent ? 'yuva420p' : 'yuv420p'); if (ap) a.push('-c:a', 'libvorbis', '-shortest'); }
        else if (o.format === 'gif') a.push('-filter_complex', '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0');
        a.push(o.outPath); s.proc = cp.spawn(c.path, a, { stdio: ['pipe', 'ignore', 'pipe'] }); s.err = ''; s.proc.stderr.on('data', (d) => { s.err += d; }); s.exit = new Promise((r) => s.proc.on('close', r)); s.proc.stdin.on('error', () => {});
      }
      sessions.set(id, s); return id;
    },
    'export.frame': async (id, i, bytes) => { const s = sessions.get(id); const b = B(bytes); if (s.kind === 'seq') await fsp.writeFile(path.join(s.o.dir, `${s.o.baseName || 'frame'}_${String(i + 1).padStart(5, '0')}.${s.o.format === 'jpg' ? 'jpg' : 'png'}`), b); else if (!s.proc.stdin.write(b)) await new Promise((r) => s.proc.stdin.once('drain', r)); s.frames++; return true; },
    'export.finish': async (id) => { const s = sessions.get(id); sessions.delete(id); if (s.kind === 'seq') return { ok: true, frames: s.frames, path: s.o.dir }; s.proc.stdin.end(); const code = await s.exit; if (code !== 0) return { ok: false, error: s.err }; return { ok: true, frames: s.frames, path: s.o.outPath, size: fs.statSync(s.o.outPath).size }; },
    'export.cancel': async (id) => { const s = sessions.get(id); if (s && s.proc) s.proc.kill(); sessions.delete(id); return true; },
    'media.extractAudio': async () => { throw new Error('n/a'); }, 'media.extractFrames': async () => { throw new Error('n/a'); },
  };
  return { api, mem };
}
// Source injected into the page before any script: builds window.mf from window.__mfCall
const PAGE_SHIM = `(() => {
  const enc = (k, v) => (v instanceof Uint8Array ? { $b64: btoa(Array.from(v, (c) => String.fromCharCode(c)).join('')) } : v instanceof ArrayBuffer ? { $b64: btoa(String.fromCharCode(...new Uint8Array(v))) } : v);
  const dec = (k, v) => { if (v && typeof v === 'object' && typeof v.$b64 === 'string') { const s = atob(v.$b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } return v; };
  const call = (n) => async (...a) => { const r = await window.__mfCall(n, JSON.stringify(a, enc)); if (r && r.error) throw new Error(r.error); return JSON.parse(r.json === undefined ? 'null' : r.json, dec); };
  const g = (...names) => Object.fromEntries(names.map((n) => [n, call]));
  const mk = (grp, names) => Object.fromEntries(names.map((n) => [n, call(grp + '.' + n)]));
  window.mf = {
    app: { ...mk('app', ['info', 'takeLaunchFile', 'reveal', 'openExternal', 'selftestDone', 'fullscreen']), confirmClose() {}, setTitle() {}, onRequestClose: () => () => {}, onOpenFile: () => () => {}, pathForFile: () => '' },
    dialog: mk('dialog', ['open', 'save', 'folder', 'message']), file: mk('file', ['read', 'write', 'stat']), project: mk('project', ['write', 'backups']),
    autosave: mk('autosave', ['write', 'list', 'read', 'remove']), settings: mk('settings', ['get', 'set']), secret: mk('secret', ['set', 'has']), ai: { request: call('ai.request') },
    lib: mk('lib', ['list', 'put', 'get', 'remove', 'folders']), ffmpeg: mk('ffmpeg', ['caps']), export: mk('export', ['begin', 'frame', 'finish', 'cancel']), media: mk('media', ['extractAudio', 'extractFrames']),
  };
})();`;
async function attach(page, bridge) {
  await page.exposeFunction('__mfCall', async (name, json) => {
    try { const args = JSON.parse(json, (k, v) => (v && typeof v === 'object' && typeof v.$b64 === 'string' ? new Uint8Array(Buffer.from(v.$b64, 'base64')) : v)); const r = await bridge.api[name](...args);
      return { json: JSON.stringify(r, (k, v) => (v instanceof Uint8Array || Buffer.isBuffer(v) ? { $b64: Buffer.from(v).toString('base64') } : v)) }; } catch (e) { return { error: String(e.message || e) }; }
  });
  await page.evaluateOnNewDocument(PAGE_SHIM);
}
module.exports = { makeBridge, attach };

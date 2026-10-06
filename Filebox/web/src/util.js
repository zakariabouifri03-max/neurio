// ── Filebox — helpers ───────────────────────────────────────────────────────

export const fmtBytes = (n) => {
  if (n == null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)) + ' ' + u[i];
};

export const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const relTime = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return T('just_now');
  if (s < 3600) return T('min_ago', Math.floor(s / 60));
  if (s < 86400) return T('h_ago', Math.floor(s / 3600));
  if (s < 2592000) return T('d_ago', Math.floor(s / 86400));
  return fmtDate(ts).slice(0, 10);
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── file classification ─────────────────────────────────────────────────────

export const EXT_ICON = {
  image: '🖼️', video: '🎬', audio: '🎵', doc: '📄', pdf: '📕',
  sheet: '📊', slide: '📽️', archive: '🗜️', app: '📱', text: '📝', code: '👨‍💻', file: '📎',
};

const KINDS = [
  ['image', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg', 'avif', 'tiff']],
  ['video', ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp', 'm4v', 'flv', 'wmv', 'ts']],
  ['audio', ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'amr', 'wma']],
  ['pdf', ['pdf']],
  ['doc', ['doc', 'docx', 'odt', 'rtf', 'pages']],
  ['sheet', ['xls', 'xlsx', 'csv', 'ods', 'numbers']],
  ['slide', ['ppt', 'pptx', 'odp', 'key']],
  ['app', ['apk', 'xapk', 'aab', 'ipa', 'exe', 'msi', 'dmg']],   // before archive: .apk is an app
  ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'jar']],
  ['code', ['js', 'ts', 'py', 'java', 'kt', 'html', 'css', 'json', 'xml', 'sh', 'c', 'cpp', 'go', 'rs']],
  ['text', ['txt', 'md', 'log', 'srt', 'vtt']],
];

export const extOf = (name) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

export function kindOf(name) {
  const e = extOf(name);
  for (const [k, list] of KINDS) if (list.includes(e)) return k;
  return 'file';
}

export const iconOf = (name) => EXT_ICON[kindOf(name)] || '📎';

export function baseName(name) {
  const s = String(name || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

// human readable "3 files · 12 MB"
export function fmtCount(n, bytes) {
  return T('n_files_size', n, fmtBytes(bytes));
}

// ── hashing (fast fingerprint for dedup) ────────────────────────────────────

export async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// sample-based fingerprint: head 256KB + tail 256KB + size → cheap duplicate detection
export async function fingerprint(file) {
  const CH = 256 * 1024;
  if (file.size <= CH * 2) return await sha256Hex(await file.arrayBuffer());
  const head = await file.slice(0, CH).arrayBuffer();
  const tail = await file.slice(file.size - CH).arrayBuffer();
  const mid = new Uint8Array(8);
  new DataView(mid.buffer).setFloat64(0, file.size);
  const all = new Uint8Array(head.byteLength + tail.byteLength + 8);
  all.set(new Uint8Array(head), 0);
  all.set(new Uint8Array(tail), head.byteLength);
  all.set(mid, head.byteLength + tail.byteLength);
  return (await sha256Hex(all.buffer)) + ':' + file.size;
}

export async function fullHash(file, onProgress) {
  const CH = 2 * 1024 * 1024;
  const hashParts = [];
  let off = 0;
  while (off < file.size) {
    hashParts.push(new Uint8Array(await file.slice(off, off + CH).arrayBuffer()));
    off += CH;
    if (onProgress) onProgress(off / file.size);
  }
  let total = 0;
  hashParts.forEach((p) => (total += p.length));
  const all = new Uint8Array(total);
  let w = 0;
  hashParts.forEach((p) => { all.set(p, w); w += p.length; });
  return await sha256Hex(all.buffer);
}

// ── tiny i18n (Darija / Français / English) ─────────────────────────────────

import { STRINGS } from './i18n.js';

// localStorage is missing in some embedders (and in Node, where the tests run)
export const store = {
  get(k, fallback = null) {
    try { const v = globalThis.localStorage?.getItem(k); return v == null ? fallback : v; }
    catch { return fallback; }
  },
  set(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* ignore */ } },
};

export let LANG = store.get('fb.lang', 'darija');
export function setLang(l) {
  LANG = l;
  store.set('fb.lang', l);
  if (globalThis.document) {
    document.documentElement.lang = l === 'darija' ? 'ar' : l;
    document.documentElement.dir = 'ltr';   // darija is written in latin script here
  }
}

export function T(key, ...args) {
  const table = STRINGS[LANG] || STRINGS.darija;
  let s = table[key];
  if (s == null) s = STRINGS.darija[key] != null ? STRINGS.darija[key] : key;
  args.forEach((a, i) => { s = s.replace(new RegExp('\\{' + i + '\\}', 'g'), String(a)); });
  return s;
}

// ── download helper ─────────────────────────────────────────────────────────

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

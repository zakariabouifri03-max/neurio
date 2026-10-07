// Small shared helpers.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const DEG = Math.PI / 180;
export const rad = (d) => d * DEG;
export const deg = (r) => r / DEG;
export const round = (v, n = 2) => { const k = 10 ** n; return Math.round(v * k) / k; };
let _uid = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(_uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class Emitter {
  constructor() { this.m = new Map(); }
  on(ev, fn) { if (!this.m.has(ev)) this.m.set(ev, new Set()); this.m.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const s = this.m.get(ev); if (s) s.delete(fn); }
  emit(ev, ...a) { const s = this.m.get(ev); if (s) for (const f of [...s]) { try { f(...a); } catch (e) { console.error('[bus]', ev, e); } } }
}

/** Tiny DOM builder: h('div.class#id', {attrs, on:{click}}, children...) */
export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)/i.exec(tag);
  const el = document.createElement(m[1] || 'div');
  const rest = m[2] || '';
  for (const t of rest.match(/[.#][\w-]+/g) || []) { if (t[0] === '.') el.classList.add(t.slice(1)); else el.id = t.slice(1); }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs) || typeof attrs === 'string')) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'tip') el.dataset.tip = v;
    else if (k in el && k !== 'list' && k !== 'type' && typeof v !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (k) => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function raf(fn) { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export function fmtTimecode(frame, fps) {
  const s = frame / fps; const m = Math.floor(s / 60); const sec = Math.floor(s % 60); const f = frame % Math.round(fps);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
export function hexToRgb(hex) {
  let h2 = hex.replace('#', '');
  if (h2.length === 3) h2 = h2.split('').map((c) => c + c).join('');
  const n = parseInt(h2, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export const deepClone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
export function canvasToBlob(c, type = 'image/png', q) { return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, q)); }
export async function canvasToBytes(c, type = 'image/png', q) { return new Uint8Array(await (await canvasToBlob(c, type, q)).arrayBuffer()); }
export function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode image')); i.src = src; }); }
export async function bytesToImage(bytes, mime = 'image/png') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
export function mimeFromName(n) {
  const e = (n.split('.').pop() || '').toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', psd: 'image/vnd.adobe.photoshop' })[e] || 'application/octet-stream';
}
export const baseName = (p) => p.split(/[\\/]/).pop();
export const stripExt = (n) => n.replace(/\.[^.]+$/, '');
export function titleCase(s) { return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
// Affine matrices [a,b,c,d,e,f] (canvas convention)
export const M = {
  I: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
  T: (x, y) => [1, 0, 0, 1, x, y],
  R: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
  S: (x, y) => [x, 0, 0, y, 0, 0],
  K: (ax) => [1, 0, Math.tan(ax), 1, 0, 0],
  inv: (m) => { const d = m[0] * m[3] - m[1] * m[2]; if (Math.abs(d) < 1e-12) return [1, 0, 0, 1, 0, 0]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; },
  pt: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  apply: (ctx, m) => ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]),
  set: (ctx, m) => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]),
};

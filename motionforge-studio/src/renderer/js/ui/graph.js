// Motion Editor: graph editor with Bezier handles.
import { h, clamp } from '../core/util.js';
import { S, bus, scene, layerById, fps, sceneDuration } from '../core/state.js';
import { H } from '../core/history.js';
import { evalTrack, getKey, setKey, layerBase, EASE_LIST, ease as easeFn } from '../core/anim.js';
import * as ops from '../core/ops.js';
import { Playback } from '../core/playback.js';
import { icon } from './icons.js';
import { selectField } from './common.js';

let root, canvas, g, list, W = 1, Hh = 1; const vis = new Set(); let norm = true; let owner = 'layer';
const view = { t0: -2, tz: 12, v0: 0, vz: 1 };
let drag = null, sel = null;
const palette = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f43', '#7bed9f', '#70a1ff', '#ff6ec7', '#a4b0be'];
const getOwner = () => (owner === 'camera' ? scene().camera : layerById(S.selection.layerId));
function trackNames() { const o = getOwner(); return o ? Object.keys(o.tracks || {}).filter((n) => o.tracks[n].length) : []; }
function range(name) { const o = getOwner(); const t = o.tracks[name]; let mn = Infinity, mx = -Infinity; for (const k of t) { mn = Math.min(mn, k.v); mx = Math.max(mx, k.v); } if (mx - mn < 1e-6) { mx = mn + 1; } const pad = (mx - mn) * 0.15; return [mn - pad, mx + pad]; }
const X = (f) => (f - view.t0) * view.tz;
const Yv = (name, v) => { if (norm) { const [a, b] = range(name); return Hh - 12 - ((v - a) / (b - a)) * (Hh - 24); } return Hh - 12 - (v - view.v0) * view.vz; };
const vFromY = (name, y) => { if (norm) { const [a, b] = range(name); return a + ((Hh - 12 - y) / (Hh - 24)) * (b - a); } return view.v0 + (Hh - 12 - y) / view.vz; };
const fFromX = (x) => x / view.tz + view.t0;

export function build(host) {
  root = h('div', { style: { display: 'flex', flex: 1, minWidth: 0 } });
  list = h('div', { style: { width: '210px', borderRight: '1px solid var(--line)', overflow: 'auto', flex: 'none' } });
  canvas = h('canvas'); g = canvas.getContext('2d'); const wrap = h('div.graph-wrap', canvas); root.append(list, wrap); host.append(root);
  new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); const d = window.devicePixelRatio || 1; W = r.width; Hh = r.height; canvas.width = W * d; canvas.height = Hh * d; canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px'; if (!view.fitted && W > 150) { view.fitted = true; fit(); } else draw(); }).observe(wrap);
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const f = fFromX(e.offsetX); view.tz = clamp(view.tz * (e.deltaY < 0 ? 1.15 : 0.87), 1.5, 120); view.t0 = f - e.offsetX / view.tz; draw(); }, { passive: false });
  for (const ev of ['change', 'frame', 'selection', 'project-loaded', 'scene']) bus.on(ev, () => { if (root.offsetParent) refresh(); });
  bus.on('render', () => { if (root.offsetParent) draw(); });
  refresh(); return root;
}
export function refresh() {
  if (!list) return; list.innerHTML = '';
  const bar = h('div', { style: { padding: '6px 8px', borderBottom: '1px solid var(--line)', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
    h('select', { on: { change: (e) => { owner = e.target.value; vis.clear(); refresh(); } } }, h('option', { value: 'layer', selected: owner === 'layer' }, 'Layer'), h('option', { value: 'camera', selected: owner === 'camera' }, 'Camera')),
    h('label.row.check', { style: { margin: 0 } }, h('input', { type: 'checkbox', checked: norm, on: { change: (e) => { norm = e.target.checked; draw(); } } }), h('span', 'Normalize')),
    h('button.btn.small', { on: { click: fit } }, 'Fit'));
  list.append(bar);
  const o = getOwner(); if (!o) { list.append(h('div.hint.pad', 'Select a layer.')); draw(); return; }
  const names = trackNames(); if (!names.length) list.append(h('div.hint.pad', 'No animated properties yet. Move something with Auto-Key on, or press K to add a keyframe — curves appear here.'));
  names.forEach((n, i) => {
    if (!vis.size && i < 6) vis.add(n);
    const col = palette[i % palette.length];
    list.append(h('label.item', { style: { cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: vis.has(n), on: { change: (e) => { e.target.checked ? vis.add(n) : vis.delete(n); draw(); } } }), h('i', { style: { width: '10px', height: '10px', background: col, borderRadius: '50%', flex: 'none' } }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label(n))));
  });
  if (sel) {
    const k = o.tracks[sel.name] && getKey(o.tracks[sel.name], sel.f);
    if (k) list.append(h('div.pad', h('div.hint', `Selected key: ${label(sel.name)} @ ${sel.f + 1}`), selectField('Easing', EASE_LIST.map((e) => [e[0], e[1]]), k.e || 'easeInOut', (v) => { ops_setEase(o, sel.name, sel.f, v); })));
  }
  draw();
}
function ops_setEase(o, name, f, e) { H.tx('Set easing', () => { const k = getKey(o.tracks[name], f); if (k) { k.e = e; if (e === 'bezier' && !k.bz) k.bz = [0.25, 0.1, 0.25, 1]; } }); refresh(); }
function label(n) { const m = /^b\.(.+)\.(\w+)$/.exec(n); if (m) { const l = layerById(S.selection.layerId); const b = l && l.char && l.char.bones.find((x) => x.id === m[1]); return `${b ? b.name : m[1]} ${m[2]}`; } return n; }
export function fit() {
  const o = getOwner(); if (!o || W < 150 || Hh < 80) return; let f0 = 1e9, f1 = -1e9, mn = 1e9, mx = -1e9;
  for (const n of vis) { const t = o.tracks[n]; if (!t) continue; for (const k of t) { f0 = Math.min(f0, k.f); f1 = Math.max(f1, k.f); mn = Math.min(mn, k.v); mx = Math.max(mx, k.v); } }
  if (f0 > f1) { f0 = 0; f1 = sceneDuration(); mn = 0; mx = 1; }
  if (f1 - f0 < 2) f1 = f0 + 2; if (mx - mn < 1e-6) mx = mn + 1;
  view.tz = (W - 60) / (f1 - f0); view.t0 = f0 - 30 / view.tz; view.vz = (Hh - 40) / (mx - mn); view.v0 = mn - 20 / view.vz; draw();
}
function visibleKeys() {
  const o = getOwner(); const out = []; if (!o) return out;
  let i = 0; for (const n of trackNames()) { const col = palette[i++ % palette.length]; if (!vis.has(n)) continue; const t = o.tracks[n]; t.forEach((k, idx) => out.push({ name: n, k, idx, t, col })); }
  return out;
}
function handles(item) { // bezier handle positions for segment item.k → next
  const { k, t, idx, name } = item; const nx = t[idx + 1]; if (!nx || k.e !== 'bezier') return null; const bz = k.bz || [0.25, 0.1, 0.25, 1]; const dt = nx.f - k.f, dv = nx.v - k.v;
  return { p1: [X(k.f + bz[0] * dt), Yv(name, k.v + bz[1] * dv)], p2: [X(k.f + bz[2] * dt), Yv(name, k.v + bz[3] * dv)], a: [X(k.f), Yv(name, k.v)], b: [X(nx.f), Yv(name, nx.v)], dt, dv, nx };
}
function draw() {
  if (!g || !(view.tz > 0.05) || !Number.isFinite(view.t0) || !(W > 1)) return; const d = window.devicePixelRatio || 1; g.setTransform(d, 0, 0, d, 0, 0); g.fillStyle = '#10131a'; g.fillRect(0, 0, W, Hh);
  g.strokeStyle = '#1d2333'; g.lineWidth = 1; g.beginPath(); const step = view.tz > 30 ? 1 : view.tz > 10 ? 5 : 10; for (let f = Math.floor(view.t0 / step) * step; X(f) < W; f += step) { g.moveTo(Math.round(X(f)) + 0.5, 0); g.lineTo(Math.round(X(f)) + 0.5, Hh); } g.stroke();
  g.fillStyle = '#566'; g.font = '10px Segoe UI'; for (let f = Math.max(0, Math.floor(view.t0 / step) * step); X(f) < W; f += step) g.fillText(String(f + 1), X(f) + 2, Hh - 2);
  const o = getOwner(); if (!o) return;
  let ci = 0;
  for (const n of trackNames()) {
    const col = palette[ci++ % palette.length]; if (!vis.has(n)) continue; const t = o.tracks[n];
    g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath(); let first = true;
    const fa = Math.max(0, Math.floor(view.t0)), fb = Math.ceil(fFromX(W)); const base = o.base ? (o.base[n] ?? 0) : layerBase(o, n);
    for (let f = fa; f <= fb; f += Math.max(0.25, 1 / Math.max(1, view.tz / 4))) { const v = evalTrack(t, f, base); const x = X(f), y = Yv(n, v); first ? g.moveTo(x, y) : g.lineTo(x, y); first = false; }
    g.stroke();
  }
  for (const it of visibleKeys()) {
    const x = X(it.k.f), y = Yv(it.name, it.k.v); const hs = handles(it);
    if (hs && sel && sel.name === it.name && sel.f === it.k.f) { g.strokeStyle = '#8899cc'; g.lineWidth = 1; g.beginPath(); g.moveTo(hs.a[0], hs.a[1]); g.lineTo(hs.p1[0], hs.p1[1]); g.moveTo(hs.b[0], hs.b[1]); g.lineTo(hs.p2[0], hs.p2[1]); g.stroke(); for (const p of [hs.p1, hs.p2]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(p[0], p[1], 4.5, 0, 7); g.fill(); g.strokeStyle = it.col; g.stroke(); } }
    const s = sel && sel.name === it.name && sel.f === it.k.f; g.fillStyle = s ? '#fff' : it.col; g.beginPath(); g.rect(x - 4, y - 4, 8, 8); g.fill(); g.strokeStyle = '#000a'; g.stroke();
  }
  const px = X(S.frame); g.strokeStyle = '#ff4d6d'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + 0.5, 0); g.lineTo(px + 0.5, Hh); g.stroke();
}
function hit(x, y) {
  const items = visibleKeys();
  for (const it of items) { // handles first when selected
    if (sel && sel.name === it.name && sel.f === it.k.f) { const hs = handles(it); if (hs) { if (Math.hypot(hs.p1[0] - x, hs.p1[1] - y) < 8) return { type: 'h1', it, hs }; if (Math.hypot(hs.p2[0] - x, hs.p2[1] - y) < 8) return { type: 'h2', it, hs }; } }
  }
  for (const it of items) if (Math.hypot(X(it.k.f) - x, Yv(it.name, it.k.v) - y) < 8) return { type: 'key', it };
  return null;
}
function down(e) {
  canvas.setPointerCapture(e.pointerId); const x = e.offsetX, y = e.offsetY;
  if (e.button === 1 || e.button === 2) { drag = { type: 'pan', x: e.clientX, y: e.clientY, t0: view.t0, v0: view.v0 }; return; }
  const ht = hit(x, y);
  if (ht) { sel = { name: ht.it.name, f: ht.it.k.f }; H.begin('Edit curve'); drag = { ...ht, y0: y, v0: ht.it.k.v, f0: ht.it.k.f }; if (ht.type === 'key') Playback.seek(ht.it.k.f); refresh(); return; }
  sel = null; Playback.seek(Math.max(0, Math.round(fFromX(x)))); drag = { type: 'scrub' }; draw();
}
function move(e) {
  if (!drag) return; const x = e.offsetX, y = e.offsetY;
  if (drag.type === 'pan') { view.t0 = drag.t0 - (e.clientX - drag.x) / view.tz; if (!norm) view.v0 = drag.v0 + (e.clientY - drag.y) / view.vz; draw(); return; }
  if (drag.type === 'scrub') { Playback.seek(Math.max(0, Math.round(fFromX(x)))); return; }
  const it = drag.it;
  if (drag.type === 'key') { const nf = Math.max(0, Math.round(fFromX(x))); const nv = vFromY(it.name, y); const prev = it.t[it.idx - 1], next = it.t[it.idx + 1]; const lo = prev ? prev.f + 1 : 0, hi = next ? next.f - 1 : 1e6; it.k.f = clamp(nf, lo, hi); if (!e.shiftKey || true) it.k.v = nv; sel = { name: it.name, f: it.k.f }; bus.emit('render'); }
  else { const hs = drag.hs; const bz = (it.k.bz = (it.k.bz || [0.25, 0.1, 0.25, 1]).slice()); const nx = hs.nx; const dt = hs.dt || 1, dv = hs.dv || 1;
    const fx = fFromX(x), fv = vFromY(it.name, y); const u = clamp((fx - it.k.f) / dt, 0, 1), vv = (fv - it.k.v) / dv;
    if (drag.type === 'h1') { bz[0] = u; bz[1] = vv; } else { bz[2] = u; bz[3] = vv; } it.k.bz = bz; bus.emit('render'); }
  draw();
}
function up() { if (!drag) return; const d = drag; drag = null; if (d.type === 'key' || d.type === 'h1' || d.type === 'h2') { H.end(); bus.emit('change'); refresh(); } }
export const Graph = { build, refresh, fit };

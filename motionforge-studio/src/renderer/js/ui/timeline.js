// Timeline panel: canvas-rendered, virtualised, with layer-name column.
import { h, clamp, fmtTimecode } from '../core/util.js';
import { S, bus, scene, layerById, allLayers, fps, sceneDuration } from '../core/state.js';
import { H } from '../core/history.js';
import { celIndexAt, celSpan, getKey, layerKeyFrames, trackIndex } from '../core/anim.js';
import { Playback } from '../core/playback.js';
import * as ops from '../core/ops.js';
import { contextMenu } from './common.js';
import { icon } from './icons.js';
import { bufferOf, clipDuration, peaks } from '../core/audio.js';
import { runCommand } from '../core/commands.js';

const RULER = 26, ROW = 24, SUB = 20, AUD = 34;
let root, canvas, g, scroller, inner, names, W = 0, Hh = 0, rows = [], total = 0;
let drag = null, hoverInfo = null;
S.ui.tlTracks = S.ui.tlTracks || new Set();
const zoom = () => S.ui.tlZoom;
const colors = { bg: '#12151c', alt: '#151a24', line: '#1f2535', head: '#171b24', text: '#9aa3ba', playhead: '#ff4d6d', cel: '#3b5bdb', celSel: '#5b8cff', blank: '#566', key: '#ffc857', range: 'rgba(91,140,255,.18)', audio: '#2f7d6b' };

function buildRows() {
  rows = []; let y = 0; const sc = scene(); if (!sc) return;
  rows.push({ type: 'camera', y, h: ROW }); y += ROW;
  for (const c of sc.audio || []) { rows.push({ type: 'audio', clip: c, y, h: AUD }); y += AUD; }
  const walk = (list, depth) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i]; rows.push({ type: 'layer', layer: l, depth, y, h: ROW }); y += ROW;
      if (S.ui.tlTracks.has(l.id)) for (const [n, tr] of Object.entries(l.tracks || {})) if (tr.length) { rows.push({ type: 'track', layer: l, name: n, y, h: SUB }); y += SUB; }
      if (l.type === 'group' && l.expanded) walk(l.children, depth + 1);
    }
  };
  walk(sc.layers, 0); total = y;
}
const frameX = (f) => f * zoom() - scroller.scrollLeft;
const rowAt = (py) => { const yy = py - RULER + scroller.scrollTop; return rows.find((r) => yy >= r.y && yy < r.y + r.h) || null; };
const frameAt = (px) => Math.max(0, Math.floor((px + scroller.scrollLeft) / zoom()));
function trackLabel(n) { const m = /^b\.(.+)\.(\w+)$/.exec(n); if (m) { const l = layerById(S.selection.layerId); const b = l && l.char && l.char.bones.find((x) => x.id === m[1]); return `${b ? b.name : m[1]} · ${m[2]}`; } return n; }

export function build(host) {
  root = h('div.tl'); names = h('div.tl-names'); const left = h('div.tl-left', h('div.hd', h('span', 'Layers'), h('span.grow'), h('button.icon-btn', { tip: 'Add layer', on: { click: () => runCommand('layer.new') }, html: icon('plus', 15) })), names);
  scroller = h('div.tl-scroll'); inner = h('div.tl-grid'); canvas = h('canvas'); g = canvas.getContext('2d');
  scroller.append(canvas); scroller.append(inner); inner.style.pointerEvents = 'none'; canvas.style.cssText = 'position:sticky;left:0;top:0;display:block;margin-top:0';
  const right = h('div.tl-right', scroller); root.append(left, right); host.append(root);
  scroller.addEventListener('scroll', () => { names.scrollTop = scroller.scrollTop; draw(); });
  names.addEventListener('wheel', (e) => { scroller.scrollTop += e.deltaY; }, { passive: true });
  new ResizeObserver(resize).observe(right);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('contextmenu', onCtx);
  canvas.addEventListener('dblclick', onDbl);
  scroller.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); const f = frameAt(e.offsetX); S.ui.tlZoom = clamp(S.ui.tlZoom * (e.deltaY < 0 ? 1.15 : 0.87), 2, 60); layout(); } else if (e.shiftKey) { scroller.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  for (const ev of ['change', 'frame', 'project-loaded', 'scene', 'selection', 'history', 'playing']) bus.on(ev, refreshSoon);
  bus.on('render', drawSoon);
  layout(); return root;
}
let rq = 0; function refreshSoon() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; rebuildNames(); layout(); }); }
let dq = 0; function drawSoon() { if (dq) return; dq = requestAnimationFrame(() => { dq = 0; draw(); }); }
function resize() { const r = scroller.getBoundingClientRect(); W = Math.max(50, Math.floor(r.width)); Hh = Math.max(50, Math.floor(r.height)); const dpr = window.devicePixelRatio || 1; canvas.width = W * dpr; canvas.height = Hh * dpr; canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px'; inner.style.marginTop = -Hh + 'px'; draw(); }
function layout() {
  if (!scroller || !scene()) return; buildRows();
  const dur = Math.max(sceneDuration(), 24) + 120; inner.style.width = dur * zoom() + 'px'; inner.style.height = RULER + total + 40 + 'px'; inner.style.marginTop = -(Hh) + 'px';
  draw(); followPlayhead();
}
function followPlayhead() { if (!S.playing) return; const x = S.frame * zoom(); if (x < scroller.scrollLeft || x > scroller.scrollLeft + W - 40) scroller.scrollLeft = Math.max(0, x - 80); }

function rebuildNames() {
  if (!names || !scene()) return; buildRows(); names.innerHTML = '';
  const pad = h('div', { style: { height: '0px' } }); names.append(h('div', { style: { height: RULER - 24 + 'px' } }));
  for (const r of rows) {
    let el;
    if (r.type === 'camera') el = h('div.tlname', { style: { height: r.h + 'px' } }, h('span.ti', { html: icon('camera', 14) }), h('span.nm', 'Camera'));
    else if (r.type === 'audio') el = h('div.tlname', { style: { height: r.h + 'px' } }, h('span.ti', { html: icon('audio', 14) }), h('span.nm', r.clip.name || 'Audio'), h('button.icon-btn', { style: { width: '22px', height: '22px' }, tip: r.clip.muted ? 'Unmute' : 'Mute', on: { click: () => { ops_setAudio(r.clip.id, { muted: !r.clip.muted }); } }, html: icon(r.clip.muted ? 'eyeoff' : 'eye', 13) }));
    else if (r.type === 'track') el = h('div.tlname.sub', { style: { height: r.h + 'px' } }, h('span.nm', trackLabel(r.name)));
    else {
      const l = r.layer; const exp = S.ui.tlTracks.has(l.id); const hasTracks = Object.values(l.tracks || {}).some((t) => t.length);
      el = h('div.tlname' + (S.selection.layerId === l.id ? '.sel' : ''), { style: { height: r.h + 'px', paddingLeft: 6 + r.depth * 12 + 'px' }, on: { click: () => ops.select(l.id), contextmenu: (e) => { e.preventDefault(); ops.select(l.id); layerMenu(e, l); } } },
        h('button.icon-btn', { style: { width: '18px', height: '18px', opacity: hasTracks ? 1 : 0.25 }, tip: 'Show animated properties', on: { click: (e) => { e.stopPropagation(); if (exp) S.ui.tlTracks.delete(l.id); else S.ui.tlTracks.add(l.id); refreshSoon(); } }, html: icon(exp ? 'down' : 'chevron', 12) }),
        h('span.ti', { html: icon(l.type === 'group' ? 'folder' : l.char ? 'person' : l.type === 'image' ? 'image' : 'brush', 13) }), h('span.nm', l.name),
        h('button.icon-btn', { style: { width: '20px', height: '20px' }, tip: l.visible ? 'Hide layer' : 'Show layer', on: { click: (e) => { e.stopPropagation(); ops.setLayerFlag(l.id, 'visible', !l.visible); } }, html: icon(l.visible ? 'eye' : 'eyeoff', 13) }),
        h('button.icon-btn', { style: { width: '20px', height: '20px' }, tip: l.locked ? 'Unlock layer' : 'Lock layer', on: { click: (e) => { e.stopPropagation(); ops.setLayerFlag(l.id, 'locked', !l.locked); } }, html: icon(l.locked ? 'lock' : 'unlock', 13) }));
    }
    names.append(el);
  }
  names.scrollTop = scroller.scrollTop;
}
function ops_setAudio(id, patch) { H.tx('Audio', () => { const c = scene().audio.find((x) => x.id === id); if (c) Object.assign(c, patch); }); }
function layerMenu(e, l) {
  contextMenu([
    { label: 'New Keyframe', run: () => ops.newKeyframe(l.id) }, { label: 'New Blank Keyframe', run: () => ops.blankKeyframe(l.id), enabled: l.type === 'draw' },
    { label: 'Rename…', run: () => runCommand('layer.rename') }, { label: 'Duplicate', run: () => ops.duplicateLayer(l.id) }, '-', { label: 'Delete Layer', run: () => ops.deleteLayer(l.id) }], e.clientX, e.clientY);
}

// ───────── drawing ─────────
function draw() {
  if (!g || !scene()) return; const sc = scene(); const dpr = window.devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = colors.bg; g.fillRect(0, 0, W, Hh);
  const z = zoom(); const sl = scroller.scrollLeft, st = scroller.scrollTop; const f0 = Math.floor(sl / z), f1 = Math.ceil((sl + W) / z); const F = fps(); const dur = sceneDuration();
  // rows
  g.save(); g.beginPath(); g.rect(0, RULER, W, Hh - RULER); g.clip(); g.translate(0, RULER - st);
  rows.forEach((r, i) => {
    g.fillStyle = r.type === 'layer' && r.layer.id === S.selection.layerId ? 'rgba(91,140,255,.10)' : i % 2 ? colors.alt : colors.bg; g.fillRect(0, r.y, W, r.h);
  });
  // beat grid
  g.strokeStyle = colors.line; g.lineWidth = 1; g.beginPath();
  for (let f = f0; f <= f1; f++) { if (z < 6 && f % 5) continue; const x = Math.round(frameX(f)) + 0.5; g.moveTo(x, st); g.lineTo(x, st + Hh); }
  g.stroke();
  g.strokeStyle = '#2a3250'; g.beginPath(); for (let f = f0 - (f0 % F); f <= f1; f += F) { const x = Math.round(frameX(f)) + 0.5; g.moveTo(x, st); g.lineTo(x, st + Hh); } g.stroke();
  // end of scene
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(frameX(dur), st, W, Hh);
  if (S.selection.range) { const rg = S.selection.range; const row = rows.find((r) => r.type === 'layer' && r.layer.id === rg.layerId); if (row) { g.fillStyle = colors.range; g.fillRect(frameX(rg.start), row.y, (rg.end - rg.start + 1) * z, row.h); } }
  for (const r of rows) {
    if (r.y + r.h < st || r.y > st + Hh) continue;
    if (r.type === 'camera') keysRow(sc.camera, r, null);
    else if (r.type === 'audio') audioRow(r);
    else if (r.type === 'track') keysRow(r.layer, r, r.name);
    else layerRow(r);
  }
  if (drag && drag.ghost) { const gh = drag.ghost; g.fillStyle = 'rgba(255,255,255,.35)'; const r = gh.row; g.fillRect(frameX(gh.f), r.y + 3, Math.max(z, 4), r.h - 6); }
  g.restore();
  // ruler
  g.fillStyle = colors.head; g.fillRect(0, 0, W, RULER); g.strokeStyle = '#2a3042'; g.beginPath(); g.moveTo(0, RULER - 0.5); g.lineTo(W, RULER - 0.5); g.stroke();
  g.font = '10.5px Segoe UI, sans-serif'; g.fillStyle = colors.text; g.textBaseline = 'middle';
  const stepF = z >= 24 ? 1 : z >= 12 ? 2 : z >= 6 ? 5 : 10;
  for (let f = f0 - (f0 % stepF); f <= f1; f += stepF) { const x = frameX(f); const major = f % F === 0; g.strokeStyle = major ? '#566' : '#3a4056'; g.beginPath(); g.moveTo(x + 0.5, major ? 6 : RULER - 8); g.lineTo(x + 0.5, RULER); g.stroke(); if (major || z >= 20) g.fillText(major ? fmtTimecode(f, F) : String(f + 1), x + 3, 9); }
  for (const m of sc.markers || []) { const x = frameX(m.f); g.fillStyle = m.color || '#ffb454'; g.beginPath(); g.moveTo(x, RULER - 10); g.lineTo(x + 5, RULER - 5); g.lineTo(x, RULER); g.closePath(); g.fill(); g.fillText(m.name || '', x + 8, RULER - 6); }
  for (const s of sc.shots || []) { const x = frameX(s.start); g.fillStyle = 'rgba(255,180,84,.9)'; g.fillRect(x, RULER - 3, Math.max(2, (s.end - s.start + 1) * z), 3); }
  if (Playback.range) { g.fillStyle = 'rgba(65,201,138,.35)'; g.fillRect(frameX(Playback.range.start), 0, (Playback.range.end - Playback.range.start + 1) * z, 4); }
  // playhead
  const px = frameX(S.frame) + z / 2; g.fillStyle = 'rgba(255,77,109,.16)'; g.fillRect(frameX(S.frame), RULER, z, Hh); g.strokeStyle = colors.playhead; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, Hh); g.stroke();
  g.fillStyle = colors.playhead; g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px + 6, 10); g.lineTo(px, 16); g.lineTo(px - 6, 10); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 10px Segoe UI'; g.textAlign = 'center'; g.fillText(String(S.frame + 1), px, 7); g.textAlign = 'left';
}
function diamond(x, y, r, fill, stroke) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } }
function layerRow(r) {
  const l = r.layer; const z = zoom(); const cy = r.y + r.h / 2; const dur = sceneDuration();
  if (l.type === 'draw' && l.cels) {
    for (let i = 0; i < l.cels.length; i++) {
      const k = l.cels[i]; const [s, e] = celSpan(l, i, dur); if (frameX(e) < 0 || frameX(s) > W) continue;
      const x = frameX(s), w = (e - s) * z; const blank = !k.id; const sel = S.selection.layerId === l.id && S.frame >= s && S.frame < e;
      g.fillStyle = blank ? '#242a3a' : sel ? '#3d63d8' : '#2c4399'; g.fillRect(x + 1, r.y + 2, w - 1, r.h - 4);
      if (!blank) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x + 1, r.y + 2, w - 1, 4); }
      g.fillStyle = blank ? '#667' : '#fff'; g.beginPath(); g.arc(x + 5, cy, 2.8, 0, 7); if (blank) { g.strokeStyle = '#99a'; g.lineWidth = 1; g.stroke(); } else g.fill();
      if (e - s > 1) { g.strokeStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.moveTo(x + 10, cy + 0.5); g.lineTo(x + w - 3, cy + 0.5); g.stroke(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + w - 4, r.y + 5, 2, r.h - 10); }
    }
  }
  if (l.type === 'group') { g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(0, r.y + 2, W, r.h - 4); }
  // property key diamonds (union)
  const fr = layerKeyFrames(l); const selK = S.selection.keyFrame;
  for (const f of fr) { const x = frameX(f) + z / 2; if (x < -8 || x > W + 8) continue; const sel = selK && selK.layerId === l.id && selK.f === f && !selK.name; diamond(x, cy, 5.5, sel ? '#fff' : colors.key, '#2a2000'); }
  if (l.type === 'draw' && l.cels && z >= 8 && S.ui.tlTracks.has('__nums__')) {}
}
function keysRow(owner, r, name) {
  const z = zoom(); const cy = r.y + r.h / 2; const tracks = name ? [owner.tracks[name] || []] : Object.values(owner.tracks || {});
  const set = new Set(); tracks.forEach((t) => t.forEach((k) => set.add(k.f)));
  if (name) { // connect segments with eased/hold hint
    const t = tracks[0]; g.strokeStyle = '#3b4a73'; g.lineWidth = 2; for (let i = 0; i + 1 < t.length; i++) { const x1 = frameX(t[i].f) + z / 2, x2 = frameX(t[i + 1].f) + z / 2; if (t[i].e === 'hold') { g.setLineDash([3, 3]); } g.beginPath(); g.moveTo(x1, cy); g.lineTo(x2, cy); g.stroke(); g.setLineDash([]); }
  }
  const selK = S.selection.keyFrame;
  for (const f of set) { const x = frameX(f) + z / 2; if (x < -8 || x > W + 8) continue; const sel = selK && selK.f === f && ((name && selK.name === name) || (!name && r.type === 'camera' && selK.camera)); const k = name ? getKey(owner.tracks[name], f) : null; diamond(x, cy, name ? 4.5 : 5.5, sel ? '#fff' : name ? (k && k.e === 'hold' ? '#9aa3ba' : '#ffd37a') : colors.key, '#2a2000'); }
}
function audioRow(r) {
  const c = r.clip; const z = zoom(); const F = fps(); const x = frameX(c.start); const w = clipDuration(c) * F * z;
  g.fillStyle = c.muted ? '#2a3a38' : colors.audio; g.fillRect(x, r.y + 2, Math.max(2, w), r.h - 4); g.strokeStyle = '#4dbfa4'; g.lineWidth = 1; g.strokeRect(x + 0.5, r.y + 2.5, Math.max(2, w) - 1, r.h - 5);
  const pk = peaks(c.assetId, 2000); const buf = bufferOf(c.assetId);
  if (pk && buf) { g.fillStyle = 'rgba(255,255,255,.75)'; const mid = r.y + r.h / 2; const amp = (r.h - 8) / 2; const n = pk.length / 2; const t0 = (c.trimIn || 0) / buf.duration, t1 = ((c.trimOut != null ? c.trimOut : buf.duration)) / buf.duration;
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(W, x + w); px++) { const u = (px - x) / Math.max(1, w); const idx = Math.min(n - 1, Math.floor((t0 + (t1 - t0) * u) * n)); const mn = pk[idx * 2], mx = pk[idx * 2 + 1]; g.fillRect(px, mid - mx * amp * (c.volume ?? 1), 1, Math.max(1, (mx - mn) * amp * (c.volume ?? 1))); } }
  if (c.fadeIn > 0) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(x, r.y + 2); g.lineTo(x + c.fadeIn * F * z, r.y + 2); g.lineTo(x, r.y + r.h - 2); g.fill(); }
  if (c.fadeOut > 0) { const xe = x + w; g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(xe, r.y + 2); g.lineTo(xe - c.fadeOut * F * z, r.y + 2); g.lineTo(xe, r.y + r.h - 2); g.fill(); }
  g.fillStyle = '#fff'; g.font = '10px Segoe UI'; g.fillText(c.name || 'audio', Math.max(4, x + 4), r.y + 10);
}

// ───────── interaction ─────────
function pos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function hitLayerRow(r, f, px) {
  const l = r.layer; const z = zoom(); const dur = sceneDuration();
  if (l.type === 'draw' && l.cels) {
    for (let i = 0; i < l.cels.length; i++) { const [s, e] = celSpan(l, i, dur); if (f >= s && f < e) { const xe = frameX(e); if (e - s >= 1 && Math.abs(px - xe) < 6 && i < l.cels.length) return { kind: 'resize', start: s, end: e }; if (f === s) return { kind: 'cel', f: s }; return { kind: 'hold', start: s, end: e }; } }
  }
  if (layerKeyFrames(l).includes(f)) return { kind: 'key', f };
  return null;
}
function onDown(e) {
  canvas.setPointerCapture(e.pointerId); const [px, py] = pos(e); const sc = scene();
  if (e.button !== 0) return;
  if (py < RULER) { drag = { mode: 'scrub' }; Playback.seek(frameAt(px)); return; }
  const r = rowAt(py); const f = frameAt(px); if (!r) { S.selection.range = null; Playback.seek(f); drag = { mode: 'scrub' }; return; }
  if (r.type === 'layer') {
    ops.select(r.layer.id); const hit = hitLayerRow(r, f, px);
    if (hit && (hit.kind === 'cel')) { drag = { mode: 'cel', row: r, from: hit.f, copy: e.altKey, ghost: { row: r, f: hit.f } }; Playback.seek(f); S.selection.range = { layerId: r.layer.id, start: f, end: f }; }
    else if (hit && hit.kind === 'resize') { drag = { mode: 'resize', row: r, start: hit.start, end: hit.end, f }; }
    else if (hit && hit.kind === 'key') { drag = { mode: 'key', row: r, from: hit.f, copy: e.altKey, ghost: { row: r, f: hit.f } }; S.selection.keyFrame = { layerId: r.layer.id, f: hit.f }; Playback.seek(f); }
    else { if (e.shiftKey && S.selection.range && S.selection.range.layerId === r.layer.id) { const a = S.selection.range.start; S.selection.range = { layerId: r.layer.id, start: Math.min(a, f), end: Math.max(a, f) }; } else S.selection.range = { layerId: r.layer.id, start: f, end: f }; Playback.seek(f); drag = { mode: 'scrub-range', row: r, a: f }; }
  } else if (r.type === 'track') {
    ops.select(r.layer.id); const k = getKey(r.layer.tracks[r.name], f);
    if (k) { drag = { mode: 'tkey', row: r, from: f, ghost: { row: r, f } }; S.selection.keyFrame = { layerId: r.layer.id, name: r.name, f }; }
    Playback.seek(f);
  } else if (r.type === 'camera') {
    const has = Object.values(sc.camera.tracks).some((t) => getKey(t, f));
    if (has) { drag = { mode: 'cam', row: r, from: f, ghost: { row: r, f } }; S.selection.keyFrame = { camera: true, f }; }
    Playback.seek(f);
  } else if (r.type === 'audio') {
    const c = r.clip; const x0 = frameX(c.start), x1 = x0 + clipDuration(c) * fps() * zoom();
    const mode = Math.abs(px - x1) < 7 ? 'atrimR' : Math.abs(px - x0) < 7 ? 'atrimL' : (px > x0 && px < x1 ? 'amove' : null);
    if (mode) { H.begin('Edit audio'); drag = { mode, clip: c, x: px, start0: c.start, in0: c.trimIn || 0, out0: c.trimOut, buf: bufferOf(c.assetId) }; }
    else Playback.seek(f);
  }
  bus.emit('selection'); draw();
}
function onMove(e) {
  const [px, py] = pos(e);
  if (!drag) { const r = rowAt(py); canvas.style.cursor = r && r.type === 'layer' && hitLayerRow(r, frameAt(px), px)?.kind === 'resize' ? 'ew-resize' : r && r.type === 'audio' ? 'grab' : 'default'; return; }
  const f = frameAt(px);
  if (drag.mode === 'scrub') Playback.seek(f);
  else if (drag.mode === 'scrub-range') { Playback.seek(f); S.selection.range = { layerId: drag.row.layer.id, start: Math.min(drag.a, f), end: Math.max(drag.a, f) }; draw(); }
  else if (['cel', 'key', 'tkey', 'cam'].includes(drag.mode)) { drag.ghost.f = f; draw(); }
  else if (drag.mode === 'resize') { drag.newEnd = Math.max(drag.start + 1, f + 1); drag.ghost = { row: drag.row, f: drag.newEnd - 1 }; draw(); }
  else if (drag.mode === 'amove') { drag.clip.start = Math.max(0, drag.start0 + Math.round((px - drag.x) / zoom())); draw(); }
  else if (drag.mode === 'atrimR') { const d = (px - drag.x) / zoom() / fps(); const full = drag.buf ? drag.buf.duration : 0; drag.clip.trimOut = clamp((drag.out0 != null ? drag.out0 : full) + d, (drag.clip.trimIn || 0) + 0.05, full); draw(); }
  else if (drag.mode === 'atrimL') { const d = (px - drag.x) / zoom() / fps(); const ni = clamp(drag.in0 + d, 0, (drag.out0 != null ? drag.out0 : drag.buf.duration) - 0.05); const real = ni - drag.in0; drag.clip.trimIn = ni; drag.clip.start = Math.max(0, drag.start0 + Math.round(real * fps())); draw(); }
}
function onUp(e) {
  if (!drag) return; const [px] = pos(e); const f = frameAt(px); const d = drag; drag = null;
  if (d.mode === 'cel') ops.moveCel(d.row.layer.id, d.from, f, d.copy);
  else if (d.mode === 'key') ops.moveKeyframeColumn(d.row.layer.id, d.from, f, d.copy);
  else if (d.mode === 'tkey') H.tx('Move key', () => { const tr = d.row.layer.tracks[d.row.name]; const k = getKey(tr, d.from); if (k && f !== d.from) { tr.splice(tr.indexOf(k), 1); const ex = getKey(tr, f); if (ex) tr.splice(tr.indexOf(ex), 1); k.f = f; tr.push(k); tr.sort((a, b) => a.f - b.f); } });
  else if (d.mode === 'cam') H.tx('Move camera key', () => { for (const tr of Object.values(scene().camera.tracks)) { const k = getKey(tr, d.from); if (k && f !== d.from) { tr.splice(tr.indexOf(k), 1); const ex = getKey(tr, f); if (ex) tr.splice(tr.indexOf(ex), 1); k.f = f; tr.push(k); tr.sort((a, b) => a.f - b.f); } } });
  else if (d.mode === 'resize' && d.newEnd) ops.setExposure(d.row.layer.id, d.start, d.newEnd - d.start);
  else if (['amove', 'atrimL', 'atrimR'].includes(d.mode)) { H.end(); bus.emit('change'); }
  refreshSoon();
}
function onDbl(e) {
  const [px, py] = pos(e); const r = rowAt(py); const f = frameAt(px);
  if (r && r.type === 'layer' && r.layer.type === 'draw') { const i = celIndexAt(r.layer, f); const hit = hitLayerRow(r, f, px); if (!hit || hit.kind === 'hold' || !r.layer.cels[i]) { ops.newKeyframe(r.layer.id, f); } }
  else if (r && r.type === 'layer') { ops.select(r.layer.id); H.tx('Keyframe', () => ops.addKeyframeAt(r.layer, f)); }
}
function onCtx(e) {
  e.preventDefault(); const [px, py] = pos(e); const r = rowAt(py); const f = frameAt(px); if (!r) return;
  if (r.type === 'layer') {
    ops.select(r.layer.id); Playback.seek(f); S.selection.range = S.selection.range && S.selection.range.layerId === r.layer.id && f >= S.selection.range.start && f <= S.selection.range.end ? S.selection.range : { layerId: r.layer.id, start: f, end: f };
    const l = r.layer; const rg = S.selection.range;
    const eases = [['linear', 'Linear'], ['easeIn', 'Ease In'], ['easeOut', 'Ease Out'], ['easeInOut', 'Ease In/Out'], ['bounce', 'Bounce'], ['elastic', 'Elastic'], ['back', 'Back'], ['hold', 'Hold (step)'], ['bezier', 'Custom Bezier']];
    contextMenu([
      { label: 'New Keyframe', run: () => ops.newKeyframe(l.id, f) }, { label: 'New Blank Keyframe', run: () => ops.blankKeyframe(l.id, f), enabled: l.type === 'draw' },
      { label: 'New Frame After', run: () => ops.newBlankFrame(l.id, f) }, { label: 'Duplicate Frame', run: () => ops.duplicateFrame(l.id, f) }, { label: 'Extend Hold (+1)', run: () => ops.holdFrame(l.id, f) }, '-',
      { label: 'Delete Frame(s)', run: () => ops.deleteFrames(l.id, rg.start, rg.end) }, { label: 'Delete Keyframe (properties)', run: () => ops.deleteKeyframeAt(l.id, f) }, '-',
      { label: 'Copy Keyframe', run: () => ops.copyKeysAt(l.id, f) }, { label: 'Paste Keyframe', run: () => ops.pasteKeysAt(l.id, f) }, '-',
      { label: 'Easing', sub: eases.map(([k, n]) => ({ label: n, run: () => ops.setEaseForFrame(l.id, f, k) })) },
      { label: 'Set Loop Range from Selection', run: () => { Playback.range = { start: rg.start, end: rg.end }; bus.emit('render'); } }, { label: 'Clear Loop Range', run: () => { Playback.range = null; draw(); } },
    ], e.clientX, e.clientY);
  } else if (r.type === 'track') {
    const k = getKey(r.layer.tracks[r.name], f); if (!k) return;
    const eases = [['linear', 'Linear'], ['easeIn', 'Ease In'], ['easeOut', 'Ease Out'], ['easeInOut', 'Ease In/Out'], ['bounce', 'Bounce'], ['elastic', 'Elastic'], ['back', 'Back'], ['hold', 'Hold (step)'], ['bezier', 'Custom Bezier']];
    contextMenu([{ label: 'Easing', sub: eases.map(([e2, n]) => ({ label: n, checked: k.e === e2, run: () => ops.setKeyEase(r.layer.id, r.name, f, e2) })) }, { label: 'Delete Key', run: () => ops.deleteKey(r.layer.id, r.name, f) }], e.clientX, e.clientY);
  } else if (r.type === 'audio') {
    const c = r.clip;
    contextMenu([{ label: c.muted ? 'Unmute' : 'Mute', run: () => ops_setAudio(c.id, { muted: !c.muted }) }, { label: 'Split at Playhead', run: () => splitAudio(c) }, { label: 'Remove Audio Clip', run: () => H.tx('Remove audio', () => { const sc = scene(); sc.audio = sc.audio.filter((x) => x.id !== c.id); }) }], e.clientX, e.clientY);
  } else if (r.type === 'camera') contextMenu([{ label: 'Add Camera Keyframe', run: () => ops.addCameraKey(f) }, { label: 'Add Shot Cut Here', run: () => ops.addShot() }], e.clientX, e.clientY);
}
export function splitAudio(c) {
  const F = fps(); const t = (S.frame - c.start) / F; const dur = clipDuration(c); if (t <= 0.02 || t >= dur - 0.02) return;
  H.tx('Split audio', () => { const sc = scene(); const nc = { ...c, id: 'au_' + Math.random().toString(36).slice(2, 8), start: S.frame, trimIn: (c.trimIn || 0) + t, fadeIn: 0 }; c.trimOut = (c.trimIn || 0) + t; c.fadeOut = 0; sc.audio.push(nc); });
}
export const Timeline = { build, refresh: () => { rebuildNames(); layout(); }, draw };

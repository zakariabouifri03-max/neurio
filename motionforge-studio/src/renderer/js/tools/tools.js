// Tool implementations. Each tool: { cursor, down, move, up, hover, dbl, key, overlay, activate }
import { M, mkCanvas, clamp, uid, DEG, deg, h, hexToRgb } from '../core/util.js';
import { S, bus, scene, layerById, curLayer, allLayers, notify } from '../core/state.js';
import { H, copyCanvas } from '../core/history.js';
import { celCanvas, createCel, touchCel, cels } from '../core/model.js';
import { celIndexAt, celAt, layerProp, writeProp, layerBase } from '../core/anim.js';
import { evalLayer, layerMatrix, solveCharacter, hitBone, boneOrder, tailRest, clampRot, bonesChildren } from '../core/rig.js';
import { Stroke, floodFill, drawShape, drawTextTo, BRUSH_PRESETS } from './draw.js';
import { renderScene, sceneCamMatrix } from '../core/render.js';
import { toast } from '../ui/common.js';
import { ensureDrawLayer } from '../core/ops.js';
import { charSolve, boneEnds } from './overlays.js';

export const TOOLS = {};
Object.assign(S.brush, BRUSH_PRESETS.ink, { type: 'ink' }); Object.assign(S.fillOpt, { sampleAll: false, grow: 1 }); S.tfTarget = 'auto';
S.pencil = { ...BRUSH_PRESETS.pencil }; S.eraserCfg = { ...BRUSH_PRESETS.eraser };
export const cfgFor = (tool = S.tool) => (tool === 'pencil' ? S.pencil : tool === 'eraser' ? S.eraserCfg : S.brush);
const requestRender = () => bus.emit('render');

// ───────── helpers ─────────
function toLocal(layer, p, f = S.frame) { return M.pt(M.inv(layerMatrix(layer, evalLayer(layer, f))), p.x, p.y); }
function celForPaint(layer) {
  const f = S.frame; layer.cels = layer.cels || [];
  const i = celIndexAt(layer, f);
  if (i >= 0 && layer.cels[i].id) return layer.cels[i].id;
  const id = createCel();
  if (i >= 0 && layer.cels[i].f === f) layer.cels[i].id = id; else { layer.cels.push({ f, id }); layer.cels.sort((a, b) => a.f - b.f); }
  return id;
}
function paintableLayer() {
  const l = ensureDrawLayer(); if (!l) return null;
  if (l.locked) { toast('This layer is locked.', 'warn'); return null; }
  if (!l.visible) { toast('This layer is hidden — show it to draw.', 'warn'); return null; }
  return l;
}
function rectUnion(a, b) { if (!a) return b; if (!b) return a; const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
function commitCelEdit(label, celId, before, rect) { if (rect) H.pixelEdit(label, celId, before, rect); }

// ───────── paint tools ─────────
function paintTool(name, erase) {
  let st = null;
  return {
    cursor: 'none',
    down(p) {
      const l = paintableLayer(); if (!l) return;
      H.begin(erase ? 'Erase' : 'Brush stroke');
      const id = celForPaint(l); const cv = celCanvas(id, true);
      const cfg = cfgFor(name);
      const before = copyCanvas(cv);
      const stroke = new Stroke({ celCanvas: cv, color: S.color, brush: { ...cfg }, erase, zoom: S.view.zoom });
      S.live = { celId: id, buf: stroke.buf, opacity: clamp(cfg.opacity, 0, 1), erase, alphaLock: !!l.alphaLock && !erase };
      st = { l, id, cv, before, stroke };
      const q = toLocal(l, p); stroke.add({ x: q[0], y: q[1], pressure: p.pressure || 0.5, pointerType: p.pointerType });
    },
    move(p) { if (!st) return; const q = toLocal(st.l, p); st.stroke.add({ x: q[0], y: q[1], pressure: p.pressure || 0.5, pointerType: p.pointerType }); },
    up(p) {
      if (!st) return; const { l, id, cv, before, stroke } = st; st = null;
      stroke.commit(S.live.alphaLock); S.live = null;
      commitCelEdit(erase ? 'Erase' : 'Brush stroke', id, before, stroke.rect); H.end(); notify('change');
    },
  };
}
TOOLS.brush = paintTool('brush', false); TOOLS.pencil = paintTool('pencil', false); TOOLS.eraser = paintTool('eraser', true);

// ───────── fill ─────────
TOOLS.fill = {
  cursor: 'crosshair',
  down(p) {
    const l = paintableLayer(); if (!l) return;
    H.begin('Fill');
    const id = celForPaint(l); const cv = celCanvas(id, true); const before = copyCanvas(cv);
    const q = toLocal(l, p); const g = cv.getContext('2d', { willReadFrequently: true });
    const target = g.getImageData(0, 0, cv.width, cv.height);
    let sample = target;
    if (S.fillOpt.sampleAll) { const c = mkCanvas(cv.width, cv.height); renderScene(c.getContext('2d'), scene(), S.frame, { scale: 1, transparent: false }); sample = c.getContext('2d').getImageData(0, 0, c.width, c.height); }
    const rect = floodFill(sample, target, q[0], q[1], S.color, S.fillOpt.tolerance, S.fillOpt.grow ?? 1, S.fillOpt.contiguous !== false);
    if (rect) { g.putImageData(target, 0, 0); commitCelEdit('Fill', id, before, rect); notify('change'); } else toast('Nothing to fill there.', 'info', 1200);
    H.end();
  },
};

// ───────── shapes ─────────
let shapeSt = null; // {kind, a,b, pts, bez}
function currentShape(extra) { return { kind: S.shape.kind, fill: S.shape.fill, stroke: S.shape.stroke, lineWidth: S.shape.lineWidth, color: S.color, color2: S.color2, ...extra }; }
function commitShape(sh) {
  const l = paintableLayer(); if (!l) { shapeSt = null; return; }
  H.begin('Shape'); const id = celForPaint(l); const cv = celCanvas(id, true); const before = copyCanvas(cv);
  drawShape(cv.getContext('2d'), sh, M.inv(layerMatrix(l, evalLayer(l, S.frame))));
  const lw = sh.lineWidth + 4;
  let pts = []; if (sh.a) pts.push(sh.a, sh.b); if (sh.pts) pts.push(...sh.pts); if (sh.bez) sh.bez.forEach((b) => pts.push([b.x, b.y], [b.x + (b.hx || 0), b.y + (b.hy || 0)], [b.x - (b.hx || 0), b.y - (b.hy || 0)]));
  const inv = M.inv(layerMatrix(l, evalLayer(l, S.frame))); pts = pts.map(([x, y]) => M.pt(inv, x, y));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const rect = { x: Math.min(...xs) - lw, y: Math.min(...ys) - lw, w: Math.max(...xs) - Math.min(...xs) + lw * 2, h: Math.max(...ys) - Math.min(...ys) + lw * 2 };
  commitCelEdit('Shape', id, before, rect); H.end(); shapeSt = null; notify('change');
}
TOOLS.shape = {
  cursor: 'crosshair',
  activate() { shapeSt = null; },
  down(p) {
    const k = S.shape.kind;
    if (k === 'polygon') {
      if (!shapeSt) shapeSt = { pts: [[p.x, p.y]], cur: [p.x, p.y] }; else shapeSt.pts.push([p.x, p.y]);
      const f = shapeSt.pts[0]; if (shapeSt.pts.length > 2 && Math.hypot(p.sx - toScr(f)[0], p.sy - toScr(f)[1]) < 10) { shapeSt.pts.pop(); commitShape(currentShape({ pts: shapeSt.pts, closed: true })); }
      return;
    }
    if (k === 'bezier') {
      if (!shapeSt) shapeSt = { bez: [], cur: [p.x, p.y] };
      shapeSt.bez.push({ x: p.x, y: p.y, hx: 0, hy: 0 }); shapeSt.dragging = true; return;
    }
    shapeSt = { a: [p.x, p.y], b: [p.x, p.y], perfect: p.shift };
  },
  move(p) {
    if (!shapeSt) return;
    if (S.shape.kind === 'bezier' && shapeSt.dragging) { const a = shapeSt.bez[shapeSt.bez.length - 1]; a.hx = p.x - a.x; a.hy = p.y - a.y; return; }
    if (shapeSt.a) { let bx = p.x, by = p.y; if (p.shift && S.shape.kind !== 'circle') { const dx = bx - shapeSt.a[0], dy = by - shapeSt.a[1]; if (S.shape.kind === 'line') { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(dx, dy); bx = shapeSt.a[0] + Math.cos(a) * d; by = shapeSt.a[1] + Math.sin(a) * d; } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); bx = shapeSt.a[0] + Math.sign(dx || 1) * m; by = shapeSt.a[1] + Math.sign(dy || 1) * m; } } shapeSt.b = [bx, by]; shapeSt.perfect = p.shift; }
  },
  hover(p) { if (shapeSt && (shapeSt.pts || shapeSt.bez)) shapeSt.cur = [p.x, p.y]; },
  up(p) {
    if (!shapeSt) return;
    if (S.shape.kind === 'bezier') { shapeSt.dragging = false; return; }
    if (shapeSt.a) { if (Math.hypot(shapeSt.b[0] - shapeSt.a[0], shapeSt.b[1] - shapeSt.a[1]) < 2) { shapeSt = null; return; } commitShape(currentShape({ a: shapeSt.a, b: shapeSt.b, perfect: shapeSt.perfect })); }
  },
  dbl() { finishShape(); },
  key(e) { if (e.key === 'Enter') { finishShape(); return true; } if (e.key === 'Escape') { shapeSt = null; requestRender(); return true; } return false; },
  overlay(g, c2s) {
    if (!shapeSt) return;
    let sh = null;
    if (shapeSt.a) sh = currentShape({ a: shapeSt.a, b: shapeSt.b, perfect: shapeSt.perfect });
    else if (shapeSt.pts) sh = currentShape({ pts: [...shapeSt.pts, shapeSt.cur], closed: false });
    else if (shapeSt.bez) { const bz = shapeSt.dragging ? shapeSt.bez : [...shapeSt.bez, { x: shapeSt.cur[0], y: shapeSt.cur[1], hx: 0, hy: 0 }]; sh = currentShape({ bez: bz, fill: false }); }
    if (!sh) return;
    const z = Math.hypot(c2s[0], c2s[1]); sh.lineWidth = sh.lineWidth; drawShape(g, sh, c2s);
    if (shapeSt.bez) { for (const b of shapeSt.bez) { const a = M.pt(c2s, b.x, b.y), c = M.pt(c2s, b.x + b.hx, b.y + b.hy), d = M.pt(c2s, b.x - b.hx, b.y - b.hy); g.strokeStyle = '#5ac8ff'; g.lineWidth = 1; g.beginPath(); g.moveTo(d[0], d[1]); g.lineTo(c[0], c[1]); g.stroke(); g.fillStyle = '#fff'; g.fillRect(a[0] - 3, a[1] - 3, 6, 6); g.beginPath(); g.arc(c[0], c[1], 3, 0, 7); g.fill(); } }
  },
};
function toScr(pt) { return M.pt(M.mul(M.T(S.view.panX, S.view.panY), M.S(S.view.zoom, S.view.zoom)), pt[0], pt[1]); }
function finishShape() {
  if (!shapeSt) return;
  if (shapeSt.pts && shapeSt.pts.length >= 2) commitShape(currentShape({ pts: shapeSt.pts, closed: false }));
  else if (shapeSt.bez && shapeSt.bez.length >= 2) commitShape(currentShape({ bez: shapeSt.bez, fill: false }));
  else shapeSt = null;
  requestRender();
}

// ───────── text ─────────
TOOLS.text = {
  cursor: 'text',
  down(p) {
    const l = paintableLayer(); if (!l) return;
    const host = document.getElementById('canvas-host'); const r = host.getBoundingClientRect();
    const ta = h('textarea.text-edit', { style: { left: p.sx + 'px', top: p.sy + 'px', fontSize: S.text.size * S.view.zoom + 'px', color: S.color, fontFamily: S.text.font, fontWeight: S.text.bold ? '700' : '400' }, placeholder: 'Type…' });
    host.append(ta); setTimeout(() => ta.focus(), 0);
    let done = false;
    const commit = (ok) => {
      if (done) return; done = true; const txt = ta.value; ta.remove();
      if (!ok || !txt.trim()) return;
      H.begin('Text'); const id = celForPaint(l); const cv = celCanvas(id, true); const before = copyCanvas(cv);
      const q = toLocal(l, p); drawTextTo(cv.getContext('2d'), txt, q[0], q[1], { color: S.color, size: S.text.size, font: S.text.font, bold: S.text.bold });
      const w = Math.max(...txt.split('\n').map((s) => s.length)) * S.text.size * 0.75 + 20; const hh = txt.split('\n').length * S.text.size * 1.3 + 10;
      commitCelEdit('Text', id, before, { x: q[0] - 4, y: q[1] - 4, w, h: hh }); H.end(); notify('change');
    };
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(true); } if (e.key === 'Escape') commit(false); });
    ta.addEventListener('blur', () => commit(true));
  },
};

// ───────── selection (marquee + move pixels) ─────────
S.marquee = null; let selDrag = null;
function marqueeCel(l) { // marquee rect in cel pixel coords (ints), clamped
  const m = S.marquee; if (!m) return null; const inv = M.inv(layerMatrix(l, evalLayer(l, S.frame)));
  const pts = [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]].map(([x, y]) => M.pt(inv, x, y));
  const x0 = Math.floor(Math.min(...pts.map((q) => q[0]))), y0 = Math.floor(Math.min(...pts.map((q) => q[1]))), x1 = Math.ceil(Math.max(...pts.map((q) => q[0]))), y1 = Math.ceil(Math.max(...pts.map((q) => q[1])));
  const W = S.project.width, Hh = S.project.height;
  const r = { x: clamp(x0, 0, W), y: clamp(y0, 0, Hh) }; r.w = clamp(x1, 0, W) - r.x; r.h = clamp(y1, 0, Hh) - r.y; return r.w > 0 && r.h > 0 ? r : null;
}
let clipboard = null;
export const Sel = {
  has: () => !!S.marquee,
  all() { S.marquee = { x: 0, y: 0, w: S.project.width, h: S.project.height }; requestRender(); },
  clear() { S.marquee = null; requestRender(); },
  del(cut) {
    const l = curLayer(); if (!l || l.type !== 'draw' || !S.marquee) return false; if (l.locked) { toast('Layer is locked', 'warn'); return true; }
    const r = marqueeCel(l); const c = celAt(l, S.frame); if (!r || !c || !c.id) return true;
    const cv = celCanvas(c.id); if (!cv) return true;
    if (cut) { const t = mkCanvas(r.w, r.h); t.getContext('2d').drawImage(cv, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); clipboard = t; }
    H.begin(cut ? 'Cut' : 'Clear selection'); const before = copyCanvas(cv); cv.getContext('2d').clearRect(r.x, r.y, r.w, r.h); commitCelEdit('Clear', c.id, before, r); H.end(); notify('change'); return true;
  },
  copy() {
    const l = curLayer(); if (!l || l.type !== 'draw' || !S.marquee) return false; const r = marqueeCel(l); const c = celAt(l, S.frame); const cv = c && c.id && celCanvas(c.id); if (!r || !cv) return false;
    const t = mkCanvas(r.w, r.h); t.getContext('2d').drawImage(cv, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); clipboard = t; toast('Copied', 'info', 900); return true;
  },
  paste() {
    if (!clipboard) return false; const l = paintableLayer(); if (!l) return true;
    H.begin('Paste'); const id = celForPaint(l); const cv = celCanvas(id, true); const before = copyCanvas(cv);
    const x = Math.round((S.project.width - clipboard.width) / 2), y = Math.round((S.project.height - clipboard.height) / 2);
    cv.getContext('2d').drawImage(clipboard, x, y); commitCelEdit('Paste', id, before, { x, y, w: clipboard.width, h: clipboard.height }); H.end();
    S.marquee = { x, y, w: clipboard.width, h: clipboard.height }; notify('change'); return true;
  },
};
TOOLS.select = {
  cursor: 'default',
  down(p) {
    const l = curLayer();
    if (l && l.char && !p.alt) { const ev = evalLayer(l, S.frame); const b = hitBone(l, ev, p.x, p.y); if (b) { S.selection.boneId = b; bus.emit('selection'); selDrag = null; return; } }
    const m = S.marquee;
    if (m && l && l.type === 'draw' && p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h && !l.locked) {
      const r = marqueeCel(l); const c = celAt(l, S.frame); const cv = c && c.id && celCanvas(c.id);
      if (r && cv) {
        H.begin('Move selection'); const before = copyCanvas(cv);
        const t = mkCanvas(r.w, r.h); t.getContext('2d').drawImage(cv, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        cv.getContext('2d').clearRect(r.x, r.y, r.w, r.h);
        S.floating = { celId: c.id, canvas: t, x: r.x, y: r.y };
        selDrag = { mode: 'move', r, before, id: c.id, cv, start: toLocal(l, p), startP: [p.x, p.y], m0: { ...m }, l }; return;
      }
    }
    selDrag = { mode: 'new', x0: p.x, y0: p.y }; S.marquee = { x: p.x, y: p.y, w: 0, h: 0 }; if (l && l.type === 'draw') S.ui.cutSource = l.id;
  },
  move(p) {
    if (!selDrag) return;
    if (selDrag.mode === 'new') { const x = Math.min(selDrag.x0, p.x), y = Math.min(selDrag.y0, p.y); S.marquee = { x, y, w: Math.abs(p.x - selDrag.x0), h: Math.abs(p.y - selDrag.y0) }; }
    else { const q = toLocal(selDrag.l, p); S.floating.x = selDrag.r.x + Math.round(q[0] - selDrag.start[0]); S.floating.y = selDrag.r.y + Math.round(q[1] - selDrag.start[1]); S.marquee = { ...selDrag.m0, x: selDrag.m0.x + (p.x - selDrag.startP[0]), y: selDrag.m0.y + (p.y - selDrag.startP[1]) }; }
  },
  up(p) {
    if (!selDrag) return;
    if (selDrag.mode === 'new') { if (!S.marquee || S.marquee.w < 3 || S.marquee.h < 3) S.marquee = null; }
    else {
      const f = S.floating; selDrag.cv.getContext('2d').drawImage(f.canvas, f.x, f.y); S.floating = null;
      commitCelEdit('Move selection', selDrag.id, selDrag.before, rectUnion(selDrag.r, { x: f.x, y: f.y, w: f.canvas.width, h: f.canvas.height })); H.end(); notify('change');
    }
    selDrag = null;
  },
  overlay(g, c2s) {
    const m = S.marquee; if (!m) return; const a = M.pt(c2s, m.x, m.y), b = M.pt(c2s, m.x + m.w, m.y + m.h);
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.setLineDash([5, 4]); g.lineDashOffset = -(performance.now() / 60) % 9; g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    g.strokeStyle = '#000'; g.lineDashOffset = -(performance.now() / 60 + 4.5) % 9; g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.setLineDash([]);
  },
};

// ───────── zoom / hand ─────────
TOOLS.hand = { cursor: 'grab' };
TOOLS.zoom = {
  cursor: 'zoom-in',
  down(p) { import('../ui/viewport.js').then(({ VP }) => VP.zoomTo(S.view.zoom * (p.alt ? 0.7 : 1.4), p.sx, p.sy)); },
};

// ───────── transform (layer + character parts) ─────────
const bboxCache = new Map();
function celBBox(celId) {
  const c = cels.get(celId); const cv = celCanvas(celId); if (!cv) return null;
  const k = bboxCache.get(celId); if (k && k.ver === c.ver) return k.box;
  const g = cv.getContext('2d', { willReadFrequently: true }); const d = g.getImageData(0, 0, cv.width, cv.height).data; const W = cv.width, Hh = cv.height;
  let x0 = W, y0 = Hh, x1 = -1, y1 = -1;
  for (let y = 0; y < Hh; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const box = x1 < 0 ? null : { x: x0 - 2, y: y0 - 2, w: x1 - x0 + 6, h: y1 - y0 + 6 };
  bboxCache.set(celId, { ver: c.ver, box }); return box;
}
export function layerLocalBBox(l) {
  if (l.type === 'draw') { const c = celAt(l, S.frame); const b = c && c.id ? celBBox(c.id) : null; return b || { x: S.project.width / 2 - 100, y: S.project.height / 2 - 100, w: 200, h: 200 }; }
  if (l.type === 'image' && l.image) return { x: l.image.x, y: l.image.y, w: l.image.w, h: l.image.h };
  if (l.char) {
    const { sol } = charSolve(l); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const b of sol.order) if (b.img) for (const [cx, cy] of [[b.img.x, b.img.y], [b.img.x + b.img.w, b.img.y], [b.img.x + b.img.w, b.img.y + b.img.h], [b.img.x, b.img.y + b.img.h]]) { const q = M.pt(sol.img[b.id], cx, cy); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    if (x1 < x0) return { x: 0, y: 0, w: 100, h: 100 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return { x: 0, y: 0, w: S.project.width, h: S.project.height };
}
function applyTransformKeeping(l, localPt, scenePt, np) {
  const A = M.mul(M.R(np.rotation * DEG), M.mul(np.skewX ? M.K(np.skewX * DEG) : M.I(), M.S(np.scaleX, np.scaleY)));
  const v = M.pt([A[0], A[1], A[2], A[3], 0, 0], localPt[0] - l.pivot.x, localPt[1] - l.pivot.y);
  return { x: scenePt[0] - v[0], y: scenePt[1] - v[1] };
}
let tf = null;
const HANDLE = 9;
function gizmo(l) {
  const bb = layerLocalBBox(l); const ev = evalLayer(l, S.frame); const lm = layerMatrix(l, ev);
  const corners = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]];
  return { bb, ev, lm, corners, scene: corners.map(([x, y]) => M.pt(lm, x, y)) };
}
const SCR = (pt) => M.pt(M.mul(M.T(S.view.panX, S.view.panY), M.mul(M.S(S.view.zoom, S.view.zoom), S.ui.cameraView ? sceneCamMatrix(scene(), S.frame, 1) : M.I())), pt[0], pt[1]);
function writeProps(l, props) { for (const [k, v] of Object.entries(props)) writeProp(l, k, S.frame, v, S.ui.autokey); }
function charPoint(l, p) { const { sol } = charSolve(l); return { pt: M.pt(M.inv(sol.lm), p.x, p.y), sol }; }

TOOLS.transform = {
  cursor: 'default',
  down(p) {
    const l = curLayer(); if (!l) return; if (l.locked) { toast('Layer is locked.', 'warn'); return; }
    const f = S.frame;
    if (l.char && S.tfTarget !== 'layer') {
      const { sol, ev } = charSolve(l);
      // IK handle?
      for (const b of sol.order) if (b.ik && b.ik.on !== false) { const [, t] = boneEnds(b, sol); const sp = SCR(M.pt(sol.lm, t[0], t[1])); if (Math.hypot(sp[0] - p.sx, sp[1] - p.sy) < 12) { H.begin('Move IK target'); tf = { mode: 'ik', l, b }; S.selection.boneId = b.id; bus.emit('selection'); return; } }
      const hit = hitBone(l, S.ui.rigEdit ? { ...ev, rest: true } : ev, p.x, p.y);
      if (hit) {
        S.selection.boneId = hit; bus.emit('selection');
        const b = sol.byId.get(hit); const cp = M.pt(M.inv(sol.lm), p.x, p.y); const J = M.pt(sol.W[hit], 0, 0);
        const pose = ev.bone[hit]; const par = b.parent && sol.byId.get(b.parent);
        H.begin('Pose ' + b.name);
        const mode = p.shift ? 'bone-move' : p.alt ? 'bone-scale' : (!b.parent ? 'layer-move' : 'bone-rot');
        if (mode === 'layer-move') { tf = { mode: 'move', l, x0: ev.x, y0: ev.y, p0: [p.x, p.y] }; return; }
        tf = { mode, l, b, sol, J, a0: Math.atan2(cp[1] - J[1], cp[0] - J[0]), r0: pose.rot, x0: pose.x, y0: pose.y, sx0: pose.sx, sy0: pose.sy, cp0: cp, d0: Math.hypot(cp[0] - J[0], cp[1] - J[1]) || 1, parW: par ? sol.W[par.id] : null }; return;
      }
    }
    const g = gizmo(l); const sc = g.scene.map(SCR); const cx = (sc[0][0] + sc[2][0]) / 2, cy = (sc[0][1] + sc[2][1]) / 2;
    const topc = [(sc[0][0] + sc[1][0]) / 2, (sc[0][1] + sc[1][1]) / 2]; const dx = topc[0] - cx, dy = topc[1] - cy; const L = Math.hypot(dx, dy) || 1;
    const rh = [topc[0] + dx / L * 28, topc[1] + dy / L * 28];
    H.begin('Transform ' + l.name);
    const base = { x: g.ev.x, y: g.ev.y, rotation: g.ev.rotation, scaleX: g.ev.scaleX, scaleY: g.ev.scaleY, skewX: g.ev.skewX };
    if (Math.hypot(p.sx - rh[0], p.sy - rh[1]) < HANDLE + 3) {
      const c = [g.bb.x + g.bb.w / 2, g.bb.y + g.bb.h / 2]; const cs = M.pt(g.lm, c[0], c[1]);
      tf = { mode: 'rotate', l, base, c, cs, a0: Math.atan2(p.y - cs[1], p.x - cs[0]) }; return;
    }
    for (let i = 0; i < 4; i++) if (Math.hypot(p.sx - sc[i][0], p.sy - sc[i][1]) < HANDLE + 2) {
      const opp = (i + 2) % 4; const anchor = p.alt ? [g.bb.x + g.bb.w / 2, g.bb.y + g.bb.h / 2] : g.corners[opp];
      tf = { mode: 'scale', l, base, anchor, anchorS: M.pt(g.lm, anchor[0], anchor[1]), corner: g.corners[i], inv: M.inv(g.lm) }; return;
    }
    const inside = (() => { const q = M.pt(M.inv(g.lm), p.x, p.y); return q[0] >= g.bb.x && q[0] <= g.bb.x + g.bb.w && q[1] >= g.bb.y && q[1] <= g.bb.y + g.bb.h; })();
    if (inside || true) tf = { mode: 'move', l, x0: g.ev.x, y0: g.ev.y, p0: [p.x, p.y] };
  },
  move(p) {
    if (!tf) return; const l = tf.l;
    if (tf.mode === 'move') { writeProps(l, { x: tf.x0 + (p.x - tf.p0[0]), y: tf.y0 + (p.y - tf.p0[1]) }); }
    else if (tf.mode === 'rotate') {
      let da = Math.atan2(p.y - tf.cs[1], p.x - tf.cs[0]) - tf.a0; let rot = tf.base.rotation + da / DEG; if (p.shift) rot = Math.round(rot / 15) * 15;
      const pos = applyTransformKeeping(l, tf.c, tf.cs, { ...tf.base, rotation: rot }); writeProps(l, { rotation: rot, x: pos.x, y: pos.y });
    } else if (tf.mode === 'scale') {
      const q = M.pt(tf.inv, p.x, p.y); const ox = tf.corner[0] - tf.anchor[0] || 1, oy = tf.corner[1] - tf.anchor[1] || 1;
      let rx = (q[0] - tf.anchor[0]) / ox, ry = (q[1] - tf.anchor[1]) / oy;
      if (p.shift) { const r = Math.max(Math.abs(rx), Math.abs(ry)); rx = Math.sign(rx || 1) * r; ry = Math.sign(ry || 1) * r; }
      const sx = tf.base.scaleX * rx, sy = tf.base.scaleY * ry; const pos = applyTransformKeeping(l, tf.anchor, tf.anchorS, { ...tf.base, scaleX: sx, scaleY: sy });
      writeProps(l, { scaleX: sx, scaleY: sy, x: pos.x, y: pos.y });
    } else if (tf.mode === 'bone-rot') {
      const cp = M.pt(M.inv(tf.sol.lm), p.x, p.y); let da = (Math.atan2(cp[1] - tf.J[1], cp[0] - tf.J[0]) - tf.a0) / DEG; while (da > 180) da -= 360; while (da < -180) da += 360;
      let r = tf.r0 + da; if (p.ctrl) r = Math.round(r / 5) * 5; r = clampRot(tf.b, r); writeProp(l, `b.${tf.b.id}.rot`, S.frame, r, S.ui.autokey);
    } else if (tf.mode === 'bone-move') {
      const cp = M.pt(M.inv(tf.sol.lm), p.x, p.y); let d = [cp[0] - tf.cp0[0], cp[1] - tf.cp0[1]];
      if (tf.parW) { const m = M.inv([tf.parW[0], tf.parW[1], tf.parW[2], tf.parW[3], 0, 0]); d = M.pt(m, d[0], d[1]); }
      writeProp(l, `b.${tf.b.id}.x`, S.frame, tf.x0 + d[0], S.ui.autokey); writeProp(l, `b.${tf.b.id}.y`, S.frame, tf.y0 + d[1], S.ui.autokey);
    } else if (tf.mode === 'bone-scale') {
      const cp = M.pt(M.inv(tf.sol.lm), p.x, p.y); const k = (Math.hypot(cp[0] - tf.J[0], cp[1] - tf.J[1]) || 1) / tf.d0;
      writeProp(l, `b.${tf.b.id}.sx`, S.frame, clamp(tf.sx0 * k, 0.05, 6), S.ui.autokey); writeProp(l, `b.${tf.b.id}.sy`, S.frame, clamp(tf.sy0 * k, 0.05, 6), S.ui.autokey);
    } else if (tf.mode === 'ik') {
      const cp = M.pt(M.inv(charSolve(l).sol.lm), p.x, p.y);
      if (tf.b.pin) { tf.b.pin = { x: p.x, y: p.y }; }
      else { writeProp(l, `ik.${tf.b.id}.x`, S.frame, cp[0], S.ui.autokey); writeProp(l, `ik.${tf.b.id}.y`, S.frame, cp[1], S.ui.autokey); }
    }
    bus.emit('props'); requestRender();
  },
  up() { if (tf) { tf = null; H.end(); bus.emit('change'); } },
  overlay(g, c2s) {
    const l = curLayer(); if (!l || l.type === 'group') return; const gz = gizmo(l); const sc = gz.scene.map(SCR);
    
    g.strokeStyle = '#5ac8ff'; g.lineWidth = 1.2; g.beginPath(); sc.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.stroke();
    const cx = (sc[0][0] + sc[2][0]) / 2, cy = (sc[0][1] + sc[2][1]) / 2; const topc = [(sc[0][0] + sc[1][0]) / 2, (sc[0][1] + sc[1][1]) / 2]; const dx = topc[0] - cx, dy = topc[1] - cy; const L = Math.hypot(dx, dy) || 1;
    const rh = [topc[0] + dx / L * 28, topc[1] + dy / L * 28];
    g.beginPath(); g.moveTo(topc[0], topc[1]); g.lineTo(rh[0], rh[1]); g.stroke();
    g.fillStyle = '#fff'; g.strokeStyle = '#2a9fe0'; for (const q of sc) { g.fillRect(q[0] - 4.5, q[1] - 4.5, 9, 9); g.strokeRect(q[0] - 4.5, q[1] - 4.5, 9, 9); }
    g.beginPath(); g.arc(rh[0], rh[1], 5.5, 0, 7); g.fill(); g.stroke();
    const pv = SCR(M.pt(gz.lm, l.pivot.x, l.pivot.y)); g.strokeStyle = '#ffb454'; g.beginPath(); g.moveTo(pv[0] - 6, pv[1]); g.lineTo(pv[0] + 6, pv[1]); g.moveTo(pv[0], pv[1] - 6); g.lineTo(pv[0], pv[1] + 6); g.stroke();
  },
};

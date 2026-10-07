// Unlimited undo/redo. Structural changes are stored as compact string diffs of the project JSON;
// pixel edits as dirty-rect ImageData pairs. Memory is bounded by a (large) pixel budget only.
import { S, bus, layerById } from './state.js';
import { cels, celCanvas, touchCel, createCel } from './model.js';
import { mkCanvas } from './util.js';

const undoS = []; const redoS = [];
let pixelBytes = 0;
const PIXEL_BUDGET = 1.2 * 1024 * 1024 * 1024;
let gesture = null; // {label, before, px:[]}

function diff(a, b) {
  if (a === b) return null;
  const n = Math.min(a.length, b.length);
  let p = 0; while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0; const m = n - p;
  while (s < m && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { p, s, a: a.slice(p, a.length - s), b: b.slice(p, b.length - s) };
}
const snap = () => JSON.stringify(S.project);

function push(entry) {
  undoS.push(entry); redoS.length = 0;
  for (const e of entry.px || []) pixelBytes += e.before.data.length + e.after.data.length;
  while (pixelBytes > PIXEL_BUDGET && undoS.length > 1) {
    const old = undoS.shift();
    for (const e of old.px || []) pixelBytes -= e.before.data.length + e.after.data.length;
  }
  S.dirty = true;
  bus.emit('history');
}

function applyPx(list, which) {
  const order = which === 'before' ? [...list].reverse() : list;
  for (const e of order) {
    const cv = celCanvas(e.id, true) || (cels.get(e.id) && celCanvas(e.id, true));
    if (!cv) continue;
    cv.getContext('2d').putImageData(which === 'before' ? e.before : e.after, e.x, e.y);
    touchCel(e.id);
  }
}
function setProjectFromJSON(str) {
  const keepScene = S.project && S.project.activeScene;
  S.project = JSON.parse(str);
  if (keepScene && S.project.scenes.some((x) => x.id === keepScene)) S.project.activeScene = keepScene;
  // keep selection valid
  const sc = S.project.scenes.find((s) => s.id === S.project.activeScene) || S.project.scenes[0];
  S.project.activeScene = sc.id;
  if (!layerById(S.selection.layerId, sc)) { S.selection.layerId = null; S.selection.boneId = null; }
  S.selection.range = null;
  bus.emit('project-replaced');
  bus.emit('change'); bus.emit('render'); bus.emit('history');
}

export const H = {
  canUndo: () => undoS.length > 0,
  canRedo: () => redoS.length > 0,
  labels: () => ({ undo: undoS.length ? undoS[undoS.length - 1].label : null, redo: redoS.length ? redoS[redoS.length - 1].label : null }),
  count: () => undoS.length,
  clear() { undoS.length = 0; redoS.length = 0; pixelBytes = 0; gesture = null; bus.emit('history'); },
  /** Synchronous transaction: any structural change made by fn becomes one undo step. */
  tx(label, fn) {
    if (gesture) { const r = fn(); return r; }
    const before = snap();
    let r;
    try { r = fn(); } finally {
      const d = diff(before, snap());
      if (d) { push({ label, d, px: [] }); bus.emit('change'); bus.emit('render'); }
    }
    return r;
  },
  /** Gesture API for drags: begin(), mutate freely, end(). */
  begin(label) { if (gesture) return; gesture = { label, before: snap(), px: [] }; },
  end() {
    if (!gesture) return;
    const g = gesture; gesture = null;
    const d = diff(g.before, snap());
    if (d || g.px.length) push({ label: g.label, d, px: g.px });
    bus.emit('change'); bus.emit('render');
  },
  cancel() { if (!gesture) return; const g = gesture; gesture = null; setProjectFromJSON(g.before); applyPx(g.px, 'before'); },
  inGesture: () => !!gesture,
  /** Record a pixel edit. `beforeCanvas` is a copy of the cel before the edit; rect = dirty rect. */
  pixelEdit(label, celId, beforeCanvas, rect) {
    const cv = celCanvas(celId, true);
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(cv.width - x, Math.ceil(rect.w + (rect.x - x))), h = Math.min(cv.height - y, Math.ceil(rect.h + (rect.y - y)));
    if (w <= 0 || h <= 0) return;
    const before = beforeCanvas.getContext('2d').getImageData(x, y, w, h);
    const after = cv.getContext('2d').getImageData(x, y, w, h);
    touchCel(celId);
    const entry = { id: celId, x, y, before, after };
    if (gesture) gesture.px.push(entry);
    else push({ label, d: null, px: [entry] });
    bus.emit('render');
  },
  undo() {
    const e = undoS.pop(); if (!e) return false;
    if (e.px.length) applyPx(e.px, 'before');
    if (e.d) {
      const cur = snap();
      if (cur.slice(e.d.p, cur.length - e.d.s) !== e.d.b) { console.warn('undo diff mismatch'); redoS.length = 0; return false; }
      setProjectFromJSON(cur.slice(0, e.d.p) + e.d.a + cur.slice(cur.length - e.d.s));
    } else { bus.emit('render'); bus.emit('history'); }
    redoS.push(e); S.dirty = true; return true;
  },
  redo() {
    const e = redoS.pop(); if (!e) return false;
    if (e.px.length) applyPx(e.px, 'after');
    if (e.d) {
      const cur = snap();
      if (cur.slice(e.d.p, cur.length - e.d.s) !== e.d.a) { console.warn('redo diff mismatch'); return false; }
      setProjectFromJSON(cur.slice(0, e.d.p) + e.d.b + cur.slice(cur.length - e.d.s));
    } else { bus.emit('render'); bus.emit('history'); }
    undoS.push(e); S.dirty = true; return true;
  },
};
export function copyCanvas(src) { const c = mkCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }

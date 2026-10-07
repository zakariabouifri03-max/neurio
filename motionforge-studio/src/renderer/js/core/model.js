// Project model, runtime stores for cels/assets, and the .mfs (zip) container.
import { uid, mkCanvas, canvasToBytes, bytesToImage, deepClone } from './util.js';
import { S } from './state.js';
import * as fflate from '../../vendor/fflate.js';

export const FORMAT_VERSION = 1;
export const BLEND_MODES = [
  ['normal', 'Normal', 'source-over'], ['multiply', 'Multiply', 'multiply'], ['screen', 'Screen', 'screen'], ['overlay', 'Overlay', 'overlay'],
  ['darken', 'Darken', 'darken'], ['lighten', 'Lighten', 'lighten'], ['color-dodge', 'Color Dodge', 'color-dodge'], ['color-burn', 'Color Burn', 'color-burn'],
  ['hard-light', 'Hard Light', 'hard-light'], ['soft-light', 'Soft Light', 'soft-light'], ['difference', 'Difference', 'difference'], ['exclusion', 'Exclusion', 'exclusion'],
  ['hue', 'Hue', 'hue'], ['saturation', 'Saturation', 'saturation'], ['color', 'Color', 'color'], ['luminosity', 'Luminosity', 'luminosity'], ['add', 'Add (Linear Dodge)', 'lighter'],
];
export const blendOp = (k) => (BLEND_MODES.find((b) => b[0] === k) || BLEND_MODES[0])[2];

// ───────── runtime stores (not part of the undoable JSON) ─────────
export const cels = new Map();    // id → { id, canvas, bytes, dirty, ver, loading, last }
export const assets = new Map();  // id → { id, bytes, img, canvas, pending, audio, peaks }
let tick = 0;

export function resetStores() { cels.clear(); assets.clear(); }

// ───────── cels ─────────
export function createCel() {
  const id = uid('cel');
  cels.set(id, { id, canvas: null, bytes: null, dirty: false, ver: 0, loading: null, last: ++tick });
  return id;
}
export function celCanvas(id, create = false) {
  const c = cels.get(id);
  if (!c) return null;
  c.last = ++tick;
  if (c.canvas) return c.canvas;
  if (c.bytes && !c.loading) { loadCel(c); return null; }
  if (c.loading) return null;
  if (create) { c.canvas = mkCanvas(S.project.width, S.project.height); return c.canvas; }
  return null;
}
async function loadCel(c) {
  c.loading = (async () => {
    try {
      const img = await bytesToImage(c.bytes);
      const cv = mkCanvas(S.project.width, S.project.height);
      cv.getContext('2d').drawImage(img, 0, 0);
      c.canvas = cv;
    } catch (e) { console.warn('cel decode failed', c.id, e); c.canvas = mkCanvas(S.project.width, S.project.height); }
    c.loading = null; c.ver++;
    import('./state.js').then(({ bus }) => bus.emit('render'));
  })();
}
export function touchCel(id) { const c = cels.get(id); if (c) { c.ver++; c.dirty = true; c.bytes = null; } }
export function cloneCel(id) {
  const nid = createCel();
  const src = id && cels.get(id);
  if (src) {
    const sc = celCanvas(id);
    if (sc) { const dc = celCanvas(nid, true); dc.getContext('2d').drawImage(sc, 0, 0); touchCel(nid); }
    else if (src.bytes) { cels.get(nid).bytes = src.bytes; }
  }
  return nid;
}
export function celIsEmpty(id) { const c = cels.get(id); return !c || (!c.canvas && !c.bytes); }
export async function celBytes(id) {
  const c = cels.get(id);
  if (!c) return null;
  if (c.bytes && !c.dirty) return c.bytes;
  if (!c.canvas) return c.bytes || null;
  c.bytes = await canvasToBytes(c.canvas); c.dirty = false;
  return c.bytes;
}
export async function preloadCels(ids, onProgress) {
  let n = 0;
  for (const id of ids) {
    celCanvas(id);
    const c = cels.get(id);
    if (c && c.loading) await c.loading;
    onProgress && onProgress(++n, ids.length);
  }
}
/** Memory management: encode & drop least-recently-used canvases beyond the budget. */
let trimming = false;
export async function trimMemory(maxBytes = 900 * 1024 * 1024, keepIds = new Set()) {
  if (trimming || !S.project) return;
  const per = S.project.width * S.project.height * 4;
  const live = [...cels.values()].filter((c) => c.canvas);
  if (live.length * per <= maxBytes) return;
  trimming = true;
  try {
    live.sort((a, b) => a.last - b.last);
    let over = live.length * per - maxBytes * 0.8;
    for (const c of live) {
      if (over <= 0) break;
      if (keepIds.has(c.id)) continue;
      await celBytes(c.id);
      if (c.bytes && !c.dirty) { c.canvas = null; over -= per; }
    }
  } finally { trimming = false; }
}

// ───────── assets ─────────
export function addAsset({ name, mime, bytes, kind, w, h, img, canvas, meta }) {
  const id = uid('as');
  assets.set(id, { id, bytes: bytes || null, img: img || canvas || null, canvas: canvas || null, pending: null });
  const rec = { id, name, mime: mime || 'image/png', kind: kind || 'image', w: w || 0, h: h || 0, ...(meta || {}) };
  S.project.assets.push(rec);
  return rec;
}
export function addCanvasAsset(canvas, name, meta) {
  return addAsset({ name, mime: 'image/png', kind: 'image', w: canvas.width, h: canvas.height, canvas, meta });
}
export const assetMeta = (id) => S.project && S.project.assets.find((a) => a.id === id);
export async function assetBytes(id) {
  const a = assets.get(id);
  if (!a) return null;
  if (a.bytes) return a.bytes;
  if (a.canvas) { a.bytes = await canvasToBytes(a.canvas); return a.bytes; }
  return null;
}
/** Returns a drawable (canvas/image) or null (and starts decoding). */
export function assetImage(id) {
  const a = assets.get(id);
  if (!a) return null;
  if (a.img) return a.img;
  if (a.bytes && !a.pending) {
    const meta = assetMeta(id);
    a.pending = bytesToImage(a.bytes, (meta && meta.mime) || 'image/png').then((img) => { a.img = img; import('./state.js').then(({ bus }) => bus.emit('render')); }).catch((e) => console.warn('asset decode', e));
  }
  return null;
}
export async function loadAssetImage(id) { assetImage(id); const a = assets.get(id); if (a && a.pending) await a.pending; return a ? a.img : null; }

// ───────── layers / scenes / projects ─────────
export function newLayer(type, name, cat) {
  const P = S.project;
  const W = P ? P.width : 1280, H = P ? P.height : 720;
  const l = {
    id: uid('ly'), name: name || 'Layer', type, cat: cat || (type === 'character' ? 'character' : 'draw'),
    visible: true, locked: false, blend: 'normal', clip: false, alphaLock: false, expanded: false,
    base: { x: W / 2, y: H / 2, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, opacity: 1 },
    pivot: { x: W / 2, y: H / 2 }, tracks: {},
  };
  if (type === 'draw') l.cels = [{ f: 0, id: createCel() }];
  if (type === 'group') { l.children = []; l.expanded = true; }
  if (type === 'image') l.image = null;
  if (type === 'character') l.char = null;
  return l;
}
export function newScene(name, W, H, duration = 48) {
  return {
    id: uid('sc'), name: name || 'Scene 1', duration, layers: [], shots: [], audio: [], markers: [], aiLog: [], bg: { color: '#ffffff', transparent: false },
    camera: { base: { x: W / 2, y: H / 2, zoom: 1, rotation: 0 }, tracks: {}, follow: null, shake: null },
  };
}
export function newProject({ name = 'Untitled', width = 1280, height = 720, fps = 24, bg = '#ffffff' } = {}) {
  resetStores();
  const sc = newScene('Scene 1', width, height, fps * 2);
  sc.bg.color = bg;
  const P = {
    format: 'mfs', version: FORMAT_VERSION, id: uid('prj'), name, created: Date.now(), modified: Date.now(),
    width, height, fps, scenes: [sc], activeScene: sc.id, assets: [],
    settings: { onion: { enabled: false, prev: 2, next: 1, opacity: 0.4, prevColor: '#ff5a5a', nextColor: '#4cc3ff', tint: true }, exportPrefs: {} },
  };
  S.project = P;
  return P;
}

export async function collectCelIds(P) {
  const ids = new Set();
  for (const sc of P.scenes) { const walk = (list) => { for (const l of list) { if (l.cels) for (const c of l.cels) if (c.id) ids.add(c.id); if (l.children) walk(l.children); } }; walk(sc.layers); }
  return [...ids];
}

/** Serialize to an .mfs container (zip). `thumb` is an optional PNG byte array. */
export async function serializeProject(thumb) {
  const P = S.project;
  P.modified = Date.now();
  const files = {};
  const lvl0 = { level: 0 }; // pngs are already compressed
  const celIds = await collectCelIds(P);
  const celList = [];
  for (const id of celIds) {
    const b = await celBytes(id);
    if (b && b.length && cels.get(id) && !(cels.get(id).canvas && isBlank(cels.get(id).canvas))) { files[`cels/${id}.png`] = [b, lvl0]; celList.push(id); }
  }
  for (const a of P.assets) {
    const b = await assetBytes(a.id);
    if (b) { files[`assets/${a.id}`] = [b, lvl0]; }
  }
  const json = deepClone(P);
  json.celsPresent = celList;
  files['project.json'] = [new TextEncoder().encode(JSON.stringify(json)), { level: 6 }];
  files['mimetype'] = [new TextEncoder().encode('application/x-motionforge-project'), lvl0];
  if (thumb) files['thumbnail.png'] = [thumb, lvl0];
  return fflate.zipSync(files);
}
function isBlank(canvas) {
  // cheap blank test on a downscaled copy
  try {
    const t = mkCanvas(32, 32); const g = t.getContext('2d'); g.drawImage(canvas, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  } catch { return false; }
}
export function migrate(P) {
  P.assets = P.assets || [];
  P.settings = P.settings || {};
  P.settings.onion = Object.assign({ enabled: false, prev: 2, next: 1, opacity: 0.4, prevColor: '#ff5a5a', nextColor: '#4cc3ff', tint: true }, P.settings.onion);
  for (const sc of P.scenes) {
    sc.shots = sc.shots || []; sc.audio = sc.audio || []; sc.markers = sc.markers || []; sc.aiLog = sc.aiLog || [];
    sc.bg = sc.bg || { color: '#ffffff', transparent: false };
    sc.camera = sc.camera || { base: { x: P.width / 2, y: P.height / 2, zoom: 1, rotation: 0 }, tracks: {}, follow: null, shake: null };
  }
  return P;
}
export async function loadProject(bytes, onProgress) {
  const files = fflate.unzipSync(bytes);
  if (!files['project.json']) throw new Error('Not a valid MotionForge project (project.json missing).');
  const P = JSON.parse(new TextDecoder().decode(files['project.json']));
  if (P.format !== 'mfs') throw new Error('Not a MotionForge project file.');
  if (P.version > FORMAT_VERSION) throw new Error('This project was saved by a newer version of MotionForge Studio.');
  resetStores();
  S.project = migrate(P);
  const present = new Set(P.celsPresent || []);
  delete P.celsPresent;
  const ids = await collectCelIds(P);
  for (const id of ids) {
    const f = files[`cels/${id}.png`];
    cels.set(id, { id, canvas: null, bytes: f || null, dirty: false, ver: 0, loading: null, last: ++tick });
  }
  for (const a of P.assets) { const f = files[`assets/${a.id}`]; assets.set(a.id, { id: a.id, bytes: f || null, img: null, canvas: null, pending: null }); }
  const keepFirst = ids.slice(0, 64);
  await preloadCels(keepFirst, onProgress);
  for (const a of P.assets) if (a.kind === 'image') assetImage(a.id);
  const ps = P.assets.filter((a) => a.kind === 'image').map((a) => loadAssetImage(a.id));
  await Promise.all(ps);
  return P;
}
export async function thumbnailOf(canvas) {
  const t = mkCanvas(320, Math.round(320 * canvas.height / canvas.width));
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return canvasToBytes(t);
}
/** Pack/unpack a library snippet (assets + a JSON payload) */
export async function packSnippet(payload, assetIds) {
  const files = {};
  for (const id of assetIds) { const b = await assetBytes(id); if (b) files[`assets/${id}`] = [b, { level: 0 }]; }
  files['payload.json'] = [new TextEncoder().encode(JSON.stringify({ payload, assets: assetIds.map((id) => assetMeta(id)).filter(Boolean) })), { level: 6 }];
  return fflate.zipSync(files);
}
export function unpackSnippet(bytes) {
  const files = fflate.unzipSync(bytes);
  const j = JSON.parse(new TextDecoder().decode(files['payload.json']));
  return { payload: j.payload, assets: j.assets, files };
}

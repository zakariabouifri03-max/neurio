// Easing, keyframe tracks and per-layer evaluation.
import { clamp, lerp, DEG } from './util.js';

export const EASE_LIST = [
  ['linear', 'Linear'], ['easeIn', 'Ease In'], ['easeOut', 'Ease Out'], ['easeInOut', 'Ease In Out'],
  ['bounce', 'Bounce'], ['elastic', 'Elastic'], ['back', 'Back'], ['bezier', 'Custom Bezier'], ['hold', 'Hold (stepped)'],
];
const bounceOut = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
export function solveBezier(x1, y1, x2, y2, x) {
  // CSS-style cubic-bezier through (0,0) (x1,y1) (x2,y2) (1,1): find t for x, return y
  if (x <= 0) return 0; if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xe = ((ax * t + bx) * t + cx) * t - x;
    if (Math.abs(xe) < 1e-6) break;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= xe / d;
  }
  let lo = 0, hi = 1;
  if (t < 0 || t > 1) {
    t = x;
    for (let i = 0; i < 24; i++) { const xe = ((ax * t + bx) * t + cx) * t; if (xe < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  }
  return ((ay * t + by) * t + cy) * t;
}
export const EASE = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),
  bounce: bounceOut,
  elastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  hold: (t) => (t >= 1 ? 1 : 0),
};
export function ease(t, key, bz) {
  t = clamp(t, 0, 1);
  if (key === 'bezier') { const b = bz || [0.25, 0.1, 0.25, 1]; return solveBezier(b[0], b[1], b[2], b[3], t); }
  return (EASE[key] || EASE.linear)(t);
}

// ── Tracks: sorted arrays of { f, v, e, bz } ──
export function trackIndex(keys, f) { // last index with keys[i].f <= f, else -1
  let lo = 0, hi = keys.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid].f <= f) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}
export function evalTrack(keys, f, dflt) {
  if (!keys || !keys.length) return dflt;
  const i = trackIndex(keys, f);
  if (i < 0) return keys[0].v;
  const a = keys[i];
  if (i === keys.length - 1 || a.f === f) return a.v;
  const b = keys[i + 1];
  const t = (f - a.f) / (b.f - a.f);
  return lerp(a.v, b.v, ease(t, a.e || 'easeInOut', a.bz));
}
export function setKey(keys, f, v, e, bz) {
  const i = trackIndex(keys, f);
  if (i >= 0 && keys[i].f === f) { keys[i].v = v; if (e) keys[i].e = e; if (bz) keys[i].bz = bz; return keys[i]; }
  const k = { f, v, e: e || (i >= 0 && keys[i].e) || 'easeInOut' };
  if (bz) k.bz = bz; else if (k.e === 'bezier' && i >= 0 && keys[i].bz) k.bz = keys[i].bz.slice();
  keys.splice(i + 1, 0, k);
  return k;
}
export function removeKey(keys, f) { const i = trackIndex(keys, f); if (i >= 0 && keys[i].f === f) { keys.splice(i, 1); return true; } return false; }
export function getKey(keys, f) { if (!keys) return null; const i = trackIndex(keys, f); return i >= 0 && keys[i].f === f ? keys[i] : null; }

export const PROP_DEFAULTS = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, opacity: 1, mouth: 0 };
export function propDefault(name) {
  if (name in PROP_DEFAULTS) return PROP_DEFAULTS[name];
  if (/\.(sx|sy)$/.test(name)) return 1;
  return 0;
}
export const LAYER_PROPS = [
  ['x', 'Position X', 1], ['y', 'Position Y', 1], ['rotation', 'Rotation', 1], ['scaleX', 'Scale X', 0.01], ['scaleY', 'Scale Y', 0.01], ['skewX', 'Skew', 1], ['opacity', 'Opacity', 0.01],
];
export function layerBase(layer, name) {
  if (layer.base && name in layer.base) return layer.base[name];
  return propDefault(name);
}
export function layerProp(layer, name, f) {
  const tr = layer.tracks && layer.tracks[name];
  if (tr && tr.length) return evalTrack(tr, f, layerBase(layer, name));
  return layerBase(layer, name);
}
export function hasKeys(layer, name) { const t = layer.tracks && layer.tracks[name]; return !!(t && t.length); }

/** Write a property at frame f. autokey → key at f (anchoring earlier frames with the previous value). */
export function writeProp(layer, name, f, v, autokey, ease0) {
  layer.tracks = layer.tracks || {}; layer.base = layer.base || {};
  const has = hasKeys(layer, name);
  if (autokey || has) {
    const tr = (layer.tracks[name] = layer.tracks[name] || []);
    if (!tr.length && f > 0) setKey(tr, 0, layerBase(layer, name), ease0);
    setKey(tr, f, v, ease0);
  } else layer.base[name] = v;
}
export function layerHasAnyKey(layer, f) {
  if (!layer.tracks) return false;
  for (const k in layer.tracks) if (getKey(layer.tracks[k], f)) return true;
  return false;
}
export function layerKeyFrames(layer) {
  const s = new Set();
  if (layer.tracks) for (const k in layer.tracks) for (const kk of layer.tracks[k]) s.add(kk.f);
  return [...s].sort((a, b) => a - b);
}

// ── Cel exposure (drawing frames) ──
// layer.cels = [{f, id}] sorted. id may be null for explicit blank keyframes.
export function celIndexAt(layer, f) { return layer.cels ? trackIndex(layer.cels, f) : -1; }
export function celAt(layer, f) { const i = celIndexAt(layer, f); return i < 0 ? null : layer.cels[i]; }
export function celSpan(layer, i, sceneDur) { // [start,end) exposure
  const s = layer.cels[i].f; const e = i + 1 < layer.cels.length ? layer.cels[i + 1].f : Math.max(sceneDur, s + 1);
  return [s, e];
}

// ── Camera ──
export function shakeOffset(seed, f, amp, freq) {
  const n = (k) => Math.sin((f * freq + seed) * 12.9898 + k * 78.233) * 43758.5453 % 1;
  return [n(1) * amp, n(2) * amp, n(3) * amp * 0.05];
}
export function cameraAt(scene, f, W, H, lookup) {
  const c = scene.camera;
  let x = layerProp(c, 'x', f), y = layerProp(c, 'y', f), zoom = layerProp(c, 'zoom', f), rot = layerProp(c, 'rotation', f);
  const fol = c.follow;
  if (fol && fol.layerId && lookup) {
    const lag = Math.max(1, fol.lag || 1);
    let sx = 0, sy = 0; let n = 0;
    for (let k = 0; k < lag; k++) { const p = lookup(fol.layerId, Math.max(0, f - k)); if (p) { sx += p[0]; sy += p[1]; n++; } }
    if (n) { x = sx / n + (fol.ox || 0); y = sy / n + (fol.oy || 0); }
  }
  const sh = c.shake;
  if (sh && sh.amp > 0 && f >= sh.start && f <= sh.start + sh.len) {
    const fall = 1 - (f - sh.start) / Math.max(1, sh.len);
    const o = shakeOffset(sh.seed || 1, f, sh.amp * (sh.decay === false ? 1 : fall), sh.freq || 1.7);
    x += o[0]; y += o[1]; rot += o[2];
  }
  return { x, y, zoom: Math.max(0.05, zoom), rot };
}
export function cameraMatrix(cam, W, H) {
  // scene → output
  const c = Math.cos(-cam.rot * DEG), s = Math.sin(-cam.rot * DEG);
  const z = cam.zoom;
  const a = c * z, b = s * z, cc = -s * z, d = c * z;
  const e = W / 2 - (a * cam.x + cc * cam.y);
  const f = H / 2 - (b * cam.x + d * cam.y);
  return [a, b, cc, d, e, f];
}
export function shotAt(scene, f) {
  const sh = scene.shots || [];
  for (const s of sh) if (f >= s.start && f <= s.end) return s;
  return null;
}

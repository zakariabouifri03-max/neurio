// Character rig: layer evaluation, forward kinematics, IK (CCD), pinning, drawing and hit-testing.
import { M, DEG, clamp } from './util.js';
import { layerProp, layerBase } from './anim.js';
import { assetImage } from './model.js';

export const VISEMES = ['rest', 'A', 'E', 'I', 'O', 'U', 'M', 'F', 'L'];

/** Evaluate all animatable properties of a layer at frame f. */
export function evalLayer(layer, f) {
  const ev = {
    x: layerProp(layer, 'x', f), y: layerProp(layer, 'y', f), rotation: layerProp(layer, 'rotation', f),
    scaleX: layerProp(layer, 'scaleX', f), scaleY: layerProp(layer, 'scaleY', f), skewX: layerProp(layer, 'skewX', f),
    opacity: layerProp(layer, 'opacity', f),
  };
  if (layer.char) {
    ev.bone = {}; ev.ik = {};
    for (const b of layer.char.bones) {
      const id = b.id;
      ev.bone[id] = {
        rot: layerProp(layer, `b.${id}.rot`, f), x: layerProp(layer, `b.${id}.x`, f), y: layerProp(layer, `b.${id}.y`, f),
        sx: layerProp(layer, `b.${id}.sx`, f), sy: layerProp(layer, `b.${id}.sy`, f),
      };
      if (b.ik) ev.ik[id] = { x: layerProp(layer, `ik.${id}.x`, f), y: layerProp(layer, `ik.${id}.y`, f) };
    }
    ev.mouth = Math.round(layerProp(layer, 'mouth', f)) | 0;
  }
  return ev;
}
export function layerMatrix(layer, ev) {
  let m = M.T(ev.x, ev.y);
  m = M.mul(m, M.R(ev.rotation * DEG));
  if (ev.skewX) m = M.mul(m, M.K(ev.skewX * DEG));
  m = M.mul(m, M.S(ev.scaleX, ev.scaleY));
  return M.mul(m, M.T(-layer.pivot.x, -layer.pivot.y));
}

export function boneOrder(char) {
  const byId = new Map(char.bones.map((b) => [b.id, b]));
  const out = []; const seen = new Set();
  const visit = (b) => { if (seen.has(b.id)) return; seen.add(b.id); if (b.parent && byId.has(b.parent)) visit(byId.get(b.parent)); out.push(b); };
  char.bones.forEach(visit);
  return out;
}
export const clampRot = (b, r) => {
  if (b.lockRot) return 0;
  if (b.min != null && r < b.min) r = b.min;
  if (b.max != null && r > b.max) r = b.max;
  return r;
};
function fk(order, byId, pose, rots) {
  const W = {};
  for (const b of order) {
    const p = pose[b.id] || {};
    const par = b.parent && byId.get(b.parent);
    const rot = rots && b.id in rots ? rots[b.id] : clampRot(b, p.rot || 0);
    let l = M.T(b.hx - (par ? par.hx : 0) + (p.x || 0), b.hy - (par ? par.hy : 0) + (p.y || 0));
    if (rot) l = M.mul(l, M.R(rot * DEG));
    const sx = p.sx == null ? 1 : p.sx, sy = p.sy == null ? 1 : p.sy;
    if (sx !== 1 || sy !== 1) l = M.mul(l, M.S(sx, sy));
    W[b.id] = par && W[par.id] ? M.mul(W[par.id], l) : l;
  }
  return W;
}
export const tailRest = (b) => [b.hx + b.len * Math.cos(b.a0 * DEG), b.hy + b.len * Math.sin(b.a0 * DEG)];
const tailWorld = (b, W) => M.pt(W[b.id], b.len * Math.cos(b.a0 * DEG), b.len * Math.sin(b.a0 * DEG));

/** Full pose solve: FK → IK/pins → final world matrices. Returns { W (joint frames), img (image matrices), lm (layer matrix) } */
export function solveCharacter(layer, ev) {
  const char = layer.char;
  const lm = layerMatrix(layer, ev);
  const order = boneOrder(char);
  const byId = new Map(order.map((b) => [b.id, b]));
  let rots = null;
  if (ev.rest) ev = { ...ev, bone: {}, ik: {} };
  const iks = ev.rest ? [] : order.filter((b) => b.ik && (b.ik.on !== false));
  let W = fk(order, byId, ev.bone, null);
  if (iks.length) {
    rots = {};
    for (const b of order) rots[b.id] = clampRot(b, (ev.bone[b.id] && ev.bone[b.id].rot) || 0);
    const inv = M.inv(lm);
    for (const b of iks) {
      let target;
      if (b.pin) target = M.pt(inv, b.pin.x, b.pin.y);
      else { const t = ev.ik[b.id]; target = t ? [t.x, t.y] : tailRest(b); }
      const chain = [b]; let cur = b;
      for (let i = 1; i < (b.ik.chain || 2); i++) { const p = cur.parent && byId.get(cur.parent); if (!p) break; chain.push(p); cur = p; }
      for (let it = 0; it < 24; it++) {
        let moved = 0;
        for (const k of chain) {
          if (k.lockRot) continue;
          const o = M.pt(W[k.id], 0, 0);
          const tip = tailWorld(b, W);
          const a1 = Math.atan2(tip[1] - o[1], tip[0] - o[0]);
          const a2 = Math.atan2(target[1] - o[1], target[0] - o[0]);
          let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          const before = rots[k.id];
          // mirrored scale flips rotation direction
          const w = W[k.id]; const det = w[0] * w[3] - w[1] * w[2];
          rots[k.id] = clampRot(k, before + (det < 0 ? -1 : 1) * (da / DEG));
          moved += Math.abs(rots[k.id] - before);
          W = fk(order, byId, ev.bone, rots);
        }
        const tip = tailWorld(b, W);
        if (Math.hypot(tip[0] - target[0], tip[1] - target[1]) < 0.25 || moved < 1e-4) break;
      }
    }
  }
  const img = {};
  for (const b of order) img[b.id] = M.mul(W[b.id], M.T(-b.hx, -b.hy));
  return { W, img, lm, order, byId, rots };
}

export function boneImage(b, ev) {
  if (!b.img) return null;
  let aid = b.img.assetId;
  if (b.visemes && ev && ev.mouth != null) aid = b.visemes[VISEMES[ev.mouth]] || b.visemes.rest || aid;
  return aid;
}
export function drawCharacter(ctx, layer, ev, baseMatrix, opts = {}) {
  const sol = solveCharacter(layer, ev);
  const bones = [...sol.order].filter((b) => b.img && !b.hidden).sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const b of bones) {
    const aid = boneImage(b, ev);
    const im = assetImage(aid);
    if (!im) continue;
    const m = M.mul(baseMatrix, M.mul(sol.lm, sol.img[b.id]));
    ctx.save();
    M.set(ctx, m);
    ctx.drawImage(im, b.img.x, b.img.y, b.img.w, b.img.h);
    ctx.restore();
  }
  return sol;
}

// ── hit-testing ──
const alphaCache = new Map();
function alphaAt(aid, u, v) { // u,v in 0..1
  let c = alphaCache.get(aid);
  const im = assetImage(aid);
  if (!im) return 0;
  if (!c) {
    const w = Math.min(256, im.width || im.naturalWidth || 1), hh = Math.min(256, im.height || im.naturalHeight || 1);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, hh);
    c = { w, h: hh, d: g.getImageData(0, 0, w, hh).data }; alphaCache.set(aid, c);
  }
  const x = clamp(Math.floor(u * c.w), 0, c.w - 1), y = clamp(Math.floor(v * c.h), 0, c.h - 1);
  return c.d[(y * c.w + x) * 4 + 3];
}
/** Pick topmost bone whose image has opaque pixel under scene point (sx,sy). */
export function hitBone(layer, ev, sx, sy) {
  const sol = solveCharacter(layer, ev);
  const p = M.pt(M.inv(sol.lm), sx, sy);
  const bones = [...sol.order].filter((b) => b.img && !b.hidden).sort((a, b) => (b.z || 0) - (a.z || 0));
  for (const b of bones) {
    const q = M.pt(M.inv(sol.img[b.id]), p[0], p[1]);
    const u = (q[0] - b.img.x) / b.img.w, v = (q[1] - b.img.y) / b.img.h;
    if (u < 0 || v < 0 || u > 1 || v > 1) continue;
    if (alphaAt(boneImage(b, ev), u, v) > 24) return b.id;
  }
  return null;
}
export function clearAlphaCache(aid) { if (aid) alphaCache.delete(aid); else alphaCache.clear(); }

export function bonesChildren(char, id) { return char.bones.filter((b) => b.parent === id); }
export function boneDescendants(char, id, out = []) { for (const c of bonesChildren(char, id)) { out.push(c.id); boneDescendants(char, c.id, out); } return out; }
export function roleMap(char) { const m = {}; for (const b of char.bones) if (b.role) m[b.role] = b; return m; }
export const REST_DEFAULT = (name) => layerBase({ base: {} }, name);

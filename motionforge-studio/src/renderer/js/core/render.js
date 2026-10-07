// Scene compositor: layers, groups, blend modes, clipping, onion skin, camera.
import { S, scene as curScene, layerById } from './state.js';
import { celCanvas, assetImage, blendOp, cels } from './model.js';
import { celAt, celIndexAt, cameraAt, cameraMatrix } from './anim.js';
import { evalLayer, layerMatrix, drawCharacter } from './rig.js';
import { M, mkCanvas } from './util.js';

const pool = [];
let poolUse = 0;
function temp(w, h) {
  let c = pool[poolUse];
  if (!c) { c = mkCanvas(w, h); pool[poolUse] = c; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  poolUse++;
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return c;
}
const release = () => { poolUse = Math.max(0, poolUse - 1); };

const tintCache = new Map();
function tinted(canvas, key, color) {
  const k = key + '|' + color;
  let t = tintCache.get(k);
  if (t) return t;
  t = mkCanvas(canvas.width, canvas.height); const g = t.getContext('2d');
  g.drawImage(canvas, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, t.width, t.height);
  tintCache.set(k, t);
  if (tintCache.size > 24) tintCache.delete(tintCache.keys().next().value);
  return t;
}

/** Draw the raw content of one layer (no opacity/blend) with matrix `base`. */
function drawContent(ctx, layer, f, base, ev, opts, depthInfo) {
  if (layer.type === 'draw') {
    const c = celAt(layer, f);
    if (!c || !c.id) return;
    const cv = celCanvas(c.id);
    if (!cv) return;
    ctx.save(); M.set(ctx, M.mul(base, layerMatrix(layer, ev)));
    const lv = S.live && S.live.celId === c.id ? S.live : null;
    if (lv && lv.erase) { const t = temp(cv.width, cv.height); const tg = t.getContext('2d'); tg.drawImage(cv, 0, 0); tg.globalAlpha = lv.opacity; tg.globalCompositeOperation = 'destination-out'; tg.drawImage(lv.buf, 0, 0); ctx.drawImage(t, 0, 0); release(); }
    else if (lv && lv.alphaLock) { const t = temp(cv.width, cv.height); const tg = t.getContext('2d'); tg.drawImage(cv, 0, 0); tg.globalAlpha = lv.opacity; tg.globalCompositeOperation = 'source-atop'; tg.drawImage(lv.buf, 0, 0); ctx.drawImage(t, 0, 0); release(); }
    else { ctx.drawImage(cv, 0, 0); if (lv) { ctx.globalAlpha *= lv.opacity; ctx.drawImage(lv.buf, 0, 0); } }
    if (S.floating && S.floating.celId === c.id) { ctx.globalAlpha = 1; ctx.drawImage(S.floating.canvas, S.floating.x, S.floating.y); }
    ctx.restore();
  } else if (layer.type === 'image' && layer.image) {
    const im = assetImage(layer.image.assetId);
    if (!im) return;
    ctx.save(); M.set(ctx, M.mul(base, layerMatrix(layer, ev)));
    ctx.drawImage(im, layer.image.x, layer.image.y, layer.image.w, layer.image.h); ctx.restore();
  } else if (layer.type === 'character' && layer.char) {
    drawCharacter(ctx, layer, opts.restLayerId === layer.id ? { ...ev, rest: true } : ev, base, opts);
  } else if (layer.type === 'group') {
    drawList(ctx, layer.children, f, M.mul(base, layerMatrix(layer, ev)), opts, depthInfo);
  }
}

function compositeLayer(ctx, layer, f, base, opts, depthInfo, maskCanvas) {
  const ev = evalLayer(layer, f);
  const needTemp = layer.type === "group" || maskCanvas;
  const op = blendOp(layer.blend);
  if (ev.opacity <= 0.001) return;
  if (!needTemp) {
    ctx.save(); ctx.globalAlpha = Math.min(1, ev.opacity); ctx.globalCompositeOperation = op;
    drawContent(ctx, layer, f, base, ev, opts, depthInfo); ctx.restore();
    return;
  }
  const t = temp(ctx.canvas.width, ctx.canvas.height); const tg = t.getContext('2d');
  drawContent(tg, layer, f, base, ev, opts, depthInfo);
  if (maskCanvas) { tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(maskCanvas, 0, 0); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, ev.opacity); ctx.globalCompositeOperation = op; ctx.drawImage(t, 0, 0); ctx.restore();
  release();
}

function drawGhosts(ctx, layer, f, base, opts) {
  const o = opts.onion;
  if (!o || !o.enabled || !opts.onionLayerId || layer.id !== opts.onionLayerId) return;
  const draw = (k, dir) => {
    const dist = k; const alpha = o.opacity * (1 - (dist - 1) / (Math.max(o.prev, o.next) + 1));
    const color = dir < 0 ? o.prevColor : o.nextColor;
    ctx.save(); ctx.globalAlpha = Math.max(0.04, alpha);
    if (layer.type === 'draw') {
      const i = celIndexAt(layer, f); const cur = i >= 0 ? layer.cels[i] : null;
      const j = i + dir * k; // distinct drawings
      if (j < 0 || j >= layer.cels.length) { ctx.restore(); return; }
      const c = layer.cels[j]; if (!c.id || (cur && c.id === cur.id)) { ctx.restore(); return; }
      const cv = celCanvas(c.id); if (!cv) { ctx.restore(); return; }
      const ff = c.f; const ev = evalLayer(layer, ff);
      M.set(ctx, M.mul(base, layerMatrix(layer, ev)));
      const meta = cels.get(c.id);
      ctx.drawImage(o.tint ? tinted(cv, c.id + ':' + (meta ? meta.ver : 0), color) : cv, 0, 0);
    } else if (layer.type === 'character') {
      const ff = f + dir * k; if (ff < 0) { ctx.restore(); return; }
      const t = temp(ctx.canvas.width, ctx.canvas.height); const tg = t.getContext('2d');
      drawCharacter(tg, layer, evalLayer(layer, ff), base, { });
      if (o.tint) { tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, t.width, t.height); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(t, 0, 0); release();
    }
    ctx.restore();
  };
  for (let k = o.prev; k >= 1; k--) draw(k, -1);
  for (let k = o.next; k >= 1; k--) draw(k, 1);
}

function drawList(ctx, list, f, base, opts, depthInfo) {
  for (let i = 0; i < list.length; i++) {
    const layer = list[i];
    if (layer.clip) continue;
    const clips = [];
    for (let j = i + 1; j < list.length && list[j].clip; j++) clips.push(list[j]);
    const hasClip = clips.some((c) => c.visible);
    if (!layer.visible && !hasClip) continue;
    if (opts.onionLayerId) {
      // ghosts go under the active layer (or under its clipping base)
      if (layer.id === opts.onionLayerId) drawGhosts(ctx, layer, f, base, opts);
      else if (clips.some((c) => c.id === opts.onionLayerId)) { /* ghost drawn with the clipped layer below */ }
    }
    if (!hasClip) { compositeLayer(ctx, layer, f, base, opts, depthInfo, null); continue; }
    // base layer rendered alone → mask
    const A = temp(ctx.canvas.width, ctx.canvas.height); const ag = A.getContext('2d');
    drawContent(ag, layer, f, base, evalLayer(layer, f), opts, depthInfo);
    if (layer.visible) { const ev = evalLayer(layer, f); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, ev.opacity); ctx.globalCompositeOperation = blendOp(layer.blend); ctx.drawImage(A, 0, 0); ctx.restore(); }
    for (const c of clips) {
      if (!c.visible) continue;
      if (opts.onionLayerId === c.id) drawGhosts(ctx, c, f, base, opts);
      compositeLayer(ctx, c, f, base, opts, depthInfo, A);
    }
    release();
  }
}

export function layerPosLookup(sc) {
  return (id, f) => { const l = layerById(id, sc); if (!l) return null; const ev = evalLayer(l, f); return [ev.x, ev.y]; };
}
export function currentCamera(sc, f) { return cameraAt(sc, f, S.project.width, S.project.height, layerPosLookup(sc)); }

/**
 * Render `sc` at frame f into ctx (whose canvas is the output surface).
 * opts: { camera, scale, transparent, onion, onionLayerId, bg }
 */
export function renderScene(ctx, sc, f, opts = {}) {
  const P = S.project; const W = P.width, H = P.height;
  const s = opts.scale || 1;
  const cv = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = opts.smooth !== false; ctx.imageSmoothingQuality = 'high';
  if (opts.transparent) ctx.clearRect(0, 0, cv.width, cv.height);
  else { ctx.fillStyle = sc.bg.color || '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  let base = M.S(s, s);
  if (opts.camera) base = M.mul(base, cameraMatrix(currentCamera(sc, f), W, H));
  poolUse = 0;
  drawList(ctx, sc.layers, f, base, opts, null);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
export function makeFrameCanvas(sc, f, W, H, opts = {}) {
  const c = mkCanvas(W, H); const g = c.getContext('2d');
  renderScene(g, sc, f, { ...opts, scale: W / S.project.width });
  return c;
}
export function sceneCamMatrix(sc, f, scale = 1) { return M.mul(M.S(scale, scale), cameraMatrix(currentCamera(sc, f), S.project.width, S.project.height)); }

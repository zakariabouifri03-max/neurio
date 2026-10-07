// Montaj Pro — the compositor (used by BOTH preview and export => WYSIWYG)
import { clamp } from './util.js';
import { clipTransform, buildFilter, drawGrade, transitionActive, compositeTransition, applyChromaKey, applySharpen, grainCanvas } from './effects.js';
import { clipSourceTime, clipLocalAt, isVisual, trackClipsSorted, trackById } from './state.js';

const pool = [];
export function getCanvas(W, H) {
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    if (c.width === W && c.height === H && !c.__busy) { c.__busy = true; return c; }
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  pool.push(c); c.__busy = true;
  return c;
}
export function releaseCanvas(c) { c.__busy = false; }

export function clearPool() { pool.length = 0; }

// ---------- text layout ----------
const meas = document.createElement('canvas').getContext('2d');
const layoutCache = new Map();
export function layoutText(text) {
  const key = JSON.stringify([text.content, text.font, text.size, text.weight, text.lineHeight, text.maxWidth, text.letterSpacing, text.rtl, text.width]);
  if (layoutCache.has(key)) return layoutCache.get(key);
  const font = `${text.weight || 700} ${text.size || 72}px "${text.font || 'Cairo'}", system-ui, sans-serif`;
  meas.font = font;
  if ('letterSpacing' in meas) meas.letterSpacing = (text.letterSpacing || 0) + 'px';
  meas.direction = text.rtl ? 'rtl' : 'ltr';
  meas.textAlign = 'center';
  const maxW = text.maxWidth || 0;
  const srcLines = String(text.content || '').split('\n');
  const lines = [];
  for (const raw of srcLines) {
    if (!maxW || meas.measureText(raw).width <= maxW) { lines.push(raw); continue; }
    let cur = '';
    for (const word of raw.split(/(\s+)/)) {
      const test = cur + word;
      if (meas.measureText(test).width > maxW && cur) { lines.push(cur); cur = word.replace(/^\s+/, ''); }
      else cur = test;
    }
    lines.push(cur);
  }
  const lh = (text.size || 72) * (text.lineHeight || 1.2);
  const widths = lines.map(l => meas.measureText(l).width);
  const w = Math.max(10, ...widths) + (text.letterSpacing || 0) + (text.padding || 0) * 2 + (text.strokeWidth || 0) * 2;
  const h = lines.length * lh + (text.strokeWidth || 0) * 2;
  const res = { lines, widths, lineHeight: lh, w, h, font };
  if (layoutCache.size > 300) layoutCache.clear();
  layoutCache.set(key, res);
  return res;
}

export function drawTextClip(ctx, W, H, clip, opts = {}) {
  const t = clip.text || {};
  const L = layoutText(t);
  const originX = W / 2, originY = H / 2;
  ctx.save();
  ctx.translate(originX, originY);
  ctx.direction = t.rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = L.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (t.letterSpacing || 0) + 'px';
  // background bubble
  if (t.bg && t.bg !== 'transparent') {
    const pad = t.padding || 24;
    const bw = L.w, bh = L.h + pad * 1.1;
    ctx.save();
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, t.radius ?? 18);
    ctx.fillStyle = t.bg;
    ctx.globalAlpha = t.bgAlpha ?? 0.85;
    ctx.fill();
    ctx.restore();
  }
  const startY = -L.h / 2 + L.lineHeight / 2;
  L.lines.forEach((line, i) => {
    const y = startY + i * L.lineHeight;
    if (t.shadow) {
      ctx.save();
      ctx.shadowColor = t.shadowColor || 'rgba(0,0,0,.75)';
      ctx.shadowBlur = (t.size || 72) * 0.13;
      ctx.shadowOffsetY = (t.size || 72) * 0.045;
      ctx.fillStyle = t.color || '#ffffff';
      ctx.fillText(line, 0, y);
      ctx.restore();
    }
    if (t.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = t.strokeWidth * 2;
      ctx.strokeStyle = t.stroke || '#000000';
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = t.color || '#ffffff';
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawShapeClip(ctx, W, H, clip) {
  const s = clip.shape || { kind: 'rect', fill: '#ffcc00', stroke: '#000', strokeWidth: 0, w: 600, h: 400 };
  const w = s.w || 600, h = s.h || 400;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.fillStyle = s.fill || '#ffcc00';
  ctx.strokeStyle = s.stroke || '#000000';
  ctx.lineWidth = s.strokeWidth || 0;
  ctx.beginPath();
  switch (s.kind) {
    case 'rect': roundRect(ctx, -w / 2, -h / 2, w, h, s.radius || 0); break;
    case 'circle': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'ring': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.strokeStyle = s.fill; ctx.lineWidth = s.strokeWidth || Math.min(w, h) * 0.12; ctx.stroke(); return;
    case 'line': ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineWidth = s.strokeWidth || 12; ctx.strokeStyle = s.fill; ctx.stroke(); return;
    case 'arrow': {
      const aw = w, ah = h;
      ctx.moveTo(-aw / 2, -ah * 0.12); ctx.lineTo(aw * 0.1, -ah * 0.12); ctx.lineTo(aw * 0.1, -ah * 0.4);
      ctx.lineTo(aw / 2, 0); ctx.lineTo(aw * 0.1, ah * 0.4); ctx.lineTo(aw * 0.1, ah * 0.12);
      ctx.lineTo(-aw / 2, ah * 0.12); ctx.closePath(); break;
    }
    case 'triangle': ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); break;
    case 'star': {
      const R = Math.min(w, h) / 2, r2 = R * 0.45, n = 5;
      for (let i = 0; i < n * 2; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / n;
        const rr = i % 2 ? r2 : R;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath(); break;
    }
    case 'heart': {
      const k = Math.min(w, h) / 2;
      ctx.moveTo(0, k * 0.75);
      ctx.bezierCurveTo(-k * 1.5, -k * 0.4, -k * 0.5, -k * 1.25, 0, -k * 0.5);
      ctx.bezierCurveTo(k * 0.5, -k * 1.25, k * 1.5, -k * 0.4, 0, k * 0.75);
      ctx.closePath(); break;
    }
  }
  ctx.fill();
  if ((s.strokeWidth || 0) > 0 && s.kind !== 'ring') ctx.stroke();
  ctx.restore();
}

export function drawStickerClip(ctx, W, H, clip) {
  const s = clip.sticker || { emoji: '😎', size: 220 };
  const size = s.size || 220;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.emoji, 0, 0);
  ctx.restore();
}

// returns natural content size (used for hit-testing / drag)
export function contentSize(clip, W, H) {
  if (clip.type === 'text') { const L = layoutText(clip.text || {}); return { w: L.w, h: L.h, natural: true }; }
  if (clip.type === 'shape') { const s = clip.shape || {}; return { w: s.kind === 'line' ? (s.w || 600) : (s.w || 600), h: s.kind === 'line' ? Math.max(20, s.strokeWidth || 12) : (s.h || 400), natural: true }; }
  if (clip.type === 'sticker') { const s = clip.sticker || {}; return { w: s.size || 220, h: s.size || 220, natural: true }; }
  return { w: W, h: H, natural: false };
}

// ---------- one clip -> its own layer canvas ----------
export function renderClipLayer(layer, clip, localT, project, provider, opts = {}) {
  const W = project.settings.width, H = project.settings.height;
  const ctx = layer.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const tf = clipTransform(clip, localT);
  let baseW = W, baseH = H;

  if (clip.type === 'video' || clip.type === 'image') {
    const sourceTime = clipSourceTime(clip, localT);
    const src = provider.getSource(clip, sourceTime, opts);
    if (!src) return null;                       // not ready yet
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    if (!sw || !sh) return null;
    const fit = clip.fit === 'fill' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
    baseW = sw * fit; baseH = sh * fit;
    const crop = (clip.transform && clip.transform.crop) || { l: 0, t: 0, r: 0, b: 0 };
    const sx = sw * (crop.l || 0), sy = sh * (crop.t || 0);
    const scw = sw * (1 - (crop.l || 0) - (crop.r || 0)), sch = sh * (1 - (crop.t || 0) - (crop.b || 0));
    const needChroma = clip.chroma && clip.chroma.enabled;
    const needSharpen = (clip.adjust && clip.adjust.sharpen) > 0;
    const filter = buildFilter(clip);
    if (needChroma || needSharpen) {
      const tmp = getCanvas(W, H);
      const tctx = tmp.getContext('2d');
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, W, H);
      tctx.save();
      tctx.translate(W / 2, H / 2);
      tctx.filter = filter;
      drawSourceFit(tctx, src, sx, sy, scw, sch, baseW, baseH, tf, clip);
      tctx.restore();
      if (needChroma) applyChromaKey(tmp, clip.chroma);
      if (needSharpen) applySharpen(tmp, clip.adjust.sharpen);
      ctx.save();
      ctx.globalAlpha = tf.opacity;
      applyReveal(ctx, W, H, tf);
      ctx.filter = tf.blurAdd ? `blur(${tf.blurAdd}px)` : 'none';
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
      releaseCanvas(tmp);
    } else {
      ctx.save();
      ctx.globalAlpha = tf.opacity;
      applyReveal(ctx, W, H, tf);
      ctx.filter = (tf.blurAdd ? `blur(${tf.blurAdd}px) ` : '') + filter;
      ctx.translate(W / 2, H / 2);
      drawSourceFit(ctx, src, sx, sy, scw, sch, baseW, baseH, tf, clip);
      ctx.restore();
    }
  } else if (clip.type === 'text' || clip.type === 'shape' || clip.type === 'sticker') {
    const cs = contentSize(clip, W, H);
    baseW = cs.w; baseH = cs.h;
    ctx.save();
    ctx.globalAlpha = tf.opacity;
    applyReveal(ctx, W, H, tf);
    ctx.filter = tf.blurAdd ? `blur(${tf.blurAdd}px)` : 'none';
    ctx.translate(W / 2 + tf.x, H / 2 + tf.y);
    ctx.rotate(tf.rotate);
    ctx.scale(tf.scale * (tf.flipH ? -1 : 1), tf.scale * (tf.flipV ? -1 : 1));
    ctx.translate(-W / 2, -H / 2);
    if (clip.type === 'text') drawTextClip(ctx, W, H, clip);
    else if (clip.type === 'shape') drawShapeClip(ctx, W, H, clip);
    else drawStickerClip(ctx, W, H, clip);
    ctx.restore();
  }
  // grade + grain (per clip)
  const a = clip.adjust || {};
  if (a.temperature || a.tint || a.vignette) {
    ctx.save();
    ctx.globalAlpha = tf.opacity;
    ctx.globalCompositeOperation = 'source-atop';
    drawGrade(ctx, W, H, clip);
    ctx.restore();
  }
  if (a.grain) {
    ctx.save();
    ctx.globalAlpha = clamp(a.grain, 0, 1) * 0.35;
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(grainCanvas(256, 256, 5), 0, 0, W, H);
    ctx.restore();
  }
  return { layer, tf, baseW, baseH };
}

function drawSourceFit(ctx, src, sx, sy, scw, sch, baseW, baseH, tf, clip) {
  ctx.rotate(tf.rotate);
  ctx.scale(tf.scale * (tf.flipH ? -1 : 1), tf.scale * (tf.flipV ? -1 : 1));
  ctx.translate(tf.x, tf.y);
  const radius = tf.radius || 0;
  if (radius > 0) {
    ctx.save();
    roundRect(ctx, -baseW / 2, -baseH / 2, baseW, baseH, radius);
    ctx.clip();
  }
  ctx.drawImage(src, sx, sy, scw, sch, -baseW / 2, -baseH / 2, baseW, baseH);
  if (radius > 0) ctx.restore();
}

function applyReveal(ctx, W, H, tf) {
  if (tf.reveal < 1) {
    ctx.beginPath();
    ctx.rect(0, H * (1 - tf.reveal), W, H * tf.reveal);
    ctx.clip();
  }
}

// ---------- full frame ----------
export function drawFrame(ctx, project, time, provider, opts = {}) {
  const W = project.settings.width, H = project.settings.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (project.settings.bg && project.settings.bg !== 'transparent') {
    ctx.fillStyle = project.settings.bg;
    ctx.fillRect(0, 0, W, H);
  } else ctx.clearRect(0, 0, W, H);

  const tracks = project.tracks.filter(t => t.type !== 'audio' && !t.hidden);
  for (const track of tracks) {
    const clips = trackClipsSorted(track.id);
    if (!clips.length) continue;
    const active = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (time >= c.start && time < c.start + c.duration) active.push({ clip: c, prev: clips[i - 1] || null });
    }
    // only the last active clip on a track wins when overlapping, but keep transition partners
    const items = active.slice(-1);
    for (const item of items) {
      const { clip, prev } = item;
      const localT = clipLocalAt(clip, time);
      const trans = transitionActive(clip, prev, time);
      if (trans) {
        const pv = getCanvas(W, H);
        const pl = renderClipLayer(pv, prev, clipLocalAt(prev, time), project, provider, opts);
        const cv = getCanvas(W, H);
        const cl = renderClipLayer(cv, clip, localT, project, provider, opts);
        const drawLayer = (canvas, alpha = 1, dx = 0, dy = 0, scale = 1, blur = 0, rot = 0) => {
          ctx.save();
          ctx.globalAlpha = clamp(alpha, 0, 1);
          ctx.filter = blur ? `blur(${blur}px)` : 'none';
          if (scale !== 1 || rot || dx || dy) {
            ctx.translate(W / 2, H / 2);
            ctx.scale(scale, scale);
            ctx.rotate(rot);
            ctx.translate(-W / 2 - dx, -H / 2 - dy);
          }
          ctx.drawImage(canvas, 0, 0);
          ctx.restore();
        };
        if (pl && cl) {
          compositeTransition(ctx, W, H, clip.transition.type, trans.p,
            (a = 1, dx = 0, dy = 0, sc = 1, bl = 0, rot = 0) => drawLayer(pv, a, dx, dy, sc, bl, rot),
            (a = 1, dx = 0, dy = 0, sc = 1, bl = 0, rot = 0) => drawLayer(cv, a, dx, dy, sc, bl, rot));
        } else if (cl) {
          ctx.drawImage(cv, 0, 0);
        } else if (pl) {
          ctx.drawImage(pv, 0, 0);
        }
        releaseCanvas(pv); releaseCanvas(cv);
      } else {
        const cv = getCanvas(W, H);
        const cl = renderClipLayer(cv, clip, localT, project, provider, opts);
        if (cl) ctx.drawImage(cv, 0, 0);
        releaseCanvas(cv);
      }
    }
  }
}

// which clips are active at `time` (top-most first)
export function activeClips(project, time) {
  const out = [];
  for (const track of project.tracks) {
    if (track.type === 'audio' || track.hidden) continue;
    const clips = trackClipsSorted(track.id);
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (time >= c.start && time < c.start + c.duration) { out.push(c); break; }
    }
  }
  return out;
}
export function activeAudioClips(project, time) {
  const out = [];
  for (const track of project.tracks) {
    if (track.type !== 'audio' || track.muted) continue;
    for (const c of trackClipsSorted(track.id)) {
      if (time >= c.start && time < c.start + c.duration) out.push(c);
    }
  }
  return out;
}

// bounding box of a clip at time (for on-canvas handles)
export function clipBounds(project, clip, time) {
  const W = project.settings.width, H = project.settings.height;
  const localT = clipLocalAt(clip, time);
  const tf = clipTransform(clip, localT);
  let bw, bh;
  if (clip.type === 'video' || clip.type === 'image') {
    const m = providerSize(project, clip);
    const fit = clip.fit === 'fill' ? Math.max(W / m.w, H / m.h) : Math.min(W / m.w, H / m.h);
    bw = m.w * fit; bh = m.h * fit;
  } else {
    const cs = contentSize(clip, W, H);
    bw = cs.w; bh = cs.h;
  }
  const w = bw * Math.abs(tf.scale), h = bh * Math.abs(tf.scale);
  return { cx: W / 2 + tf.x, cy: H / 2 + tf.y, w, h, rot: tf.rotate, tf };
}
function providerSize(project, clip) {
  const m = project.media.find(x => x.id === clip.mediaId) || {};
  return { w: m.width || project.settings.width, h: m.height || project.settings.height };
}

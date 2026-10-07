// Montaj Pro — filters, adjustments, animations, transitions, chroma key
import { clamp, lerp } from './util.js';
import { kfValue } from './state.js';
import { FILTERS } from './i18n.js';

export const filterById = (id) => FILTERS.find(f => f.id === id) || FILTERS[0];

// deterministic pseudo random (must be identical in preview & export)
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildFilter(clip) {
  const parts = [];
  const f = filterById(clip.filter);
  if (f.css && (clip.filterStrength ?? 100) > 0) {
    // scale filter strengths by amount
    parts.push(f.css);
  }
  const a = clip.adjust || {};
  if (a.brightness) parts.push(`brightness(${clamp(1 + a.brightness, 0.1, 3)})`);
  if (a.contrast) parts.push(`contrast(${clamp(1 + a.contrast, 0.1, 3)})`);
  if (a.saturation) parts.push(`saturate(${clamp(1 + a.saturation, 0, 4)})`);
  if (a.hue) parts.push(`hue-rotate(${a.hue * 180}deg)`);
  if (a.blur) parts.push(`blur(${clamp(a.blur, 0, 40)}px)`);
  return parts.join(' ') || 'none';
}
// color grading that css filters cannot do (temperature / tint) — applied as overlay
export function drawGrade(ctx, W, H, clip) {
  const a = clip.adjust || {};
  if (a.temperature) {
    const warm = a.temperature;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.55, Math.abs(warm) * 0.55);
    ctx.fillStyle = warm > 0 ? '#ff9a3c' : '#3ca8ff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (a.tint) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.5, Math.abs(a.tint) * 0.5);
    ctx.fillStyle = a.tint > 0 ? '#ff44cc' : '#44ff88';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (a.vignette) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${clamp(a.vignette, 0, 1)})`);
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}

// ---------- animations ----------
export function animState(anim, p) {
  // returns multipliers for a given 0..1 progress
  const out = { opacityMul: 1, dx: 0, dy: 0, scaleMul: 1, rotAdd: 0, blurAdd: 0, reveal: 1 };
  if (!anim || anim === 'none' || p == null) return out;
  p = clamp(p, 0, 1);
  const ip = 1 - p;      // "distance from start"
  const back = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
  switch (anim) {
    case 'fade': out.opacityMul = p; break;
    case 'slideUp': out.dy = ip * 0.35; out.opacityMul = Math.min(1, p * 1.6); break;
    case 'slideDown': out.dy = -ip * 0.35; out.opacityMul = Math.min(1, p * 1.6); break;
    case 'slideLeft': out.dx = ip * 0.35; out.opacityMul = Math.min(1, p * 1.6); break;
    case 'slideRight': out.dx = -ip * 0.35; out.opacityMul = Math.min(1, p * 1.6); break;
    case 'zoomIn': out.scaleMul = lerp(0.55, 1, p); out.opacityMul = Math.min(1, p * 1.5); break;
    case 'zoomOut': out.scaleMul = lerp(1.55, 1, p); out.opacityMul = Math.min(1, p * 1.5); break;
    case 'pop': out.scaleMul = lerp(0.4, 1, back(p)); out.opacityMul = Math.min(1, p * 2); break;
    case 'rotateIn': out.rotAdd = -0.45 * ip; out.opacityMul = Math.min(1, p * 1.5); out.scaleMul = lerp(0.8, 1, p); break;
    case 'blurIn': out.blurAdd = ip * 16; out.opacityMul = Math.min(1, p * 1.4); break;
    case 'bounce': { const n = 7.5625, d = 2.75; let t = p; let v; if (t < 1 / d) v = n * t * t; else if (t < 2 / d) v = n * (t -= 1.5 / d) * t + 0.75; else if (t < 2.5 / d) v = n * (t -= 2.25 / d) * t + 0.9375; else v = n * (t -= 2.625 / d) * t + 0.984375; out.dy = -(1 - v) * 0.25; out.opacityMul = Math.min(1, p * 2); break; }
    case 'wipeUp': out.reveal = p; break;
    default: break;
  }
  return out;
}

export function clipAnimState(clip, localT) {
  const d = clip.duration;
  let st = { opacityMul: 1, dx: 0, dy: 0, scaleMul: 1, rotAdd: 0, blurAdd: 0, reveal: 1 };
  const merge = (s) => {
    st.opacityMul *= s.opacityMul; st.dx += s.dx; st.dy += s.dy;
    st.scaleMul *= s.scaleMul; st.rotAdd += s.rotAdd; st.blurAdd += s.blurAdd;
    st.reveal = Math.min(st.reveal, s.reveal);
  };
  const aIn = clip.animIn, aOut = clip.animOut;
  if (aIn && aIn.type !== 'none' && aIn.dur > 0) merge(animState(aIn.type, clamp(localT / aIn.dur, 0, 1)));
  if (aOut && aOut.type !== 'none' && aOut.dur > 0) merge(animState(aOut.type, clamp((d - localT) / aOut.dur, 0, 1)));
  return st;
}

// ---------- transforms ----------
export function clipTransform(clip, localT) {
  const t = clip.transform || {};
  const a = clipAnimState(clip, localT);
  const x = kfValue(clip, 'x', localT, t.x || 0) + a.dx;
  const y = kfValue(clip, 'y', localT, t.y || 0) + a.dy;
  const scale = kfValue(clip, 'scale', localT, t.scale ?? 1) * a.scaleMul;
  const rotate = (kfValue(clip, 'rotate', localT, t.rotate || 0)) + a.rotAdd;
  const opacity = clamp(kfValue(clip, 'opacity', localT, t.opacity ?? 1) * a.opacityMul, 0, 1);
  const blurAdd = a.blurAdd;
  return { x, y, scale, rotate, opacity, blurAdd, reveal: a.reveal, flipH: !!t.flipH, flipV: !!t.flipV, radius: t.radius || 0 };
}

export function clipVolumeAt(clip, localT) {
  const t = clip.transform ? clip.transform : {};
  let v = kfValue(clip, 'volume', localT, clip.volume ?? 1);
  if (clip.muted) v = 0;
  const fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
  if (fi > 0 && localT < fi) v *= clamp(localT / fi, 0, 1);
  if (fo > 0 && localT > clip.duration - fo) v *= clamp((clip.duration - localT) / fo, 0, 1);
  return clamp(v, 0, 4);
}

// ---------- transitions ----------
export function transitionActive(clip, prev, t) {
  const tr = clip.transition;
  if (!tr || tr.type === 'none' || !(tr.duration > 0) || !prev) return null;
  const dur = Math.min(tr.duration, Math.min(clip.duration, prev.duration) * 0.95);
  const s = clip.start, e = s + dur;
  if (t < s || t > e) return null;
  return { p: clamp((t - s) / dur, 0, 1), dur };
}

// blends two already-rendered layers (canvas: draw functions)
export function compositeTransition(ctx, W, H, type, p, drawA, drawB) {
  const ease = (t) => t * t * (3 - 2 * t);
  const q = ease(p);
  switch (type) {
    case 'fade': case 'dissolve': {
      drawA(1);
      drawB(type === 'fade' ? p : q);
      break;
    }
    case 'slideLeft': {
      drawA(1, -q * W, 0);
      drawB(1, (1 - q) * W, 0);
      break;
    }
    case 'slideRight': {
      drawA(1, q * W, 0);
      drawB(1, -(1 - q) * W, 0);
      break;
    }
    case 'slideUp': {
      drawA(1, 0, -q * H);
      drawB(1, 0, (1 - q) * H);
      break;
    }
    case 'slideDown': {
      drawA(1, 0, q * H);
      drawB(1, 0, -(1 - q) * H);
      break;
    }
    case 'zoomIn': {
      drawA(1, 0, 0, 1 + q * 0.35);
      drawB(q, 0, 0, lerp(1.6, 1, q));
      break;
    }
    case 'zoomOut': {
      drawA(1, 0, 0, lerp(1, 0.6, q));
      drawB(q, 0, 0, lerp(0.5, 1, q));
      break;
    }
    case 'wipeLeft': return wipe(ctx, W, H, 'l', q, drawA, drawB);
    case 'wipeRight': return wipe(ctx, W, H, 'r', q, drawA, drawB);
    case 'wipeUp': return wipe(ctx, W, H, 'u', q, drawA, drawB);
    case 'wipeDown': return wipe(ctx, W, H, 'd', q, drawA, drawB);
    case 'circle': return circleReveal(ctx, W, H, q, drawA, drawB);
    case 'blur': {
      drawA(1, 0, 0, 1, q * 18);
      drawB(q, 0, 0, lerp(1.05, 1, q), (1 - q) * 18);
      break;
    }
    case 'spin': {
      drawA(1, 0, 0, 1, 0, -q * 0.6);
      drawB(q, 0, 0, lerp(0.5, 1, q), 0, (1 - q) * 1.2);
      break;
    }
    case 'glitch': return glitch(ctx, W, H, p, drawA, drawB);
    case 'whip': {
      drawA(1, -q * W * 1.2, 0, 1, q * 22);
      drawB(q, (1 - q) * W * 1.2, 0, 1, (1 - q) * 22);
      break;
    }
    default: drawB(1); break;
  }
}
function wipe(ctx, W, H, dir, p, drawA, drawB) {
  drawA(1);
  ctx.save();
  ctx.beginPath();
  if (dir === 'l') ctx.rect(W * (1 - p), 0, W * p, H);
  else if (dir === 'r') ctx.rect(0, 0, W * p, H);
  else if (dir === 'u') ctx.rect(0, H * (1 - p), W, H * p);
  else ctx.rect(0, 0, W, H * p);
  ctx.clip();
  drawB(1);
  ctx.restore();
}
function circleReveal(ctx, W, H, p, drawA, drawB) {
  drawA(1);
  ctx.save();
  ctx.beginPath();
  const r = Math.hypot(W, H) * 0.5 * p;
  ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  ctx.clip();
  drawB(1);
  ctx.restore();
}
function glitch(ctx, W, H, p, drawA, drawB) {
  drawA(1);
  const rnd = (i) => hash(Math.floor(p * 24) * 7 + i);
  ctx.save();
  ctx.globalAlpha = clamp(p * 1.4, 0, 1);
  const slices = 7;
  for (let i = 0; i < slices; i++) {
    const y = (i / slices) * H;
    const off = (rnd(i) - 0.5) * W * 0.25 * (1 - p);
    const h = H / slices;
    ctx.drawImage(ctx.canvas, 0, y, W, h, off, y + (rnd(i + 9) - 0.5) * 12, W, h);
  }
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = clamp((1 - p) * 0.5, 0, 0.5);
  ctx.fillStyle = '#ff0044'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = clamp((1 - p) * 0.35, 0, 0.5);
  ctx.fillStyle = '#00ffe1'; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = p;
  drawB(1);
  ctx.restore();
}

// ---------- chroma key ----------
export function applyChromaKey(canvas, chroma) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const key = hexToRgb(chroma.color || '#00ff00');
  const tol = (chroma.tol ?? 0.28) * 442;
  const feather = Math.max(1, (chroma.feather ?? 0.12) * 442);
  const spill = chroma.spill ?? 0.4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dist = Math.hypot(r - key.r, g - key.g, b - key.b);
    if (dist < tol) { d[i + 3] = 0; }
    else if (dist < tol + feather) {
      const a = (dist - tol) / feather;
      d[i + 3] = Math.round(d[i + 3] * a);
      if (spill > 0) { d[i + 1] = Math.round(g * (1 - spill * 0.35 * (1 - a))); }
    } else if (spill > 0 && g > Math.max(r, b) * 1.15) {
      const excess = (g - Math.max(r, b)) * spill;
      d[i + 1] = Math.max(0, Math.round(g - excess));
    }
  }
  ctx.putImageData(img, 0, 0);
}
export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#00ff00');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 255, b: 0 };
}

// unsharp-ish sharpen (3x3) — only used when needed
export function applySharpen(canvas, amount) {
  if (amount <= 0) return;
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const src = ctx.getImageData(0, 0, W, H);
  const out = ctx.createImageData(W, H);
  const s = src.data, o = out.data, k = clamp(amount, 0, 1) * 1.6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2]; o[i + 3] = s[i + 3]; continue; }
      for (let c = 0; c < 3; c++) {
        const center = s[i + c];
        const nb = s[i - 4 + c] + s[i + 4 + c] + s[i - W * 4 + c] + s[i + W * 4 + c];
        const v = center + k * (4 * center - nb) / 4;
        o[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      o[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

// noise/grain overlay cached per size
const grainCache = new Map();
export function grainCanvas(W, H, seed = 1) {
  const key = W + 'x' + H;
  if (grainCache.has(key)) return grainCache.get(key);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = hash(i * 0.017 + seed) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainCache.set(key, c);
  return c;
}

// Raster drawing engine: brush strokes with a stroke buffer, flood fill, shapes, text.
import { mkCanvas, clamp, lerp, hexToRgb, M } from '../core/util.js';
import { S } from '../core/state.js';

export const BRUSH_PRESETS = {
  pencil: { label: 'Pencil', size: 3, opacity: 1, hardness: 1, smoothing: 0.15, stabilization: 0, pressure: true, spacing: 0.08, kind: 'hard', texture: true },
  ink: { label: 'Ink Brush', size: 10, opacity: 1, hardness: 0.92, smoothing: 0.5, stabilization: 0.25, pressure: true, spacing: 0.06, kind: 'ink' },
  marker: { label: 'Marker', size: 22, opacity: 0.7, hardness: 0.85, smoothing: 0.3, stabilization: 0.1, pressure: false, spacing: 0.1, kind: 'marker' },
  soft: { label: 'Soft Brush', size: 40, opacity: 0.8, hardness: 0.1, smoothing: 0.35, stabilization: 0.1, pressure: true, spacing: 0.12, kind: 'soft' },
  eraser: { label: 'Eraser', size: 30, opacity: 1, hardness: 0.9, smoothing: 0.2, stabilization: 0, pressure: true, spacing: 0.1, kind: 'hard' },
};

const tipCache = new Map();
function tip(d, hardness, color) {
  d = Math.max(1, Math.round(d)); hardness = Math.round(hardness * 20) / 20;
  const key = `${d}|${hardness}|${color}`;
  let t = tipCache.get(key);
  if (t) return t;
  const pad = 2; const c = mkCanvas(d + pad * 2, d + pad * 2); const g = c.getContext('2d');
  const r = d / 2, cx = r + pad, cy = r + pad;
  if (hardness >= 0.98 || d < 3) { g.fillStyle = color; g.beginPath(); g.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2); g.fill(); }
  else {
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    const [R, G, B] = hexToRgb(color); const h0 = clamp(hardness, 0, 0.99);
    rg.addColorStop(0, `rgba(${R},${G},${B},1)`); rg.addColorStop(h0, `rgba(${R},${G},${B},1)`); rg.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  tipCache.set(key, t = c);
  if (tipCache.size > 400) tipCache.delete(tipCache.keys().next().value);
  return t;
}

export class Stroke {
  /** opts: { celCanvas, color, brush(settings), erase, zoom } */
  constructor(opts) {
    this.o = opts; this.b = opts.brush; this.erase = !!opts.erase;
    const W = opts.celCanvas.width, H = opts.celCanvas.height;
    this.buf = mkCanvas(W, H); this.g = this.buf.getContext('2d');
    this.pts = []; this.rope = null; this.smooth = null; this.last = null; this.dirty = null; this.vel = 0; this.lastT = 0;
    this.carry = 0;
  }
  _grow(x, y, r) {
    const d = this.dirty || (this.dirty = { x0: x - r, y0: y - r, x1: x + r, y1: y + r });
    d.x0 = Math.min(d.x0, x - r); d.y0 = Math.min(d.y0, y - r); d.x1 = Math.max(d.x1, x + r); d.y1 = Math.max(d.y1, y + r);
  }
  get rect() { const d = this.dirty; if (!d) return null; return { x: Math.floor(d.x0) - 2, y: Math.floor(d.y0) - 2, w: Math.ceil(d.x1 - d.x0) + 5, h: Math.ceil(d.y1 - d.y0) + 5 }; }
  _filter(p) {
    const b = this.b; const zoom = this.o.zoom || 1;
    // lazy rope (stabilization)
    const L = (b.stabilization || 0) * 70 / zoom;
    if (!this.rope) this.rope = { x: p.x, y: p.y };
    else if (L > 0) {
      const dx = p.x - this.rope.x, dy = p.y - this.rope.y, d = Math.hypot(dx, dy);
      if (d > L) { const k = (d - L) / d; this.rope.x += dx * k; this.rope.y += dy * k; }
    } else { this.rope.x = p.x; this.rope.y = p.y; }
    // exponential smoothing
    const s = clamp(b.smoothing || 0, 0, 0.95);
    if (!this.smooth) this.smooth = { x: this.rope.x, y: this.rope.y };
    else { const k = 1 - s * 0.85; this.smooth.x += (this.rope.x - this.smooth.x) * k; this.smooth.y += (this.rope.y - this.smooth.y) * k; }
    return { x: this.smooth.x, y: this.smooth.y };
  }
  _sizeAt(p) {
    const b = this.b; let k = 1;
    if (b.pressure) {
      if (p.pointerType === 'pen' || p.pointerType === 'touch') k = lerp(0.15, 1, clamp(p.pressure, 0, 1));
      else if (b.kind === 'ink') k = lerp(1, 0.45, clamp(this.vel / 1.8, 0, 1)); // mouse: speed-based taper
    }
    return Math.max(0.5, b.size * k);
  }
  _stamp(x, y, size, alpha) {
    const g = this.g; const color = this.erase ? '#000000' : this.o.color;
    const hard = this.b.kind === 'marker' ? Math.max(this.b.hardness, 0.85) : this.b.hardness;
    const t = tip(size, hard, color); const pad = 2;
    g.globalAlpha = alpha; g.drawImage(t, x - t.width / 2, y - t.height / 2);
    this._grow(x, y, size / 2 + pad);
  }
  add(raw, final = false) {
    const now = performance.now(); const dt = Math.max(1, now - (this.lastT || now - 16)); this.lastT = now;
    const prev = this.pts.length ? this.pts[this.pts.length - 1] : null;
    if (prev) this.vel = lerp(this.vel, Math.hypot(raw.x - prev.rx, raw.y - prev.ry) / dt, 0.3);
    const f = this._filter(raw);
    const p = { x: f.x, y: f.y, rx: raw.x, ry: raw.y, size: this._sizeAt(raw) };
    if (!this.last) { this._stamp(p.x, p.y, p.size, 1); this.last = p; this.pts.push(p); return; }
    const a = this.last; const dist = Math.hypot(p.x - a.x, p.y - a.y);
    const step = Math.max(0.7, Math.min(a.size, p.size) * (this.b.spacing || 0.1));
    let d = this.carry;
    while (d <= dist) {
      const t = dist === 0 ? 1 : d / dist;
      const jitter = this.b.texture ? 0.85 + Math.random() * 0.15 : 1;
      this._stamp(lerp(a.x, p.x, t), lerp(a.y, p.y, t), lerp(a.size, p.size, t), jitter);
      d += step;
    }
    this.carry = d - dist; this.last = p; this.pts.push(p);
  }
  /** Composite stroke buffer to cel. */
  commit(alphaLock) {
    const cg = this.o.celCanvas.getContext('2d');
    cg.save();
    cg.globalAlpha = clamp(this.b.opacity, 0, 1);
    cg.globalCompositeOperation = this.erase ? 'destination-out' : (alphaLock ? 'source-atop' : 'source-over');
    cg.drawImage(this.buf, 0, 0);
    cg.restore();
  }
}

// ── flood fill ──
/** sample: ImageData used to find region; target: ImageData written. Returns dirty rect or null. */
export function floodFill(sample, target, sx, sy, color, tol = 24, grow = 1, contiguous = true) {
  const W = sample.width, H = sample.height; sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const sd = sample.data, td = target.data;
  const i0 = (sy * W + sx) * 4; const r0 = sd[i0], g0 = sd[i0 + 1], b0 = sd[i0 + 2], a0 = sd[i0 + 3];
  const [R, G, B] = hexToRgb(color);
  const within = (i) => {
    const da = Math.abs(sd[i + 3] - a0);
    if (a0 < 8 && sd[i + 3] < 8) return true;
    return Math.abs(sd[i] - r0) + Math.abs(sd[i + 1] - g0) + Math.abs(sd[i + 2] - b0) + da * 1.2 <= tol * 3;
  };
  const mask = new Uint8Array(W * H);
  let minx = W, miny = H, maxx = -1, maxy = -1;
  if (contiguous) {
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(), x0 = stack.pop();
      let x = x0;
      while (x >= 0 && !mask[y * W + x] && within((y * W + x) * 4)) x--;
      x++;
      let up = false, dn = false;
      while (x < W && !mask[y * W + x] && within((y * W + x) * 4)) {
        mask[y * W + x] = 1; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (y > 0) { const ok = !mask[(y - 1) * W + x] && within(((y - 1) * W + x) * 4); if (ok && !up) { stack.push(x, y - 1); up = true; } else if (!ok) up = false; }
        if (y < H - 1) { const ok = !mask[(y + 1) * W + x] && within(((y + 1) * W + x) * 4); if (ok && !dn) { stack.push(x, y + 1); dn = true; } else if (!ok) dn = false; }
        x++;
      }
    }
  } else {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (within((y * W + x) * 4)) { mask[y * W + x] = 1; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  if (maxx < 0) return null;
  // grow to cover anti-aliased fringes
  let m = mask;
  for (let it = 0; it < grow; it++) {
    const n = new Uint8Array(m);
    for (let y = Math.max(0, miny - 1); y <= Math.min(H - 1, maxy + 1); y++) for (let x = Math.max(0, minx - 1); x <= Math.min(W - 1, maxx + 1); x++) {
      const k = y * W + x; if (m[k]) continue;
      if ((x > 0 && m[k - 1]) || (x < W - 1 && m[k + 1]) || (y > 0 && m[k - W]) || (y < H - 1 && m[k + W])) { // only grow into non-line pixels
        const i = k * 4; if (sd[i + 3] < 255 * 0.55 || Math.abs(sd[i] - r0) + Math.abs(sd[i + 1] - g0) + Math.abs(sd[i + 2] - b0) < 200) n[k] = 1;
      }
    }
    m = n; minx = Math.max(0, minx - 1); miny = Math.max(0, miny - 1); maxx = Math.min(W - 1, maxx + 1); maxy = Math.min(H - 1, maxy + 1);
  }
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) if (m[y * W + x]) { const i = (y * W + x) * 4; td[i] = R; td[i + 1] = G; td[i + 2] = B; td[i + 3] = 255; }
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}

// ── shapes ──
/** shape: {kind, a:[x,y], b:[x,y], pts:[[x,y]...], bez:[{x,y,hx,hy}], fill, stroke, lineWidth, color, color2, closed} drawn in `ctx` with matrix m (scene→target). */
export function drawShape(ctx, sh, m) {
  ctx.save();
  if (m) M.apply(ctx, m);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = sh.lineWidth; ctx.strokeStyle = sh.color; ctx.fillStyle = sh.color2;
  ctx.beginPath();
  const [x0, y0] = sh.a || [0, 0]; const [x1, y1] = sh.b || [0, 0];
  switch (sh.kind) {
    case 'line': ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); break;
    case 'rect': ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); break;
    case 'circle': { const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2; if (sh.perfect) { const r = Math.max(rx, ry); ctx.ellipse(x0 + Math.sign(x1 - x0) * r, y0 + Math.sign(y1 - y0) * r, r, r, 0, 0, Math.PI * 2); } else ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); break; }
    case 'polygon': { const p = sh.pts || []; if (!p.length) break; ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); if (sh.closed) ctx.closePath(); break; }
    case 'bezier': {
      const p = sh.bez || []; if (!p.length) break; ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i]; ctx.bezierCurveTo(a.x + (a.hx || 0), a.y + (a.hy || 0), b.x - (b.hx || 0), b.y - (b.hy || 0), b.x, b.y); }
      if (sh.closed && p.length > 2) { const a = p[p.length - 1], b = p[0]; ctx.bezierCurveTo(a.x + (a.hx || 0), a.y + (a.hy || 0), b.x - (b.hx || 0), b.y - (b.hy || 0), b.x, b.y); ctx.closePath(); }
      break;
    }
    default: break;
  }
  if (sh.fill && sh.kind !== 'line') ctx.fill();
  if (sh.stroke || sh.kind === 'line' || !sh.fill) ctx.stroke();
  ctx.restore();
}
export function drawTextTo(ctx, text, x, y, o) {
  ctx.save();
  ctx.fillStyle = o.color; ctx.font = `${o.bold ? 'bold ' : ''}${o.size}px "${o.font}", "Segoe UI", sans-serif`; ctx.textBaseline = 'top';
  text.split('\n').forEach((ln, i) => ctx.fillText(ln, x, y + i * o.size * 1.2));
  ctx.restore();
}

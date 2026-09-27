// ============================================================
// utils.js — math helpers, AABB collisions, canvas helpers
// ============================================================
import * as THREE from 'three';

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent smoothing
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const TAU = Math.PI * 2;

export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

// ---------- 2D axis-aligned box (x,z plane) with height info ----------
export class AABB {
  constructor(x0, z0, x1, z1, y0 = 0, y1 = 3) {
    this.min = { x: Math.min(x0, x1), z: Math.min(z0, z1) };
    this.max = { x: Math.max(x0, x1), z: Math.max(z0, z1) };
    this.y0 = y0; this.y1 = y1;
    this.solid = true;
    this.tag = '';
  }
  static fromCenter(cx, cz, w, d, y0 = 0, y1 = 3) {
    return new AABB(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y0, y1);
  }
  contains2D(x, z, pad = 0) {
    return x > this.min.x - pad && x < this.max.x + pad && z > this.min.z - pad && z < this.max.z + pad;
  }
  // push a circle (x,z,r) out of the box; returns corrected [x,z]
  resolveCircle(x, z, r, py = 1.0) {
    if (py < this.y0 || py > this.y1) return [x, z];
    const cx = clamp(x, this.min.x, this.max.x);
    const cz = clamp(z, this.min.z, this.max.z);
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) return [x, z];
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2), push = (r - d) / d;
      return [x + dx * push, z + dz * push];
    }
    // center inside box: push out along smallest axis
    const l = x - this.min.x, rr = this.max.x - x, t = z - this.min.z, bb = this.max.z - z;
    const m = Math.min(l, rr, t, bb);
    if (m === l) return [this.min.x - r, z];
    if (m === rr) return [this.max.x + r, z];
    if (m === t) return [x, this.min.z - r];
    return [x, this.max.z + r];
  }
  // 2D segment intersection test (for line-of-sight)
  segmentHit(x0, z0, x1, z1, rayY = 1.5) {
    if (rayY < this.y0 || rayY > this.y1) return false;
    let tmin = 0, tmax = 1;
    const dx = x1 - x0, dz = z1 - z0;
    for (const [p, q] of [[-dx, x0 - this.min.x], [dx, this.max.x - x0], [-dz, z0 - this.min.z], [dz, this.max.z - z0]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
      else {
        const t = q / p;
        if (p < 0) { if (t > tmax) return false; if (t > tmin) tmin = t; }
        else { if (t < tmin) return false; if (t < tmax) tmax = t; }
      }
    }
    return true;
  }
}

// has line of sight between two points given wall-ish boxes
export function losClear(colliders, x0, z0, x1, z1, rayY = 1.5) {
  for (const c of colliders) {
    if (!c.solid || !c.blocksSight) continue;
    if (c.segmentHit(x0, z0, x1, z1, rayY)) return false;
  }
  return true;
}

// ---------- canvas texture helpers ----------
export function makeCanvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  return c;
}
export function canvasTex(w, h, fn, { repeat = [1, 1], nearest = true, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(makeCanvas(w, h, fn));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (nearest) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter; }
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  return tex;
}

// value-noise painter used by several textures
export function speckle(ctx, w, h, n, colors, sizeMin = 1, sizeMax = 3) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = pick(colors);
    const s = rand(sizeMin, sizeMax);
    ctx.globalAlpha = rand(0.12, 0.5);
    ctx.fillRect(rand(0, w), rand(0, h), s, s);
  }
  ctx.globalAlpha = 1;
}

export function el(id) { return document.getElementById(id); }

export function fmtClock(mins) {
  // mins since midnight; returns like "1:05 AM"
  let h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

// simple event bus
export class Bus {
  constructor() { this.map = new Map(); }
  on(ev, fn) { (this.map.get(ev) || this.map.set(ev, []).get(ev)).push(fn); return fn; }
  emit(ev, ...args) { const l = this.map.get(ev); if (l) for (const fn of l) fn(...args); }
}

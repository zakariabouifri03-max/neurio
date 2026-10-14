// ── WARFRONT · math, RNG and the AABB world model ───────────────────────────
// The whole game (movement, bullets, line-of-sight) is resolved against axis
// aligned boxes — no physics engine, deterministic and fast.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const sign = (v) => (v < 0 ? -1 : 1);

/** frame-rate independent smoothing: `rate` = approach per second */
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1337) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.min(arr.length - 1, Math.floor(this.f() * arr.length))]; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  /** normal-ish distributed noise in [-1,1] */
  n() { return (this.f() + this.f() + this.f() - 1.5) / 1.5; }
  chance(p) { return this.f() < p; }
}

export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function approachAngle(cur, tgt, maxStep) {
  const d = angDiff(cur, tgt);
  return cur + clamp(d, -maxStep, maxStep);
}

// ── boxes ────────────────────────────────────────────────────────────────────
export const box = (x0, y0, z0, x1, y1, z1, tag) => ({ x0, y0, z0, x1, y1, z1, tag: tag || '' });

export function boxAdd(b, cx, cz, w, d, y0, y1, tag) {
  return box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y1, cz + d / 2, tag);
}

export const boxCenterX = (b) => (b.x0 + b.x1) / 2;
export const boxCenterZ = (b) => (b.z0 + b.z1) / 2;

/** XZ overlap between a point-with-radius and a box */
export function xzOverlapCircle(b, x, z, r) {
  return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;
}

/**
 * Ray vs box (slab method). `d` must be normalised.
 * Returns hit distance or -1. Hits from inside count as t = 0.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, b, tmax) {
  const eps = 1e-8;
  let t0 = 0, t1 = tmax === undefined ? 1e9 : tmax;
  // X slab
  if (Math.abs(dx) < eps) {
    if (ox < b.x0 || ox > b.x1) return -1;
  } else {
    const inv = 1 / dx;
    let a = (b.x0 - ox) * inv, c = (b.x1 - ox) * inv;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dy) < eps) {
    if (oy < b.y0 || oy > b.y1) return -1;
  } else {
    const inv = 1 / dy;
    let a = (b.y0 - oy) * inv, c = (b.y1 - oy) * inv;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < eps) {
    if (oz < b.z0 || oz > b.z1) return -1;
  } else {
    const inv = 1 / dz;
    let a = (b.z0 - oz) * inv, c = (b.z1 - oz) * inv;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  return t0 >= 0 ? t0 : -1;
}

/** nearest box hit along a ray, returns { t, nx, ny, nz, box } or null */
export function rayWorld(ro, rd, boxes, tmax) {
  let best = null, bt = tmax;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const t = rayBox(ro.x, ro.y, ro.z, rd.x, rd.y, rd.z, b, bt);
    if (t >= 0 && t < bt) {
      bt = t;
      // dominant axis of the entry face = surface normal
      const px = ro.x + rd.x * t, py = ro.y + rd.y * t, pz = ro.z + rd.z * t;
      const ex = Math.min(Math.abs(px - b.x0), Math.abs(px - b.x1));
      const ey = Math.min(Math.abs(py - b.y0), Math.abs(py - b.y1));
      const ez = Math.min(Math.abs(pz - b.z0), Math.abs(pz - b.z1));
      let nx = 0, ny = 0, nz = 0;
      if (ey <= ex && ey <= ez) ny = py > (b.y0 + b.y1) / 2 ? 1 : -1;
      else if (ex <= ez) nx = px > (b.x0 + b.x1) / 2 ? 1 : -1;
      else nz = pz > (b.z0 + b.z1) / 2 ? 1 : -1;
      best = { t, nx, ny, nz, box: b };
    }
  }
  return best;
}

/** is the straight line between two points unobstructed? (offset = eye height) */
export function losClear(from, to, boxes) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  const rd = { x: dx / len, y: dy / len, z: dz / len };
  return rayWorld(from, rd, boxes, len - 0.05) === null;
}

export function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ── grid pathfinding (A*) ────────────────────────────────────────────────────
export class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, pri) {
    const a = this.a;
    a.push({ node, pri });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri <= a[i].pri) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (r < a.length && a[r].pri < a[m].pri) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top.node;
  }
}

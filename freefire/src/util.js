// ── BOOYAH FIRE — shared math / RNG helpers ──────────────────────────────────

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (r, a, b) => a + (b - a) * r();
export const randi = (r, a, b) => Math.floor(a + (b - a + 1) * r());
export const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];

// weighted pick: items = [[value, weight], ...]
export function weightedPick(r, items) {
  let total = 0;
  for (const it of items) total += it[1];
  let x = r() * total;
  for (const it of items) { x -= it[1]; if (x <= 0) return it[0]; }
  return items[items.length - 1][0];
}

// shortest signed angular distance a → b
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function turnToward(cur, target, maxStep) {
  const d = angDiff(cur, target);
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm');

// ── value noise (seeded, no deps) ────────────────────────────────────────────
export class Noise {
  constructor(seed) {
    const r = mulberry32(seed);
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    this.p = p;
  }
  // value noise in [-1, 1], smooth interpolation
  n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const p = this.p;
    const h = (ix, iy) => p[(p[ix & 255] + (iy & 255)) & 255] / 127.5 - 1;
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  fbm(x, y, oct = 4, lac = 2.05, gain = 0.5) {
    let f = 1, amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += this.n2(x * f, y * f) * amp;
      norm += amp;
      f *= lac; amp *= gain;
    }
    return sum / (norm || 1);
  }
  // ridge noise — good for mountain crests
  ridge(x, y, oct = 4) {
    let f = 1, amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += (1 - Math.abs(this.n2(x * f, y * f))) * amp;
      norm += amp;
      f *= 2.03; amp *= 0.5;
    }
    return sum / (norm || 1);
  }
}

// ── geometry helpers (ray vs. sphere, axis box) ───────────────────────────────
// Ray/dir must be normalized. Returns distance t>0 or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? -1 : t;
}

// ray vs. oriented box (rotY) — slab test in box space
export function rayOBB(ox, oy, oz, dx, dy, dz, box) {
  const cs = Math.cos(-box.rot), sn = Math.sin(-box.rot);
  const rx = ox - box.x, rz = oz - box.z;
  const lx = rx * cs - rz * sn, lz = rx * sn + rz * cs, ly = oy - box.y;
  const ldx = dx * cs - dz * sn, ldz = dx * sn + dz * cs, ldy = dy;
  let tmin = -Infinity, tmax = Infinity;
  const hw = box.hw, hh = box.hh, hd = box.hd;
  // x
  if (Math.abs(ldx) < 1e-8) { if (lx < -hw || lx > hw) return -1; }
  else {
    let t1 = (-hw - lx) / ldx, t2 = (hw - lx) / ldx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  // y
  if (Math.abs(ldy) < 1e-8) { if (ly < -hh || ly > hh) return -1; }
  else {
    let t1 = (-hh - ly) / ldy, t2 = (hh - ly) / ldy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  // z
  if (Math.abs(ldz) < 1e-8) { if (lz < -hd || lz > hd) return -1; }
  else {
    let t1 = (-hd - lz) / ldz, t2 = (hd - lz) / ldz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < 0 || tmin > tmax) return -1;
  return tmin < 0 ? 0 : tmin;
}

// does segment (x,z) overlap a circle? used for zone checks
export const inCircle = (x, z, cx, cz, r) => (x - cx) * (x - cx) + (z - cz) * (z - cz) <= r * r;

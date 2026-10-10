// BLOCK CITY ULTRA — shared math / RNG helpers.
// The RNG is the same xorshift32 used by FBCUVoxelRng (C++) and citygen.py so
// a given seed produces the same city in all three runtimes.

export function rng(seed = 1) {
  let s = seed | 1;
  const next = () => {
    let x = s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    s = x;
    return x;
  };
  return {
    next,
    f: () => (next() >>> 8) / 16777216,
    r: (a, b) => a + (b - a) * ((next() >>> 8) / 16777216),
    i: (a, b) => a + (next() % (b - a + 1)),
    chance: (p) => ((next() >>> 8) / 16777216) < p,
    pick: (arr) => arr[next() % arr.length],
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export const TAU = Math.PI * 2;

// shortest signed angle a -> b
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

// --- tiny spatial hash: O(1) building / prop lookups -------------------------
export class SpatialHash {
  constructor(cell = 4000) { this.cell = cell; this.map = new Map(); }
  _k(x, y) { return ((Math.floor(x / this.cell) & 0xffff) << 16) | (Math.floor(y / this.cell) & 0xffff); }
  insert(x, y, item) {
    const k = this._k(x, y);
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(item);
  }
  query(x, y, radius, out = []) {
    out.length = 0;
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const b = this.map.get(((cx + dx & 0xffff) << 16) | (cy + dy & 0xffff));
        if (b) for (const it of b) out.push(it);
      }
    }
    return out;
  }
}

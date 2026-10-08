// Small math helpers. Vectors are plain {x, y, z} objects so the simulation
// layer has no three.js dependency (and can run under Node for tests).

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Frame-rate independent exponential approach: lambda ≈ 'speed' (1/s).
export function damp(a, b, lambda, dt) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function dist2(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function len2(v) {
  return Math.hypot(v.x, v.z);
}

export function len3(v) {
  return Math.hypot(v.x, v.y, v.z);
}

// Returns a unit vector in the XZ plane (y ignored). Zero vector stays zero.
export function norm2(v) {
  const l = Math.hypot(v.x, v.z);
  return l > 1e-9 ? { x: v.x / l, y: 0, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

export function norm3(v) {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

export function heading(v) {
  return Math.atan2(v.z, v.x);
}

export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Rotate a XZ vector by angle (radians).
export function rotate2(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}

export function lerpV(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Mulberry32 seeded PRNG — deterministic matches for testing and reproducible seeds.
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    gauss: () => {
      const u = Math.max(1e-9, next()), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    },
    seed: (x) => { s = x >>> 0; },
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

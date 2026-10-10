// BLOCK CITY ULTRA — browser slice. Original code; no third-party game assets.

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same city, everywhere. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash — the same one the UE5 generator uses, so both cities match. */
export function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** C2-continuous value noise, 2D. Matches BCUVoxelGrid's ValueNoise2D. */
export function valueNoise2D(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const corner = (cx, cy) => (hash3(cx, cy, 0, seed) % 65536) / 65535;
  const a = corner(xi, yi), b = corner(xi + 1, yi);
  const c = corner(xi, yi + 1), d = corner(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fractalNoise2D(x, y, seed, octaves = 4, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp; amp *= gain; freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

export const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, t) => { const x = clamp((t - a) / (b - a || 1), 0, 1); return x * x * (3 - 2 * x); };
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Frame-rate independent exponential approach. */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function formatCash(n) {
  return '$' + Math.max(0, Math.round(n)).toLocaleString('en-US');
}

/** Shortest signed angular difference in radians. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const TAU = Math.PI * 2;

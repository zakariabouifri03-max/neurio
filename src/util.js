// ── Shared math, seeded RNG & procedural noise helpers ───────────────────────

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (r, a, b) => a + (b - a) * r();
export const randi = (r, a, b) => Math.floor(rand(r, a, b + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function hexLerp(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

export function hexToCss(num) {
  return '#' + (num >>> 0).toString(16).padStart(6, '0');
}

// Fast 2D value noise for desert dunes & road elevation
function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) ^ 0x5bf03635;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

export function noise2D(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

// Highway centerline X and Y as a function of Z (infinite in both +Z and -Z directions!)
// Straight from z = -50 to z = 80 near the starter house, then winds gently in both directions.
export function roadX(z) {
  if (z >= -50 && z <= 80) return 0;
  const dist = z > 80 ? z - 80 : z + 50;
  const blend = clamp(Math.abs(dist) / 140, 0, 1);
  const t = dist * 0.0016;
  return blend * (Math.sin(t) * 55 + Math.sin(t * 0.41 + 1.3) * 95 + Math.cos(t * 0.17) * 120 - 120 * Math.cos(0));
}

export function roadSlopeDxDz(z) {
  const eps = 0.5;
  return (roadX(z + eps) - roadX(z - eps)) / (eps * 2);
}

export function roadHeading(z) {
  return Math.atan2(roadSlopeDxDz(z), 1);
}

export function roadY(z) {
  if (z >= -60 && z <= 90) return 0;
  const dist = z > 90 ? z - 90 : z + 60;
  const blend = clamp(Math.abs(dist) / 150, 0, 1);
  const t = dist * 0.0020;
  return blend * (Math.sin(t) * 4.5 + Math.sin(t * 0.37) * 8.5);
}

// Desert terrain height at any world (x, z)
// Flat around starter compound (x in [-45, 45], z in [-45, 75]) and smoothly matches roadY(z) on the highway
export function terrainHeight(x, z) {
  const rx = roadX(z);
  const ry = roadY(z);
  const distFromRoad = Math.abs(x - rx);

  // Road bed + shoulder (width ~11m)
  if (distFromRoad < 6.2) {
    return ry;
  }

  // Starter compound flattening
  const homeDist = Math.hypot(x - (-16), z - 10);
  const homeFlat = smoothstep(22, 48, homeDist);

  // Roadside POI pads are flattened near road shoulder (6.2m .. 34m) at POI z coordinates
  const shoulderBlend = smoothstep(6.2, 26.0, distFromRoad);

  // Multi-octave desert dunes
  const n1 = (noise2D(x * 0.012, z * 0.012) - 0.48) * 18;
  const n2 = (noise2D(x * 0.045 + 17.3, z * 0.045 + 9.1) - 0.5) * 4.2;
  const n3 = Math.max(0, noise2D(x * 0.004 - 5.2, z * 0.004 + 3.7) - 0.58) * 65; // distant mesas/hills
  const mesaBlend = smoothstep(28, 95, distFromRoad);

  const duneH = (n1 + n2 + n3 * mesaBlend) * shoulderBlend * homeFlat;
  return ry + duneH;
}

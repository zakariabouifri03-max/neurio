// neurio Craft — seeded value-noise (2D + 3D) & hashing. No dependencies,
// so world generation can be unit-tested outside the browser.

export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? 'neurio');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const smooth = (t) => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;

export class Noise {
  constructor(seed) {
    this.seed = (typeof seed === 'string' ? seedFromString(seed) : seed >>> 0) || 1;
  }

  // Integer lattice hash → [0,1). Works for negative coordinates.
  hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(this.seed | 0, 974634211);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 2246822519) ^ Math.imul(z | 0, 668265263) ^ Math.imul(this.seed | 0, 3266489917);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Deterministic per-column random (trees, plants, ores decoration…)
  rand2(x, z, salt = 0) {
    return this.hash2((x | 0) + Math.imul(salt | 0, 1013904223), (z | 0) - Math.imul(salt | 0, 1664525));
  }

  noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = this.hash2(xi, yi), b = this.hash2(xi + 1, yi);
    const c = this.hash2(xi, yi + 1), d = this.hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v); // [0,1)
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm; // [0,1)
  }

  noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = smooth(xf), v = smooth(yf), w = smooth(zf);
    const c000 = this.hash3(xi, yi, zi),     c100 = this.hash3(xi + 1, yi, zi);
    const c010 = this.hash3(xi, yi + 1, zi), c110 = this.hash3(xi + 1, yi + 1, zi);
    const c001 = this.hash3(xi, yi, zi + 1),     c101 = this.hash3(xi + 1, yi, zi + 1);
    const c011 = this.hash3(xi, yi + 1, zi + 1), c111 = this.hash3(xi + 1, yi + 1, zi + 1);
    return lerp(
      lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
      lerp(lerp(c001, c101, u), lerp(c011, c111, u), v), w);
  }

  fbm3(x, y, z, octaves = 3) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

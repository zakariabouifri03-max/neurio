// ── seeded value noise (2D / 3D) + fBm — deterministic world shapes ─────────
import { mulberry32 } from '../util.js';

export function makeNoise(seed) {
  const PERM = new Uint8Array(512);
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];

  const hash2 = (x, y) => PERM[(PERM[x & 255] + (y & 255)) & 511] / 255;
  const hash3 = (x, y, z) => PERM[(PERM[(PERM[x & 255] + (y & 255)) & 511] + (z & 255)) & 511] / 255;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;   // −1..1
  }

  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
  }

  function fbm2(x, y, oct = 4, lac = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise2(x * freq, y * freq) * amp; norm += amp; amp *= gain; freq *= lac; }
    return sum / norm;
  }
  function fbm3(x, y, z, oct = 3) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise3(x * freq, y * freq, z * freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  }
  function ridged2(x, y, oct = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += (1 - Math.abs(noise2(x * freq, y * freq))) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return (sum / norm) * 2 - 1;
  }

  return { noise2, noise3, fbm2, fbm3, ridged2, rnd };
}

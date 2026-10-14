// ── Deterministic randomness + noise ────────────────────────────────────────
// Everything in the Giant Worlds is generated from an integer seed, so
// "planet #37" always looks exactly the same on every visit.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (r, a, b) => a + (b - a) * r();
export const randi = (r, a, b) => Math.floor(a + r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// ── 2D gradient (Perlin-style) noise ────────────────────────────────────────
export function makeNoise2D(seed) {
  const r = mulberry32(seed);
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y;  case 1: return x - y;  case 2: return -x + y; case 3: return -x - y;
      case 4: return x;      case 5: return -x;     case 6: return y;      default: return -y;
    }
  };

  return function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // ≈ -1..1
  };
}

// fractal brownian motion — layered noise, the shape of every hill here
export function fbm(noise, x, y, octaves = 4, lac = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;
}

// hex helpers
export const hex2rgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mixHex = (a, b, t) => {
  const A = hex2rgb(a), B = hex2rgb(b);
  const c = (i) => Math.round(lerp(A[i], B[i], t));
  return `#${((1 << 24) + (c(0) << 16) + (c(1) << 8) + c(2)).toString(16).slice(1)}`;
};

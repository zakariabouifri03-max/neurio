// أدوات صغيرة مشتركة — util.js
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

// مولّد أرقام عشوائية بسييد ثابت
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const r = mulberry32(seed >>> 0);
  const f = () => r();
  f.range = (a, b) => a + (b - a) * r();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * r()) - (r() < 0 ? 1 : 0);
  f.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
  f.chance = (p) => r() < p;
  return f;
}

// ضجيج قيمي بسيط (value noise) 2D
export function makeNoise2D(seed) {
  const r = mulberry32(seed);
  const size = 256;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const fade = (t) => t * t * (3 - 2 * t);
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
  };
}

export function shuffle(arr, r) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// تنسيق الوقت داخل اللعبة
export function clockText(t) {
  const total = ((t % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60), m = Math.floor(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 0 = نهار كامل، 1 = ليل كامل
export function nightAmount(hour) {
  // مغرب 18:30 → صباح 06:00
  if (hour >= 20 || hour < 5) return 1;
  if (hour >= 18.5 && hour < 20) return smoothstep((hour - 18.5) / 1.5);
  if (hour >= 5 && hour < 6.5) return 1 - smoothstep((hour - 5) / 1.5);
  return 0;
}

export function sunsetAmount(hour) {
  if (hour >= 17.5 && hour < 19.5) return Math.sin(((hour - 17.5) / 2) * Math.PI);
  if (hour >= 5 && hour < 6.5) return Math.sin(((hour - 5) / 1.5) * Math.PI) * 0.6;
  return 0;
}

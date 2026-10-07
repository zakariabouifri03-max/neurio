// Background worker: computes in-between keys for animation tracks (self-contained; classic worker).
const bounceOut = (t) => { const n1 = 7.5625, d1 = 2.75; if (t < 1 / d1) return n1 * t * t; if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75; if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375; return n1 * (t -= 2.625 / d1) * t + 0.984375; };
function solveBezier(x1, y1, x2, y2, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 30; i++) { const xe = ((ax * t + bx) * t + cx) * t; if (xe < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  return ((ay * t + by) * t + cy) * t;
}
const EASE = {
  linear: (t) => t, easeIn: (t) => t * t * t, easeOut: (t) => 1 - (1 - t) ** 3, easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2), bounce: bounceOut,
  elastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; }, hold: (t) => (t >= 1 ? 1 : 0),
};
function ease(t, key, bz) { t = Math.max(0, Math.min(1, t)); if (key === 'bezier') { const b = bz || [0.25, 0.1, 0.25, 1]; return solveBezier(b[0], b[1], b[2], b[3], t); } return (EASE[key] || EASE.linear)(t); }
function compute(tracks, n, easing) {
  const out = {}; let count = 0;
  for (const [name, keys] of Object.entries(tracks)) {
    const real = keys.filter((k) => !k.ib); const add = [];
    for (let i = 0; i + 1 < real.length; i++) {
      const a = real[i], b = real[i + 1]; const e0 = a.ibE || a.e || 'easeInOut'; if (e0 === 'hold' || b.f - a.f <= n) continue;
      if (Math.abs(a.v - b.v) < 1e-9) continue;
      const use = easing === 'keep' ? e0 : easing;
      for (let f = a.f + n; f < b.f - Math.max(1, n / 2) + 0.001; f += n) { const t = (f - a.f) / (b.f - a.f); add.push({ f, v: a.v + (b.v - a.v) * ease(t, use, a.bz), e: 'linear', ib: true }); count++; }
    }
    if (add.length) out[name] = add;
  }
  return { out, count };
}
self.onmessage = (e) => { const { id, tracks, n, ease: easing } = e.data; try { const r = compute(tracks, n, easing); self.postMessage({ id, ...r }); } catch (err) { self.postMessage({ id, error: String(err) }); } };

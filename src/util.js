/* ============================================================
   Botola 25 — util.js
   Tiny math / RNG helpers. No DOM, no Three.js → runs in Node too.
   ============================================================ */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/* Deterministic RNG (mulberry32) so replays / tests are repeatable */
export function rngFrom(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.range = (a, b) => a + f() * (b - a);
  f.irange = (a, b) => a + Math.floor(f() * (b - a + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  f.gauss = () => {
    // Box-Muller, clamped so stats never go absurd
    let u = 0, v = 0;
    while (u === 0) u = f();
    while (v === 0) v = f();
    return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v), -3, 3);
  };
  f.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(f() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return f;
}

/* ---- flat 3-vector math (plain objects {x,y,z}) ---- */
export const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vset = (o, x, y, z) => ((o.x = x), (o.y = y), (o.z = z), o);
export const vcopy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vlen = (a) => Math.hypot(a.x, a.y, a.z);
export const vlen2 = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/* horizontal (pitch-plane) distance — what football actually cares about */
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2D2 = (a, b) => {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
};
export const vnorm = (a) => {
  const l = vlen(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const norm2D = (x, z) => {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
};
export const dot2D = (ax, az, bx, bz) => ax * bx + az * bz;

/* shortest signed angle difference (radians) */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const approachAngle = (cur, target, maxStep) => {
  const d = angleDelta(cur, target);
  return cur + clamp(d, -maxStep, maxStep);
};

/* exponential smoothing that is frame-rate independent */
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
export const pad2 = (n) => (n < 10 ? '0' : '') + n;

/* clock in match-minutes → "MM:SS"-ish display of the football clock */
export function matchClockStr(minutes) {
  const m = Math.max(0, Math.floor(minutes));
  return String(Math.min(90, m));
}

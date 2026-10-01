// ── IRONVOW — math & geometry helpers ────────────────────────────────────────
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Frame-rate independent exponential approach. */
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Critically-damped-ish spring used for hand/weapon servos. */
export function springStep(cur, target, vel, k, c, dt) {
  const a = (target - cur) * k - vel * c;
  const nv = vel + a * dt;
  return [cur + nv * dt, nv];
}

// ── deterministic RNG ───────────────────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (r, a, b) => a + (b - a) * r();
export const randSym = (r, a) => (r() * 2 - 1) * a;
export const pick = (r, arr) => arr[Math.min(arr.length - 1, (r() * arr.length) | 0)];

/** Cheap hash-noise in [0,1) — used by texture & FX generation. */
export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothed value noise, fbm-composable. */
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, oct = 4, seed = 0, gain = 0.5, lac = 2) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, y * f, seed + i * 37) * amp;
    norm += amp; amp *= gain; f *= lac;
  }
  return s / norm;
}

// ── shared scratch objects (avoid per-frame allocation) ─────────────────────
export const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
export const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
export const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
export const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
export const _e1 = new THREE.Euler();
export const _c1 = new THREE.Color(), _c2 = new THREE.Color();

export const UP = new THREE.Vector3(0, 1, 0);
export const FWD = new THREE.Vector3(0, 0, -1);

/** Angular distance wrapped to [-PI, PI]. */
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function angDamp(a, b, lambda, dt) { return a + angDiff(a, b) * (1 - Math.exp(-lambda * dt)); }

// ── capsule / segment intersections ─────────────────────────────────────────
/**
 * Closest points between segments [p1,q1] and [p2,q2].
 * out = {s,t,c1,c2,d2} — s,t are normalised params along each segment.
 */
export function segSeg(p1, q1, p2, q2, out) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-8;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const den = a * e - b * b;
      s = den > EPS ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  out.s = s; out.t = t;
  out.c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  out.c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
  const dx = out.c1.x - out.c2.x, dy = out.c1.y - out.c2.y, dz = out.c1.z - out.c2.z;
  out.d2 = dx * dx + dy * dy + dz * dz;
  return out;
}
export function makeSegOut() { return { s: 0, t: 0, c1: new THREE.Vector3(), c2: new THREE.Vector3(), d2: 0 }; }

/** Ray vs sphere; returns hit distance or -1. */
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const k = ox * ox + oy * oy + oz * oz - r * r;
  if (k > 0 && b > 0) return -1;
  const disc = b * b - k;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Ray vs axis-aligned box (slab method). Returns distance or -1. */
export function rayBox(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z], mn = [min.x, min.y, min.z], mx = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(da[i]) < 1e-8) { if (oa[i] < mn[i] || oa[i] > mx[i]) return -1; continue; }
    const inv = 1 / da[i];
    let ta = (mn[i] - oa[i]) * inv, tb = (mx[i] - oa[i]) * inv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

// ── misc ────────────────────────────────────────────────────────────────────
export const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function quatFromDir(dir, roll, out) {
  // Orient so local +Y points along dir, then roll about that axis.
  out.setFromUnitVectors(UP, dir);
  if (roll) out.multiply(_q1.setFromAxisAngle(UP, roll));
  return out;
}

/** Random point in a horizontal disc. */
export function randDisc(rng, radius, out) {
  const a = rng() * TAU, r = Math.sqrt(rng()) * radius;
  return out.set(Math.cos(a) * r, 0, Math.sin(a) * r);
}

// ── deterministic chance ────────────────────────────────────────────────────
// A duel must replay: two runs of the same fight, with the same seed, have to
// produce the same wounds, or nothing about the fight can be tested. Every
// "random" choice inside the game comes through here.
let _seed = 0x9e3779b9;
export function srand(seed) { _seed = ((seed >>> 0) || 0x9e3779b9) >>> 0; }
export function rnd() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
/** Uniform in [a, b). */
export function rr(a, b) { return a + (b - a) * rnd(); }
/** A symmetric jitter in [−a, a): the shape of most human error. */
export function jitter(a) { return (rnd() * 2 - 1) * a; }

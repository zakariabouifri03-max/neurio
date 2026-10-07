/**
 * 3D LUT support. Built-in LUTs are generated procedurally (32^3). User LUTs can be
 * imported from .cube files. Also provides the 1D curve texture builder.
 */
import type { CurvePoint, Curves } from '@/core/types';
import { clamp } from '@/core/util';

export const LUT_SIZE = 32;

export interface LUTDef {
  id: string;
  name: string;
  category: 'Cinematic' | 'Film' | 'Vintage' | 'Mood' | 'Creative' | 'User';
  /** color transform used to generate the table */
  fn?: (r: number, g: number, b: number) => [number, number, number];
  data?: Uint8Array;
  size?: number;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (r: number, g: number, b: number, s: number): [number, number, number] => {
  const l = lum(r, g, b);
  return [mix(l, r, s), mix(l, g, s), mix(l, b, s)];
};
const contrast = (v: number, c: number) => (v - 0.5) * c + 0.5;
const lift = (v: number, l: number) => v * (1 - l) + l;
const sCurve = (v: number, k: number) => {
  const s = 1 / (1 + Math.exp(-k * (v - 0.5)));
  const lo = 1 / (1 + Math.exp(k * 0.5)), hi = 1 / (1 + Math.exp(-k * 0.5));
  return (s - lo) / (hi - lo);
};

export const LUTS: LUTDef[] = [
  { id: 'none', name: 'None', category: 'Cinematic' },
  { id: 'teal_orange', name: 'Teal & Orange', category: 'Cinematic', fn: (r, g, b) => { const l = lum(r, g, b); const t = l; const [sr, sg, sb] = sat(r, g, b, 1.15); return [mix(sr, mix(0.0, 1.0, t) * 0.9 + sr * 0.3, 0.25), mix(sg, mix(0.35, 0.6, t) * 0.5 + sg * 0.5, 0.2), mix(sb, mix(0.5, 0.2, t) * 0.7 + sb * 0.4, 0.3)]; } },
  { id: 'blockbuster', name: 'Blockbuster', category: 'Cinematic', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 1.1); return [sCurve(sr, 6) * 1.02, sCurve(sg, 6) * 0.98, sCurve(sb, 6) * 0.95 + 0.02]; } },
  { id: 'moody_blue', name: 'Moody Blue', category: 'Mood', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.85); return [sr * 0.92, sg * 0.97, lift(sb, 0.06) * 1.02]; } },
  { id: 'golden_hour', name: 'Golden Hour', category: 'Mood', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 1.1); return [Math.min(1, sr * 1.08 + 0.02), sg * 1.0, sb * 0.85]; } },
  { id: 'noir', name: 'Noir', category: 'Film', fn: (r, g, b) => { const l = sCurve(lum(r, g, b), 7); return [l, l, l]; } },
  { id: 'kodak_warm', name: 'Warm Film', category: 'Film', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 1.05); return [lift(sCurve(sr, 4), 0.03) * 1.03, lift(sCurve(sg, 4), 0.02), lift(sCurve(sb, 4), 0.0) * 0.92]; } },
  { id: 'fuji_green', name: 'Cool Film', category: 'Film', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.95); return [lift(sr, 0.02) * 0.96, lift(sg, 0.03) * 1.02, lift(sb, 0.04) * 1.0]; } },
  { id: 'faded', name: 'Faded', category: 'Vintage', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.8); return [lift(sr, 0.1) * 0.9, lift(sg, 0.09) * 0.9, lift(sb, 0.1) * 0.88]; } },
  { id: 'sepia', name: 'Sepia', category: 'Vintage', fn: (r, g, b) => [Math.min(1, 0.393 * r + 0.769 * g + 0.189 * b), Math.min(1, 0.349 * r + 0.686 * g + 0.168 * b), Math.min(1, 0.272 * r + 0.534 * g + 0.131 * b)] },
  { id: 'cross_process', name: 'Cross Process', category: 'Creative', fn: (r, g, b) => [sCurve(r, 8), sCurve(g, 5), contrast(b, 0.8) + 0.05] },
  { id: 'bleach', name: 'Bleach Bypass', category: 'Film', fn: (r, g, b) => { const l = lum(r, g, b); const [sr, sg, sb] = sat(r, g, b, 0.5); const ov = (v: number) => (l < 0.5 ? 2 * v * l : 1 - 2 * (1 - v) * (1 - l)); return [mix(sr, ov(sr), 0.7), mix(sg, ov(sg), 0.7), mix(sb, ov(sb), 0.7)]; } },
  { id: 'cyber', name: 'Cyber Neon', category: 'Creative', fn: (r, g, b) => { const l = lum(r, g, b); return [mix(r, mix(0.1, 1.0, l), 0.4) * 1.05, mix(g, mix(0.0, 0.3, l), 0.35), mix(b, mix(0.3, 1.0, l), 0.4)]; } },
  { id: 'matrix', name: 'Matrix', category: 'Creative', fn: (r, g, b) => { const l = lum(r, g, b); return [l * 0.3, Math.min(1, l * 1.1), l * 0.4]; } },
  { id: 'pastel', name: 'Pastel', category: 'Mood', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.7); return [lift(sr, 0.15), lift(sg, 0.13), lift(sb, 0.17)]; } },
  { id: 'punchy', name: 'Punchy', category: 'Creative', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 1.4); return [sCurve(sr, 8), sCurve(sg, 8), sCurve(sb, 8)]; } },
  { id: 'horror', name: 'Horror', category: 'Mood', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.6); const l = lum(r, g, b); return [contrast(sr, 1.3) * 0.9 + (l > 0.6 ? 0.1 : 0), contrast(sg, 1.3) * 0.95, contrast(sb, 1.3) * 0.85]; } },
  { id: 'summer', name: 'Summer', category: 'Mood', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 1.2); return [Math.min(1, sr * 1.05 + 0.02), sg * 1.02, sb * 0.95]; } },
  { id: 'winter', name: 'Winter', category: 'Mood', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.9); return [sr * 0.95, sg * 0.98, Math.min(1, sb * 1.06 + 0.03)]; } },
  { id: 'cinema_green', name: 'Matrix Green Tint', category: 'Cinematic', fn: (r, g, b) => { const [sr, sg, sb] = sat(r, g, b, 0.95); return [sr * 0.95, sg * 1.02, sb * 0.92]; } },
];

const cache = new Map<string, Uint8Array>();
export function lutData(def: LUTDef): Uint8Array | null {
  if (def.data) return def.data;
  if (!def.fn) return null;
  let d = cache.get(def.id);
  if (d) return d;
  const N = LUT_SIZE;
  d = new Uint8Array(N * N * N * 3);
  let i = 0;
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const [or, og, ob] = def.fn(r / (N - 1), g / (N - 1), b / (N - 1));
        d[i++] = Math.round(clamp(or, 0, 1) * 255);
        d[i++] = Math.round(clamp(og, 0, 1) * 255);
        d[i++] = Math.round(clamp(ob, 0, 1) * 255);
      }
  cache.set(def.id, d);
  return d;
}

const userLuts: LUTDef[] = [];
export function allLuts(): LUTDef[] {
  return [...LUTS, ...userLuts];
}
export function getLut(id: string): LUTDef | undefined {
  return LUTS.find((l) => l.id === id) || userLuts.find((l) => l.id === id);
}

/** Parse an Adobe .cube 3D LUT. Resamples to 32^3 if needed. */
export function parseCube(text: string, name: string): LUTDef {
  const lines = text.split(/\r?\n/);
  let size = 0;
  const vals: number[] = [];
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue;
    if (line.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(/\s+/)[1]);
    else if (line.startsWith('DOMAIN_MIN')) dmin = line.split(/\s+/).slice(1, 4).map(Number);
    else if (line.startsWith('DOMAIN_MAX')) dmax = line.split(/\s+/).slice(1, 4).map(Number);
    else if (line.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs are not supported');
    else {
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.every((n) => !isNaN(n))) vals.push(parts[0], parts[1], parts[2]);
    }
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('Invalid .cube file');
  const sample = (r: number, g: number, b: number): [number, number, number] => {
    // trilinear sample from source table
    const f = (v: number) => v * (size - 1);
    const fr = f(r), fg = f(g), fb = f(b);
    const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
    const r1 = Math.min(size - 1, r0 + 1), g1 = Math.min(size - 1, g0 + 1), b1 = Math.min(size - 1, b0 + 1);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    const at = (ri: number, gi: number, bi: number, c: number) => vals[((bi * size + gi) * size + ri) * 3 + c];
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const c00 = mix(at(r0, g0, b0, c), at(r1, g0, b0, c), tr), c10 = mix(at(r0, g1, b0, c), at(r1, g1, b0, c), tr);
      const c01 = mix(at(r0, g0, b1, c), at(r1, g0, b1, c), tr), c11 = mix(at(r0, g1, b1, c), at(r1, g1, b1, c), tr);
      const v = mix(mix(c00, c10, tg), mix(c01, c11, tg), tb);
      out[c] = (v - dmin[c]) / (dmax[c] - dmin[c] || 1);
    }
    return out;
  };
  const def: LUTDef = { id: `user_${Date.now().toString(36)}`, name: name.replace(/\.cube$/i, ''), category: 'User', fn: sample };
  def.data = lutData(def)!;
  userLuts.push(def);
  return def;
}

/* ---------------- Curves ---------------- */

/** Monotone cubic interpolation through control points, sampled to 256 values. */
export function sampleCurve(points: CurvePoint[], n = 256): Float32Array {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const out = new Float32Array(n);
  if (pts.length < 2) {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1);
    return out;
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const m = xs.length;
  const d: number[] = [], ms: number[] = [];
  for (let i = 0; i < m - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  ms.push(d[0]);
  for (let i = 1; i < m - 1; i++) ms.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  ms.push(d[m - 2]);
  for (let i = 0; i < m - 1; i++) {
    if (d[i] === 0) {
      ms[i] = ms[i + 1] = 0;
      continue;
    }
    const a = ms[i] / d[i], b = ms[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      ms[i] = t * a * d[i];
      ms[i + 1] = t * b * d[i];
    }
  }
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    if (x <= xs[0]) {
      out[i] = clamp(ys[0], 0, 1);
      continue;
    }
    if (x >= xs[m - 1]) {
      out[i] = clamp(ys[m - 1], 0, 1);
      continue;
    }
    let k = 0;
    while (k < m - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    out[i] = clamp(h00 * ys[k] + h10 * h * ms[k] + h01 * ys[k + 1] + h11 * h * ms[k + 1], 0, 1);
  }
  return out;
}

export function curvesTextureData(c: Curves): Uint8Array {
  const master = sampleCurve(c.master), r = sampleCurve(c.red), g = sampleCurve(c.green), b = sampleCurve(c.blue);
  const d = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    d[i * 4] = Math.round(master[i] * 255);
    d[i * 4 + 1] = Math.round(r[i] * 255);
    d[i * 4 + 2] = Math.round(g[i] * 255);
    d[i * 4 + 3] = Math.round(b[i] * 255);
  }
  return d;
}

export function isDefaultCurve(points: CurvePoint[]): boolean {
  return points.length === 2 && Math.abs(points[0].x) < 1e-6 && Math.abs(points[0].y) < 1e-6 && Math.abs(points[1].x - 1) < 1e-6 && Math.abs(points[1].y - 1) < 1e-6;
}

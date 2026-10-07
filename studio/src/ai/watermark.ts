/**
 * Watermark / logo removal.
 *
 * Detection (real analysis, no neural model): a burnt-in watermark is a region whose pixels are
 * temporally STABLE (low variance across frames) while having strong EDGES (unlike a static plain
 * background). We sample frames across the clip, compute per-pixel temporal std-dev + mean gradient,
 * threshold, and extract connected components → candidate rectangles ranked by score.
 *
 * Removal is done by the `watermark` GPU effect: content-aware fill (harmonic interpolation from the
 * rectangle's surroundings), blur, pixelate or clone-from-offset. It hides the mark — it cannot
 * recover what was underneath it (be upfront with users about that).
 */
import type { VideoClip, ImageClip, Clip, VisualClip } from '@/core/types';
import { openGrabber } from './frames';
import { useProject } from '@/core/store';
import * as cmd from '@/core/commands';
import { getEffect } from '@/library/effects';
import { uid } from '@/core/util';
import { vec as evalVec } from '@/core/keyframes';

export interface Region {
  x: number; // top-left, normalized 0..1 of the source frame
  y: number;
  w: number;
  h: number;
}
export interface WatermarkCandidate extends Region {
  score: number; // 0..1
  coverage: number; // fraction of frame
  corner: string | null;
}
export interface DetectOptions {
  samples?: number;
  onProgress?: (p: number) => void;
  signal?: { cancelled: boolean };
}

export async function detectWatermarks(clip: VideoClip | ImageClip, opts: DetectOptions = {}): Promise<{ candidates: WatermarkCandidate[]; sampled: number; note: string } | null> {
  if (clip.kind !== 'video') return { candidates: [], sampled: 0, note: 'Auto-detect needs a video (it looks for pixels that stay fixed while the picture moves). Draw the region manually for images.' };
  const g = await openGrabber(clip.mediaId, 320);
  if (!g) return null;
  const rate = clip.speed.rate || 1;
  const from = clip.mediaIn;
  const to = Math.min(g.duration || from + clip.duration * rate, from + clip.duration * rate);
  const span = Math.max(0.1, to - from);
  const n = Math.max(6, Math.min(opts.samples ?? 28, Math.round(span * 2)));
  const W = g.width, H = g.height, N = W * H;
  const sum = new Float32Array(N), sq = new Float32Array(N), grad = new Float32Array(N);
  const lum = new Float32Array(N);
  let sampled = 0;
  try {
    for (let i = 0; i < n; i++) {
      if (opts.signal?.cancelled) return null;
      const t = from + ((i + 0.5) / n) * span;
      const img = await g.grab(Math.min(to - 0.01, t));
      const d = img.data;
      for (let p = 0, k = 0; p < N; p++, k += 4) lum[p] = d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const p = y * W + x;
          const gx = lum[p + 1] - lum[p - 1], gy = lum[p + W] - lum[p - W];
          grad[p] += Math.abs(gx) + Math.abs(gy);
          sum[p] += lum[p];
          sq[p] += lum[p] * lum[p];
        }
      sampled++;
      opts.onProgress?.((i + 1) / n);
    }
  } finally {
    g.dispose();
  }
  if (sampled < 4) return { candidates: [], sampled, note: 'Clip too short to analyze — draw the region manually.' };
  // per-pixel temporal std + mean gradient
  const mask = new Uint8Array(N);
  let staticEdges = 0, anyMotion = 0;
  for (let p = 0; p < N; p++) {
    const mean = sum[p] / sampled;
    const sd = Math.sqrt(Math.max(0, sq[p] / sampled - mean * mean));
    const gm = grad[p] / sampled;
    if (sd > 10) anyMotion++;
    if (sd < 7 && gm > 28) { mask[p] = 1; staticEdges++; }
  }
  if (anyMotion < N * 0.03) return { candidates: [], sampled, note: 'The picture barely changes across the clip, so static watermarks cannot be separated from the background. Draw the region manually.' };
  if (staticEdges > N * 0.3) return { candidates: [], sampled, note: 'Too much of the frame is static — detection is unreliable here. Draw the region manually.' };
  // dilate (3×3) to connect letters/logo parts
  const dil = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (mask[p] || mask[p - 1] || mask[p + 1] || mask[p - W] || mask[p + W] || mask[p - W - 1] || mask[p - W + 1] || mask[p + W - 1] || mask[p + W + 1]) dil[p] = 1;
    }
  for (let pass = 0; pass < 2; pass++) {
    const src = dil.slice();
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (src[p] || src[p - 1] || src[p + 1] || src[p - W] || src[p + W]) dil[p] = 1;
      }
  }
  // connected components (BFS)
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  const comps: { minX: number; minY: number; maxX: number; maxY: number; area: number; edge: number }[] = [];
  for (let p0 = 0; p0 < N; p0++) {
    if (!dil[p0] || seen[p0]) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0, edge = 0;
    stack.push(p0);
    seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      area++;
      edge += mask[p];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [p - 1, p + 1, p - W, p + W];
      for (const q of nb) {
        if (q < 0 || q >= N || seen[q] || !dil[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    comps.push({ minX, minY, maxX, maxY, area, edge });
  }
  const cands: WatermarkCandidate[] = [];
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    const cov = (bw * bh) / N;
    if (cov < 0.0008 || cov > 0.2 || bw < 6 || bh < 4) continue;
    const density = c.area / (bw * bh);
    const cx = (c.minX + bw / 2) / W, cy = (c.minY + bh / 2) / H;
    const nearEdge = Math.min(cx, 1 - cx) < 0.3 || Math.min(cy, 1 - cy) < 0.25;
    const corner = (Math.min(cx, 1 - cx) < 0.3 && Math.min(cy, 1 - cy) < 0.25) ? `${cy < 0.5 ? 'top' : 'bottom'}-${cx < 0.5 ? 'left' : 'right'}` : null;
    const score = Math.min(1, (c.edge / Math.max(1, c.area)) * 0.6 + density * 0.3 + (corner ? 0.25 : nearEdge ? 0.1 : 0) + Math.min(0.15, cov * 3));
    const padX = 3 / W, padY = 3 / H;
    cands.push({ x: Math.max(0, c.minX / W - padX), y: Math.max(0, c.minY / H - padY), w: Math.min(1, bw / W + 2 * padX), h: Math.min(1, bh / H + 2 * padY), score, coverage: cov, corner });
  }
  cands.sort((a, b) => b.score - a.score);
  // merge heavily overlapping candidates
  const out: WatermarkCandidate[] = [];
  for (const c of cands) {
    if (out.some((o) => overlap(o, c) > 0.5)) continue;
    out.push(c);
    if (out.length >= 5) break;
  }
  return { candidates: out, sampled, note: out.length ? `${out.length} static high-contrast region${out.length === 1 ? '' : 's'} found in ${sampled} sampled frames.` : `No static logo-like region found in ${sampled} frames — draw it manually.` };
}

function overlap(a: Region, b: Region) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

export type RemoveMode = 'fill' | 'blur' | 'pixelate' | 'clone';
const MODE_INDEX: Record<RemoveMode, number> = { fill: 0, blur: 1, pixelate: 2, clone: 3 };

/** Adds (or updates) a `watermark` effect on the clip for the given region. Returns the effect id. */
export function applyWatermarkRemoval(clip: Clip, region: Region, opts: { mode?: RemoveMode; feather?: number; strength?: number; clone?: { dx: number; dy: number }; replaceExisting?: boolean } = {}): string | null {
  const def = getEffect('watermark');
  if (!def || clip.kind === 'audio') return null;
  const params: Record<string, { value: number }> = {};
  def.params.forEach((pd) => (params[pd.key] = { value: pd.default }));
  params.x.value = clamp01(region.x); params.y.value = clamp01(region.y);
  params.w.value = Math.max(0.005, Math.min(1, region.w)); params.h.value = Math.max(0.005, Math.min(1, region.h));
  params.feather.value = opts.feather ?? 0.3;
  params.mode.value = MODE_INDEX[opts.mode ?? 'fill'];
  params.strength.value = opts.strength ?? 0.6;
  if (opts.clone) { params.dx.value = opts.clone.dx; params.dy.value = opts.clone.dy; }
  const fx = { id: uid('fx'), type: 'watermark', enabled: true, params };
  useProject.getState().apply('Remove watermark', (p) =>
    cmd.updateClip(p, clip.id, (c) => {
      const v = c as VisualClip;
      const kept = opts.replaceExisting ? v.effects.filter((e) => e.type !== 'watermark') : v.effects;
      return { ...v, effects: [...kept, fx] } as Clip;
    }),
  );
  return fx.id;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Converts a region drawn on the preview (canvas-normalized) into the clip's own frame coordinates. */
export function canvasRegionToClip(region: Region, clip: VisualClip, canvas: { width: number; height: number }, asset: { width?: number; height?: number } | null, time: number): Region {
  // Approximation: ignores rotation; accounts for fit-scale, transform scale and position.
  const aw = asset?.width || canvas.width, ah = asset?.height || canvas.height;
  const fit = Math.min(canvas.width / aw, canvas.height / ah);
  const sc = evalVec(clip.transform.scale, time, { x: 1, y: 1 });
  const pos = evalVec(clip.transform.position, time, { x: 0, y: 0 });
  const dispW = aw * fit * sc.x, dispH = ah * fit * sc.y;
  const left = canvas.width / 2 + pos.x - dispW / 2, top = canvas.height / 2 + pos.y - dispH / 2;
  const x0 = (region.x * canvas.width - left) / dispW, y0 = (region.y * canvas.height - top) / dispH;
  const x1 = ((region.x + region.w) * canvas.width - left) / dispW, y1 = ((region.y + region.h) * canvas.height - top) / dispH;
  const rx = clamp01(Math.min(x0, x1)), ry = clamp01(Math.min(y0, y1));
  return { x: rx, y: ry, w: Math.max(0.005, clamp01(Math.max(x0, x1)) - rx), h: Math.max(0.005, clamp01(Math.max(y0, y1)) - ry) };
}


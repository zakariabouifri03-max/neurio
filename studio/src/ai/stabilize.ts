/**
 * Video stabilization analysis: global translation estimation per frame (block matching on a
 * low-resolution luma pyramid) followed by trajectory smoothing. The result is stored on the clip
 * (`stabilization.analysis`) and applied by the renderer as a per-frame counter-translation + crop zoom.
 */
import type { VideoClip, Stabilization } from '@/core/types';
import { getAsset } from '@/engine/MediaManager';
import { openGrabber } from './frames';

export interface StabilizeProgress {
  frame: number;
  total: number;
}

const LEVEL_WINDOW: Record<number, number> = { 1: 6, 2: 15, 3: 30 }; // smoothing radius in frames

function gray(img: ImageData): Float32Array {
  const d = img.data, n = img.width * img.height;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

/** Estimate translation (dx,dy) that maps prev -> cur by minimizing SAD within ±range. */
function estimateShift(prev: Float32Array, cur: Float32Array, w: number, h: number, range: number, prior = { x: 0, y: 0 }): { x: number; y: number } {
  const mx = Math.floor(w * 0.15), my = Math.floor(h * 0.15);
  let best = Infinity, bx = 0, by = 0;
  const step = 2; // subsample for speed
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const sx = prior.x + dx, sy = prior.y + dy;
      let sad = 0, cnt = 0;
      for (let y = my; y < h - my; y += step) {
        const yy = y + sy;
        if (yy < 0 || yy >= h) continue;
        for (let x = mx; x < w - mx; x += step) {
          const xx = x + sx;
          if (xx < 0 || xx >= w) continue;
          sad += Math.abs(prev[y * w + x] - cur[yy * w + xx]);
          cnt++;
        }
      }
      if (cnt) {
        sad /= cnt;
        if (sad < best) {
          best = sad;
          bx = sx;
          by = sy;
        }
      }
    }
  }
  return { x: bx, y: by };
}

export async function analyzeStabilization(clip: VideoClip, level: 1 | 2 | 3, onProgress?: (p: StabilizeProgress) => void, signal?: { cancelled: boolean }): Promise<Stabilization['analysis'] | null> {
  const asset = getAsset(clip.mediaId);
  if (!asset) return null;
  const g = await openGrabber(clip.mediaId, 160);
  if (!g) return null;
  try {
    const srcFps = Math.min(asset.fps || 30, 30);
    const analysisFps = srcFps;
    // analyze the used range of the source (with margin) to keep it quick
    const t0 = Math.max(0, clip.mediaIn - 0.5);
    const t1 = Math.min(asset.duration, clip.mediaIn + (clip.duration * (clip.speed.rate || 1)) + 0.5);
    const total = Math.max(2, Math.ceil((t1 - t0) * analysisFps));
    const scaleX = asset.width / g.width, scaleY = asset.height / g.height;
    const motion: number[] = []; // per analyzed frame: dx, dy (frame-to-frame)
    let prev: Float32Array | null = null;
    let prior = { x: 0, y: 0 };
    for (let i = 0; i < total; i++) {
      if (signal?.cancelled) return null;
      const img = await g.grab(t0 + i / analysisFps);
      const cur = gray(img);
      if (prev) {
        const s = estimateShift(prev, cur, g.width, g.height, 5, prior);
        prior = { x: Math.max(-6, Math.min(6, Math.round(s.x * 0.5))), y: Math.max(-6, Math.min(6, Math.round(s.y * 0.5))) };
        motion.push(s.x, s.y);
      } else motion.push(0, 0);
      prev = cur;
      onProgress?.({ frame: i + 1, total });
    }
    // trajectory
    const n = motion.length / 2;
    const traj = new Float32Array(n * 2);
    for (let i = 1; i < n; i++) {
      traj[i * 2] = traj[(i - 1) * 2] + motion[i * 2];
      traj[i * 2 + 1] = traj[(i - 1) * 2 + 1] + motion[i * 2 + 1];
    }
    // smooth with a gaussian window
    const r = LEVEL_WINDOW[level] ?? 15;
    const weights: number[] = [];
    for (let k = -r; k <= r; k++) weights.push(Math.exp(-(k * k) / (2 * (r / 2) * (r / 2))));
    const smooth = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, ws = 0;
      for (let k = -r; k <= r; k++) {
        const j = Math.max(0, Math.min(n - 1, i + k));
        const w = weights[k + r];
        sx += traj[j * 2] * w;
        sy += traj[j * 2 + 1] * w;
        ws += w;
      }
      smooth[i * 2] = sx / ws;
      smooth[i * 2 + 1] = sy / ws;
    }
    // correction = raw - smooth, in source pixels, indexed by absolute source frame (pad start)
    const startFrame = Math.round(t0 * analysisFps);
    const outLen = startFrame + n;
    const smoothed = new Array(outLen * 2).fill(0);
    const offsets = new Array(outLen * 2).fill(0);
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
      const cx = (traj[i * 2] - smooth[i * 2]) * scaleX;
      const cy = (traj[i * 2 + 1] - smooth[i * 2 + 1]) * scaleY;
      smoothed[(startFrame + i) * 2] = cx;
      smoothed[(startFrame + i) * 2 + 1] = cy;
      offsets[(startFrame + i) * 2] = motion[i * 2] * scaleX;
      offsets[(startFrame + i) * 2 + 1] = motion[i * 2 + 1] * scaleY;
      maxOff = Math.max(maxOff, Math.abs(cx) / asset.width, Math.abs(cy) / asset.height);
    }
    return { fps: analysisFps, offsets, smoothed, maxOffset: Math.min(0.25, maxOff) } as any;
  } finally {
    g.dispose();
  }
}

/** Suggested crop zoom so the counter-translation never shows borders. */
export function suggestedCropZoom(analysis: Stabilization['analysis'] & { maxOffset?: number }): number {
  const m = (analysis as any)?.maxOffset ?? 0.04;
  return Math.max(1.02, Math.min(1.4, 1 + m * 2.2));
}

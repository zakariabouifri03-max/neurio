/**
 * Scene / shot change detection — colour-histogram + luminance difference between sampled frames
 * (deterministic signal processing, always available, no model). Produces source-time cut points
 * which can be turned into markers or used to split the clip.
 */
import type { VideoClip } from '@/core/types';
import { openGrabber } from './frames';
import { useProject, addMarker } from '@/core/store';
import * as cmd from '@/core/commands';

export interface SceneCut {
  time: number; // source seconds
  score: number; // 0..1 (how strong the change is)
}
export interface SceneOptions {
  sensitivity?: number; // 0..1 (higher = more cuts)
  minSceneLength?: number; // seconds
  sampleFps?: number;
  onProgress?: (p: number) => void;
  signal?: { cancelled: boolean };
}

function histogram(img: ImageData): { hist: Float32Array; luma: number } {
  const d = img.data;
  const hist = new Float32Array(8 * 8 * 8);
  let luma = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    hist[(r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)] += 1;
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= n;
  return { hist, luma: luma / n / 255 };
}
const histDistance = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / 2; // 0..1
};

export async function detectScenes(clip: VideoClip, opts: SceneOptions = {}): Promise<{ cuts: SceneCut[]; sampled: number } | null> {
  const g = await openGrabber(clip.mediaId, 96);
  if (!g || !g.duration) return null;
  const fps = opts.sampleFps ?? 4;
  const rate = clip.speed.rate || 1;
  const from = clip.mediaIn, to = Math.min(g.duration, clip.mediaIn + clip.duration * rate);
  const step = 1 / fps;
  const n = Math.max(2, Math.floor((to - from) / step));
  const dists: number[] = [];
  const times: number[] = [];
  let prev: { hist: Float32Array; luma: number } | null = null;
  try {
    for (let i = 0; i < n; i++) {
      if (opts.signal?.cancelled) return null;
      const t = from + i * step;
      const img = await g.grab(t);
      const h = histogram(img);
      if (prev) {
        const d = histDistance(prev.hist, h.hist) * 0.7 + Math.abs(prev.luma - h.luma) * 0.3;
        dists.push(d);
        times.push(t);
      }
      prev = h;
      opts.onProgress?.((i + 1) / n);
    }
  } finally {
    g.dispose();
  }
  if (dists.length < 3) return { cuts: [], sampled: n };
  // adaptive threshold: median + k * MAD, scaled by sensitivity
  const sorted = [...dists].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const mad = [...dists.map((d) => Math.abs(d - med))].sort((a, b) => a - b)[Math.floor(sorted.length / 2)] || 0.01;
  const sens = opts.sensitivity ?? 0.5;
  const thr = Math.max(0.12, med + (6 - sens * 4.5) * mad);
  const minLen = opts.minSceneLength ?? 1;
  const cuts: SceneCut[] = [];
  let last = from - minLen;
  for (let i = 0; i < dists.length; i++) {
    const d = dists[i];
    // local peak
    if (d >= thr && d >= (dists[i - 1] ?? 0) && d >= (dists[i + 1] ?? 0) && times[i] - last >= minLen) {
      cuts.push({ time: times[i], score: Math.min(1, d / Math.max(thr, 1e-6) / 2) });
      last = times[i];
    }
  }
  return { cuts, sampled: n };
}

/** Timeline time for a source time inside a clip (constant-rate clips; reverse handled). */
export function sourceToTimeline(clip: VideoClip, src: number): number {
  const rate = clip.speed.rate || 1;
  const span = clip.duration * rate;
  return clip.speed.reversed ? clip.start + (clip.mediaIn + span - src) / rate : clip.start + (src - clip.mediaIn) / rate;
}

export function addSceneMarkers(clip: VideoClip, cuts: SceneCut[]) {
  let n = 0;
  cuts.forEach((c, i) => {
    const t = sourceToTimeline(clip, c.time);
    if (t > clip.start + 0.05 && t < clip.start + clip.duration - 0.05) {
      addMarker(t, `Scene ${i + 2}`, 'chapter', '#f59e0b');
      n++;
    }
  });
  return n;
}

export function splitAtScenes(clip: VideoClip, cuts: SceneCut[]) {
  const st = useProject.getState();
  if (!st.project) return 0;
  const times = cuts.map((c) => sourceToTimeline(clip, c.time)).filter((t) => t > clip.start + 0.05 && t < clip.start + clip.duration - 0.05).sort((a, b) => b - a);
  if (!times.length) return 0;
  let n = 0;
  st.apply('Split at scenes', (p0) => {
    let p = p0;
    for (const t of times) {
      // the clip covering t keeps the original id when splitting from the end
      const found = cmd.findClip(p, clip.id);
      if (!found) break;
      const r = cmd.splitClip(p, found.clip.id, t);
      p = r.project;
      if (r.newId) n++;
    }
    return p;
  });
  return n;
}

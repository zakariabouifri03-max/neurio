/**
 * Highlight detection — a transparent heuristic (NOT a neural model): combines audio loudness peaks,
 * audio onset density and visual motion energy into a per-second score, then picks the best windows.
 */
import type { VideoClip } from '@/core/types';
import { getAudioBuffer, getAsset } from '@/engine/MediaManager';
import { energyEnvelope } from './audioAnalysis';
import { openGrabber } from './frames';

export interface Highlight {
  start: number; // source seconds
  end: number;
  score: number; // 0..1
  reasons: string[];
}
export interface HighlightOptions {
  windowSec?: number; // highlight length
  count?: number;
  useVisual?: boolean;
  onProgress?: (p: number) => void;
  signal?: { cancelled: boolean };
}

export async function detectHighlights(mediaId: string, opts: HighlightOptions = {}): Promise<{ highlights: Highlight[]; note: string } | null> {
  const asset = getAsset(mediaId);
  if (!asset || asset.duration < 2) return null;
  const win = opts.windowSec ?? 5;
  const count = opts.count ?? 5;
  const dur = asset.duration;
  const secs = Math.ceil(dur);
  const audioScore = new Float32Array(secs);
  const onsetScore = new Float32Array(secs);
  const motionScore = new Float32Array(secs);
  const notes: string[] = [];
  // audio
  const buf = await getAudioBuffer(mediaId);
  if (buf) {
    const { env, hopSec } = energyEnvelope(buf, 2048);
    for (let i = 0; i < env.length; i++) {
      const s = Math.min(secs - 1, Math.floor(i * hopSec));
      audioScore[s] = Math.max(audioScore[s], env[i]);
      if (i > 0 && env[i] - env[i - 1] > 0.05) onsetScore[s] += 1;
    }
    notes.push('audio loudness & onsets');
  }
  opts.onProgress?.(0.3);
  // visual motion (sampled 2 fps, tiny frames)
  if (opts.useVisual !== false && asset.type === 'video') {
    const g = await openGrabber(mediaId, 96);
    if (g) {
      try {
        let prev: Uint8ClampedArray | null = null;
        const steps = Math.min(secs * 2, 600);
        for (let i = 0; i < steps; i++) {
          if (opts.signal?.cancelled) return null;
          const t = (i / steps) * dur;
          const img = await g.grab(t);
          if (prev) {
            let s = 0;
            for (let p = 0; p < img.data.length; p += 8) s += Math.abs(img.data[p] - prev[p]);
            motionScore[Math.min(secs - 1, Math.floor(t))] += s / (img.data.length / 8) / 255;
          }
          prev = img.data.slice();
          opts.onProgress?.(0.3 + 0.65 * (i / steps));
        }
        notes.push('visual motion');
      } finally {
        g.dispose();
      }
    }
  }
  const norm = (a: Float32Array) => {
    let m = 0;
    for (const v of a) m = Math.max(m, v);
    return m > 0 ? a.map((v) => v / m) : a;
  };
  const A = norm(audioScore), O = norm(onsetScore), M = norm(motionScore);
  const score = new Float32Array(secs);
  for (let i = 0; i < secs; i++) score[i] = A[i] * 0.5 + O[i] * 0.2 + M[i] * 0.3;
  // sliding windows, greedy non-overlapping pick
  const wins: Highlight[] = [];
  for (let s = 0; s + 1 <= secs; s++) {
    const e = Math.min(secs, s + win);
    let acc = 0, a = 0, o = 0, m = 0;
    for (let i = s; i < e; i++) { acc += score[i]; a += A[i]; o += O[i]; m += M[i]; }
    const len = e - s;
    const reasons: string[] = [];
    if (a / len > 0.5) reasons.push('loud');
    if (o / len > 0.4) reasons.push('rhythmic / speech bursts');
    if (m / len > 0.4) reasons.push('high motion');
    wins.push({ start: s, end: Math.min(dur, s + win), score: acc / len, reasons });
  }
  wins.sort((x, y) => y.score - x.score);
  const picked: Highlight[] = [];
  for (const w of wins) {
    if (picked.length >= count) break;
    if (picked.some((p) => w.start < p.end && w.end > p.start)) continue;
    picked.push(w);
  }
  picked.sort((x, y) => x.start - y.start);
  const max = picked[0] ? Math.max(...picked.map((p) => p.score)) || 1 : 1;
  picked.forEach((p) => (p.score = p.score / max));
  opts.onProgress?.(1);
  return { highlights: picked, note: `Heuristic ranking based on ${notes.join(' + ') || 'duration'} — review the picks before trusting them.` };
}

/** Convenience: the clip's own highlights expressed in timeline time. */
export function highlightsForClip(clip: VideoClip, hs: Highlight[]) {
  const rate = clip.speed.rate || 1;
  return hs
    .map((h) => ({ ...h, start: clip.start + (h.start - clip.mediaIn) / rate, end: clip.start + (h.end - clip.mediaIn) / rate }))
    .filter((h) => h.end > clip.start && h.start < clip.start + clip.duration)
    .map((h) => ({ ...h, start: Math.max(clip.start, h.start), end: Math.min(clip.start + clip.duration, h.end) }));
}

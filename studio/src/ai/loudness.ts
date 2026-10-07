/**
 * Loudness measurement & normalisation (ITU-R BS.1770 style: K-weighting → mean square → gating).
 * Pure Web Audio / DSP — always available. Used for "Normalize loudness" and "Match clips".
 */
import type { VideoClip, AudioClip } from '@/core/types';
import { getAudioBuffer } from '@/engine/MediaManager';
import { useProject } from '@/core/store';
import * as cmd from '@/core/commands';

type MediaClip = VideoClip | AudioClip;

export interface LoudnessResult {
  integrated: number; // LUFS
  peak: number; // dBFS (sample peak)
  truePeakApprox: number; // dBTP approx (4x oversampled)
}

async function kWeight(buffer: AudioBuffer, from: number, to: number): Promise<AudioBuffer> {
  const len = Math.max(1, Math.floor((to - from) * buffer.sampleRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, len, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  // Stage 1: high-shelf (+4 dB above ~1.5 kHz), stage 2: high-pass (~38 Hz) — BS.1770 pre-filter approximation
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1681;
  shelf.gain.value = 3.99;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(ctx.destination);
  src.start(0, from, to - from);
  return ctx.startRendering();
}

export async function measureLoudness(buffer: AudioBuffer, from = 0, to = buffer.duration): Promise<LoudnessResult> {
  to = Math.min(to, buffer.duration);
  from = Math.max(0, Math.min(from, to - 0.05));
  const w = await kWeight(buffer, from, to);
  const sr = w.sampleRate;
  const block = Math.floor(sr * 0.4), hop = Math.floor(sr * 0.1);
  const chans = Array.from({ length: w.numberOfChannels }, (_, i) => w.getChannelData(i));
  const weights = chans.map((_, i) => (i >= 3 ? 1.41 : 1)); // surround weighting (Ls/Rs)
  const blocks: number[] = [];
  for (let s = 0; s + block <= w.length; s += hop) {
    let ms = 0;
    for (let c = 0; c < chans.length; c++) {
      const d = chans[c];
      let acc = 0;
      for (let i = s; i < s + block; i++) acc += d[i] * d[i];
      ms += weights[c] * (acc / block);
    }
    blocks.push(-0.691 + 10 * Math.log10(ms + 1e-12));
  }
  // gating: absolute -70 LUFS, then relative -10 LU
  const abs = blocks.filter((l) => l > -70);
  const mean = (arr: number[]) => (arr.length ? 10 * Math.log10(arr.reduce((a, l) => a + Math.pow(10, (l + 0.691) / 10), 0) / arr.length) - 0.691 : -Infinity);
  const relThr = mean(abs) - 10;
  const gated = abs.filter((l) => l > relThr);
  const integrated = gated.length ? mean(gated) : -Infinity;
  // peaks on the original signal
  let peak = 0;
  let tp = 0;
  const n0 = Math.floor(from * buffer.sampleRate), n1 = Math.min(buffer.length, Math.floor(to * buffer.sampleRate));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = n0; i < n1; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (i > n0) {
        // linear interpolation ≈ cheap inter-sample estimate
        const m = Math.abs((d[i] + d[i - 1]) * 0.5);
        if (m > tp) tp = m;
      }
    }
  }
  tp = Math.max(tp, peak);
  return { integrated, peak: 20 * Math.log10(peak + 1e-9), truePeakApprox: 20 * Math.log10(tp + 1e-9) };
}

export async function measureClip(clip: MediaClip): Promise<LoudnessResult | null> {
  const buf = await getAudioBuffer(clip.mediaId);
  if (!buf) return null;
  const rate = clip.speed.rate || 1;
  return measureLoudness(buf, clip.mediaIn, clip.mediaIn + clip.duration * rate);
}

export const LOUDNESS_TARGETS = [
  { id: 'tiktok', label: 'TikTok / Reels / Shorts (-14 LUFS)', lufs: -14 },
  { id: 'youtube', label: 'YouTube (-14 LUFS)', lufs: -14 },
  { id: 'spotify', label: 'Podcast / Spotify (-16 LUFS)', lufs: -16 },
  { id: 'broadcast', label: 'Broadcast EBU R128 (-23 LUFS)', lufs: -23 },
  { id: 'loud', label: 'Loud (-11 LUFS)', lufs: -11 },
];

/** Sets each clip's volume so its integrated loudness hits the target (peak-limited to -1 dBTP). */
export async function normalizeClips(clips: MediaClip[], targetLufs: number, onProgress?: (p: number) => void): Promise<{ applied: number; results: { clip: MediaClip; before: number; gainDb: number }[] }> {
  const results: { clip: MediaClip; before: number; gainDb: number }[] = [];
  let i = 0;
  for (const c of clips) {
    const m = await measureClip(c);
    onProgress?.(++i / clips.length);
    if (!m || !isFinite(m.integrated)) continue;
    let gainDb = targetLufs - m.integrated;
    // don't push peaks above -1 dBTP
    if (m.truePeakApprox + gainDb > -1) gainDb = -1 - m.truePeakApprox;
    results.push({ clip: c, before: m.integrated, gainDb });
  }
  if (results.length) {
    useProject.getState().apply('Normalize loudness', (p) => {
      let out = p;
      for (const r of results) {
        const gain = Math.max(0, Math.min(4, Math.pow(10, r.gainDb / 20)));
        out = cmd.updateClip(out, r.clip.id, (c) => ({ ...c, audio: { ...(c as MediaClip).audio, volume: { ...(c as MediaClip).audio.volume, value: gain } } }) as typeof c);
      }
      return out;
    });
  }
  return { applied: results.length, results };
}

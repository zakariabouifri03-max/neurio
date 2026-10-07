/**
 * Audio analysis (pure DSP, runs on decoded AudioBuffers):
 *  - beat detection: spectral-flux-free energy onset detector with adaptive threshold + BPM estimate
 *  - silence detection: RMS gate with hysteresis and minimum durations
 *  - loudness: integrated RMS
 */

export interface BeatResult {
  beats: number[]; // seconds in source
  bpm: number;
  confidence: number; // 0..1
}

function mono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buffer.numberOfChannels;
  }
  return out;
}

export function energyEnvelope(buffer: AudioBuffer, hop = 1024): { env: Float32Array; hopSec: number } {
  const m = mono(buffer);
  const n = Math.floor(m.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * hop;
    for (let j = 0; j < hop; j++) s += m[off + j] * m[off + j];
    env[i] = Math.sqrt(s / hop);
  }
  return { env, hopSec: hop / buffer.sampleRate };
}

export function detectBeats(buffer: AudioBuffer, opts: { minBpm?: number; maxBpm?: number; sensitivity?: number } = {}): BeatResult {
  const { minBpm = 60, maxBpm = 200, sensitivity = 1 } = opts;
  const hop = 512;
  const { env, hopSec } = energyEnvelope(buffer, hop);
  // onset strength: positive differences of log energy, with a low-passed local mean threshold
  const n = env.length;
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, Math.log(1e-6 + env[i]) - Math.log(1e-6 + env[i - 1]));
  const win = Math.round(0.35 / hopSec);
  const peaks: number[] = [];
  const minGap = Math.round(60 / maxBpm / hopSec);
  let last = -minGap;
  for (let i = 1; i < n - 1; i++) {
    let mean = 0, cnt = 0;
    for (let j = Math.max(0, i - win); j < Math.min(n, i + win); j++) {
      mean += onset[j];
      cnt++;
    }
    mean /= cnt || 1;
    const thr = mean * (1.5 / sensitivity) + 0.02;
    if (onset[i] > thr && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1] && i - last >= minGap) {
      peaks.push(i);
      last = i;
    }
  }
  // BPM via inter-onset interval histogram (autocorrelation of onset function is costlier)
  const hist = new Map<number, number>();
  for (let i = 1; i < peaks.length; i++) {
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const iv = (peaks[i] - peaks[k]) * hopSec;
      if (iv <= 0) continue;
      let bpm = 60 / iv;
      while (bpm < minBpm) bpm *= 2;
      while (bpm > maxBpm) bpm /= 2;
      const key = Math.round(bpm);
      hist.set(key, (hist.get(key) || 0) + 1 / (i - k));
    }
  }
  let bpm = 0, best = 0, total = 0;
  for (const [k, v] of hist) {
    total += v;
    // merge ±1 neighbors
    const score = v + (hist.get(k - 1) || 0) * 0.5 + (hist.get(k + 1) || 0) * 0.5;
    if (score > best) {
      best = score;
      bpm = k;
    }
  }
  const confidence = total ? Math.min(1, best / total) : 0;
  return { beats: peaks.map((p) => p * hopSec), bpm, confidence };
}

export interface SilenceRange {
  start: number;
  end: number;
}

/** Find silent ranges (seconds in source). threshold in linear RMS (0.01 ≈ -40 dBFS). */
export function detectSilences(buffer: AudioBuffer, opts: { thresholdDb?: number; minSilence?: number; minSound?: number; padding?: number } = {}): SilenceRange[] {
  const { thresholdDb = -38, minSilence = 0.4, minSound = 0.15, padding = 0.06 } = opts;
  const hop = 1024;
  const { env, hopSec } = energyEnvelope(buffer, hop);
  const thr = Math.pow(10, thresholdDb / 20);
  const raw: SilenceRange[] = [];
  let start: number | null = null;
  for (let i = 0; i < env.length; i++) {
    const silent = env[i] < thr;
    if (silent && start === null) start = i;
    if (!silent && start !== null) {
      raw.push({ start: start * hopSec, end: i * hopSec });
      start = null;
    }
  }
  if (start !== null) raw.push({ start: start * hopSec, end: env.length * hopSec });
  // merge sound gaps shorter than minSound, drop silences shorter than minSilence
  const merged: SilenceRange[] = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    if (prev && r.start - prev.end < minSound) prev.end = r.end;
    else merged.push({ ...r });
  }
  return merged
    .map((r) => ({ start: r.start + padding, end: r.end - padding }))
    .filter((r) => r.end - r.start >= minSilence);
}

export function integratedLoudnessDb(buffer: AudioBuffer): number {
  const { env } = energyEnvelope(buffer, 2048);
  let s = 0;
  for (let i = 0; i < env.length; i++) s += env[i] * env[i];
  const rms = Math.sqrt(s / Math.max(1, env.length));
  return 20 * Math.log10(Math.max(1e-6, rms));
}

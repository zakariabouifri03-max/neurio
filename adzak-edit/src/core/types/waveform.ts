/**
 * Audio waveform peak cache.
 *
 * Stored as plain `number[]` (not Float32Array) so it round-trips through JSON
 * in `.adzak` files and the SQLite cache without a codec.
 */
export interface WaveformData {
  /** Interleaved peak amplitudes in 0..1, `channels * peaks` long. */
  peaks: number[];
  /** Also stores the negative envelope so the drawing is symmetric-accurate. */
  troughs: number[];
  channels: number;
  /** Seconds of audio each peak bucket covers. */
  secondsPerPeak: number;
  durationSec: number;
  sampleRate: number;
  /** Loudness stats used by the audio AI (silence detection, normalisation). */
  rmsDb: number;
  peakDb: number;
  /** Mean dB across the whole file; cached so silence detection is cheap. */
  loudness?: { integratedLufs?: number; truePeakDb?: number };
  generatedAt: number;
}

/** Peak lookup at an arbitrary time, channel 0 by default. */
export function peakAt(waveform: WaveformData, seconds: number, channel = 0): number {
  const { peaks, troughs, channels, secondsPerPeak } = waveform;
  if (!peaks.length || secondsPerPeak <= 0) return 0;
  const idx = Math.min(
    peaks.length / channels - 1,
    Math.max(0, Math.floor(seconds / secondsPerPeak)),
  );
  const offset = idx * channels + channel;
  const p = peaks[offset] ?? 0;
  const t = troughs[offset] ?? 0;
  return Math.max(p, Math.abs(t));
}

export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return 10 ** (db / 20);
}

import type { AudioClipSettings, AudioProcessId, Clip } from '../types/timeline';
import { atempoCascade, gainToDbArg } from '../../utils/ffmpegEscape';

/**
 * Audio chain builder.
 *
 * Every audio process is non-destructive: the original file is never rewritten,
 * the chain is expressed as FFmpeg filters applied at export/preview time.
 */

export interface AudioChainContext {
  /** Clip-local duration in timeline seconds (needed for fade-out start). */
  clipDurationSec: number;
  /** Start offset on the timeline, for `adelay`. */
  timelineStartSec: number;
  channels: number;
}

/** Per-process filter fragments, in the order they should be applied. */
export const AUDIO_PROCESS_FILTERS: Record<AudioProcessId, string[]> = {
  // Broadband FFT denoise — the right tool for constant hiss/hum.
  'noise-reduce': ['highpass=f=60', 'afftdn=nr=14:nf=-30:tn=1'],
  normalize: ['loudnorm=I=-16:TP=-1.5:LRA=11'],
  'voice-enhance': [
    'highpass=f=85',
    'lowpass=f=13500',
    'afftdn=nr=10:nf=-32',
    'acompressor=threshold=-18dB:ratio=3:attack=8:release=180:makeup=2.2',
  ],
  'de-esser': ['deesser=i=0.6'],
  'eq-broadcast': [
    'equalizer=f=120:t=q:w=1.0:g=2.5',
    'equalizer=f=3000:t=q:w=1.6:g=2',
    'equalizer=f=9000:t=q:w=1.2:g=1.5',
  ],
  compressor: ['acompressor=threshold=-16dB:ratio=4:attack=10:release=220:makeup=2'],
};

export const AUDIO_PROCESS_LABELS: Record<AudioProcessId, string> = {
  'noise-reduce': 'Noise Reduction',
  normalize: 'Loudness Normalisation (EBU R128)',
  'voice-enhance': 'Voice Enhance',
  'de-esser': 'De-esser',
  'eq-broadcast': 'Broadcast EQ',
  compressor: 'Compressor',
};

/**
 * Build the complete audio filter chain for one clip, ending with correct
 * timing so it can be mixed with the rest of the timeline.
 */
export function buildClipAudioChain(clip: Clip, ctx: AudioChainContext): string[] {
  const settings: AudioClipSettings = clip.audio;
  const filters: string[] = [];

  // 1. Rate + direction first, so fades land on the final timeline duration.
  filters.push(...atempoCascade(clip.speed));
  if (clip.reverse) filters.push('areverse');

  // 2. Restoration / enhancement chain, in a fixed sensible order.
  for (const id of settings.chain) {
    const chain = AUDIO_PROCESS_FILTERS[id];
    if (chain) filters.push(...chain);
  }

  // 3. Level and pan.
  const vol = gainToDbArg(settings.volume);
  if (vol) filters.push(vol);
  if (Math.abs(settings.pan) > 1e-4) {
    // pan in [-1, 1]; constant-power law keeps mono sources from collapsing.
    const pan = Math.max(-1, Math.min(1, settings.pan));
    const left = Math.cos(((pan + 1) * Math.PI) / 4).toFixed(4);
    const right = Math.sin(((pan + 1) * Math.PI) / 4).toFixed(4);
    filters.push(`pan=stereo|c0=${left}*c0|c1=${right}*c0`);
  }

  // 4. Fades.
  if (settings.fadeInSec > 0) {
    filters.push(`afade=t=in:st=0:d=${settings.fadeInSec.toFixed(3)}`);
  }
  if (settings.fadeOutSec > 0 && ctx.clipDurationSec > settings.fadeOutSec) {
    const start = ctx.clipDurationSec - settings.fadeOutSec;
    filters.push(`afade=t=out:st=${start.toFixed(3)}:d=${settings.fadeOutSec.toFixed(3)}`);
  }

  // 5. Placement on the timeline. adelay needs one value per channel.
  const delayMs = Math.max(0, Math.round(ctx.timelineStartSec * 1000));
  if (delayMs > 0) {
    filters.push(`adelay=${Array.from({ length: ctx.channels }, () => delayMs).join('|')}`);
  }

  return filters;
}

/* ------------------------------------------------------------------ *
 * Silence detection (pure DSP over the cached waveform peaks)
 * ------------------------------------------------------------------ */

export interface SilenceSegment {
  start: number;
  end: number;
  /** Mean level of the segment in dBFS. */
  levelDb: number;
  confidence: number;
}

export interface SilenceOptions {
  /** Below this dBFS a bucket counts as silence. */
  thresholdDb: number;
  /** A silent run shorter than this is kept (natural pauses). */
  minSilenceSec: number;
  /** Keep this much audio around each detected cut, seconds. */
  paddingSec: number;
  /** Merge two silences separated by less than this, seconds. */
  mergeGapSec: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  thresholdDb: -42,
  minSilenceSec: 0.6,
  paddingSec: 0.12,
  mergeGapSec: 0.25,
};

/**
 * Detect silence from cached peak data.
 *
 * Deliberately peak-based on the *already cached* waveform: no re-decode, no
 * new I/O, so a 2-hour file analyses in milliseconds. Precision is the bucket
 * resolution (`secondsPerPeak`), which is fine for jump cuts — the export path
 * re-derives exact boundaries from the clip's source range anyway.
 */
export function detectSilence(
  peaks: number[],
  secondsPerPeak: number,
  options: Partial<SilenceOptions> = {},
): SilenceSegment[] {
  const opts = { ...DEFAULT_SILENCE_OPTIONS, ...options };
  if (!peaks.length || secondsPerPeak <= 0) return [];
  const threshold = 10 ** (opts.thresholdDb / 20);

  const raw: SilenceSegment[] = [];
  let runStart = -1;
  let runSum = 0;
  let runCount = 0;

  const close = (endIdx: number) => {
    if (runStart < 0) return;
    const start = runStart * secondsPerPeak;
    const end = endIdx * secondsPerPeak;
    const mean = runCount > 0 ? runSum / runCount : 0;
    const levelDb = mean > 0 ? 20 * Math.log10(mean) : -120;
    raw.push({ start, end, levelDb, confidence: Math.min(1, (opts.minSilenceSec > 0 ? (end - start) / (opts.minSilenceSec * 2) : 1)) });
    runStart = -1;
    runSum = 0;
    runCount = 0;
  };

  for (let i = 0; i < peaks.length; i++) {
    const level = peaks[i] ?? 0;
    if (level <= threshold) {
      if (runStart < 0) runStart = i;
      runSum += level;
      runCount++;
    } else {
      close(i);
    }
  }
  close(peaks.length);

  // Merge near neighbours, then drop runs that are too short.
  const merged: SilenceSegment[] = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && seg.start - prev.end <= opts.mergeGapSec) {
      prev.end = seg.end;
      prev.levelDb = (prev.levelDb + seg.levelDb) / 2;
      continue;
    }
    merged.push({ ...seg });
  }

  return merged
    .filter((s) => s.end - s.start >= opts.minSilenceSec)
    .map((s) => ({
      ...s,
      start: Math.max(0, s.start + opts.paddingSec),
      end: Math.max(0, s.end - opts.paddingSec),
    }))
    .filter((s) => s.end > s.start + 0.01)
    .sort((a, b) => a.start - b.start);
}

/** Loudness normalisation gain (linear) needed to hit a target peak. */
export function normalizeGain(peakDb: number, targetDb = -1): number {
  if (!Number.isFinite(peakDb)) return 1;
  const gainDb = targetDb - peakDb;
  // Never amplify more than +12 dB: it just pumps the noise floor.
  const clamped = Math.min(12, Math.max(-30, gainDb));
  return 10 ** (clamped / 20);
}

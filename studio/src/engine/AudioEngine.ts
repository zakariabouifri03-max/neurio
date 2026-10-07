/**
 * AudioEngine — Web Audio playback & offline mixdown of the project.
 *
 * Every audio-bearing clip (audio clips, video clips with sound) is played from a decoded
 * AudioBuffer through a per-clip effect chain:
 *   source → [pitch/time] → [gate/NR] → EQ → [voice] → [compressor] → [echo] → [reverb]
 *          → volume (keyframes+fades+ducking) → pan/width → track gain → master
 * The same graph builder is used with an OfflineAudioContext for export.
 */
import type { AudioClip, AudioFX, Clip, Project, Track, VideoClip } from '@/core/types';
import { getAudioBuffer, getAudioContext } from './MediaManager';
import { num } from '@/core/keyframes';
import { effectiveRate, speedAtFraction, timelineToSourceOffset, sourceSpan } from '@/core/commands';

export type AudibleClip = AudioClip | VideoClip;
const workletUrl = new URL('./worklets/dsp-processors.js', import.meta.url);
const workletReady = new WeakMap<BaseAudioContext, Promise<boolean>>();

export async function ensureWorklets(ctx: BaseAudioContext): Promise<boolean> {
  let p = workletReady.get(ctx);
  if (!p) {
    p = ctx.audioWorklet
      ? ctx.audioWorklet.addModule(workletUrl).then(() => true).catch((e) => {
          console.warn('AudioWorklet unavailable', e);
          return false;
        })
      : Promise.resolve(false);
    workletReady.set(ctx, p);
  }
  return p;
}

export function audibleClips(project: Project): { clip: AudibleClip; track: Track }[] {
  const out: { clip: AudibleClip; track: Track }[] = [];
  const anySolo = project.tracks.some((t) => t.solo);
  for (const t of project.tracks) {
    if (t.muted || (anySolo && !t.solo)) continue;
    for (const c of t.clips) {
      if (c.kind === 'audio') out.push({ clip: c, track: t });
      else if (c.kind === 'video' && c.hasAudio && !c.audioDetached) out.push({ clip: c, track: t });
    }
  }
  return out;
}

const reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();
function reversedBuffer(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  let r = reversedCache.get(b);
  if (r) return r;
  r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c);
    const dst = r.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reversedCache.set(b, r);
  return r;
}

const peakCache = new WeakMap<AudioBuffer, number>();
export function bufferPeak(b: AudioBuffer): number {
  let p = peakCache.get(b);
  if (p !== undefined) return p;
  p = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.abs(d[i]);
      if (v > p) p = v;
    }
  }
  peakCache.set(b, p);
  return p;
}

const irCache = new Map<string, AudioBuffer>();
function impulseResponse(ctx: BaseAudioContext, size: number, decay: number): AudioBuffer {
  const key = `${ctx.sampleRate}_${size.toFixed(2)}_${decay.toFixed(2)}`;
  let ir = irCache.get(key);
  if (ir) return ir;
  const len = Math.max(0.1, 0.3 + size * 3) * decay;
  const n = Math.floor(ctx.sampleRate * len);
  ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let seed = 12345 + c;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const r = seed / 4294967296 - 0.5;
      d[i] = r * Math.pow(1 - i / n, 2.5 / Math.max(0.2, decay)) * (i < 200 ? i / 200 : 1);
    }
  }
  irCache.set(key, ir);
  return ir;
}

/** RMS envelope of a buffer at `hop` seconds. */
export function rmsEnvelope(b: AudioBuffer, hop = 0.05): Float32Array {
  const hs = Math.floor(b.sampleRate * hop);
  const n = Math.ceil(b.length / hs);
  const out = new Float32Array(n);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const a = i * hs, e = Math.min(d.length, a + hs);
      for (let j = a; j < e; j += 2) s += d[j] * d[j];
      out[i] += Math.sqrt(s / Math.max(1, (e - a) / 2));
    }
  }
  for (let i = 0; i < n; i++) out[i] /= b.numberOfChannels;
  return out;
}

/** Sample the clip volume (keyframes × fades) over its duration (timeline time), `hop` seconds apart. */
function volumeCurve(clip: AudibleClip, hop = 0.02): Float32Array {
  const n = Math.max(2, Math.ceil(clip.duration / hop) + 1);
  const out = new Float32Array(n);
  const fx = clip.audio;
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i * hop);
    let v = num(fx.volume, t, 1);
    if (fx.fadeIn > 0 && t < fx.fadeIn) v *= t / fx.fadeIn;
    if (fx.fadeOut > 0 && t > clip.duration - fx.fadeOut) v *= Math.max(0, (clip.duration - t) / fx.fadeOut);
    out[i] = Math.max(0, v);
  }
  return out;
}

/** Ducking: compute a gain curve for `clip` that dips when other (non-ducked) clips are loud. */
async function duckingCurve(project: Project, clip: AudibleClip, hop = 0.05): Promise<Float32Array | null> {
  const d = clip.audio.ducking;
  if (!d.enabled) return null;
  const others = audibleClips(project).filter((x) => x.clip.id !== clip.id && !x.clip.audio.ducking.enabled);
  if (!others.length) return null;
  const n = Math.max(2, Math.ceil(clip.duration / hop) + 1);
  const side = new Float32Array(n);
  for (const { clip: o } of others) {
    const buf = await getAudioBuffer(o.mediaId);
    if (!buf) continue;
    const env = rmsEnvelope(buf, hop);
    const rate = effectiveRate(o) || 1;
    for (let i = 0; i < n; i++) {
      const tl = clip.start + i * hop; // timeline time
      if (tl < o.start || tl >= o.start + o.duration) continue;
      const srcT = o.mediaIn + (tl - o.start) * rate;
      const ei = Math.floor(srcT / hop);
      if (ei >= 0 && ei < env.length) side[i] = Math.max(side[i], env[ei] * num(o.audio.volume, tl - o.start, 1));
    }
  }
  const out = new Float32Array(n);
  let g = 1;
  const att = hop / Math.max(hop, d.attack), rel = hop / Math.max(hop, d.release);
  for (let i = 0; i < n; i++) {
    const target = side[i] > d.threshold ? 1 - d.amount : 1;
    g += (target - g) * (target < g ? att : rel);
    out[i] = g;
  }
  return out;
}

export interface BuiltClip {
  nodes: AudioNode[];
  source: AudioBufferSourceNode;
  stop: () => void;
}

/**
 * Build & schedule a clip in `ctx` so that timeline time `tlStart` corresponds to ctx time `ctxStart`.
 * `from` = timeline time where playback begins (>= clip.start).
 */
export async function scheduleClip(ctx: BaseAudioContext, project: Project, clip: AudibleClip, track: Track, dest: AudioNode, from: number, ctxTimeAtFrom: number, opts: { worklets: boolean }): Promise<BuiltClip | null> {
  const buffer0 = await getAudioBuffer(clip.mediaId);
  if (!buffer0) return null;
  const fx = clip.audio;
  const sp = clip.speed;
  if (sp.freezeAt !== undefined) return null; // frozen frames are silent
  const buffer = sp.reversed ? reversedBuffer(ctx, buffer0) : buffer0;
  const clipEnd = clip.start + clip.duration;
  const startTl = Math.max(from, clip.start);
  if (startTl >= clipEnd - 0.005) return null;
  const when = ctxTimeAtFrom + (startTl - from);
  const relStart = startTl - clip.start;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  // source offset
  let offset: number;
  const span = sourceSpan(clip);
  if (sp.reversed) {
    // reversed buffer: position = buffer.duration - (mediaIn + srcOffsetForward)
    const fwd = span - timelineToSourceOffset(clip, relStart); // forward offset from mediaIn
    offset = buffer.duration - (clip.mediaIn + fwd);
  } else offset = clip.mediaIn + timelineToSourceOffset(clip, relStart);
  offset = Math.max(0, Math.min(buffer.duration - 0.001, offset));

  // speed: constant or curve
  const semis = fx.pitch;
  let ratioForPitch = 1;
  if (sp.curve && sp.curve.length > 1) {
    const hop = 0.02;
    const n = Math.max(2, Math.ceil((clip.duration - relStart) / hop));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.max(0.05, speedAtFraction(sp.curve, (relStart + i * hop) / clip.duration));
    src.playbackRate.setValueAtTime(curve[0], when);
    src.playbackRate.setValueCurveAtTime(curve, when, Math.max(0.01, clip.duration - relStart));
    ratioForPitch = effectiveRate(clip) || 1;
  } else {
    src.playbackRate.value = Math.max(0.05, sp.rate);
    ratioForPitch = sp.rate;
  }

  const nodes: AudioNode[] = [src];
  let last: AudioNode = src;
  const connect = (n: AudioNode) => {
    last.connect(n);
    last = n;
    nodes.push(n);
  };

  // pitch preservation / pitch shift (worklet)
  const wantRatio = (sp.preservePitch ? 1 / Math.max(0.05, ratioForPitch) : 1) * Math.pow(2, semis / 12);
  if (Math.abs(wantRatio - 1) > 1e-3 && opts.worklets) {
    try {
      const ps = new AudioWorkletNode(ctx, 'neurio-pitch-shift', { parameterData: { ratio: Math.max(0.25, Math.min(4, wantRatio)) } });
      connect(ps);
    } catch (e) {
      /* worklet missing — play without pitch correction */
    }
  } else if (Math.abs(semis) > 1e-3 && !opts.worklets) {
    src.detune.value = semis * 100;
  }

  // noise reduction: gate + band limiting
  if (fx.noiseReduction > 0) {
    if (opts.worklets) {
      try {
        const gate = new AudioWorkletNode(ctx, 'neurio-noise-gate', { parameterData: { threshold: 0.005 + fx.noiseReduction * 0.04, amount: Math.min(1, fx.noiseReduction * 1.2) } });
        connect(gate);
      } catch {}
    }
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60 + fx.noiseReduction * 90;
    connect(hp);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 16000 - fx.noiseReduction * 7000;
    connect(lp);
  }

  // EQ
  if (fx.eq.bands && fx.eq.bands.some((b) => b)) {
    const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    fx.eq.bands.forEach((gain, i) => {
      if (!gain) return;
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
      f.frequency.value = freqs[i];
      f.Q.value = 1.1;
      f.gain.value = gain;
      connect(f);
    });
  }
  if (fx.eq.low) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowshelf';
    f.frequency.value = 200;
    f.gain.value = fx.eq.low;
    connect(f);
  }
  if (fx.eq.mid) {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = 1000;
    f.Q.value = 0.8;
    f.gain.value = fx.eq.mid;
    connect(f);
  }
  if (fx.eq.high) {
    const f = ctx.createBiquadFilter();
    f.type = 'highshelf';
    f.frequency.value = 4000;
    f.gain.value = fx.eq.high;
    connect(f);
  }
  // voice enhance: presence + hp + gentle compression
  if (fx.voiceEnhance > 0) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    connect(hp);
    const pres = ctx.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = 3000;
    pres.Q.value = 1;
    pres.gain.value = 6 * fx.voiceEnhance;
    connect(pres);
    const warm = ctx.createBiquadFilter();
    warm.type = 'peaking';
    warm.frequency.value = 180;
    warm.Q.value = 1;
    warm.gain.value = 2 * fx.voiceEnhance;
    connect(warm);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    connect(comp);
    const mk = ctx.createGain();
    mk.gain.value = 1 + 0.5 * fx.voiceEnhance;
    connect(mk);
  }
  if (fx.compressor.enabled) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = fx.compressor.threshold;
    c.ratio.value = fx.compressor.ratio;
    c.attack.value = fx.compressor.attack;
    c.release.value = fx.compressor.release;
    connect(c);
    if (fx.compressor.makeup) {
      const g = ctx.createGain();
      g.gain.value = Math.pow(10, fx.compressor.makeup / 20);
      connect(g);
    }
  }
  // echo (parallel)
  if (fx.echo.enabled && fx.echo.mix > 0) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    const sum = ctx.createGain();
    delay.delayTime.value = fx.echo.time;
    fb.gain.value = Math.min(0.95, fx.echo.feedback);
    dry.gain.value = 1;
    wet.gain.value = fx.echo.mix;
    last.connect(dry);
    last.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    dry.connect(sum);
    wet.connect(sum);
    nodes.push(dry, wet, delay, fb, sum);
    last = sum;
  }
  // reverb (parallel)
  if (fx.reverb.enabled && fx.reverb.mix > 0) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulseResponse(ctx, fx.reverb.size, fx.reverb.decay);
    const sum = ctx.createGain();
    dry.gain.value = 1 - fx.reverb.mix * 0.5;
    wet.gain.value = fx.reverb.mix;
    last.connect(dry);
    last.connect(conv);
    conv.connect(wet);
    dry.connect(sum);
    wet.connect(sum);
    nodes.push(dry, wet, conv, sum);
    last = sum;
  }
  // volume: keyframes, fades, normalize, ducking
  const vol = ctx.createGain();
  const hop = 0.02;
  const curve = volumeCurve(clip, hop);
  const norm = fx.normalize ? 0.95 / Math.max(0.05, bufferPeak(buffer0)) : 1;
  const duck = await duckingCurve(project, clip, 0.05);
  const startIdx = Math.floor(relStart / hop);
  const remaining = curve.subarray(Math.min(curve.length - 2, startIdx));
  const scaled = new Float32Array(remaining.length);
  for (let i = 0; i < scaled.length; i++) {
    let d = 1;
    if (duck) {
      const di = Math.min(duck.length - 1, Math.floor(((startIdx + i) * hop) / 0.05));
      d = duck[di];
    }
    scaled[i] = remaining[i] * norm * track.volume * d;
  }
  const dur = Math.max(0.01, clip.duration - relStart);
  vol.gain.setValueAtTime(scaled[0], when);
  try {
    vol.gain.setValueCurveAtTime(scaled, when, dur);
  } catch {
    vol.gain.value = scaled[0];
  }
  connect(vol);
  // stereo width + pan
  if (Math.abs(fx.stereoWidth - 1) > 1e-3) {
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const w = fx.stereoWidth;
    // L' = L*(1+w)/2 + R*(1-w)/2 ; R' = L*(1-w)/2 + R*(1+w)/2
    const ll = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain(), rr = ctx.createGain();
    ll.gain.value = (1 + w) / 2;
    lr.gain.value = (1 - w) / 2;
    rl.gain.value = (1 - w) / 2;
    rr.gain.value = (1 + w) / 2;
    last.connect(split);
    split.connect(ll, 0);
    split.connect(lr, 1);
    split.connect(rl, 0);
    split.connect(rr, 1);
    ll.connect(merge, 0, 0);
    lr.connect(merge, 0, 0);
    rl.connect(merge, 0, 1);
    rr.connect(merge, 0, 1);
    nodes.push(split, merge, ll, lr, rl, rr);
    last = merge;
  }
  if (Math.abs(fx.pan) > 1e-3) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = fx.pan;
    connect(pan);
  }
  last.connect(dest);
  src.start(when, offset);
  src.stop(when + dur + 0.05);
  const stop = () => {
    try {
      src.stop();
    } catch {}
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {}
    }
  };
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {}
    }
  };
  return { nodes, source: src, stop };
}

/* ------------------------------------------------------------------------- */

export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  private scheduled = new Map<string, BuiltClip>();
  private scheduling = new Set<string>();
  private playing = false;
  private project: Project | null = null;
  private anchorTl = 0;
  private anchorCtx = 0;
  private workletsOk = false;
  private generation = 0;

  constructor() {
    this.ctx = getAudioContext();
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    void ensureWorklets(this.ctx).then((ok) => (this.workletsOk = ok));
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  async start(project: Project, fromTl: number) {
    await this.ctx.resume();
    this.stop();
    this.generation++;
    this.playing = true;
    this.project = project;
    this.anchorTl = fromTl;
    this.anchorCtx = this.ctx.currentTime + 0.05;
    this.tick(project, fromTl);
  }

  /** Called every frame while playing; schedules clips coming up in the next window. */
  tick(project: Project, tl: number) {
    if (!this.playing) return;
    this.project = project;
    const gen = this.generation;
    const lookahead = 1.5;
    for (const { clip, track } of audibleClips(project)) {
      if (this.scheduled.has(clip.id) || this.scheduling.has(clip.id)) continue;
      const end = clip.start + clip.duration;
      if (end <= tl || clip.start > tl + lookahead) continue;
      this.scheduling.add(clip.id);
      const startTl = Math.max(tl, clip.start);
      const ctxWhen = this.anchorCtx + (startTl - this.anchorTl);
      void scheduleClip(this.ctx, project, clip, track, this.master, startTl, ctxWhen, { worklets: this.workletsOk })
        .then((b) => {
          this.scheduling.delete(clip.id);
          if (!b) return;
          if (gen !== this.generation || !this.playing) {
            b.stop();
            return;
          }
          this.scheduled.set(clip.id, b);
        })
        .catch((e) => {
          this.scheduling.delete(clip.id);
          console.warn('audio schedule failed', e);
        });
    }
    // cleanup finished
    for (const [id, b] of this.scheduled) {
      const c = audibleClips(project).find((x) => x.clip.id === id)?.clip;
      if (!c || c.start + c.duration < tl - 0.1) {
        b.stop();
        this.scheduled.delete(id);
      }
    }
  }

  /** Timeline time derived from the audio clock (authoritative while playing). */
  currentTime(): number {
    return this.anchorTl + (this.ctx.currentTime - this.anchorCtx);
  }

  isPlaying() {
    return this.playing;
  }

  stop() {
    this.playing = false;
    this.generation++;
    for (const b of this.scheduled.values()) b.stop();
    this.scheduled.clear();
    this.scheduling.clear();
  }

  /** Re-schedule after an edit while playing (cheap: stop all, restart from current time). */
  restart(project: Project) {
    if (!this.playing) return;
    const t = this.currentTime();
    void this.start(project, t);
  }

  /** Preview a single buffer (e.g. SFX / music library preview). Returns a stop function. */
  previewBuffer(buffer: AudioBuffer, volume = 0.9): () => void {
    void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.buffer = buffer;
    src.connect(g).connect(this.master);
    src.start();
    return () => {
      try {
        src.stop();
      } catch {}
    };
  }

  getLevels(): { rms: number; peak: number } {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let s = 0, p = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      s += v * v;
      if (v > p) p = v;
    }
    return { rms: Math.sqrt(s / data.length), peak: p };
  }
}

/** Render the whole project mix offline (for export). */
export async function renderMixdown(project: Project, duration: number, sampleRate = 48000, onProgress?: (p: number) => void): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const worklets = await ensureWorklets(ctx);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const clips = audibleClips(project);
  let i = 0;
  for (const { clip, track } of clips) {
    if (clip.start >= duration) continue;
    await scheduleClip(ctx, project, clip, track, master, clip.start, clip.start, { worklets });
    onProgress?.((++i / Math.max(1, clips.length)) * 0.3);
  }
  const buf = await ctx.startRendering();
  onProgress?.(1);
  return buf;
}

export function isAudible(c: Clip): c is AudibleClip {
  return c.kind === 'audio' || (c.kind === 'video' && c.hasAudio && !c.audioDetached);
}

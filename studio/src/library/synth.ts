/**
 * Tiny procedural synthesizer used by the SFX and music libraries. Everything is rendered with
 * OfflineAudioContext so previews and timeline assets are real audio files (WAV) — no external
 * samples, hence no licensing concerns.
 */

export type Wave = OscillatorType | 'noise' | 'pink';

export interface Layer {
  wave: Wave;
  /** frequency start → end (Hz). Ignored for noise. */
  f?: [number, number];
  /** exponential/linear sweep */
  sweep?: 'exp' | 'lin';
  /** ADSR in seconds + sustain level */
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  gain?: number;
  /** filter */
  filter?: { type: BiquadFilterType; f: [number, number]; q?: number };
  /** start offset within the sound */
  at?: number;
  /** duration override */
  dur?: number;
  /** vibrato depth (Hz) and rate */
  vib?: [number, number];
  /** simple feedback delay */
  delay?: { time: number; fb: number; mix: number };
  detune?: number;
}

export interface Recipe {
  duration: number;
  layers: Layer[];
  /** repeat the whole layer set n times with an interval */
  repeat?: { n: number; every: number };
  reverb?: number; // 0..1
}

let noiseBuf: AudioBuffer | null = null;
let pinkBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext, pink = false): AudioBuffer {
  const cached = pink ? pinkBuf : noiseBuf;
  if (cached && cached.sampleRate === ctx.sampleRate) return cached;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  if (!pink) for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  else {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
  }
  if (pink) pinkBuf = b;
  else noiseBuf = b;
  return b;
}

export function impulseResponse(ctx: BaseAudioContext, seconds = 1.5, decay = 2.5): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

export function playLayer(ctx: BaseAudioContext, dest: AudioNode, l: Layer, t0: number, total: number) {
  const start = t0 + (l.at ?? 0);
  const dur = l.dur ?? total - (l.at ?? 0);
  if (dur <= 0) return;
  const a = l.a ?? 0.005, d = l.d ?? 0.1, s = l.s ?? 0.6, r = l.r ?? 0.1;
  const g = ctx.createGain();
  const peak = l.gain ?? 0.5;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peak, start + a);
  g.gain.linearRampToValueAtTime(peak * s, start + a + d);
  const relStart = Math.max(start + a + d, start + dur - r);
  g.gain.setValueAtTime(peak * s, relStart);
  g.gain.linearRampToValueAtTime(0, start + dur);
  let src: AudioScheduledSourceNode;
  if (l.wave === 'noise' || l.wave === 'pink') {
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx, l.wave === 'pink');
    n.loop = true;
    src = n;
  } else {
    const o = ctx.createOscillator();
    o.type = l.wave;
    const [f0, f1] = l.f ?? [440, 440];
    o.frequency.setValueAtTime(Math.max(1, f0), start);
    if (f1 !== f0) {
      if ((l.sweep ?? 'exp') === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
      else o.frequency.linearRampToValueAtTime(Math.max(1, f1), start + dur);
    }
    if (l.detune) o.detune.value = l.detune;
    if (l.vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = l.vib[1];
      const lg = ctx.createGain();
      lg.gain.value = l.vib[0];
      lfo.connect(lg).connect(o.frequency);
      lfo.start(start);
      lfo.stop(start + dur + 0.05);
    }
    src = o;
  }
  let node: AudioNode = src;
  if (l.filter) {
    const f = ctx.createBiquadFilter();
    f.type = l.filter.type;
    f.Q.value = l.filter.q ?? 1;
    f.frequency.setValueAtTime(Math.max(10, l.filter.f[0]), start);
    if (l.filter.f[1] !== l.filter.f[0]) f.frequency.exponentialRampToValueAtTime(Math.max(10, l.filter.f[1]), start + dur);
    node.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(dest);
  if (l.delay) {
    const dl = ctx.createDelay(2);
    dl.delayTime.value = l.delay.time;
    const fb = ctx.createGain();
    fb.gain.value = l.delay.fb;
    const mix = ctx.createGain();
    mix.gain.value = l.delay.mix;
    g.connect(dl);
    dl.connect(fb).connect(dl);
    dl.connect(mix).connect(dest);
  }
  src.start(start);
  src.stop(start + dur + 0.05);
}

export async function renderRecipe(recipe: Recipe, sampleRate = 44100): Promise<AudioBuffer> {
  const total = recipe.duration + (recipe.reverb ? 1.2 : 0.1);
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  let dest: AudioNode = master;
  if (recipe.reverb) {
    const conv = ctx.createConvolver();
    conv.buffer = impulseResponse(ctx, 1.2 + recipe.reverb, 3);
    const wet = ctx.createGain();
    wet.gain.value = recipe.reverb * 0.6;
    conv.connect(wet).connect(master);
    const split = ctx.createGain();
    split.connect(master);
    split.connect(conv);
    dest = split;
  }
  const reps = recipe.repeat?.n ?? 1;
  const every = recipe.repeat?.every ?? 0;
  for (let i = 0; i < reps; i++) for (const l of recipe.layers) playLayer(ctx, dest, l, i * every, recipe.duration - i * every);
  return ctx.startRendering();
}

/** Encode an AudioBuffer as 16-bit PCM WAV. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * 2, true);
  v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, len * numCh * 2, true);
  const chans = Array.from({ length: numCh }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/* ---------------- music helpers ---------------- */
export const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentMinor: [0, 3, 5, 7, 10],
  pentMajor: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};
/** chord degrees → midi notes */
export function chord(rootMidi: number, scale: number[], degree: number, notes = 3, spread = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < notes; i++) {
    const idx = degree + i * 2;
    const oct = Math.floor(idx / scale.length);
    out.push(rootMidi + scale[idx % scale.length] + oct * 12 + (i === notes - 1 ? spread : 0));
  }
  return out;
}

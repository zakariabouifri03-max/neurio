const SAMPLE_RATE = 24000;

function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function frac(value) { return value - Math.floor(value); }
function smoothStep(t) { return t * t * (3 - 2 * t); }

/**
 * A compact procedural sound palette. The generated clips are original, local
 * oscillator/noise synthesis (not stock recordings), so the app does not imply
 * that it bundles third-party licensed music or sound effects.
 */
export function synthesizeAudio(def, kind = 'sfx') {
  const duration = Math.max(.12, Math.min(16, kind === 'music' ? 8 : def.duration || .5));
  const length = Math.ceil(SAMPLE_RATE * duration);
  const samples = new Float32Array(length);
  const seed = (String(def.id || def.name).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 17) >>> 0) || 5;
  let randomState = seed;
  const random = () => { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState / 4294967296; };
  const noise = new Float32Array(Math.ceil(SAMPLE_RATE * duration) + 1);
  for (let i = 0; i < noise.length; i++) noise[i] = random() * 2 - 1;

  if (kind === 'music') {
    const bpm = Number(def.bpm) || 92;
    const beat = 60 / bpm;
    const roots = [45, 48, 50, 52, 43, 46, 41, 48];
    const root = roots[(Number(def.key) || 1) % roots.length];
    const scales = {
      lofi: [0, 3, 7, 10, 7, 3], synth: [0, 7, 12, 15, 12, 7], acoustic: [0, 4, 7, 9, 7, 4],
      ambient: [0, 7, 12, 19, 12, 7], drive: [0, 7, 10, 12, 15, 12], piano: [0, 3, 7, 12, 10, 7],
      cinematic: [0, 7, 12, 15, 19, 15], trap: [0, 7, 10, 12, 15, 10], pop: [0, 4, 7, 11, 7, 4],
      dark: [0, 1, 7, 6, 3, 1], game: [0, 7, 12, 19, 24, 19],
    };
    const scale = scales[def.style] || scales.lofi;
    const warm = ['lofi','piano','acoustic'].includes(def.style);
    const pad = ['ambient','cinematic','dark'].includes(def.style);
    const square = ['game','trap'].includes(def.style);
    const rhythm = ['drive','trap','pop','game','synth'].includes(def.style);
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const beatPos = t / beat;
      const beatIndex = Math.floor(beatPos);
      const beatPhase = frac(beatPos);
      const noteIndex = Math.floor(t / (beat / 2)) % scale.length;
      const noteStart = Math.floor(t / (beat / 2)) * beat / 2;
      const noteTime = t - noteStart;
      const noteDuration = beat * .46;
      const noteEnv = Math.exp(-noteTime * (warm ? 3.7 : 5.6)) * Math.min(1, noteTime * 45);
      const midi = root + 12 + scale[noteIndex];
      const hz = midiToHz(midi);
      const phase = t * hz * Math.PI * 2;
      const tri = Math.asin(Math.sin(phase)) * (2 / Math.PI);
      const pluck = square ? Math.sign(Math.sin(phase)) * .58 + Math.sin(phase * 2) * .16 : Math.sin(phase) * .78 + tri * .22;
      let value = pluck * noteEnv * (pad ? .105 : .14);
      if (pad) {
        const chord = [root + 12, root + 16, root + 19].map(midiToHz);
        const padEnv = .55 + .45 * Math.sin(Math.PI * (t / duration));
        value += padEnv * .035 * (Math.sin(t * chord[0] * Math.PI * 2) + Math.sin(t * chord[1] * Math.PI * 2) + Math.sin(t * chord[2] * Math.PI * 2));
      }
      const lowHz = midiToHz(root - 12);
      const bassEnv = Math.exp(-beatPhase * 8) * Math.min(1, beatPhase * 30);
      value += Math.sin(t * lowHz * Math.PI * 2) * bassEnv * (rhythm ? .15 : .11);
      if (rhythm && beatPhase < .13) {
        const kickEnv = Math.exp(-beatPhase * 30);
        value += Math.sin((52 - beatPhase * 21) * t * Math.PI * 2) * kickEnv * .14;
      }
      if ((def.style === 'lofi' || def.style === 'acoustic') && beatIndex % 4 === 2 && beatPhase > .48 && beatPhase < .63) value += noise[i] * .045;
      if (def.style === 'trap' && beatIndex % 4 === 3 && beatPhase < .23) value += noise[i] * Math.exp(-beatPhase * 24) * .065;
      const fade = Math.min(1, t / .28, (duration - t) / .44);
      samples[i] = Math.tanh(value * Math.max(0, fade) * 2.1) * .88;
    }
  } else {
    const style = def.style || 'pop';
    const durationS = duration;
    let previousNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const p = t / durationS;
      const n = noise[i];
      let value = 0;
      if (style === 'whoosh' || style === 'swipe' || style === 'sparkle') {
        const env = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, p))), style === 'sparkle' ? 1.35 : .75);
        const cutoff = 90 + p * (style === 'whoosh' ? 4200 : 2100);
        const alpha = Math.min(.96, cutoff / SAMPLE_RATE * 6.283);
        previousNoise += alpha * (n - previousNoise);
        value += (n - previousNoise * .35) * env * (style === 'sparkle' ? .18 : .26);
        value += Math.sin((180 + p * 500) * t * Math.PI * 2) * env * .12;
        if (style === 'sparkle' && p > .6 && Math.sin(t * 1800 * Math.PI * 2) > .96) value += .08 * env;
      } else if (style === 'pop' || style === 'funny') {
        const env = Math.exp(-t * (style === 'funny' ? 11 : 17));
        value = Math.sin((style === 'funny' ? 510 - p * 210 : 730 - p * 270) * t * Math.PI * 2) * env * .48;
        value += n * env * .06;
      } else if (style === 'click' || style === 'camera') {
        const env = Math.exp(-t * (style === 'camera' ? 23 : 37));
        value = n * env * (style === 'camera' ? .45 : .3) + Math.sin((style === 'camera' ? 120 : 1700) * t * Math.PI * 2) * env * .22;
      } else if (style === 'impact' || style === 'bass' || style === 'stadium') {
        const env = Math.exp(-t * (style === 'bass' ? 5.4 : 7.8));
        const freq = style === 'impact' ? 100 - 55 * p : style === 'stadium' ? 74 - 28 * p : 62 - 34 * p;
        value = Math.sin(freq * t * Math.PI * 2) * env * .58 + n * Math.exp(-t * 20) * .12;
        if (style === 'stadium') value += Math.sin(t * 220 * Math.PI * 2) * Math.exp(-t * 3) * .08;
      } else if (style === 'glitch') {
        const burst = (Math.floor(t * 34) % 5 === 0 || Math.floor(t * 18) % 7 === 1) ? 1 : .17;
        value = (n * .35 + Math.sin((250 + ((Math.floor(t * 51) % 8) * 117)) * t * Math.PI * 2) * .2) * burst * Math.exp(-p * 1.6);
      } else if (style === 'notify' || style === 'chime' || style === 'game') {
        const notes = style === 'notify' ? [880, 1174] : style === 'chime' ? [523, 659, 784] : [784, 988, 1174, 1568];
        const noteSpan = durationS / notes.length;
        const k = Math.min(notes.length - 1, Math.floor(t / noteSpan));
        const local = t - k * noteSpan;
        const env = Math.exp(-local * (style === 'chime' ? 3.7 : 8)) * Math.min(1, local * 80);
        value = (Math.sin(notes[k] * t * Math.PI * 2) + .23 * Math.sin(notes[k] * 2.01 * t * Math.PI * 2)) * env * .29;
      } else if (style === 'horror') {
        const env = .65 + .35 * Math.cos(t / durationS * Math.PI * 2);
        value = (Math.sin((53 + 14 * Math.sin(t * 2.2)) * t * Math.PI * 2) * .38 + n * .09) * env * (1 - p * .55);
      } else if (style === 'crowd') {
        const swell = Math.pow(Math.sin(Math.PI * p), 1.3);
        previousNoise = previousNoise * .94 + n * .06;
        value = (n * .16 + previousNoise * .18 + Math.sin(112 * t * Math.PI * 2) * .07) * swell;
      } else if (style === 'birds') {
        const chirp = (Math.sin(t * 5.1) > .25 || Math.sin(t * 3.6 + 1) > .72) ? 1 : .07;
        const f = 1900 + 750 * Math.sin(t * 12 + 1.7);
        value = Math.sin(f * t * Math.PI * 2) * chirp * Math.sin(Math.PI * p) * .15 + n * .015;
      } else if (style === 'engine') {
        const f = 55 + 115 * smoothStep(Math.min(1, p * 1.08));
        value = Math.sin(f * t * Math.PI * 2) * .23 + Math.sin(f * 2.03 * t * Math.PI * 2) * .11 + n * .035;
        value *= Math.sin(Math.PI * p) * .9;
      }
      const tail = Math.min(1, t / .012, (durationS - t) / Math.max(.02, durationS * .08));
      samples[i] = Math.tanh(value * Math.max(0, tail) * 2.1) * .88;
    }
  }

  const waveform = [];
  const bucketSize = Math.max(1, Math.floor(length / 96));
  for (let x = 0; x < 96; x++) {
    let peak = 0;
    for (let i = x * bucketSize; i < Math.min(length, (x + 1) * bucketSize); i++) peak = Math.max(peak, Math.abs(samples[i]));
    waveform.push(Math.max(.07, Math.min(1, peak)));
  }
  return { blob: toWaveBlob(samples), duration, waveform };
}

function toWaveBlob(samples) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

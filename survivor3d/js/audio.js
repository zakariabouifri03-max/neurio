import { G } from './state.js';

// ══════════════════════════════════════════════════════════════
//  AUDIO — 100% synthesised with WebAudio. No files, no download.
//  Every gunshot is a noise burst through a shaped filter, so the
//  whole soundtrack costs ~0 KB and one AudioContext.
// ══════════════════════════════════════════════════════════════

let ctx = null, master = null, noiseBuf = null, windGain = null;
let enabled = true;

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch (e) { return null; }
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // one shared white-noise buffer (1 s) reused by every SFX
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  // ambient wind bed
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
  windGain = ctx.createGain(); windGain.gain.value = 0.0;
  src.connect(lp); lp.connect(windGain); windGain.connect(master);
  src.start();
  // slow LFO on the wind so it breathes
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lg = ctx.createGain(); lg.gain.value = 0.022;
  lfo.connect(lg); lg.connect(windGain.gain); lfo.start();
  return ctx;
}

export function resumeAudio() {
  if (!ctx) initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export function setEnabled(v) {
  enabled = v;
  if (master) master.gain.value = v ? 0.55 : 0;
}
export const isEnabled = () => enabled;

function now() { return ctx.currentTime; }

function noise(dur, gain, type, freq, q, pan = 0, decay = 'exp') {
  if (!ctx || !enabled) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.5;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  const t = now();
  g.gain.setValueAtTime(gain, t);
  if (decay === 'exp') g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  else g.gain.linearRampToValueAtTime(0, t + dur);
  let node = g;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); node = p;
  }
  s.connect(f); f.connect(g); node.connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

function tone(freq, dur, gain, type = 'sine', slide = 0, delay = 0) {
  if (!ctx || !enabled) return;
  const t = now() + delay;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

/** distance-based pan + volume for off-screen sounds */
function spatial(pos) {
  if (!pos || !G.camera) return { pan: 0, vol: 1 };
  const dx = pos.x - G.camera.position.x, dz = pos.z - G.camera.position.z;
  const d = Math.hypot(dx, dz);
  const fwd = { x: Math.sin(G.camera.rotation.y || 0), z: Math.cos(G.camera.rotation.y || 0) };
  const side = dx * fwd.z - dz * fwd.x;
  return { pan: Math.max(-1, Math.min(1, side / 30)), vol: Math.max(0.08, 1 - d / 130) };
}

export function sfx(name, vol = 1, pos = null) {
  if (!ctx) return;
  const sp = spatial(pos);
  const v = vol * sp.vol;
  const pan = sp.pan;
  switch (name) {
    case 'shot:pistol':
      noise(0.13, 0.5 * v, 'bandpass', 1500, 0.9, pan);
      noise(0.05, 0.32 * v, 'highpass', 3200, 0.7, pan);
      tone(150, 0.09, 0.3 * v, 'triangle', -110, pan * 0);
      break;
    case 'shot:smg':
      noise(0.1, 0.44 * v, 'bandpass', 1850, 1.1, pan);
      noise(0.04, 0.3 * v, 'highpass', 3600, 0.6, pan);
      tone(190, 0.07, 0.24 * v, 'square', -140);
      break;
    case 'shot:rifle':
      noise(0.16, 0.56 * v, 'bandpass', 1250, 0.85, pan);
      noise(0.06, 0.36 * v, 'highpass', 2900, 0.7, pan);
      tone(118, 0.13, 0.36 * v, 'triangle', -80);
      break;
    case 'shot:shotgun':
      noise(0.3, 0.7 * v, 'lowpass', 1400, 0.7, pan);
      noise(0.1, 0.4 * v, 'bandpass', 900, 0.5, pan);
      tone(78, 0.24, 0.44 * v, 'triangle', -46);
      break;
    case 'shot:sniper':
      noise(0.42, 0.72 * v, 'lowpass', 2100, 0.6, pan);
      noise(0.09, 0.44 * v, 'highpass', 3400, 0.7, pan);
      tone(66, 0.34, 0.5 * v, 'triangle', -34);
      break;
    case 'shot:fists': noise(0.07, 0.22 * v, 'bandpass', 620, 1.4, pan); break;
    case 'swing': noise(0.11, 0.24 * v, 'bandpass', 900, 1.6, pan); break;
    case 'hit': noise(0.09, 0.42 * v, 'bandpass', 780, 1.3, pan); tone(320, 0.07, 0.2 * v, 'square', -180); break;
    case 'hurt':
      noise(0.2, 0.4 * v, 'lowpass', 620, 0.8); tone(180, 0.18, 0.26 * v, 'sawtooth', -90); break;
    case 'reload': noise(0.07, 0.2 * v, 'bandpass', 2300, 2.4); tone(520, 0.05, 0.12 * v, 'square', -160); break;
    case 'reloadEnd': noise(0.09, 0.26 * v, 'bandpass', 1500, 2.0); tone(300, 0.07, 0.16 * v, 'square', 220); break;
    case 'pickup': tone(660, 0.09, 0.2 * v, 'sine', 320); tone(990, 0.08, 0.13 * v, 'sine', 200, 0.05); break;
    case 'armor': tone(300, 0.13, 0.24 * v, 'square', 240); noise(0.1, 0.16 * v, 'bandpass', 1800, 1.2); break;
    case 'coin': tone(1180, 0.07, 0.18 * v, 'sine', 380); tone(1560, 0.09, 0.13 * v, 'sine', 300, 0.05); break;
    case 'heal': tone(420, 0.22, 0.2 * v, 'sine', 320); tone(640, 0.2, 0.14 * v, 'sine', 260, 0.09); break;
    case 'jump': noise(0.08, 0.14 * v, 'bandpass', 480, 1.1); break;
    case 'land': noise(0.16, 0.3 * v, 'lowpass', 380, 0.7); tone(90, 0.12, 0.2 * v, 'sine', -40); break;
    case 'boom':
      noise(0.75, 0.85 * v, 'lowpass', 900, 0.5, pan * 0.5);
      noise(0.18, 0.5 * v, 'highpass', 2400, 0.6, pan * 0.5);
      tone(52, 0.62, 0.62 * v, 'triangle', -26);
      break;
    case 'kill': tone(720, 0.1, 0.24 * v, 'square', 420); tone(1180, 0.16, 0.2 * v, 'square', 500, 0.08); break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.42, 0.22 * v, 'triangle', 0, i * 0.13));
      break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, 0.2 * v, 'sawtooth', -20, i * 0.17)); break;
    case 'zone': tone(220, 0.9, 0.18 * v, 'sine', -60); noise(0.9, 0.1 * v, 'lowpass', 300, 0.6); break;
    case 'ui': noise(0.05, 0.16 * v, 'bandpass', 2000, 2); break;
    case 'step': noise(0.05, 0.09 * v, 'bandpass', 420 + Math.random() * 220, 1.1); break;
    case 'chute': noise(0.55, 0.24 * v, 'lowpass', 700, 0.5); break;
    case 'plane': noise(1.4, 0.2 * v, 'bandpass', 260, 0.6); tone(90, 1.4, 0.12 * v, 'sawtooth', 30); break;
  }
}

/** footsteps are driven by the walk cycle */
let stepT = 0;
export function footstep(speed, dt, crouch) {
  if (!ctx || speed < 0.06) return;
  stepT -= dt * (4.5 + speed * 8);
  if (stepT <= 0) {
    stepT = 1;
    sfx('step', crouch ? 0.35 : 0.5 + speed * 0.5);
  }
}

export function setWind(v) {
  if (windGain) windGain.gain.value = v;
}

/* ============================================================
   Botola 25 — audio.js
   Everything is synthesised with WebAudio: crowd noise, whistle,
   boot-on-ball thud, post clang, goal roar. No audio files.
   ============================================================ */

let ctx = null, master = null, crowdGain = null, crowdFilter = null, noiseBuf = null;
let enabled = true, started = false;

function noiseBuffer() {
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export const Sfx = {
  get enabled() { return enabled; },

  init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = noiseBuffer();

    // permanent crowd bed
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.value = 620;
    crowdFilter.Q.value = 0.7;
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.0;
    src.connect(crowdFilter).connect(crowdGain).connect(master);
    src.start();
    started = true;
    return true;
  },

  resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  },

  setEnabled(v) {
    enabled = v;
    if (master) master.gain.value = v ? 0.55 : 0;
  },

  crowd(level) {
    if (!started || !enabled) return;
    const target = 0.035 + level * 0.09;
    crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
    crowdFilter.frequency.setTargetAtTime(520 + level * 520, ctx.currentTime, 0.5);
  },

  whistle(n = 1) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(2250, t + i * 0.22);
      o.frequency.linearRampToValueAtTime(2450, t + i * 0.22 + 0.08);
      g.gain.setValueAtTime(0.0001, t + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + (n > 1 ? 0.18 : 0.32));
      o.connect(g).connect(master);
      o.start(t + i * 0.22);
      o.stop(t + i * 0.22 + 0.35);
    }
  },

  kick(power = 0.5) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    // low thud + a slap of noise
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 + power * 0.25, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.2);

    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.12 + power * 0.1, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(nf).connect(ng).connect(master);
    n.start(t); n.stop(t + 0.1);
  },

  post() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1180, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.55);
  },

  goal() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    // the roar: noise sweeping up
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    f.frequency.exponentialRampToValueAtTime(700, t + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    n.connect(f).connect(g).connect(master);
    n.start(t); n.stop(t + 3.1);
    // horn
    [330, 415, 495].forEach((hz, i) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      og.gain.setValueAtTime(0.0001, t + 0.05);
      og.gain.exponentialRampToValueAtTime(0.07, t + 0.2 + i * 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(og).connect(master);
      o.start(t + 0.05); o.stop(t + 2.0);
    });
  },

  ui() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(990, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.14);
  },

  coin() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    [880, 1320].forEach((hz, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.13, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.22);
      o.connect(g).connect(master);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.25);
    });
  },

  sad() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.65);
  },
};

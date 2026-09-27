// ============================================================
// audio.js — fully procedural sound engine (Web Audio API).
// No audio files: wind, crickets, footsteps, creaks, stings,
// phones, machinery & the chase are all synthesized live.
// ============================================================
import { clamp, rand, pick } from './utils.js';

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this._loops = {};         // named loops -> {nodes[], gains, stop()}
    this._heart = null;       // heartbeat state
    this._chase = null;       // chase percussion state
    this._nextCricket = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.ratio.value = 4;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.bus = {};
    for (const name of ['amb', 'sfx', 'ui', 'sting']) {
      const g = ctx.createGain(); g.connect(this.master); this.bus[name] = g;
    }
    this.bus.sting.gain.value = 1.0;
    // small generated room reverb, send bus for indoor sfx
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(0.9, 2.2);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.33;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.setVolume(this.settings.vol);
    this._noiseBuf = this._makeNoise(2);
    this._startWind(); this._startCrickets();
  }

  setVolume(v) { if (this.master) this.master.gain.value = v * v * 1.15; }

  updateListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.03); l.positionY.setTargetAtTime(pos.y, t, 0.03);
      l.positionZ.setTargetAtTime(pos.z, t, 0.03);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.03); l.forwardY.setTargetAtTime(fwd.y, t, 0.03);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.03);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }

  // per-frame: heartbeat + chase music scheduling
  update() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this._heart && t > this._heart.next) {
      this._heart.next = t + 60 / this._heart.bpm;
      this._thump(this._heart.vol); setTimeout(() => this._thump(this._heart.vol * 0.7), 170);
    }
    if (this._chase && t > this._chase.next) {
      const s = this._chase;
      s.step = (s.step + 1) % 16;
      s.next = t + 60 / s.bpm / 2; // 8th notes
      if (s.step % 4 === 0) this._kick(s.vol);
      if (s.step === 6 || s.step === 14) this._tom(s.vol * 0.8, 130);
      if (s.step === 8) this._tom(s.vol, 92);
      if (s.step % 2 === 1) this._hat(s.vol * 0.35);
      if (s.step === 0) this._clang(s.vol * 0.5);
    }
  }

  _impulse(dur, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = rate * dur;
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  _makeNoise(sec) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = rate * sec;
    const buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { // pink-ish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 0.6;
    }
    return buf;
  }

  // ---------- routing helpers ----------
  _panner(pos, ref = 1.6, max = 34) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'exponential';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.4;
    p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }
  _out(gain, bus, pos, ref, max, wet = 0.12) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    if (pos) {
      const p = this._panner(pos, ref, max);
      g.connect(p); p.connect(this.bus[bus]);
      const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.verb);
    } else { g.connect(this.bus[bus]); }
    return g;
  }
  _osc(type, freq, t0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0); return o; }
  _noise() { const s = this.ctx.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true; return s; }
  _env(param, t0, a, peak, dur, end = 0.0001) {
    param.setValueAtTime(0.0001, t0); param.linearRampToValueAtTime(peak, t0 + a);
    param.exponentialRampToValueAtTime(end, t0 + dur);
  }

  // ==========================================================
  // LOOPS
  // ==========================================================
  _startWind() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 240; f.Q.value = 0.6;
    const g = this._out(0.045, 'amb');
    const lfo = this._osc('sine', 0.07, t); const lg = ctx.createGain(); lg.gain.value = 130;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const g2 = ctx.createGain(); g2.gain.value = 1;
    const lfo2 = this._osc('sine', 0.13, t); const lg2 = ctx.createGain(); lg2.gain.value = 0.02;
    lfo2.connect(lg2); lg2.connect(g.gain); lfo2.start();
    src.connect(f); f.connect(g); src.start();
    this._loops.wind = { gain: g.gain, base: 0.045, stop: () => { try { src.stop(); lfo.stop(); lfo2.stop(); } catch {} } };
  }
  setWind(v) { const w = this._loops.wind; if (w) w.gain.setTargetAtTime(v, this.ctx.currentTime, 1.2); }

  _startCrickets() {
    const ctx = this.ctx;
    const g = this._out(0.028, 'amb');
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4300; f.Q.value = 8;
    f.connect(g);
    const stop = { dead: false };
    const chirp = () => {
      if (stop.dead) return;
      const t = ctx.currentTime;
      const o = this._osc('sine', rand(4100, 4600), t);
      const og = ctx.createGain();
      const n = Math.floor(rand(3, 7));
      og.gain.setValueAtTime(0, t);
      for (let i = 0; i < n; i++) {
        og.gain.setValueAtTime(rand(0.2, 0.4), t + i * 0.055 + 0.01);
        og.gain.setValueAtTime(0, t + i * 0.055 + 0.04);
      }
      og.gain.setValueAtTime(0, t + n * 0.06);
      o.connect(og); og.connect(f); o.start(t); o.stop(t + n * 0.07 + 0.02);
      this._loopTimers.push(setTimeout(chirp, rand(260, 1300)));
    };
    this._loopTimers = this._loopTimers || [];
    chirp();
    this._loops.crickets = { gain: g.gain, base: 0.028, stop: () => { stop.dead = true; } };
  }
  setCrickets(v) { const c = this._loops.crickets; if (c) c.gain.setTargetAtTime(v, this.ctx.currentTime, 1.0); }

  // persistent positional hum (neon sign, fridges, machines)
  startHum(id, pos, { freq = 120, vol = 0.05, type = 'sawtooth', ref = 1.2, max = 18, bus = 'amb' } = {}) {
    if (!this.ctx || this._loops[id]) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o1 = this._osc(type, freq, t); const o2 = this._osc('square', freq * 2.02, t);
    const og = ctx.createGain(); og.gain.value = 0.7;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq * 4;
    o1.connect(og); o2.connect(og); og.connect(f);
    const g = this._out(vol, bus, pos, ref, max, 0.05);
    f.connect(g); o1.start(t); o2.start(t);
    this._loops[id] = { nodes: [o1, o2], gain: g.gain, base: vol };
  }
  stopLoop(id, fade = 0.4) {
    const l = this._loops[id]; if (!l) return;
    delete this._loops[id];
    if (l.gain) l.gain.setTargetAtTime(0, this.ctx.currentTime, fade);
    setTimeout(() => { try { l.nodes && l.nodes.forEach(n => n.stop()); } catch {} try { l.stop && l.stop(); } catch {} }, fade * 4 * 1000 + 300);
  }
  setLoopVol(id, v, tc = 0.1) { const l = this._loops[id]; if (l && l.gain) l.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }

  startWasher(id, pos) { // unbalanced drum thump-a-thump
    if (!this.ctx || this._loops[id]) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 300; f.Q.value = 1.2;
    const thG = ctx.createGain(); thG.gain.value = 0.7;
    const lfo = this._osc('sine', 5.2, t); const lg = ctx.createGain(); lg.gain.value = 0.65;
    lfo.connect(lg); lg.connect(thG.gain); lfo.start();
    src.connect(f); f.connect(thG);
    const g = this._out(0.16, 'sfx', pos, 1.4, 15); thG.connect(g);
    src.start();
    this._loops[id] = { nodes: [src, lfo], gain: g.gain, base: 0.16 };
  }

  startStatic(id, pos, vol = 0.09) { // TV static
    if (!this.ctx || this._loops[id]) return;
    const ctx = this.ctx;
    const src = this._noise();
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    src.connect(f);
    const g = this._out(vol, 'sfx', pos, 1.2, 14, 0.2);
    f.connect(g); src.start();
    this._loops[id] = { nodes: [src], gain: g.gain, base: vol };
  }

  startMurmur(id, pos) { // muffled late-night TV voices behind a door
    if (!this.ctx || this._loops[id]) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('sawtooth', 90, t);
    const am = this._osc('sine', 3.1, t); const amg = ctx.createGain(); amg.gain.value = 55;
    am.connect(amg); amg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 2;
    o.connect(f);
    const g = this._out(0.05, 'sfx', pos, 1.1, 9, 0.3); f.connect(g);
    o.start(); am.start();
    this._loops[id] = { nodes: [o, am], gain: g.gain, base: 0.05 };
  }

  // ==========================================================
  // ONE-SHOTS — interactions
  // ==========================================================
  footstep(surface = 'concrete', vol = 0.5, pos = null, run = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise();
    const f = ctx.createBiquadFilter();
    const cfg = {
      concrete: { f: 500, q: 1.4, d: 0.09, v: 1.0 }, asphalt: { f: 380, q: 1.1, d: 0.1, v: 0.9 },
      carpet: { f: 190, q: 0.9, d: 0.08, v: 0.55 }, wood: { f: 300, q: 3, d: 0.12, v: 0.95 },
      gravel: { f: 900, q: 0.6, d: 0.13, v: 0.8 }, metal: { f: 700, q: 6, d: 0.16, v: 0.7 },
    }[surface] || { f: 400, q: 1, d: 0.1, v: 1 };
    f.type = surface === 'metal' ? 'bandpass' : 'lowpass'; f.frequency.value = cfg.f * rand(0.85, 1.2); f.Q.value = cfg.q;
    const g = this._out(vol * cfg.v * (run ? 1.35 : 1), 'sfx', pos, 1.2, 22, 0.16);
    this._env(g.gain, t, 0.004, vol * cfg.v * (run ? 1.35 : 1) * 0.7, cfg.d);
    src.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.0001, t); // env handles level
    src.start(t); src.stop(t + cfg.d + 0.05);
    if (surface === 'wood') { // slight creak underfoot
      const o = this._osc('triangle', rand(70, 90), t);
      const og = this._out(0.08 * vol, 'sfx', pos, 1.2, 14);
      this._env(og.gain, t, 0.01, 0.08 * vol, 0.15);
      o.connect(og); o.start(t); o.stop(t + 0.2);
    }
  }

  knock(n = 3, pos = null, vol = 0.8, hard = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (hard ? 0.22 : rand(0.28, 0.4));
      const o = this._osc('sine', hard ? 95 : rand(140, 170), t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
      const g = this._out(vol, 'sfx', pos, 1.5, 26, 0.25);
      this._env(g.gain, t, 0.003, vol * (hard ? 1 : 0.7), 0.14);
      o.connect(g); o.start(t); o.stop(t + 0.2);
      if (hard) { const src = this._noise(); const f = ctx.createBiquadFilter(); f.frequency.value = 900; const ng = this._out(vol * 0.4, 'sfx', pos, 1.5, 26); this._env(ng.gain, t, 0.002, vol * 0.35, 0.05); src.connect(f); f.connect(ng); src.start(t); src.stop(t + 0.08); }
    }
  }

  doorCreak(open = true, pos = null, slow = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = slow ? rand(1.0, 1.4) : rand(0.35, 0.6);
    const o = this._osc('sawtooth', rand(180, 240), t);
    o.frequency.linearRampToValueAtTime(rand(90, 140), t + dur * 0.8);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 9;
    f.frequency.linearRampToValueAtTime(open ? 700 : 300, t + dur);
    const g = this._out(0.11, 'sfx', pos, 1.3, 16, 0.3);
    this._env(g.gain, t, dur * 0.25, 0.11, dur);
    o.connect(f); f.connect(g); o.start(t); o.stop(t + dur + 0.05);
    // latch at the end
    const t2 = t + dur + 0.04;
    const o2 = this._osc('square', 900, t2); const g2 = this._out(0.06, 'sfx', pos, 1.3, 12);
    this._env(g2.gain, t2, 0.002, 0.06, 0.03);
    o2.connect(g2); o2.start(t2); o2.stop(t2 + 0.05);
  }

  doorSlam(pos = null, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('sine', 120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.13);
    const g = this._out(vol, 'sfx', pos, 1.6, 30, 0.35);
    this._env(g.gain, t, 0.002, vol, 0.2);
    o.connect(g); o.start(t); o.stop(t + 0.25);
    const src = this._noise(); const f = ctx.createBiquadFilter(); f.frequency.value = 500;
    const ng = this._out(vol * 0.5, 'sfx', pos, 1.6, 30);
    this._env(ng.gain, t, 0.001, vol * 0.45, 0.08);
    src.connect(f); f.connect(ng); src.start(t); src.stop(t + 0.12);
  }

  latch(kind = 'click', pos = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const cfg = {
      click: [1100, 0.05, 0.05], switch: [1600, 0.07, 0.04], locked: [300, 0.14, 0.09],
      unlock: [700, 0.09, 0.06], bolt: [220, 0.16, 0.12], drawer: [500, 0.05, 0.05],
      key: [1800, 0.04, 0.05], pickup: [900, 0.06, 0.05], ui: [1500, 0.025, 0.03],
      paper: [2400, 0.03, 0.05], slam: [180, 0.2, 0.2],
    }[kind] || [800, 0.06, 0.05];
    if (kind === 'locked') { // jiggle: a few rapid clicks
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.07;
        const o = this._osc('square', cfg[0] + i * 40, tt);
        const g = this._out(0.16, 'sfx', pos, 1.2, 14);
        this._env(g.gain, tt, 0.002, 0.14, cfg[2]);
        o.connect(g); o.start(tt); o.stop(tt + 0.1);
      }
      return;
    }
    if (kind === 'paper') {
      const src = this._noise(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000;
      const g = this._out(0.12, 'sfx', pos, 1.2, 10);
      this._env(g.gain, t, 0.01, 0.1, 0.22);
      src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.3); return;
    }
    const o = this._osc('square', cfg[0], t);
    const g = this._out(0.12, 'sfx', pos, 1.2, 12);
    this._env(g.gain, t, 0.002, cfg[1] * 2, cfg[2]);
    o.connect(g); o.start(t); o.stop(t + cfg[2] + 0.06);
    if (kind === 'bolt' || kind === 'unlock') {
      const o2 = this._osc('square', cfg[0] * 0.5, t + 0.09);
      const g2 = this._out(0.13, 'sfx', pos, 1.2, 12);
      this._env(g2.gain, t + 0.09, 0.002, 0.12, cfg[2]);
      o2.connect(g2); o2.start(t + 0.09); o2.stop(t + 0.25);
    }
  }

  drawerSlide(open = true, pos = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = open ? 640 : 520; f.Q.value = 2;
    const g = this._out(0.1, 'sfx', pos, 1.2, 12, 0.2);
    this._env(g.gain, t, 0.05, 0.1, 0.42);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.5);
    const t2 = t + 0.42;
    const o = this._osc('sine', 180, t2); const g2 = this._out(0.09, 'sfx', pos, 1.2, 10);
    this._env(g2.gain, t2, 0.002, 0.09, 0.06);
    o.connect(g2); o.start(t2); o.stop(t2 + 0.1);
  }

  // phone
  msgDing() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [delay, fr] of [[0, 1244], [0.09, 932]]) {
      const tt = t + delay;
      const o = this._osc('sine', fr, tt);
      const g = this._out(0.09, 'ui');
      this._env(g.gain, tt, 0.004, 0.09, 0.5);
      o.connect(g); o.start(tt); o.stop(tt + 0.55);
    }
  }
  phoneBuzz(long = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const pulses = long ? [0, 0.28, 0.56, 0.84] : [0, 0.18];
    for (const p of pulses) {
      const o = this._osc('square', 175, t + p);
      const g = this._out(0.05, 'ui');
      this._env(g.gain, t + p, 0.01, 0.05, 0.14);
      o.connect(g); o.start(t + p); o.stop(t + p + 0.18);
    }
  }
  landlineRing(pos = null, rings = 2) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let r = 0; r < rings; r++) {
      const t0 = ctx.currentTime + r * 2.2;
      const o = this._osc('sawtooth', 1180, t0), o2 = this._osc('sawtooth', 990, t0);
      const am = this._osc('square', 22, t0); const amg = ctx.createGain(); amg.gain.value = 0.5;
      const vca = ctx.createGain(); vca.gain.value = 0.5;
      am.connect(amg); amg.connect(vca.gain);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 4;
      o.connect(vca); o2.connect(vca); vca.connect(f);
      const g = this._out(0.16, 'sfx', pos, 1.4, 22, 0.3);
      f.connect(g);
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.16, t0 + 0.03);
      g.gain.setValueAtTime(0.16, t0 + 1.1); g.gain.linearRampToValueAtTime(0.0001, t0 + 1.25);
      for (const x of [o, o2, am]) { x.start(t0); x.stop(t0 + 1.3); }
    }
  }

  // machinery / ambient one-shots
  breakerChunk(pos = null, big = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('square', big ? 120 : 300, t);
    const g = this._out(big ? 0.35 : 0.16, 'sfx', pos, 1.4, 18, 0.3);
    this._env(g.gain, t, 0.002, big ? 0.35 : 0.16, 0.09);
    o.connect(g); o.start(t); o.stop(t + 0.15);
    if (big) { // mains thunk + brief electric crackle
      const src = this._noise(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
      const ng = this._out(0.12, 'sfx', pos, 1.4, 18);
      this._env(ng.gain, t + 0.05, 0.02, 0.1, 0.5);
      src.connect(f); f.connect(ng); src.start(t + 0.05); src.stop(t + 0.7);
    }
  }
  powerDown() { // whole building exhales: descending hum
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('sawtooth', 110, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.6);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = this._out(0.2, 'sfx');
    this._env(g.gain, t, 0.05, 0.2, 1.9);
    o.connect(f); f.connect(g); o.start(t); o.stop(t + 2.0);
  }
  powerUp() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('sawtooth', 45, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = this._out(0.22, 'sfx');
    this._env(g.gain, t, 0.02, 0.22, 1.3);
    o.connect(f); f.connect(g); o.start(t); o.stop(t + 1.4);
  }
  thunder(far = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(far ? 160 : 400, t);
    f.frequency.exponentialRampToValueAtTime(50, t + (far ? 3 : 1.6));
    const g = this._out(far ? 0.25 : 0.5, 'amb');
    this._env(g.gain, t, far ? 0.5 : 0.03, far ? 0.25 : 0.5, far ? 3.4 : 2.1);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + 3.8);
  }
  carPass() { // a car sweeps past on Route 9
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = rand(3.4, 4.6);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(rand() < 0.5 ? -1 : 1, t);
    pan.pan.linearRampToValueAtTime(0, t + dur / 2);
    pan.pan.linearRampToValueAtTime(pan.pan.value > 0 ? -1 : 1, t + dur);
    const o = this._osc('sawtooth', 55, t);
    o.frequency.linearRampToValueAtTime(85, t + dur / 2);
    o.frequency.linearRampToValueAtTime(48, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + dur / 2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(pan); pan.connect(this.bus.amb);
    o.start(t); o.stop(t + dur + 0.1);
  }
  whisper() { // dry breath right at your ear (stings)
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1400, t + 0.5); f.frequency.linearRampToValueAtTime(500, t + 1.1); f.Q.value = 3;
    const g = this._out(0.3, 'sting');
    this._env(g.gain, t, 0.25, 0.28, 1.3);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + 1.4);
  }

  // ---------- stings & scares ----------
  stingLow(vol = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const fr of [55, 58.3, 82.4, 110.7]) {
      const o = this._osc('sawtooth', fr, t);
      o.detune.setValueAtTime(rand(-14, 14), t);
      o.detune.linearRampToValueAtTime(rand(-50, 50), t + 1.8);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      const g = this._out(vol * 0.22, 'sting');
      this._env(g.gain, t, 0.02, vol * 0.2, 2.0);
      o.connect(f); f.connect(g); o.start(t); o.stop(t + 2.1);
    }
    this._kick(vol * 0.9);
  }
  stingHit(vol = 0.8) { // sharp dissonant hit + noise burst
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const fr of [220, 233.1, 466.2, 622, 932]) {
      const o = this._osc('square', fr, t);
      o.detune.value = rand(-30, 30);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr * 1.4; f.Q.value = 2;
      const g = this._out(vol * 0.13, 'sting');
      this._env(g.gain, t, 0.003, vol * 0.13, rand(0.5, 0.9));
      o.connect(f); f.connect(g); o.start(t); o.stop(t + 1);
    }
    const src = this._noise();
    const f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = 1500;
    const ng = this._out(vol * 0.4, 'sting');
    this._env(ng.gain, t, 0.001, vol * 0.4, 0.3);
    src.connect(f2); f2.connect(ng); src.start(t); src.stop(t + 0.4);
    this._kick(vol);
  }
  jumpscare() { // the big one: shriek formant + sub drop + clatter
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // scream-ish: stacked gliding saws through formant filter
    for (const [fr, to] of [[900, 1600], [1250, 2100], [640, 1100]]) {
      const o = this._osc('sawtooth', fr, t);
      o.frequency.exponentialRampToValueAtTime(to, t + 0.5);
      o.frequency.exponentialRampToValueAtTime(200, t + 1.3);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(1300, t);
      f.frequency.exponentialRampToValueAtTime(2400, t + 0.5); f.Q.value = 4;
      const g = this._out(0.3, 'sting');
      this._env(g.gain, t, 0.01, 0.28, 1.35);
      o.connect(f); f.connect(g); o.start(t); o.stop(t + 1.45);
    }
    // breathy noise
    const src = this._noise();
    const f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = 900;
    const ng = this._out(0.5, 'sting');
    this._env(ng.gain, t, 0.01, 0.45, 1.1);
    src.connect(f2); f2.connect(ng); src.start(t); src.stop(t + 1.2);
    // sub slam
    const o2 = this._osc('sine', 120, t); o2.frequency.exponentialRampToValueAtTime(28, t + 1.0);
    const g2 = this._out(0.85, 'sting');
    this._env(g2.gain, t, 0.004, 0.85, 1.4);
    o2.connect(g2); o2.start(t); o2.stop(t + 1.5);
  }

  heartbeat(bpm = 0, vol = 0.5) {
    if (!this.ctx) return;
    if (bpm <= 0) { this._heart = null; return; }
    this._heart = { bpm, vol, next: this.ctx.currentTime };
  }
  chaseMusic(on, bpm = 150) {
    if (!this.ctx) return;
    if (!on) { this._chase = null; return; }
    this._chase = { bpm, step: -1, next: this.ctx.currentTime, vol: 0.4 };
  }

  _kick(vol) {
    const t = this.ctx.currentTime;
    const o = this._osc('sine', 130, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
    const g = this._out(vol, 'sting');
    this._env(g.gain, t, 0.002, vol, 0.18);
    o.connect(g); o.start(t); o.stop(t + 0.25);
  }
  _tom(vol, fr) {
    const t = this.ctx.currentTime;
    const o = this._osc('sine', fr, t); o.frequency.exponentialRampToValueAtTime(fr * 0.5, t + 0.16);
    const g = this._out(vol * 0.6, 'sting');
    this._env(g.gain, t, 0.003, vol * 0.6, 0.2);
    o.connect(g); o.start(t); o.stop(t + 0.25);
  }
  _hat(vol) {
    const t = this.ctx.currentTime;
    const src = this._noise();
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
    const g = this._out(vol, 'sting');
    this._env(g.gain, t, 0.001, vol, 0.04);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.06);
  }
  _clang(vol) {
    const t = this.ctx.currentTime;
    for (const fr of [842, 1123, 1680]) {
      const o = this._osc('square', fr * rand(0.98, 1.02), t);
      const g = this._out(vol * 0.2, 'sting');
      this._env(g.gain, t, 0.002, vol * 0.16, rand(0.7, 1.2));
      o.connect(g); o.start(t); o.stop(t + 1.3);
    }
  }
  _thump(vol) {
    const t = this.ctx.currentTime;
    const o = this._osc('sine', 58, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.1);
    const g = this._out(vol, 'sfx');
    this._env(g.gain, t, 0.004, vol, 0.16);
    o.connect(g); o.start(t); o.stop(t + 0.24);
  }

  duckAmbience(sec = 1.5, to = 0.2) {
    if (!this.ctx) return;
    const g = this.bus.amb.gain, t = this.ctx.currentTime;
    const old = g.value;
    g.cancelScheduledValues(t); g.setValueAtTime(old, t);
    g.linearRampToValueAtTime(old * to, t + 0.08);
    g.linearRampToValueAtTime(old, t + sec);
  }
}

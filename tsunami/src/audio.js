// audio.js — fully procedural WebAudio: ambience, weather, engines, SFX and a generative score
import { clamp, clamp01, lerp, rand, mulberry32 } from './util.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.rng = mulberry32(31337);
    this.volumes = { master: 0.85, music: 0.5, ambience: 0.7, sfx: 0.9 };
    this._lastStep = 0;
    this.danger = 0;
    this.storm = 0;
    this.underwater = false;
    this.enabled = true;
    this.warned = false;
  }

  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return false; }
    try {
      this.ctx = new AC();
    } catch (e) { this.enabled = false; return false; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    // buses
    this.busMusic = ctx.createGain(); this.busMusic.gain.value = this.volumes.music;
    this.busAmb = ctx.createGain(); this.busAmb.gain.value = this.volumes.ambience;
    this.busSfx = ctx.createGain(); this.busSfx.gain.value = this.volumes.sfx;
    this.busMusic.connect(this.master);
    this.busAmb.connect(this.master);
    this.busSfx.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = true;
    this.startAmbience();
    this.startMusic();
    return true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volumes.master; }

  /* ------------------------------------------------------------- helpers */
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  noiseSource() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; return s; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filt(type, freq, q = 1) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
  panner(x, y, z) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 6; p.maxDistance = 200; p.rolloffFactor = 1.2;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
    return p;
  }

  /* ----------------------------------------------------------- ambience */
  startAmbience() {
    const ctx = this.ctx;
    // ---- ocean waves
    const src = this.noiseSource();
    const lp = this.filt('lowpass', 480, 0.7);
    const hp = this.filt('highpass', 90, 0.6);
    const g = this.gain(0.0);
    src.connect(lp); lp.connect(hp); hp.connect(g); g.connect(this.busAmb);
    src.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.075;
    const lfoGain = this.gain(0.16);
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    lfo.start();
    this.waveGain = g;
    this.waveFilter = lp;
    // ---- wind
    const wsrc = this.noiseSource();
    const wbp = this.filt('bandpass', 620, 0.8);
    const wg = this.gain(0.02);
    wsrc.connect(wbp); wbp.connect(wg); wg.connect(this.busAmb);
    wsrc.start();
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.11;
    const wlg = this.gain(0.02);
    wlfo.connect(wlg); wlg.connect(wg.gain);
    wlfo.start();
    this.windGain = wg;
    // ---- rain
    const rsrc = this.noiseSource();
    const rbp = this.filt('highpass', 1400, 0.5);
    const rg = this.gain(0);
    rsrc.connect(rbp); rbp.connect(rg); rg.connect(this.busAmb);
    rsrc.start();
    this.rainGain = rg;
    // ---- forest / insects
    const fsrc = this.noiseSource();
    const fbp = this.filt('bandpass', 2400, 3.5);
    const fg = this.gain(0);
    fsrc.connect(fbp); fbp.connect(fg); fg.connect(this.busAmb);
    fsrc.start();
    this.forestGain = fg;
    void ctx;
  }

  /** generative score: slow pads that get darker as danger rises */
  startMusic() {
    const ctx = this.ctx;
    this.music = { step: 0, chords: [[0, 3, 7, 10], [-2, 2, 5, 9], [-4, 1, 4, 7], [0, 3, 7, 12]] };
    this.musicTimer = 0;
    this.musicGain = this.gain(1);
    this.musicGain.connect(this.busMusic);
    this.padVoices = [];
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'triangle';
      const g = this.gain(0);
      const f = this.filt('lowpass', 900, 1.4);
      o.connect(f); f.connect(g); g.connect(this.musicGain);
      o.start();
      this.padVoices.push({ osc: o, gain: g, filt: f });
    }
    void ctx;
  }

  playChord(root = 0, bright = 1) {
    if (!this.ready) return;
    const t = this.now();
    const freqs = this.music.chords[this.music.step % this.music.chords.length]
      .map((n) => 110 * Math.pow(2, (n + root) / 12));
    this.music.step++;
    this.padVoices.forEach((v, i) => {
      const f = freqs[i % freqs.length] * (i === 0 ? 0.5 : 1);
      v.osc.frequency.setTargetAtTime(f, t, 1.6);
      v.gain.gain.setTargetAtTime(0.055 * bright, t, 1.4);
      v.filt.frequency.setTargetAtTime(500 + bright * 2200, t, 2.0);
    });
  }

  /* ------------------------------------------------------------- one-shots */
  play(name, opts = {}) {
    if (!this.ready || this.muted) return;
    const t = this.now();
    const ctx = this.ctx;
    const out = opts.position ? this.panner(opts.position[0], opts.position[1], opts.position[2]) : this.busSfx;
    if (opts.position) out.connect(this.busSfx);
    const env = (node, a, d, peak = 1, dest = out) => {
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      node.connect(g); g.connect(dest);
      return g;
    };
    const tone = (freq, type, a, d, peak = 0.25, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      env(o, a, d, peak);
      o.start(t); o.stop(t + a + d + 0.05);
      return o;
    };
    const noise = (filterType, freq, q, a, d, peak = 0.3) => {
      const s = this.noiseSource();
      const f = this.filt(filterType, freq, q);
      s.connect(f);
      env(f, a, d, peak);
      s.start(t);
      s.stop(t + a + d + 0.05);
      return s;
    };
    switch (name) {
      case 'step': {
        const surf = opts.surface || 'grass';
        if (surf === 'sand') noise('lowpass', 900, 0.6, 0.005, 0.14, 0.22);
        else if (surf === 'rock') { noise('bandpass', 2600, 1.2, 0.004, 0.09, 0.2); }
        else noise('lowpass', 1500, 0.8, 0.004, 0.11, 0.18);
        break;
      }
      case 'jump': tone(220, 'sine', 0.01, 0.12, 0.12); break;
      case 'land': noise('lowpass', 700, 0.7, 0.005, 0.16, 0.3); break;
      case 'splash': noise('bandpass', 900, 0.5, 0.01, 0.5, 0.34); tone(180, 'sine', 0.01, 0.3, 0.1); break;
      case 'water': {           // filling a bottle / pouring water
        noise('bandpass', 1500, 1.4, 0.02, 0.28, 0.16);
        setTimeout(() => noise('lowpass', 700, 0.8, 0.02, 0.22, 0.12), 180);
        break;
      }
      case 'swim': noise('lowpass', 600, 0.6, 0.02, 0.4, 0.16); break;
      case 'drink': tone(300, 'sine', 0.01, 0.16, 0.14); setTimeout(() => this.play('gulp'), 150); break;
      case 'gulp': tone(150, 'sine', 0.01, 0.14, 0.16); break;
      case 'eat': noise('lowpass', 1200, 0.8, 0.01, 0.12, 0.16); break;
      case 'chop': noise('lowpass', 500, 0.9, 0.005, 0.22, 0.42); tone(120, 'triangle', 0.005, 0.18, 0.2); break;
      case 'metal': noise('bandpass', 3200, 2.5, 0.004, 0.4, 0.3); tone(880, 'square', 0.004, 0.25, 0.06); break;
      case 'build': tone(420, 'triangle', 0.01, 0.18, 0.2); setTimeout(() => this.play('chop'), 130); break;
      case 'craft': tone(660, 'sine', 0.01, 0.12, 0.18); setTimeout(() => tone(990, 'sine', 0.01, 0.18, 0.16), 110); break;
      case 'ui': tone(720, 'sine', 0.005, 0.07, 0.12); break;
      case 'uiBig': tone(520, 'triangle', 0.01, 0.22, 0.16); setTimeout(() => tone(780, 'triangle', 0.01, 0.3, 0.14), 120); break;
      case 'cast': noise('bandpass', 1800, 1.2, 0.02, 0.4, 0.18); break;
      case 'charge': tone(160, 'sawtooth', 0.05, 0.35, 0.05); break;
      case 'bite': tone(1200, 'sine', 0.005, 0.09, 0.2); setTimeout(() => tone(900, 'sine', 0.005, 0.12, 0.18), 90); break;
      case 'legendaryBite': for (let i = 0; i < 4; i++) setTimeout(() => tone(1400 - i * 120, 'sine', 0.005, 0.15, 0.18), i * 110); break;
      case 'strike': noise('bandpass', 2400, 2, 0.004, 0.2, 0.3); tone(300, 'square', 0.005, 0.15, 0.1); break;
      case 'snap': noise('highpass', 3000, 1, 0.003, 0.12, 0.4); tone(2400, 'square', 0.003, 0.1, 0.12); break;
      case 'catch': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 'triangle', 0.01, 0.3, 0.18), i * 120)); break;
      case 'legendary': [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 'sine', 0.01, 0.6, 0.2), i * 150)); break;
      case 'miss': tone(200, 'sawtooth', 0.01, 0.25, 0.1); break;
      case 'siren': {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const f = this.filt('lowpass', 1400, 1);
        o.connect(f); env(f, 0.4, 3.4, 0.16);
        o.frequency.setValueAtTime(420, t);
        for (let i = 0; i < 6; i++) {
          o.frequency.linearRampToValueAtTime(680, t + 0.5 + i);
          o.frequency.linearRampToValueAtTime(420, t + 1.0 + i);
        }
        o.start(t); o.stop(t + 4.2);
        break;
      }
      case 'thunder': {
        const s = this.noiseSource();
        const f = this.filt('lowpass', 320, 0.9);
        s.connect(f);
        const g = env(f, 0.08, 2.6, opts.near ? 0.8 : 0.4);
        f.frequency.setValueAtTime(420, t);
        f.frequency.exponentialRampToValueAtTime(60, t + 2.4);
        s.start(t); s.stop(t + 3);
        void g;
        break;
      }
      case 'quake': {
        const s = this.noiseSource();
        const f = this.filt('lowpass', 90, 1.4);
        s.connect(f); env(f, 0.6, 5.0, 0.55);
        s.start(t); s.stop(t + 6);
        tone(42, 'sine', 0.5, 4.0, 0.22);
        break;
      }
      case 'rumble': {
        const s = this.noiseSource();
        const f = this.filt('lowpass', 160, 1.1);
        s.connect(f); env(f, 2.0, 8.0, 0.6);
        s.start(t); s.stop(t + 11);
        tone(34, 'sine', 2.0, 7.0, 0.28);
        break;
      }
      case 'waveHit': {
        const s = this.noiseSource();
        const f = this.filt('lowpass', 700, 0.7);
        s.connect(f); env(f, 0.15, 3.0, 0.65);
        s.start(t); s.stop(t + 3.4);
        break;
      }
      case 'rockfall': {
        for (let i = 0; i < 6; i++) setTimeout(() => {
          noise('lowpass', 900 + Math.random() * 900, 0.8, 0.005, 0.5, 0.3);
          tone(120 + Math.random() * 80, 'triangle', 0.005, 0.35, 0.14);
        }, i * (180 + Math.random() * 260));
        break;
      }
      case 'heartbeat': tone(58, 'sine', 0.01, 0.16, 0.35); setTimeout(() => tone(48, 'sine', 0.01, 0.2, 0.25), 210); break;
      case 'hurt': noise('lowpass', 700, 0.9, 0.005, 0.2, 0.35); tone(180, 'sawtooth', 0.005, 0.2, 0.14); break;
      case 'death': [220, 196, 165, 110].forEach((f, i) => setTimeout(() => tone(f, 'sine', 0.05, 1.2, 0.22), i * 260)); break;
      case 'fire': noise('bandpass', 900, 1.4, 0.05, 1.2, 0.22); break;
      case 'shoot': noise('highpass', 1800, 1, 0.002, 0.1, 0.3); break;
      case 'panic': tone(300 + Math.random() * 300, 'sawtooth', 0.02, 0.35, 0.08); break;
      case 'win': [392, 523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 'triangle', 0.02, 1.4, 0.2), i * 220)); break;
      default: break;
    }
  }

  /* --------------------------------------------------------------- engines */
  startEngine(kind = 'car') {
    if (!this.ready || this.engine) return;
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const f = this.filt('lowpass', 700, 1.2);
    const g = this.gain(0);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.busSfx);
    o1.start(); o2.start();
    this.engine = { o1, o2, g, f, kind };
  }
  stopEngine() {
    if (!this.engine) return;
    const t = this.now();
    this.engine.g.gain.setTargetAtTime(0, t, 0.15);
    const e = this.engine;
    setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch (err) { } }, 500);
    this.engine = null;
  }

  /* -------------------------------------------------------------- update */
  update(dt, s = {}) {
    if (!this.ready) return;
    // ocean: louder near the beach, huge during the tsunami
    const waveTarget = s.nearSea ? 0.14 + s.storm * 0.2 + s.flood * 0.42 : 0.03;
    this.waveGain.gain.setTargetAtTime(waveTarget, this.now(), 0.6);
    this.waveFilter.frequency.setTargetAtTime(360 + s.storm * 500 + s.flood * 900, this.now(), 0.7);
    this.windGain.gain.setTargetAtTime(0.015 + s.storm * 0.075 + (s.altitude || 0) * 0.00018, this.now(), 0.8);
    this.rainGain.gain.setTargetAtTime((s.rain || 0) * 0.09, this.now(), 1.2);
    this.forestGain.gain.setTargetAtTime(s.forest || 0, this.now(), 1.4);
    // engines
    if (s.engine) {
      if (!this.engine || this.engine.kind !== s.engine.kind) {
        this.stopEngine();
        this.startEngine(s.engine.kind);
      }
      const rpm = clamp01(s.engine.rpm);
      const base = s.engine.kind === 'boat' ? 60 : 42;
      const f = base + rpm * (s.engine.kind === 'boat' ? 90 : 150);
      this.engine.o1.frequency.setTargetAtTime(f, this.now(), 0.08);
      this.engine.o2.frequency.setTargetAtTime(f * 0.5, this.now(), 0.08);
      this.engine.g.gain.setTargetAtTime(0.05 + rpm * 0.07, this.now(), 0.15);
      this.engine.f.frequency.setTargetAtTime(400 + rpm * 1800, this.now(), 0.2);
    } else if (this.engine) this.stopEngine();
    // music
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = lerp(26, 12, this.danger);
      this.playChord(0, 0.35 + this.danger * 0.65);
    }
    if (s.danger !== undefined) this.danger = lerp(this.danger, s.danger, 1 - Math.exp(-0.4 * dt));
    if (s.underwater !== undefined && s.underwater !== this.underwater) {
      this.underwater = s.underwater;
      const t = this.now();
      this.busAmb.gain.setTargetAtTime(s.underwater ? this.volumes.ambience * 0.25 : this.volumes.ambience, t, 0.3);
      this.busSfx.gain.setTargetAtTime(s.underwater ? this.volumes.sfx * 0.45 : this.volumes.sfx, t, 0.3);
    }
    if (s.heartRate && this.danger > 0.6) {
      this._hb = (this._hb || 0) - dt;
      if (this._hb <= 0) { this.play('heartbeat'); this._hb = lerp(1.4, 0.62, this.danger); }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AMBIENT AUDIO — everything synthesised live with the Web Audio API:
//  wind bed, wave lapping, campfire crackle, day birdsong, night crickets and
//  soft footsteps. Zero audio files. Autostarts on the first user gesture.
// ═══════════════════════════════════════════════════════════════════════════

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.master = null;
    this._birds = 0; this._crickets = 0; this._steps = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(c.destination);

    // ── noise buffer (2 s of pink-ish noise) ───────────────────────────────
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    this.noiseBuf = buf;

    // ── wind ───────────────────────────────────────────────────────────────
    const wind = c.createBufferSource(); wind.buffer = buf; wind.loop = true;
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.7;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.14;
    wind.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.master);
    wind.start();
    // slow LFO on the wind band
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 190;
    lfo.connect(lfoG); lfoG.connect(wf.frequency); lfo.start();
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.043;
    const lfo2G = c.createGain(); lfo2G.gain.value = 0.07;
    lfo2.connect(lfo2G); lfo2G.connect(this.windGain.gain); lfo2.start();

    // ── surf / waves ───────────────────────────────────────────────────────
    const surf = c.createBufferSource(); surf.buffer = buf; surf.loop = true;
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 620;
    this.surfGain = c.createGain(); this.surfGain.gain.value = 0.0;
    surf.connect(sf); sf.connect(this.surfGain); this.surfGain.connect(this.master);
    surf.start();
    const sl = c.createOscillator(); sl.frequency.value = 0.11;
    const slG = c.createGain(); slG.gain.value = 0.09;
    sl.connect(slG); slG.connect(this.surfGain.gain); sl.start();
    this._surfBase = this.surfGain.gain;

    // ── fire crackle bed (filtered noise burst train, gated by proximity) ──
    const fire = c.createBufferSource(); fire.buffer = buf; fire.loop = true;
    fire.playbackRate.value = 1.7;
    const ff = c.createBiquadFilter(); ff.type = 'highpass'; ff.frequency.value = 900;
    this.fireGain = c.createGain(); this.fireGain.gain.value = 0.0;
    fire.connect(ff); ff.connect(this.fireGain); this.fireGain.connect(this.master);
    fire.start();

    this.ready = true;
    this.setMuted(!this.enabled);
  }

  setMuted(m) {
    this.enabled = !m;
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.4);
  }

  /** per-frame mix: night, distance to fire, distance to shore */
  update(dt, info) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const night = info.night ?? 0;
    // wind swells a little at night
    this.windGain.gain.setTargetAtTime(0.1 + night * 0.09, t, 1.2);
    // surf louder when close to the water
    const surf = Math.max(0, 1 - (info.distToSea ?? 40) / 46);
    this.surfGain.gain.setTargetAtTime(surf * 0.2, t, 0.8);
    // fire
    const fire = Math.max(0, 1 - (info.distToFire ?? 60) / 22);
    this.fireGain.gain.setTargetAtTime(fire * fire * 0.34, t, 0.3);

    // birds by day
    this._birds -= dt;
    if (this._birds <= 0 && night < 0.35) { this._birds = 1.6 + Math.random() * 5.5; this.bird(); }
    // crickets by night
    this._crickets -= dt;
    if (this._crickets <= 0 && night > 0.45) { this._crickets = 0.16 + Math.random() * 0.3; this.cricket(); }
  }

  bird() {
    const c = this.ctx, t = c.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 1500 + Math.random() * 1400;
    const g = c.createGain(); g.gain.value = 0;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6; f.frequency.value = base;
    g.connect(this.master);
    let o = null;
    for (let i = 0; i < notes; i++) {
      const st = t + i * (0.09 + Math.random() * 0.1);
      o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.85 + Math.random() * 0.4), st);
      o.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.5), st + 0.07);
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, st);
      ng.gain.exponentialRampToValueAtTime(0.075, st + 0.015);
      ng.gain.exponentialRampToValueAtTime(0.0001, st + 0.11);
      o.connect(ng); ng.connect(f); f.connect(g);
      o.start(st); o.stop(st + 0.14);
    }
    g.gain.setValueAtTime(0.9, t);
    g.gain.setValueAtTime(0.0, t + notes * 0.2 + 0.2);
  }

  cricket() {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.value = 4200 + Math.random() * 900;
    const g = c.createGain(); g.gain.value = 0;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.frequency.value; f.Q.value = 12;
    o.connect(f); f.connect(g); g.connect(this.master);
    const chirps = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < chirps; i++) {
      const st = t + i * 0.055;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.02, st + 0.008);
      g.gain.linearRampToValueAtTime(0.0001, st + 0.03);
    }
    o.start(t); o.stop(t + chirps * 0.06 + 0.05);
  }

  step(soft = false) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.7 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = soft ? 900 : 1500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(soft ? 0.05 : 0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 0.2);
  }

  click(freq = 620) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  place() {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.15);
  }
}

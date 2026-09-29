// ─────────────────────────────────────────────────────────────────────────────
//  audio.js — everything is synthesised, nothing is downloaded
//
//  Ball clacks are short filtered noise bursts pitched by impact speed, the
//  cushions are lower and duller, pockets are a drop plus a wooden rattle, and
//  every table event is positioned in 3D with a PannerNode so a shot on the
//  far table sounds like it is over there. The hall ambience and the music bed
//  are generated too (brown noise + slow chord drift).
// ─────────────────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Audio3D {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.musicOn = true;
    this.spatial = true;
    this.volume = 0.7;
    this.sfxVolume = 0.85;
    this._last = { clack: 0, rail: 0 };
  }

  /** must be called from a user gesture on most browsers */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ready; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0.0;
    this.musicBus.connect(this.master);

    // a gentle limiter so a 15-ball break cannot clip
    try {
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 22;
      this.comp.ratio.value = 6; this.comp.attack.value = 0.002; this.comp.release.value = 0.18;
      this.sfxBus.disconnect(); this.sfxBus.connect(this.comp); this.comp.connect(this.master);
    } catch (e) { /* older browsers */ }

    this.listener = c.listener;

    // shared noise buffer (1 s of white noise) — every percussive sound uses it
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;                 // brown-ish
      d[i] = w * 0.6 + last * 3.0;
    }

    this._startAmbience();
    if (this.musicOn) this._startMusic();
    this.ready = true;
    return true;
  }

  setVolume(v) { this.volume = clamp(v, 0, 1); if (this.master) this.master.gain.value = this.volume; }
  setSfxVolume(v) { this.sfxVolume = clamp(v, 0, 1); if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume; }
  setEnabled(on) { this.enabled = !!on; if (this.master) this.master.gain.value = on ? this.volume : 0; }
  setMusic(on) {
    this.musicOn = !!on;
    if (!this.ctx) return;
    if (on) this._startMusic();
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.16 : 0.0, this.ctx.currentTime, 0.6);
  }

  /** the camera is the listener */
  setListener(pos, forward, up) {
    if (!this.ctx || !this.spatial) return;
    const l = this.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  _panner(x, y, z, refDist = 0.6) {
    const c = this.ctx;
    if (!this.spatial) { const g = c.createGain(); g.connect(this.sfxBus); return { node: g, x: 0 }; }
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = 24;
    p.rolloffFactor = 1.15;
    p.coneInnerAngle = 360;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else p.setPosition(x, y, z);
    p.connect(this.sfxBus);
    return { node: p, x };
  }

  _noiseSrc(rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    s.loop = true;
    return s;
  }

  // ── table sounds ──────────────────────────────────────────────────────────
  /** two balls meeting. speed in m/s, position in world metres */
  clack(speed, pos, sharpness = 1) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    if (t - this._last.clack < 0.008) return;
    this._last.clack = t;
    const v = clamp(speed, 0.05, 10);
    const amp = clamp(0.05 + Math.pow(v / 6.5, 1.5) * 0.55, 0, 0.62);
    const pan = this._panner(pos.x, pos.y, pos.z, 0.5);
    const src = this._noiseSrc(1 + v * 0.05);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100 + v * 260 * sharpness;
    bp.Q.value = 1.6;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.055 + v * 0.008);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(pan.node);
    // a little body: phenolic balls ring
    const osc = c.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180 + v * 55, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.05);
    const og = c.createGain();
    og.gain.setValueAtTime(amp * 0.34, t);
    og.gain.exponentialRampToValueAtTime(0.0006, t + 0.05);
    osc.connect(og); og.connect(pan.node);
    src.start(t); src.stop(t + 0.14);
    osc.start(t); osc.stop(t + 0.09);
  }

  /** cue tip striking the cue ball */
  strike(power, pos) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const p = clamp(power, 0.05, 1);
    const pan = this._panner(pos.x, pos.y, pos.z, 0.4);
    const src = this._noiseSrc(0.8 + p * 0.4);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 900 + p * 900; bp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 + p * 0.42, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.10 + p * 0.06);
    src.connect(bp); bp.connect(g); g.connect(pan.node);
    // the shaft's thunk
    const osc = c.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(230 - p * 60, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.10 + p * 0.22, t);
    og.gain.exponentialRampToValueAtTime(0.0006, t + 0.11);
    osc.connect(og); og.connect(pan.node);
    src.start(t); src.stop(t + 0.2); osc.start(t); osc.stop(t + 0.14);
  }

  /** the cue ball (or any ball) into a cushion */
  rail(speed, pos) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    if (t - this._last.rail < 0.012) return;
    this._last.rail = t;
    const v = clamp(speed, 0.1, 8);
    const amp = clamp(0.04 + Math.pow(v / 5, 1.4) * 0.4, 0, 0.5);
    const pan = this._panner(pos.x, pos.y, pos.z, 0.6);
    const src = this._noiseSrc(0.5 + v * 0.06);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 420 + v * 210; lp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.13 + v * 0.02);
    src.connect(lp); lp.connect(g); g.connect(pan.node);
    const osc = c.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(150 + v * 22, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const og = c.createGain();
    og.gain.setValueAtTime(amp * 0.7, t);
    og.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    osc.connect(og); og.connect(pan.node);
    src.start(t); src.stop(t + 0.26); osc.start(t); osc.stop(t + 0.16);
  }

  /** a ball dropping into a pocket */
  pocket(pos, index = 0) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const pan = this._panner(pos.x, pos.y - 0.05, pos.z, 0.6);
    // the drop
    const src = this._noiseSrc(0.6);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.30, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.30);
    src.connect(lp); lp.connect(g); g.connect(pan.node);
    src.start(t); src.stop(t + 0.4);
    // then it lands in the ball rack: two or three wooden knocks
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.13 + i * 0.075 + Math.random() * 0.02;
      const osc = c.createOscillator(); osc.type = 'triangle';
      osc.frequency.setValueAtTime(320 - i * 45 + Math.random() * 40, tt);
      osc.frequency.exponentialRampToValueAtTime(120, tt + 0.08);
      const og = c.createGain();
      og.gain.setValueAtTime(0.13 - i * 0.03, tt);
      og.gain.exponentialRampToValueAtTime(0.0005, tt + 0.09);
      osc.connect(og); og.connect(pan.node);
      osc.start(tt); osc.stop(tt + 0.12);
    }
  }

  /** the cue ball rolling — a soft continuous rumble, rate-linked to speed */
  rollStart() {
    if (!this.ready || !this.enabled || this._roll) return;
    const c = this.ctx, t = c.currentTime;
    const src = this._noiseSrc(0.35);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2;
    const g = c.createGain(); g.gain.value = 0;
    const pan = this._panner(0, 0.8, 0, 1.2);
    src.connect(lp); lp.connect(g); g.connect(pan.node);
    src.start(t);
    this._roll = { src, g, pan, lp };
  }
  rollUpdate(speed, pos) {
    if (!this._roll) return;
    const c = this.ctx, t = c.currentTime;
    const v = clamp(speed, 0, 9);
    this._roll.g.gain.setTargetAtTime(clamp(v * 0.012, 0, 0.09), t, 0.05);
    this._roll.lp.frequency.setTargetAtTime(180 + v * 90, t, 0.06);
    this._roll.src.playbackRate.setTargetAtTime(0.3 + v * 0.06, t, 0.08);
    if (this.spatial && this._roll.pan.node.positionX) {
      this._roll.pan.node.positionX.setTargetAtTime(pos.x, t, 0.03);
      this._roll.pan.node.positionY.setTargetAtTime(pos.y, t, 0.03);
      this._roll.pan.node.positionZ.setTargetAtTime(pos.z, t, 0.03);
    }
  }
  rollStop() {
    if (!this._roll) return;
    const c = this.ctx, t = c.currentTime;
    this._roll.g.gain.setTargetAtTime(0, t, 0.08);
    const r = this._roll; this._roll = null;
    setTimeout(() => { try { r.src.stop(); } catch (e) {} }, 400);
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  click(kind = 'tap') {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const map = { tap: [660, 0.05], confirm: [880, 0.07], back: [420, 0.06], error: [180, 0.10], coin: [1320, 0.08] };
    const [f, a] = map[kind] || map.tap;
    const osc = c.createOscillator(); osc.type = kind === 'error' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * (kind === 'coin' ? 1.9 : 0.75), t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.13);
    osc.connect(g); g.connect(this.sfxBus);
    osc.start(t); osc.stop(t + 0.16);
  }

  /** win / loss stingers */
  fanfare(win) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [392, 349.23, 293.66, 220];
    notes.forEach((f, i) => {
      const t = t0 + i * (win ? 0.11 : 0.16);
      const osc = c.createOscillator(); osc.type = win ? 'triangle' : 'sine';
      osc.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0006, t + (win ? 0.5 : 0.7));
      osc.connect(g); g.connect(this.sfxBus);
      osc.start(t); osc.stop(t + 0.8);
    });
  }

  /** a small crowd reaction, used for a big pot or a match win */
  crowd(level = 0.5) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const src = this._noiseSrc(0.4);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 + level * 0.1, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 1.4 + level);
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + 2.6);
  }

  // ── ambience + music ──────────────────────────────────────────────────────
  _startAmbience() {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.22;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = c.createGain(); g.gain.value = 0.0;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t);
    g.gain.setTargetAtTime(0.035, t, 3);
    this.ambience = { src, g };
    // distant room tone that swells gently
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
  }

  setAmbience(on, level = 1) {
    if (!this.ambience || !this.ctx) return;
    this.ambience.g.gain.setTargetAtTime(on ? 0.035 * level : 0.0, this.ctx.currentTime, 0.8);
  }

  _startMusic() {
    if (this._music) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.value = 0.0; g.connect(this.musicBus);
    this.musicGain = g;
    this.musicBus.gain.value = 1;
    g.gain.setTargetAtTime(0.16, t, 4);

    // a slow, smoky chord drift: two detuned saws through a lowpass, plus a
    // sparse plucked note every few seconds
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 620; filter.Q.value = 3;
    filter.connect(g);
    const chords = [[110, 164.81, 220], [98, 146.83, 196], [87.31, 130.81, 174.61], [110, 138.59, 207.65]];
    const oscs = chords[0].map((f, i) => {
      const o = c.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f; o.detune.value = (i - 1) * 6;
      const og = c.createGain(); og.gain.value = i === 2 ? 0.05 : 0.09;
      o.connect(og); og.connect(filter); o.start(t);
      return { o, og, base: f };
    });
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05;
    const lg = c.createGain(); lg.gain.value = 260;
    lfo.connect(lg); lg.connect(filter.frequency); lfo.start(t);

    let ci = 0;
    this._musicTimer = setInterval(() => {
      if (!this.musicOn || !this.ctx) return;
      ci = (ci + 1) % chords.length;
      const now = this.ctx.currentTime;
      oscs.forEach((x, i) => x.o.frequency.setTargetAtTime(chords[ci][i], now, 1.6));
    }, 9000);
    this._music = { oscs, lfo, filter, g };
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  dispose() {
    if (this._musicTimer) clearInterval(this._musicTimer);
    this.rollStop();
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
    this.ctx = null; this.ready = false;
  }
}

export const Audio = new Audio3D();
export default Audio;

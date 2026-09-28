// ── BOOYAH FIRE — 100% synthesized audio (no sound files) ───────────────────
// Gunfire, explosions, gloo walls, footsteps, UI clicks, the drop-plane and a
// looping menu/mission soundtrack are all generated with the Web Audio API.

import { clamp01 } from './util.js';

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.sfxOn = true;
    this.musicOn = true;
    this._musicTimer = null;
    this._step = 0;
    this._unlocked = false;
    this._eng = null;
    this._ambient = null;
    this._lastPlay = new Map();
  }

  unlock() {
    if (this._unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.75;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxOn ? 0.9 : 0;
      this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 0.3 : 0;
      this.musicGain.connect(this.master);
      this._unlocked = true;
      this._startAmbient();
      if (this.musicOn) this.startMusic();
    } catch (e) { /* no audio available */ }
  }

  setSfx(on) { this.sfxOn = on; if (this.sfxGain) this.sfxGain.gain.value = on ? 0.9 : 0; }
  // ── engine loop for vehicles (start/stop + a rev tied to speed) ───────────
  engine(on, kind = 'jeep') {
    try {
      if (!on) {
        const e = this._eng;
        this._eng = null;
        if (e) {
          e.gain.gain.cancelScheduledValues(this._now());
          e.gain.gain.setTargetAtTime(0.0001, this._now(), 0.04);
          setTimeout(() => { try { e.osc.stop(); e.sub.stop(); e.lp.disconnect(); e.gain.disconnect(); } catch { /* already gone */ } }, 240);
        }
        return;
      }
      const ctx = this.ctx;
      if (!ctx || !this.sfxGain || this._eng) return;
      const osc = ctx.createOscillator(), sub = ctx.createOscillator();
      const lp = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = kind === 'bike' ? 'square' : 'sawtooth';
      sub.type = 'sine';
      osc.frequency.value = kind === 'boat' ? 78 : 58;
      sub.frequency.value = 29;
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'bike' ? 900 : 460;
      gain.gain.value = 0.0001;
      osc.connect(lp); sub.connect(lp); lp.connect(gain); gain.connect(this.sfxGain);
      osc.start(); sub.start();
      gain.gain.setTargetAtTime(0.05, this._now(), 0.15);
      this._eng = { osc, sub, lp, gain, kind };
    } catch { /* no audio */ }
  }

  engineRev(speed, top) {
    const e = this._eng;
    if (!e) return;
    const k = clamp01(Math.abs(speed) / Math.max(1, top));
    try {
      const t = this._now();
      e.osc.frequency.setTargetAtTime((e.kind === 'boat' ? 70 : 52) + k * 165, t, 0.08);
      e.sub.frequency.setTargetAtTime(26 + k * 54, t, 0.08);
      e.lp.frequency.setTargetAtTime(380 + k * 780, t, 0.1);
      e.gain.gain.setTargetAtTime(0.035 + k * 0.05, t, 0.12);
    } catch { /* ignore */ }
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.3 : 0;
    if (on) this.startMusic(); else this.stopMusic();
  }

  _now() { return this.ctx ? this.ctx.currentTime : 0; }

  // throttle: never stack more than N of the same sound per 60 ms
  _ok(key, count = 3, ms = 60) {
    const t = performance.now();
    const L = this._lastPlay.get(key) || [];
    const keep = L.filter((x) => t - x < ms);
    if (keep.length >= count) { this._lastPlay.set(key, keep); return false; }
    keep.push(t);
    this._lastPlay.set(key, keep);
    return true;
  }

  // ── building blocks ─────────────────────────────────────────────────────
  _env(node, t0, a, d, peak = 1) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    return t0 + a + d;
  }

  _noise(dur = 0.3) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  _tone(type, f0, f1, dur, gain = 0.3, dest = null) {
    const ctx = this.ctx, t0 = this._now();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    this._env(g, t0, 0.005, dur, gain);
    osc.connect(g); g.connect(dest || this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    return { osc, g };
  }

  _noiseBurst(dur, gain, filter) {
    const ctx = this.ctx, t0 = this._now();
    const src = this._noise(dur);
    const g = ctx.createGain();
    this._env(g, t0, 0.002, dur, gain);
    let node = src;
    if (filter) {
      const bp = ctx.createBiquadFilter();
      bp.type = filter.type || 'bandpass';
      bp.frequency.setValueAtTime(filter.f0, t0);
      if (filter.f1) bp.frequency.exponentialRampToValueAtTime(filter.f1, t0 + dur);
      bp.Q.value = filter.q ?? 1.1;
      src.connect(bp); node = bp;
    }
    node.connect(g); g.connect(this.sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.05);
    return g;
  }

  // ── weapons ─────────────────────────────────────────────────────────────
  shot(kind = 'ar', dist = 0) {
    if (!this._unlocked || !this.sfxOn || !this._ok('shot', 4, 55)) return;
    const close = dist < 30 ? 1 : Math.max(0.18, 1 - (dist - 30) / 220);
    switch (kind) {
      case 'pistol':
        this._noiseBurst(0.09, 0.5 * close, { type: 'bandpass', f0: 1700, f1: 500, q: 0.9 });
        this._tone('square', 380, 90, 0.08, 0.22 * close);
        break;
      case 'smg':
        this._noiseBurst(0.07, 0.42 * close, { type: 'bandpass', f0: 2400, f1: 700, q: 0.8 });
        this._tone('square', 300, 110, 0.06, 0.16 * close);
        break;
      case 'sniper':
        this._noiseBurst(0.34, 0.75 * close, { type: 'lowpass', f0: 3200, f1: 300, q: 0.7 });
        this._tone('sawtooth', 190, 42, 0.3, 0.34 * close);
        break;
      case 'shotgun':
        this._noiseBurst(0.26, 0.72 * close, { type: 'lowpass', f0: 2600, f1: 260, q: 0.6 });
        this._tone('square', 240, 60, 0.2, 0.3 * close);
        break;
      case 'dmr':
        this._noiseBurst(0.17, 0.6 * close, { type: 'bandpass', f0: 2000, f1: 420, q: 0.9 });
        this._tone('square', 260, 70, 0.14, 0.26 * close);
        break;
      default: // ar
        this._noiseBurst(0.1, 0.5 * close, { type: 'bandpass', f0: 2000, f1: 520, q: 0.9 });
        this._tone('square', 320, 95, 0.08, 0.2 * close);
    }
    if (dist > 45) this._noiseBurst(0.22, 0.1 * close, { type: 'lowpass', f0: 700, q: 0.5 }); // tail
  }

  hitmarker(head = false) {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('sine', head ? 1500 : 1100, head ? 900 : 700, 0.07, 0.2);
    if (head) this._tone('sine', 2300, 1600, 0.05, 0.12);
  }

  kill() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('triangle', 700, 1400, 0.16, 0.28);
    this._tone('triangle', 1050, 1900, 0.18, 0.2);
  }

  reload(empty = false) {
    if (!this._unlocked || !this.sfxOn || !this._ok('reload', 2, 120)) return;
    this._noiseBurst(0.04, 0.3, { type: 'highpass', f0: 1800 });
    setTimeout(() => this._unlocked && this._noiseBurst(0.05, 0.34, { type: 'bandpass', f0: 2600, q: 2 }), 120);
    setTimeout(() => this._unlocked && this._noiseBurst(0.06, 0.3, { type: 'bandpass', f0: 1400, q: 2 }), 330);
    if (empty) setTimeout(() => this._unlocked && this._tone('square', 200, 320, 0.06, 0.16), 380);
  }

  dryfire() {
    if (!this._unlocked || !this.sfxOn || !this._ok('dry', 1, 150)) return;
    this._noiseBurst(0.03, 0.25, { type: 'highpass', f0: 2500 });
  }

  explode(dist = 0) {
    if (!this._unlocked || !this.sfxOn) return;
    const close = dist < 20 ? 1 : Math.max(0.2, 1 - (dist - 20) / 160);
    this._noiseBurst(0.7, 0.85 * close, { type: 'lowpass', f0: 900, f1: 120, q: 0.6 });
    this._tone('sawtooth', 120, 28, 0.55, 0.4 * close);
    this._noiseBurst(0.5, 0.2 * close, { type: 'highpass', f0: 2000 });
  }

  gloo(inflate = true) {
    if (!this._unlocked || !this.sfxOn) return;
    if (inflate) {
      this._noiseBurst(0.3, 0.28, { type: 'bandpass', f0: 800, f1: 2400, q: 0.7 });
      this._tone('sine', 300, 900, 0.22, 0.16);
    } else {
      this._noiseBurst(0.12, 0.3, { type: 'highpass', f0: 3000 });
    }
  }

  pickup() {
    if (!this._unlocked || !this.sfxOn || !this._ok('pickup', 2, 90)) return;
    this._tone('sine', 880, 1320, 0.09, 0.16);
  }

  heal() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('sine', 520, 780, 0.35, 0.14);
  }

  step(surface = 'ground') {
    if (!this._unlocked || !this.sfxOn || !this._ok('step', 2, 90)) return;
    const f = surface === 'water' ? 700 : 380;
    this._noiseBurst(0.06, 0.13, { type: 'bandpass', f0: f, q: 1.4 });
  }

  land() {
    if (!this._unlocked || !this.sfxOn) return;
    this._noiseBurst(0.16, 0.35, { type: 'lowpass', f0: 500, q: 0.7 });
  }

  zoneWarn() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('square', 420, 420, 0.12, 0.12);
  }

  parachute() {
    if (!this._unlocked || !this.sfxOn) return;
    this._noiseBurst(0.9, 0.3, { type: 'lowpass', f0: 900, f1: 300, q: 0.5 });
  }

  plane() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('sawtooth', 90, 70, 3.5, 0.14);
    this._noiseBurst(3.4, 0.16, { type: 'lowpass', f0: 420, q: 0.5 });
  }

  airdrop() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('square', 600, 900, 0.12, 0.14);
    setTimeout(() => this._unlocked && this._tone('square', 900, 1300, 0.14, 0.12), 140);
  }

  knock() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('triangle', 300, 180, 0.22, 0.24);
  }

  revive() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('sine', 600, 1200, 0.3, 0.2);
  }

  death() {
    if (!this._unlocked || !this.sfxOn) return;
    this._tone('sawtooth', 400, 60, 1.1, 0.3);
    this._noiseBurst(1.0, 0.22, { type: 'lowpass', f0: 700, f1: 120, q: 0.6 });
  }

  booyah() {
    if (!this._unlocked || !this.sfxOn) return;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => setTimeout(() => {
      if (!this._unlocked) return;
      this._tone('triangle', f, f * 1.01, 0.42, 0.3);
      this._tone('sine', f * 2, f * 2, 0.3, 0.12);
    }, i * 130));
    this._noiseBurst(0.5, 0.18, { type: 'highpass', f0: 3000 });
  }

  ui(kind = 'click') {
    if (!this._unlocked || !this.sfxOn) return;
    if (kind === 'click') this._tone('sine', 700, 900, 0.05, 0.14);
    else if (kind === 'buy') { this._tone('sine', 800, 1200, 0.09, 0.18); setTimeout(() => this._unlocked && this._tone('sine', 1200, 1600, 0.12, 0.15), 90); }
    else if (kind === 'error') this._tone('square', 260, 180, 0.16, 0.18);
    else if (kind === 'nav') this._tone('sine', 520, 780, 0.07, 0.12);
    else if (kind === 'spin') this._noiseBurst(0.08, 0.14, { type: 'bandpass', f0: 1800, q: 2 });
    else if (kind === 'win') { this._tone('triangle', 660, 990, 0.3, 0.25); this._tone('triangle', 990, 1320, 0.3, 0.15); }
  }

  // ── ambient bed (sea + wind) ────────────────────────────────────────────
  _startAmbient() {
    const ctx = this.ctx;
    try {
      const src = this._noise(4);
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start();
      this._ambient = { src, g };
    } catch (e) { /* ignore */ }
  }

  // ── music: a driving 4-bar loop, Free-Fire-ish ──────────────────────────
  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + 0.3);
  }
  _hat(t, open = false) {
    const ctx = this.ctx;
    const src = this._noise(open ? 0.16 : 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.16 : 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.14 : 0.04));
    src.connect(hp); hp.connect(g); g.connect(this.musicGain);
    src.start(t); src.stop(t + (open ? 0.2 : 0.08));
  }
  _snare(t) {
    const ctx = this.ctx;
    const src = this._noise(0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(this.musicGain);
    src.start(t); src.stop(t + 0.24);
  }
  _bass(t, f, dur = 0.22) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _lead(t, f, dur = 0.3) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.06);
  }

  startMusic() {
    if (!this._unlocked || !this.musicOn || this._musicTimer) return;
    const BPM = 132, beat = 60 / BPM;
    const bassLine = [55, 55, 82.4, 73.4, 55, 55, 98, 82.4];
    const leadLine = [440, 523, 659, 523, 587, 523, 392, 440];
    const tick = () => {
      if (!this.ctx || !this.musicOn) return;
      const t = this.ctx.currentTime + 0.05;
      const bar = Math.floor(this._step / 8) % 4;
      for (let i = 0; i < 8; i++) {
        const bt = t + i * beat * 0.5;
        if (i % 2 === 0) this._kick(bt);
        else this._hat(bt, i === 7);
        if (i === 4) this._snare(bt);
        if (i % 2 === 0) this._bass(bt, bar % 2 === 1 && i === 6 ? bassLine[i] * 1.5 : bassLine[i], beat * 0.6);
        if (bar >= 2 && i % 2 === 1) this._lead(bt, leadLine[i], beat * 0.5);
      }
      this._step++;
    };
    tick();
    this._musicTimer = setInterval(tick, (60 / BPM) * 1000 * 4);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}

export const audio = new AudioSys();

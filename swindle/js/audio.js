// ── original synthesized audio: lounge loops, tension bed, stingers, table sfx
// No samples, no files — everything is oscillators, filtered noise and delays.
const N7 = [0, 4, 7, 10];       // dominant 7th shell
const CHORDS = [
  [0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [8, 12, 15, 19],
  [-2, 2, 5, 9], [3, 7, 10, 12], [10, 14, 17, 21], [5, 9, 12, 16],
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

class Audio {
  constructor() {
    this.ctx = null;
    this.on = { music: true, sfx: true };
    this.mode = 'menu';       // menu | table | tension | reveal | hush
    this._step = 0;
    this._timer = null;
    this._noiseBuf = null;
    this.master = 0.85;
    this.shakeGain = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.out = c.createGain(); this.out.gain.value = this.master;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
    this.comp.connect(this.out); this.out.connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.0;
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9;
    // slap-back on the music for a "room" feel
    this.delay = c.createDelay(0.6); this.delay.delayTime.value = 0.23;
    this.fb = c.createGain(); this.fb.gain.value = 0.26;
    this.delay.connect(this.fb); this.fb.connect(this.delay);
    const dwet = c.createGain(); dwet.gain.value = 0.28;
    this.delay.connect(dwet); dwet.connect(this.comp);
    this.musicBus.connect(this.comp);
    this.musicBus.connect(this.delay);
    this.sfxBus.connect(this.comp);
    this.noise = this._noise();
    this._setMusic(0.5);
    if (this.on.music) this._startLoop();
  }
  _noise() {
    const c = this.ctx, len = c.sampleRate * 2;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setMusic(on) { this.on.music = on; if (!this.ctx) return; this._setMusic(on ? 0.5 : 0); if (on && !this._timer) this._startLoop(); if (!on && this._timer) { clearInterval(this._timer); this._timer = null; } }
  setSfx(on) { this.on.sfx = on; if (this.ctx) this.sfxBus.gain.value = on ? 0.9 : 0; }
  _setMusic(v) { if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); }

  setMode(m) {
    this.mode = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = m === 'hush' ? 0.16 : m === 'tension' ? 0.34 : m === 'reveal' ? 0.22 : 0.5;
    this.musicBus.gain.setTargetAtTime(this.on.music ? vol : 0, t, 0.6);
    this.filter && this.filter.frequency.setTargetAtTime(m === 'tension' ? 900 : 1500, t, 0.8);
  }

  // ── the loop ───────────────────────────────────────────────────────────────
  _startLoop() {
    if (this._timer) return;
    const bpm = 96, step = (60 / bpm) / 2;
    this._t0 = this.ctx.currentTime + 0.1;
    this._step = 0;
    this._timer = setInterval(() => this._tickLoop(step), step * 1000 * 2);
  }
  _tickLoop(step) {
    if (!this.ctx) return;
    for (let i = 0; i < 2; i++) this._playStep(this._step + i, step);
    this._step = (this._step + 2) % 64;
  }
  _playStep(n, step) {
    const c = this.ctx;
    const t = this._t0 + n * step;
    if (t < c.currentTime - 0.05) return;
    const bar = (n / 8) | 0;
    const ch = CHORDS[bar % CHORDS.length];
    const tension = this.mode === 'tension';
    const reveal = this.mode === 'reveal';

    // brushed hi-hat / rim
    if (n % 2 === 0 || (n % 4 === 1 && bar % 2 === 1)) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 6200;
      const g = c.createGain();
      const v = n % 2 ? 0.035 : 0.06;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
      src.connect(bp); bp.connect(g); g.connect(this.musicBus);
      src.start(t); src.stop(t + 0.1);
    }
    // ride-ish ping on the 3
    if (n % 8 === 3) { this._tone(mtof(88 + ch[2]), 0.22, 'triangle', 0.028, t, this.musicBus); }
    // upright bass
    const bassN = [0, 0, 7, 5, 3, 3, 10, 8][n % 8];
    if (n % 2 === 0) {
      const f = mtof(41 + bassN + ch[0]);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
      lp.frequency.setValueAtTime(tension ? 260 : 380, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.3);
      const g = c.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.34);
      o.connect(lp); lp.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.4);
    }
    // guitar/piano comps on the off-beats
    if (n % 4 === 1 || n % 8 === 6) {
      const g = c.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(reveal ? 0.06 : 0.085, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0006, t + (reveal ? 1.4 : 0.55));
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tension ? 1400 : 2400;
      this.filter = lp;
      g.connect(this.musicBus); lp.connect(g);
      for (const iv of ch) {
        const o = c.createOscillator();
        o.type = reveal ? 'sine' : 'triangle';
        o.frequency.value = mtof(57 + iv + ch[0] * 0);
        o.detune.value = (Math.random() - 0.5) * 8;
        o.connect(lp); o.start(t); o.stop(t + 1.6);
      }
    }
    // tension pulse
    if (tension && n % 2 === 0) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(mtof(45 + ch[0]), t);
      const g = c.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.1);
      o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.12);
    }
  }

  _tone(freq, dur, type = 'sine', vol = 0.2, when = 0, bus = null, slide = null) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + (typeof when === 'number' ? when : 0);
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _nz(dur, vol, f0 = 900, f1 = null, type = 'bandpass', q = 1.2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = type; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    if (f1) bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + dur + 0.02);
  }
  _chord(base, ivs, dur, type = 'triangle', vol = 0.12) {
    ivs.forEach((iv, i) => this._tone(mtof(base + iv), dur, type, vol, i * 0.035));
  }

  // ── sfx vocabulary ─────────────────────────────────────────────────────────
  click() { this._tone(1300, 0.04, 'square', 0.06, 0, null, 800); this._nz(0.03, 0.03, 4000, 1500); }
  hover() { this._tone(2100, 0.02, 'sine', 0.025); }
  pop(v = 1) { this._tone(520 * v, 0.11, 'triangle', 0.16, 0, null, 1180 * v); }
  chip() { for (let i = 0; i < 3; i++) this._nz(0.05, 0.05, 3000 + i * 900, 1200, 'bandpass', 6); this._tone(1500, 0.06, 'square', 0.05, 0.02); }
  coin() { this._tone(1180, 0.09, 'square', 0.1); this._tone(1760, 0.16, 'square', 0.09, 0.05); }
  cashOut() { [0, 0.06, 0.12, 0.19, 0.27].forEach((d, i) => this._tone(880 * Math.pow(1.12, i), 0.2, 'triangle', 0.1, d)); }
  stamp() { this._nz(0.16, 0.28, 260, 60, 'lowpass', 1); this._tone(120, 0.16, 'square', 0.16, 0, null, 60); }
  gavel() { this._tone(210, 0.1, 'square', 0.18, 0, null, 90); this._nz(0.14, 0.16, 700, 180); }
  whoosh() { this._nz(0.34, 0.12, 300, 3200, 'bandpass', 0.7); }
  riser(dur = 1.6) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(900, t + dur);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0006, t); g.gain.linearRampToValueAtTime(0.13, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0004, t + dur + 0.1);
    o.connect(bp); bp.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.15);
    this._nz(dur * 0.8, 0.05, 800, 5200);
  }
  good() { this._chord(69, [0, 4, 7, 12], 0.5, 'triangle', 0.13); this._tone(1400, 0.1, 'sine', 0.07, 0.12); }
  bad() { this._chord(45, [0, 3, 6, 10], 0.6, 'sawtooth', 0.09); this._tone(90, 0.4, 'square', 0.09, 0.02, null, 55); }
  bigWin() { [0, 0.09, 0.18, 0.27].forEach((d, i) => this._tone(mtof(72 + i * 3), 0.5, 'square', 0.1, d)); this._nz(0.5, 0.09, 500, 6000); }
  fail() { this._tone(320, 0.25, 'sawtooth', 0.1, 0, null, 90); this._tone(200, 0.35, 'square', 0.07, 0.1, null, 70); }
  lie() { this._tone(700, 0.09, 'square', 0.08); this._tone(660, 0.12, 'square', 0.07, 0.09); this._nz(0.1, 0.05, 2400, 900); }
  alarm() { for (let i = 0; i < 3; i++) { this._tone(1250, 0.1, 'square', 0.09, i * 0.16); this._tone(940, 0.1, 'square', 0.08, i * 0.16 + 0.08); } }
  deal() { this._nz(0.12, 0.09, 2600, 700); this._tone(520, 0.08, 'triangle', 0.06, 0.04); }
  sit() { this._nz(0.1, 0.05, 400, 180, 'lowpass'); }
  emote() { this._tone(880, 0.1, 'sine', 0.09, 0, null, 1320); this._tone(1320, 0.12, 'sine', 0.07, 0.07); }
  countBeep(i) { this._tone(760 + i * 40, 0.07, 'square', 0.1); }
  finalHorn() { this._chord(48, [0, 7, 12, 16, 19], 1.6, 'sawtooth', 0.09); this._nz(1.2, 0.06, 200, 3000); }
}

export const audio = new Audio();

// ── All-synthesized audio: engine, sfx, horns, island music ─────────────────

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.engine = null;
    this.musicTimer = null;
    this.musicOn = true;
    this.sfxOn = true;
    this._unlocked = false;
    this._musicStep = 0;
  }

  unlock() {
    if (this._unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      this._unlocked = true;
      this._startEngine();
      if (this.musicOn) this._startMusic();
    } catch (e) { /* no audio available */ }
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on && !this.musicTimer) this._startMusic();
    if (!on && this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
  setSfx(on) { this.sfxOn = on; }

  _tone(freq, dur, type = 'square', vol = 0.2, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol = 0.3, freq = 1200, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  // ── engine loop ──
  _startEngine() {
    const c = this.ctx;
    this.engOsc1 = c.createOscillator(); this.engOsc1.type = 'sawtooth';
    this.engOsc2 = c.createOscillator(); this.engOsc2.type = 'square';
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.engOsc1.start(); this.engOsc2.start();
    this.engineOn = false;
  }

  engine(rpm01, boosting) {
    if (!this.ctx || !this.engGain) return;
    const f = 55 + rpm01 * 210 + (boosting ? 70 : 0);
    this.engOsc1.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5 + 3, this.ctx.currentTime, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + rpm01 * 1400, this.ctx.currentTime, 0.08);
    this.engGain.gain.setTargetAtTime(this.engineOn ? 0.055 + rpm01 * 0.05 : 0, this.ctx.currentTime, 0.1);
  }

  // ── one-shots ──
  click() { if (this.sfxOn) this._tone(700, 0.06, 'square', 0.12); }
  beep(final) { if (this.sfxOn) this._tone(final ? 880 : 440, final ? 0.5 : 0.18, 'square', 0.22); }
  coin() { if (this.sfxOn) { this._tone(988, 0.08, 'square', 0.14); this._tone(1319, 0.22, 'square', 0.14, 0.07); } }
  pickup() { if (this.sfxOn) { this._tone(660, 0.07, 'triangle', 0.2); this._tone(880, 0.07, 'triangle', 0.2, 0.06); this._tone(1320, 0.12, 'triangle', 0.2, 0.12); } }
  boost() { if (this.sfxOn) { this._tone(160, 0.5, 'sawtooth', 0.22, 0, 760); this._noise(0.45, 0.2, 2400); } }
  rocket() { if (this.sfxOn) { this._tone(900, 0.35, 'sawtooth', 0.16, 0, 240); this._noise(0.3, 0.15, 3000); } }
  hit() { if (this.sfxOn) { this._noise(0.3, 0.4, 500); this._tone(180, 0.25, 'square', 0.2, 0, 60); } }
  spin() { if (this.sfxOn) this._tone(300, 0.5, 'sawtooth', 0.15, 0, 1300); }
  shieldHit() { if (this.sfxOn) this._tone(500, 0.2, 'sine', 0.25, 0, 900); }
  bump() { if (this.sfxOn) this._noise(0.12, 0.14, 700); }
  splash() { if (this.sfxOn) this._noise(0.4, 0.3, 900); }
  deny() { if (this.sfxOn) { this._tone(220, 0.15, 'square', 0.15); this._tone(160, 0.25, 'square', 0.15, 0.12); } }
  buy() {
    if (!this.sfxOn) return;
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.14, 'triangle', 0.18, i * 0.07));
    this.coin();
  }
  fanfare() {
    if (!this.sfxOn) return;
    const seq = [523, 523, 523, 659, 784, 784, 1046];
    const dt = [0, 0.12, 0.24, 0.36, 0.55, 0.67, 0.85];
    seq.forEach((f, i) => this._tone(f, i === seq.length - 1 ? 0.6 : 0.13, 'triangle', 0.22, dt[i]));
  }
  horn(idx) {
    if (!this.ctx || !this.sfxOn) return;
    if (idx === 0) { this._tone(392, 0.16, 'square', 0.25); this._tone(392, 0.22, 'square', 0.25, 0.2); }
    else if (idx === 1) { this._tone(280, 0.3, 'sawtooth', 0.22, 0, 500); this._tone(520, 0.25, 'sawtooth', 0.18, 0.28, 260); }
    else if (idx === 2) { [523, 659, 784].forEach((f, i) => this._tone(f, 0.12, 'square', 0.2, i * 0.1)); }
    else { this._tone(660, 0.3, 'sawtooth', 0.16, 0, 990); this._tone(990, 0.3, 'sawtooth', 0.16, 0.3, 660); }
  }

  // ── tiny island music loop ──
  _startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bass = [130.8, 130.8, 98, 110, 130.8, 130.8, 146.8, 98];
    const mel = [523, 0, 659, 0, 784, 659, 523, 0, 440, 0, 523, 587, 659, 0, 392, 0];
    this._musicStep = 0;
    this.musicTimer = setInterval(() => {
      if (!this.ctx) return;
      const s = this._musicStep++;
      const b = bass[(s >> 1) % bass.length];
      if (s % 2 === 0) {
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
        o.type = 'triangle'; o.frequency.value = b;
        g.gain.setValueAtTime(0.5, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.42);
        o.connect(g); g.connect(this.musicGain);
        o.start(); o.stop(this.ctx.currentTime + 0.45);
      }
      const m = mel[s % mel.length];
      if (m) {
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = m;
        g.gain.setValueAtTime(0.30, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.24);
        o.connect(g); g.connect(this.musicGain);
        o.start(); o.stop(this.ctx.currentTime + 0.26);
      }
    }, 210);
  }
}

export const audio = new AudioSys();

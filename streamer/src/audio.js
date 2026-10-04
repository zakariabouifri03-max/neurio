// ── All-synthesized audio: sfx, car engine, lo-fi radio ─────────────────────

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null; this.musicGain = null; this.sfxGain = null;
    this._eng = null; this.engineGain = null;
    this.musicTimer = null;
    this._unlocked = false;
    this.volumes = { master: 0.8, music: 0.5, sfx: 0.9 };
  }

  unlock() {
    if (this._unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volumes.master;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.volumes.music * 0.35;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volumes.sfx;
      this.sfxGain.connect(this.master);
      this._unlocked = true;
      this._startMusic();
    } catch (e) { /* no audio */ }
  }

  setVolumes(v) {
    this.volumes = v;
    if (!this.ctx) return;
    this.master.gain.value = v.master;
    this.musicGain.gain.value = v.music * 0.35;
    this.sfxGain.gain.value = v.sfx;
  }

  _tone(freq, dur, type = 'square', vol = 0.2, when = 0, slideTo = null, dest = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.03);
  }

  _noise(dur, vol = 0.25, freq = 1400, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  click() { this._tone(700, 0.06, 'square', 0.12); }
  back() { this._tone(420, 0.08, 'square', 0.12); }
  buy() { this._tone(880, 0.09, 'square', 0.16); this._tone(1320, 0.14, 'square', 0.16, 0.09); }
  cash() { this._tone(1568, 0.1, 'triangle', 0.22); this._tone(2093, 0.18, 'triangle', 0.2, 0.09); }
  donate() { this._tone(988, 0.08, 'sine', 0.25); this._tone(1319, 0.08, 'sine', 0.25, 0.07); this._tone(1976, 0.2, 'sine', 0.25, 0.14); }
  err() { this._tone(180, 0.18, 'sawtooth', 0.16, 0, 120); }
  door() { this._noise(0.16, 0.2, 500); this._tone(140, 0.12, 'sine', 0.15, 0.02, 90); }
  sleep() { [523, 392, 330, 262].forEach((f, i) => this._tone(f, 0.35, 'sine', 0.14, i * 0.22)); }
  wake() { [262, 330, 392, 523].forEach((f, i) => this._tone(f, 0.25, 'sine', 0.12, i * 0.14)); }
  level() { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.16, 'square', 0.14, i * 0.09)); }
  live() { [392, 523, 659, 784].forEach((f, i) => this._tone(f, 0.14, 'triangle', 0.18, i * 0.1)); }
  step() { this._noise(0.05, 0.06, 300); }
  horn() { this._tone(370, 0.3, 'sawtooth', 0.2); this._tone(466, 0.3, 'sawtooth', 0.18); }
  fan() { this._tone(660, 0.1, 'sine', 0.2); this._tone(880, 0.16, 'sine', 0.2, 0.1); }

  // ── car engine ──
  engineStart() {
    if (!this.ctx || this._eng) return;
    this._eng = this.ctx.createOscillator();
    this._eng.type = 'sawtooth';
    this._eng.frequency.value = 55;
    const sub = this.ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = 28;
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    this._eng.connect(f); sub.connect(f); f.connect(this.engineGain); this.engineGain.connect(this.sfxGain);
    this._eng.start(); sub.start();
    this._engineSub = sub;
  }
  engine(speedNorm, on) {
    if (!this._eng) return;
    const t = this.ctx.currentTime;
    this._eng.frequency.setTargetAtTime(50 + speedNorm * 160, t, 0.08);
    this._engineSub.frequency.setTargetAtTime(25 + speedNorm * 80, t, 0.08);
    this.engineGain.gain.setTargetAtTime(on ? 0.09 + speedNorm * 0.08 : 0, t, 0.1);
  }
  engineStop() {
    if (this._eng) { try { this._eng.stop(); this._engineSub.stop(); } catch (e) {} this._eng = null; }
  }

  // ── lo-fi radio loop ──
  _startMusic() {
    if (this.musicTimer || !this.ctx) return;
    const chords = [
      [220, 261.6, 329.6, 392],   // Am7
      [174.6, 220, 261.6, 349.2], // Fmaj7
      [196, 246.9, 293.7, 349.2], // G
      [164.8, 196, 246.9, 329.6], // Em7
    ];
    let bar = 0, step = 0;
    this.musicTimer = setInterval(() => {
      if (!this.ctx) return;
      const ch = chords[Math.floor(bar / 2) % chords.length];
      if (step % 8 === 0) {
        ch.forEach((f) => this._tone(f, 1.6, 'sine', 0.10, 0, null, this.musicGain));
        this._tone(ch[0] / 2, 1.6, 'triangle', 0.12, 0, null, this.musicGain);
      }
      const pent = [ch[0] * 2, ch[1] * 2, ch[2] * 2, ch[3] * 2, ch[0] * 4];
      if (Math.random() < 0.7) {
        const f = pent[(Math.random() * pent.length) | 0];
        this._tone(f, 0.32, 'triangle', 0.07, 0, null, this.musicGain);
      }
      if (step % 4 === 2) this._noise(0.03, 0.02, 6000);
      step++;
      if (step % 16 === 0) { step = 0; bar++; }
    }, 210);
  }
}

export const audio = new AudioSys();

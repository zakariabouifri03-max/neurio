// أصوات مُصنّعة بـ WebAudio (بلا ملفات) — audio.js
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    const len = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return this.ctx;
  }
  resume() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume(); }

  tone(freq, dur, type = 'sine', vol = 0.18, slideTo = null, delay = 0) {
    if (this.muted) return;
    const c = this.ensure(); if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(dur, vol = 0.2, filter = 900, q = 1) {
    if (this.muted) return;
    const c = this.ensure(); if (!c) return;
    const t0 = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filter; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.start(t0); s.stop(t0 + dur);
  }
  chop() { this.noise(0.16, 0.30, 420, 0.9); this.tone(150, 0.14, 'triangle', 0.16, 90); }
  rockHit() { this.noise(0.10, 0.22, 2200, 1.4); this.tone(400, 0.07, 'square', 0.09, 260); }
  gather() { this.noise(0.16, 0.16, 1700, 0.7); }
  pickup() { this.tone(620, 0.09, 'triangle', 0.14, 900); }
  craft() { this.tone(523, 0.10, 'triangle', 0.16); this.tone(659, 0.10, 'triangle', 0.16, null, 0.09); this.tone(784, 0.16, 'triangle', 0.15, null, 0.18); }
  build() { this.noise(0.22, 0.3, 300, 0.8); this.tone(120, 0.24, 'sine', 0.2, 80); }
  egg() { this.tone(880, 0.07, 'sine', 0.16, 1250); this.tone(1320, 0.09, 'sine', 0.1, 1500, 0.05); }
  eat() { this.noise(0.13, 0.16, 700, 0.6); this.tone(220, 0.1, 'triangle', 0.1, 160, 0.06); }
  drink() { this.tone(300, 0.14, 'sine', 0.12, 520); this.tone(400, 0.12, 'sine', 0.1, 640, 0.12); }
  hurt() { this.tone(180, 0.22, 'sawtooth', 0.16, 70); this.noise(0.12, 0.14, 500, 0.8); }
  pop() { this.tone(760, 0.07, 'sine', 0.14, 1100); }
  tame() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.15, null, i * 0.09)); }
  ui() { this.tone(440, 0.05, 'square', 0.07, 520); }
  fail() { this.tone(200, 0.18, 'square', 0.12, 120); }
  grunt() { this.tone(150, 0.18, 'sawtooth', 0.13, 95); this.noise(0.1, 0.1, 350, 0.7); }
  cluck() { this.tone(700, 0.05, 'triangle', 0.12, 520); this.tone(560, 0.06, 'triangle', 0.1, 700, 0.06); }
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.16, null, i * 0.15)); }
  step() { this.noise(0.05, 0.05, 800, 0.5); }
}

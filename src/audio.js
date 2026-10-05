class VoxelAudio {
  constructor() { this.ctx = null; this.master = null; this.enabled = true; this.music = false; this.timer = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.28; this.master.connect(this.ctx.destination);
      if (this.music) this.startMusic();
    } catch { /* silent device */ }
  }

  setEnabled(on) { this.enabled = !!on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.28 : 0, this.ctx.currentTime, 0.06); }
  setMusic(on) { this.music = !!on; if (on) this.startMusic(); else if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tone(frequency, duration = 0.09, wave = 'triangle', volume = 0.12, slide = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = wave; osc.frequency.setValueAtTime(frequency, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(t); osc.stop(t + duration + 0.02);
  }

  noise(duration = 0.12, volume = 0.06) {
    if (!this.ctx || !this.enabled) return;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    src.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 1500; gain.gain.value = volume;
    src.connect(filter); filter.connect(gain); gain.connect(this.master); src.start();
  }

  click() { this.tone(650, 0.045, 'sine', 0.08); }
  dig() { this.noise(0.10, 0.11); this.tone(180, 0.07, 'triangle', 0.07); }
  place() { this.tone(260, 0.08, 'square', 0.07, 150); }
  pickup() { this.tone(660, 0.09, 'sine', 0.08); this.tone(880, 0.11, 'sine', 0.08); }
  hurt() { this.tone(110, 0.3, 'sawtooth', 0.15, 55); }
  craft() { [520, 660, 780].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'triangle', 0.08), i * 65)); }
  jump() { this.tone(220, 0.12, 'sine', 0.07, 440); }

  startMusic() {
    if (!this.ctx || this.timer || !this.music) return;
    const notes = [220, 0, 330, 0, 293.7, 0, 392, 0, 261.6, 0, 330, 0, 440, 0, 392, 0];
    let i = 0;
    this.timer = setInterval(() => {
      const f = notes[i++ % notes.length];
      if (f) this.tone(f, 0.7, 'sine', 0.018);
    }, 420);
  }
}

export const audio = new VoxelAudio();

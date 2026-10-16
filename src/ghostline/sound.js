// No samples or downloads. A quiet, opt-in synthesized city and interface soundscape.
export class Soundscape {
  constructor() { this.enabled = false; this.context = null; }
  async setEnabled(on) {
    this.enabled = on;
    if (on && !this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) { this.enabled = false; return; }
      this.context = new Context(); this.master = this.context.createGain(); this.master.gain.value = 0; this.master.connect(this.context.destination);
      const size = this.context.sampleRate * 4, buffer = this.context.createBuffer(1, size, this.context.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 340;
      const gain = this.context.createGain(); gain.gain.value = .06; noise.connect(filter); filter.connect(gain); gain.connect(this.master); noise.start();
      for (const hz of [55, 82.5]) { const o = this.context.createOscillator(), v = this.context.createGain(); o.frequency.value = hz; v.gain.value = .013; o.connect(v); v.connect(this.master); o.start(); }
    }
    if (!this.context) return;
    if (on && this.context.state === 'suspended') await this.context.resume().catch(() => {});
    this.master.gain.setTargetAtTime(on ? .45 : 0, this.context.currentTime, .2);
  }
  tone(frequency, length = .15, type = 'sine', volume = .13, delay = 0, endFrequency = frequency) {
    if (!this.enabled || !this.context) return;
    const c = this.context, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(frequency, t); o.frequency.exponentialRampToValueAtTime(endFrequency, t + length);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(volume, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + length);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + length + .02); o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  play(name) {
    if (name === 'click') this.tone(640, .065, 'sine', .08);
    if (name === 'scan') { this.tone(220, .45, 'sine', .12, 0, 1200); this.tone(1200, .3, 'sine', .03, .35, 800); }
    if (name === 'hack') { for (let i = 0; i < 7; i++) this.tone(400 + i * 155, .10, 'sine', .07, i * .3); }
    if (name === 'success') { [520, 650, 780].forEach((h, i) => this.tone(h, .28, 'sine', .13, i * .10)); }
    if (name === 'blackout') { this.tone(290, .65, 'sawtooth', .07, 0, 35); this.tone(70, 1.2, 'sine', .12, .15, 32); }
    if (name === 'alert') { this.tone(200, .2, 'triangle', .13); this.tone(170, .3, 'triangle', .13, .23); }
    if (name === 'complete') [390, 520, 650, 780, 1040].forEach((h, i) => this.tone(h, .75, 'sine', .12, i * .16));
  }
}

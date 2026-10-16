export class OceanAudio {
  constructor() { this.context = null; this.enabled = false; this.paused = false; }
  async init() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      this.context = new Context();
      this.master = this.context.createGain(); this.master.gain.value = 0; this.master.connect(this.context.destination);
      const size = this.context.sampleRate * 8, buffer = this.context.createBuffer(1, size, this.context.sampleRate), data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < size; i++) { previous = (previous + (Math.random() * 2 - 1) * .024) / 1.024; data[i] = previous * 3; }
      const noise = this.context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 730;
      const surf = this.context.createGain(); surf.gain.value = .36;
      noise.connect(filter); filter.connect(surf); surf.connect(this.master); noise.start();
      const swell = this.context.createOscillator(), depth = this.context.createGain();
      swell.frequency.value = .105; depth.gain.value = .12; swell.connect(depth); depth.connect(surf.gain); swell.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.applyGain();
    return true;
  }
  async setEnabled(value) { this.enabled = value; if (value) await this.init(); this.applyGain(); }
  setPaused(value) { this.paused = value; this.applyGain(); }
  applyGain() {
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.enabled && !this.paused ? .26 : 0, this.context.currentTime, .25);
  }
  play(kind) {
    if (!this.context || !this.enabled || this.paused) return;
    const context = this.context, now = context.currentTime;
    const sounds = { collect: [640, 960, .14], build: [150, 225, .13], hook: [340, 210, .1], drink: [480, 740, .18], eat: [190, 150, .1], warn: [210, 175, .3], defend: [95, 65, .14], click: [420, 600, .055] };
    const [start, end, duration] = sounds[kind] || sounds.click;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = kind === 'build' || kind === 'defend' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(start, now); oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.22, now + .015); gain.gain.exponentialRampToValueAtTime(.001, now + duration + .1);
    oscillator.connect(gain); gain.connect(this.master); oscillator.start(now); oscillator.stop(now + duration + .12);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}

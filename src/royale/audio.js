export class RaceAudio {
  constructor(enabled = true) { this.enabled = enabled; this.ctx = null; }
  unlock() {
    if (!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
      this.ctx = new Context(); this.master = this.ctx.createGain(); this.master.gain.value = .23; this.master.connect(this.ctx.destination);
      this.engine = this.ctx.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 45;
      this.engineFilter = this.ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 340;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0; this.engine.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
      this.sub = this.ctx.createOscillator(); this.sub.type = 'triangle'; this.sub.frequency.value = 36;
      this.subGain = this.ctx.createGain(); this.subGain.gain.value = 0; this.sub.connect(this.subGain); this.subGain.connect(this.master); this.sub.start();
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate); const buffer = this.noise.getChannelData(0); for (let i = 0; i < buffer.length; i++) buffer[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  tone(frequency, duration = .1, volume = .15, end = frequency, type = 'sine') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + duration); gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(t); osc.stop(t + duration);
  }
  hiss(duration = .1, volume = .2, frequency = 700) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, source = this.ctx.createBufferSource(), gain = this.ctx.createGain(), filter = this.ctx.createBiquadFilter(); source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration); source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(t); source.stop(t + duration);
  }
  update(speed, throttle, boost, playing) {
    if (!this.ctx) return;
    const active = this.enabled && playing, t = this.ctx.currentTime;
    const gear = Math.max(1, Math.min(6, Math.floor(Math.abs(speed) / 13) + 1)), rpm = (Math.abs(speed) % 13) / 13;
    this.engine.frequency.setTargetAtTime(40 + gear * 6 + rpm * 69 + (throttle ? 16 : 0), t, .12);
    this.sub.frequency.setTargetAtTime(31 + rpm * 20 + gear * 4, t, .15);
    this.engineFilter.frequency.setTargetAtTime(250 + rpm * 450 + (boost ? 400 : 0), t, .12);
    this.engineGain.gain.setTargetAtTime(active ? (throttle ? .19 : .09) : 0, t, .1);
    this.subGain.gain.setTargetAtTime(active ? .10 : 0, t, .1);
  }
  click() { this.tone(640, .055, .13, 460); }
  beep(go = false) { this.tone(go ? 780 : 420, go ? .35 : .13, .3, go ? 1100 : 420); }
  upgrade() { [480, 640, 820].forEach((f, i) => setTimeout(() => this.tone(f, .23, .22), i * 90)); }
  win() { [440, 554, 660, 880].forEach((f, i) => setTimeout(() => this.tone(f, .6, .22), i * 140)); }
  bump() { this.hiss(.17, .5, 420); }
  warning() { this.tone(360, .16, .17, 300); }
  stop() { this.update(0, false, false, false); }
}

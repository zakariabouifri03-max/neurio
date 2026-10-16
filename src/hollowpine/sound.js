// Opt-in synthesized ambience. No recordings, music files, or autoplay.
export class ForestSound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.birdTime = 0;
  }
  async enable(on) {
    this.enabled = on;
    if (on && !this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) {
        this.enabled = false;
        return;
      }
      this.ctx = new Context();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.connect(c.destination);
      this.noise = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
      const data = this.noise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.07) / 1.025;
        data[i] = last;
      }
      const wind = c.createBufferSource();
      wind.buffer = this.noise;
      wind.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700;
      const gain = c.createGain();
      gain.gain.value = 0.36;
      wind.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      wind.start();
      this.fireGain = c.createGain();
      this.fireGain.gain.value = 0;
      const fire = c.createBufferSource();
      fire.buffer = this.noise;
      fire.loop = true;
      fire.playbackRate.value = 2.4;
      const ff = c.createBiquadFilter();
      ff.type = "highpass";
      ff.frequency.value = 700;
      fire.connect(ff);
      ff.connect(this.fireGain);
      this.fireGain.connect(this.master);
      fire.start();
    }
    if (this.ctx) {
      if (on && this.ctx.state === "suspended")
        await this.ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(
        on ? 0.5 : 0,
        this.ctx.currentTime,
        0.25,
      );
    }
  }
  tone(hz, length = 0.15, volume = 0.1, delay = 0, end = hz, type = "sine") {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx,
      t = c.currentTime + delay,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(end, t + length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + length + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  rustle(length = 0.15, volume = 0.3, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx,
      t = c.currentTime + delay,
      s = c.createBufferSource(),
      g = c.createGain();
    s.buffer = this.noise;
    s.playbackRate.value = 2.5;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    s.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + length);
    s.onended = () => {
      s.disconnect();
      g.disconnect();
    };
  }
  play(name) {
    if (name === "click") this.tone(410, 0.06, 0.06);
    if (name === "gather") {
      this.rustle(0.14, 0.5);
      this.tone(480, 0.09, 0.04, 0.04, 620);
    }
    if (name === "chop") {
      this.tone(140, 0.13, 0.22, 0, 58, "triangle");
      this.rustle(0.14, 0.9);
    }
    if (name === "fall") {
      this.rustle(0.9, 0.9);
      this.tone(80, 0.8, 0.13, 0, 30, "triangle");
    }
    if (name === "build") {
      for (let i = 0; i < 3; i++)
        this.tone(180 + i * 60, 0.11, 0.11, i * 0.11, 90);
      this.rustle(0.25, 0.4, 0.2);
    }
    if (name === "eat") this.rustle(0.25, 0.4);
    if (name === "drink") {
      this.tone(330, 0.18, 0.1, 0, 180);
      this.tone(420, 0.18, 0.06, 0.16, 280);
    }
    if (name === "warn") {
      this.tone(150, 0.4, 0.1, 0, 90);
      this.rustle(0.3, 0.2);
    }
    if (name === "dawn")
      [330, 440, 550, 660].forEach((h, i) => this.tone(h, 0.8, 0.08, i * 0.18));
  }
  update(dt, time, night, fireDistance, fireLit) {
    if (!this.enabled || !this.ctx) return;
    if (this.fireGain)
      this.fireGain.gain.setTargetAtTime(
        fireLit ? Math.max(0, 1 - fireDistance / 15) * 0.8 : 0,
        this.ctx.currentTime,
        0.4,
      );
    this.birdTime += dt;
    if (this.birdTime > 10 && !night) {
      this.birdTime = 0;
      this.tone(1900, 0.12, 0.025, 0, 3400);
      this.tone(3100, 0.16, 0.02, 0.18, 2100);
      this.tone(2300, 0.1, 0.018, 0.4, 3600);
    }
  }
}

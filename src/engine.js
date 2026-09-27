/**
 * Tiny synthesized V8 engine — no audio assets needed.
 * Two detuned saws + a square sub through a resonant lowpass,
 * waveshaped for grit, with a rev-limiter flutter at high rpm.
 */
export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.enabled = true;
  }

  _build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = (this.ctx = new Ctx());

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    // waveshaper for exhaust grit
    const shaper = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 4.5;

    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = 55;
    this.gainA = ctx.createGain();
    this.gainA.gain.value = 0.5;

    this.oscB = ctx.createOscillator();
    this.oscB.type = 'sawtooth';
    this.oscB.frequency.value = 55;
    this.oscB.detune.value = -14;
    this.gainB = ctx.createGain();
    this.gainB.gain.value = 0.35;

    this.oscC = ctx.createOscillator();
    this.oscC.type = 'square';
    this.oscC.frequency.value = 27.5;
    this.gainC = ctx.createGain();
    this.gainC.gain.value = 0.3;

    const sum = ctx.createGain();
    sum.gain.value = 0.9;

    this.oscA.connect(this.gainA).connect(sum);
    this.oscB.connect(this.gainB).connect(sum);
    this.oscC.connect(this.gainC).connect(sum);
    sum.connect(this.filter).connect(shaper).connect(this.master).connect(ctx.destination);

    this.oscA.start();
    this.oscB.start();
    this.oscC.start();
    return true;
  }

  /** Call from a user gesture (click). */
  start() {
    if (!this.ctx && !this._build()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.running = true;
  }

  /**
   * @param {number} rpm01 0..1 through the rev range
   * @param {number} throttle 0..1
   */
  update(rpm01, throttle) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    const target = this.enabled ? 0.16 * (0.35 + 0.65 * throttle) : 0;
    this.master.gain.setTargetAtTime(target, t, 0.09);

    const base = 46 + rpm01 * 118 + throttle * 22;
    this.oscA.frequency.setTargetAtTime(base, t, 0.06);
    this.oscB.frequency.setTargetAtTime(base * 1.005, t, 0.06);
    this.oscC.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    this.filter.frequency.setTargetAtTime(320 + rpm01 * 2200 + throttle * 900, t, 0.08);
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    if (!this.enabled && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    return this.enabled;
  }

  silence() {
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }
}

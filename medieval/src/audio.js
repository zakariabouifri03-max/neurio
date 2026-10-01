// ── IRONVOW — sound made from scratch ────────────────────────────────────────
// No samples, no downloads: every noise here is synthesised from oscillators and
// one generated buffer of white noise. Steel rings because a band-passed burst
// excites a couple of detuned partials; a cut into a body is a low-passed burst
// that has been swept downward; a footstep on flagstones is a click with a room.
//
// The mix is deliberately dry and small: a stone hall, two men, and the scrape
// of their breathing.
import { clamp01, rr, rnd } from './mathx.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.8;
    this.ambient = null;
    this.ambientId = null;
    this.lastStep = 0;
    this.ready = false;
  }

  /** Browsers require a gesture: call this from the first click or keypress. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // a touch of room: one short convolver fed by generated noise
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.4);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (c ? 0.85 : 1);
      }
    }
    conv.buffer = buf;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.22;
    this.wet.connect(conv); conv.connect(this.master);
    this.master.connect(ctx.destination);

    // the noise source every impact draws from
    const nlen = Math.floor(ctx.sampleRate * 2);
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this.ready = true;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? this.volume : 0; }

  _now() { return this.ctx.currentTime; }

  _noise(dur, gain, filter, q, sweep) {
    const ctx = this.ctx, t = this._now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rr(0.85, 1.15);
    const f = ctx.createBiquadFilter();
    f.type = filter || 'bandpass';
    f.frequency.setValueAtTime(q?.f0 ?? 1800, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweep), t + dur);
    if (q?.Q) f.Q.value = q.Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.wet);
    src.start(t, rnd() * 1.5); src.stop(t + dur + 0.02);
    return g;
  }

  _tone(freq, dur, gain, type = 'sine', bend = 1) {
    const ctx = this.ctx, t = this._now();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * bend), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(this.master); g.connect(this.wet);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ── the sounds of a duel ───────────────────────────────────────────────────
  /** Steel stops steel. `power` 0..1 from the clash energy. */
  clash(power = 0.5, shield = false) {
    if (!this.ready || !this.enabled) return;
    const p = clamp01(power);
    if (!shield) {
      const base = rr(2100, 2900);
      this._tone(base, 0.5 + p * 0.7, 0.09 + p * 0.1, 'triangle', 0.72);
      this._tone(base * 1.51, 0.36 + p * 0.5, 0.05 + p * 0.06, 'sine', 0.8);
      this._tone(base * 0.51, 0.22, 0.06 + p * 0.05, 'sine', 0.9);
    }
    this._noise(0.09 + p * 0.22, 0.16 + p * 0.34, 'bandpass', { f0: shield ? 420 : 2400, Q: 0.9 }, shield ? 150 : 700);
    this._noise(0.03, 0.2 + p * 0.3, 'highpass', { f0: 3000 }, 500);
  }

  /** A parry: the clean, ringing version of the same thing. */
  parry(power = 0.6) {
    if (!this.ready || !this.enabled) return;
    const p = clamp01(power);
    this._tone(rr(2600, 3400), 1.0 + p * 0.6, 0.11 + p * 0.12, 'triangle', 0.55);
    this._tone(rr(3900, 4600), 0.7, 0.05, 'sine', 0.6);
    this._noise(0.12, 0.24, 'bandpass', { f0: 3200, Q: 1.4 }, 900);
  }

  /** A guard beaten down: wood-on-wood and a man's breath leaving him. */
  guardBreak() {
    if (!this.ready || !this.enabled) return;
    this._tone(150, 0.5, 0.3, 'square', 0.4);
    this._noise(0.34, 0.4, 'lowpass', { f0: 900, Q: 0.7 }, 180);
    this.exhale(0.9);
  }

  /** Blade into flesh. `amount` 0..1 from the wound. */
  cut(amount = 0.5, strike = 'cut') {
    if (!this.ready || !this.enabled) return;
    const p = clamp01(amount);
    if (strike === 'blunt' || strike === 'haft') {
      this._tone(rr(90, 130), 0.34, 0.28 + p * 0.3, 'sine', 0.5);
      this._noise(0.16, 0.2 + p * 0.24, 'lowpass', { f0: 700, Q: 0.8 }, 140);
      return;
    }
    if (strike === 'thrust') {
      this._noise(0.22, 0.24 + p * 0.3, 'bandpass', { f0: 1400, Q: 0.7 }, 260);
      this._tone(rr(180, 240), 0.18, 0.16, 'sine', 0.6);
      return;
    }
    this._noise(0.26 + p * 0.2, 0.22 + p * 0.34, 'lowpass', { f0: 1600, Q: 0.6 }, 220);
    this._noise(0.06, 0.22, 'highpass', { f0: 2600 }, 1200);
  }

  /** Armour taking a blow it mostly turned. */
  clang(power = 0.4) {
    if (!this.ready || !this.enabled) return;
    const p = clamp01(power);
    this._tone(rr(620, 900), 0.7, 0.07 + p * 0.07, 'triangle', 0.7);
    this._noise(0.12, 0.12 + p * 0.18, 'bandpass', { f0: 1700, Q: 1.2 }, 500);
  }

  /** A breath let out hard. */
  exhale(power = 0.6) {
    if (!this.ready || !this.enabled) return;
    this._noise(0.4 + power * 0.3, 0.1 + power * 0.14, 'bandpass', { f0: 620, Q: 1.1 }, 300);
  }

  /** An effort: the grunt of a man committing to a blow. */
  grunt(hard = false) {
    if (!this.ready || !this.enabled) return;
    this._noise(0.16, hard ? 0.2 : 0.13, 'bandpass', { f0: hard ? 340 : 420, Q: 1.6 }, 200);
    this._tone(rr(120, 160), 0.12, hard ? 0.1 : 0.06, 'sawtooth', 0.7);
  }

  /** Pain, kept human and short. */
  hurt(severe = false) {
    if (!this.ready || !this.enabled) return;
    this._noise(severe ? 0.5 : 0.3, severe ? 0.3 : 0.18, 'bandpass', { f0: severe ? 500 : 700, Q: 1.4 }, 260);
    this._tone(rr(160, 210), 0.24, severe ? 0.16 : 0.1, 'sawtooth', 0.6);
  }

  death() {
    if (!this.ready || !this.enabled) return;
    this._noise(1.1, 0.22, 'lowpass', { f0: 800, Q: 0.6 }, 200);
    this._tone(90, 1.2, 0.16, 'sine', 0.5);
  }

  /** Boots on the floor. `surface`: stone | sand | wood. */
  step(speed = 1, surface = 'stone', power = 1) {
    if (!this.ready || !this.enabled) return;
    const t = this._now();
    if (t - this.lastStep < 0.16) return;
    this.lastStep = t;
    const p = clamp01(power) * clamp01(speed);
    const base = surface === 'sand' ? 900 : surface === 'wood' ? 500 : 2200;
    this._noise(surface === 'sand' ? 0.1 : 0.06, 0.05 + p * 0.09, 'bandpass', { f0: rr(base * 0.8, base * 1.2), Q: surface === 'stone' ? 1.1 : 0.7 }, base * 0.35);
    if (surface !== 'sand') this._tone(rr(90, 130), 0.1, 0.03 + p * 0.04, 'sine', 0.6);
  }

  /** Mail shifting, leather creaking: the sound of a man who is still standing. */
  rattle(power = 0.4) {
    this._noise(0.12, 0.03 + power * 0.05, 'bandpass', { f0: rr(1800, 3000), Q: 1.6 }, 900);
  }

  /** A shield boss taking one. */
  shieldHit(power = 0.5) {
    if (!this.ready || !this.enabled) return;
    const p = clamp01(power);
    this._tone(rr(180, 260), 0.4, 0.2 + p * 0.2, 'sine', 0.5);
    this._noise(0.22, 0.2 + p * 0.24, 'bandpass', { f0: 700, Q: 0.8 }, 200);
  }

  ui(kind = 'click') {
    if (!this.ready || !this.enabled) return;
    if (kind === 'confirm') { this._tone(660, 0.16, 0.1, 'triangle', 1.3); this._tone(990, 0.2, 0.06, 'sine', 1.2); }
    else if (kind === 'deny') { this._tone(180, 0.22, 0.12, 'square', 0.8); }
    else this._tone(420, 0.06, 0.06, 'square', 1.1);
  }

  // ── the room ──────────────────────────────────────────────────────────────
  /** Ambient bed per arena: a hall, a cell under it, a yard, a wet rampart. */
  setAmbient(arenaId) {
    if (!this.ready || this.ambientId === arenaId) return;
    this.ambientId = arenaId;
    const ctx = this.ctx, t = this._now();
    if (this.ambient) { try { this.ambient.stop(t + 0.6); } catch (e) { /* already stopped */ } }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 1.2);
    g.connect(this.master);
    g.connect(this.wet);
    // a slow, breathing drone: the building itself
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = arenaId === 'oubliette' ? 46 : 58;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = arenaId === 'ramparts' ? 92 : 87;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lg = ctx.createGain(); lg.gain.value = 0.25;
    lfo.connect(lg); lg.connect(o2.frequency);
    const dg = ctx.createGain(); dg.gain.value = 0.05;
    const ng = ctx.createGain(); ng.gain.value = arenaId === 'ramparts' ? 0.05 : 0.02;
    const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = arenaId === 'ramparts' ? 380 : 190; wf.Q.value = 0.6;
    wind.connect(wf); wf.connect(ng); ng.connect(g);
    o1.connect(dg); o2.connect(dg); dg.connect(g);
    o1.start(t); o2.start(t); lfo.start(t); wind.start(t);
    this.ambient = { stop: (tt) => { [o1, o2, lfo, wind].forEach((n) => { try { n.stop(tt); } catch (e) { /* */ } }); g.gain.setTargetAtTime(0.0001, tt, 0.4); setTimeout(() => g.disconnect(), 1500); } };
  }

  /** Steel being drawn: the promise before the fight. */
  draw() {
    if (!this.ready || !this.enabled) return;
    this._noise(0.3, 0.14, 'bandpass', { f0: 2600, Q: 2.2 }, 1400);
    this._tone(rr(1400, 1800), 0.3, 0.05, 'triangle', 0.8);
  }

  /** The bell that starts a bout. */
  bell() {
    if (!this.ready || !this.enabled) return;
    for (const [f, d, g] of [[196, 1.9, 0.16], [293, 1.5, 0.1], [392, 1.1, 0.07], [587, 0.7, 0.04]]) {
      this._tone(f * rr(0.99, 1.01), d, g, 'sine', 0.98);
    }
    this._noise(0.5, 0.1, 'bandpass', { f0: 1200, Q: 0.8 }, 600);
  }
}

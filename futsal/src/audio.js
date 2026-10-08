// AudioManager: all sounds are synthesised procedurally with WebAudio (no samples, no music).
// The crowd is a filtered noise bed whose level follows the match state; goals, whistles,
// kicks, bounces and card beeps are short oscillator / noise envelopes.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.crowdBus = null;
    this.noise = null;
    this.crowdFilter = null;
    this.crowdGain = null;
    this.crowdLevel = 0.25;     // 0..1 target level of the ambience
    this.sfxVolume = 0.7;
    this.crowdVolume = 0.6;
    this.muted = false;
    this.lastKickT = 0;
  }

  // Must be called from a user gesture (browsers block audio before that).
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    this.crowdBus = ctx.createGain();
    this.crowdBus.gain.value = this.crowdVolume * 0.35;
    this.crowdBus.connect(this.master);

    // 2-second white noise buffer reused by every noise sound
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = seed / 0x7fffffff * 2 - 1;
    }
    this.noise = buf;

    // crowd ambience: looped noise through a band-pass with a slow swell LFO
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 900;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(this.crowdFilter);
    this.crowdFilter.connect(this.crowdGain);
    this.crowdGain.connect(this.crowdBus);
    src.start();
    this.crowdSrc = src;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.27;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain);
    lfoGain.connect(this.crowdGain.gain);
    lfo.start();
    this.lfo = lfo;
    return true;
  }

  setVolumes(sfx, crowd) {
    this.sfxVolume = sfx;
    this.crowdVolume = crowd;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.crowdBus) this.crowdBus.gain.value = crowd * 0.35;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  // 0..1 crowd excitement, eased each frame by the game loop
  update(dt) {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    const target = Math.min(1, this.crowdLevel) * 0.9 + 0.1;
    this.crowdGain.gain.setTargetAtTime(target * (0.5 + 0.5 * this.crowdLevel), t, 0.6);
    this.crowdFilter.frequency.setTargetAtTime(700 + 900 * this.crowdLevel, t, 0.5);
    void dt;
  }

  setCrowdLevel(v) { this.crowdLevel = v; }

  env(gain, t0, attack, hold, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.setValueAtTime(Math.max(0.0002, gain), t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    return g;
  }

  tone(freq, dur, type, gain, when = 0, sweepTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = this.env(gain, t0, 0.005, dur * 0.4, dur * 0.6);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  burst(dur, gain, cutoff, when = 0, q = 0.7, type = 'lowpass') {
    if (!this.ctx || !this.noise || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    f.Q.value = q;
    const g = this.env(gain, t0, 0.003, dur * 0.2, dur * 0.8);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  // ---- game sounds ----
  kick(power = 0.6) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - this.lastKickT < 0.04) return;
    this.lastKickT = now;
    this.tone(120 + 60 * power, 0.09, 'triangle', 0.35 * (0.5 + power), 0, 60);
    this.burst(0.06, 0.25 * (0.4 + power), 2400, 0, 1.2, 'highpass');
  }

  bounce(strength = 0.5) {
    this.burst(0.05, 0.15 * strength + 0.04, 900, 0, 0.8);
  }

  tackle() {
    this.burst(0.18, 0.35, 380, 0, 0.9);
    this.tone(90, 0.12, 'sine', 0.25, 0, 50);
  }

  post() {
    this.tone(1400, 0.35, 'sine', 0.22, 0, 900);
    this.tone(2100, 0.25, 'sine', 0.12, 0.01, 1500);
  }

  save() {
    this.burst(0.12, 0.3, 1600, 0, 0.7, 'bandpass');
  }

  whistle(kind = 'restart') {
    const long = kind === 'goal' || kind === 'full' || kind === 'half' || kind === 'kickoff';
    const dur = long ? 0.55 : 0.28;
    this.tone(2750, dur, 'sine', 0.22);
    this.tone(2620, dur, 'sine', 0.12, 0.01);
    if (kind === 'full') this.tone(2750, 0.8, 'sine', 0.22, 0.6);
  }

  goal() {
    this.burst(2.6, 0.5, 1200, 0, 0.5);
    this.burst(1.8, 0.35, 2200, 0.2, 0.6, 'bandpass');
    this.tone(523, 0.25, 'triangle', 0.18, 0);
    this.tone(659, 0.25, 'triangle', 0.18, 0.18);
    this.tone(784, 0.5, 'triangle', 0.2, 0.36);
  }

  cheer() {
    this.burst(1.2, 0.3, 1500, 0, 0.6, 'bandpass');
  }

  card(red = false) {
    this.tone(red ? 220 : 660, 0.25, 'square', 0.12);
    if (red) this.tone(180, 0.3, 'square', 0.12, 0.3);
  }

  callout() {
    this.tone(880, 0.12, 'sine', 0.12);
  }

  uiClick() {
    this.tone(1200, 0.04, 'square', 0.05);
  }
}

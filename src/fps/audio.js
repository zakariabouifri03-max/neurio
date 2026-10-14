// ── WARFRONT · every sound is synthesized at runtime with WebAudio ──────────
// No asset files: gun layers, reloads, footsteps, explosions, ambience and a
// reactive combat score that swells while you are in a firefight.

const SHOT = {
  rifle: { body: [1500, 240, .11], tail: [220, .3], thump: [110, 42, .3], gain: .55 },
  ak: { body: [1250, 200, .12], tail: [240, .34], thump: [100, 38, .34], gain: .6 },
  smg: { body: [2100, 420, .07], tail: [300, .16], thump: [140, 60, .18], gain: .42 },
  shotgun: { body: [900, 130, .16], tail: [180, .42], thump: [80, 30, .46], gain: .72 },
  sniper: { body: [2600, 300, .13], tail: [150, .62], thump: [70, 26, .55], gain: .82 },
  lmg: { body: [1300, 220, .1], tail: [210, .26], thump: [96, 40, .34], gain: .62 },
  dmr: { body: [1800, 260, .1], tail: [220, .3], thump: [100, 36, .3], gain: .6 },
  pistol: { body: [2400, 520, .07], tail: [340, .14], thump: [150, 62, .16], gain: .42 },
  hgrunt: { body: [1100, 190, .14], tail: [190, .38], thump: [86, 34, .42], gain: .74 },
};

class AudioSys {
  constructor() {
    this.ctx = null;
    this.on = { sfx: true, music: true };
    this.vol = { master: .9, sfx: .9, music: .5 };
    this.camPos = { x: 0, y: 0, z: 0 };
    this.camYaw = 0;
    this.intensity = 0;
    this.enabled = true;
  }

  unlock() {
    if (this.ctx || !this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.vol.master;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 5;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.busSfx = ctx.createGain(); this.busSfx.gain.value = this.vol.sfx; this.busSfx.connect(this.master);
      this.busMusic = ctx.createGain(); this.busMusic.gain.value = 0; this.busMusic.connect(this.master);
      this.busAmb = ctx.createGain(); this.busAmb.gain.value = .0; this.busAmb.connect(this.master);
      // 2s of noise, reused for every burst
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this._wind();
      this._music();
      if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    } catch (e) { this.enabled = false; }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => { }); }
  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  set(kind, on) {
    if (kind === 'sfx') this.on.sfx = on;
    if (kind === 'music') this.on.music = on;
    if (!this.ctx) return;
    if (kind === 'music') this.busMusic.gain.setTargetAtTime(on ? this.vol.music : 0, this.t, .4);
    if (kind === 'sfx') this.busSfx.gain.setTargetAtTime(on ? this.vol.sfx : 0, this.t, .05);
  }
  setMaster(v) { this.vol.master = v; if (this.master) this.master.gain.value = v; }

  // ── helpers ──────────────────────────────────────────────────────────────
  _pan(pos) {
    if (!this.ctx) return null;
    if (!pos) return this.busSfx;
    const dx = pos.x - this.camPos.x, dz = pos.z - this.camPos.z;
    const d = Math.hypot(dx, dz);
    const fwdX = -Math.sin(this.camYaw), fwdZ = -Math.cos(this.camYaw);
    const side = (dx * Math.cos(this.camYaw) - dz * fwdZ * -1);
    const p = this.ctx.createStereoPanner();
    const rel = d < 1 ? 0 : Math.max(-1, Math.min(1, (dx * Math.cos(this.camYaw) + dz * -Math.sin(this.camYaw)) / Math.max(1, d)));
    p.pan.value = rel * .8;
    void side; void fwdX; void fwdZ;
    const g = this.ctx.createGain();
    p.connect(g); g.connect(this.busSfx);
    p._out = g;
    return p;
  }
  _decayGain(peak, dur, atk = .004) {
    if (!this.ctx) return { gain: { value: 0, setValueAtTime() { }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { } } };
    const g = this.ctx.createGain();
    const t = this.t;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(.02, dur));
    return g;
  }
  _noise(dur, type, f0, f1, q, peak, dest, atk) {
    const ctx = this.ctx;
    if (!ctx || !this.busSfx) return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = .85 + Math.random() * .3;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, ctx.currentTime);
    if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), ctx.currentTime + dur * .8);
    const g = this._decayGain(peak, dur, atk);
    src.connect(flt); flt.connect(g); g.connect(dest || this.busSfx);
    src.start(ctx.currentTime, Math.random() * 1.2, dur + .06);
    src.stop(ctx.currentTime + dur + .08);
    return g;
  }
  _tone(freq, to, dur, peak, type = 'sine', dest = null, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.busSfx) return null;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur * .85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + .005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.busSfx);
    o.start(t); o.stop(t + dur + .03);
    return g;
  }
  atten(pos) {
    if (!pos) return 1;
    const d = Math.hypot(pos.x - this.camPos.x, pos.y - this.camPos.y, pos.z - this.camPos.z);
    return 1 / (1 + Math.pow(d / 16, 2.1));
  }

  // ── gunfire ──────────────────────────────────────────────────────────────
  shot(kind, _u, ads) {
    if (!this.ctx || !this.on.sfx) return;
    const s = SHOT[kind] || SHOT.rifle;
    const dest = this.busSfx;
    const mul = ads ? .82 : 1;
    this._noise(s.body[2], 'bandpass', s.body[0] * mul, s.body[1], 1.1, s.gain * 1.05, dest, .002);
    this._noise(s.tail[1], 'lowpass', 900, s.tail[0], .7, s.gain * .34, dest, .01);
    this._tone(s.thump[0], s.thump[1], s.thump[2], s.gain * .55, 'sine', dest);
    this._noise(.02, 'highpass', 5200, 0, .8, s.gain * .5, dest, .001);
    if (kind === 'sniper' || kind === 'hgrunt') this._tone(220, 55, .5, .22, 'sawtooth', dest);
  }
  shotAt(kind, pos, d) {
    if (!this.ctx || !this.on.sfx) return;
    const s = SHOT[kind] || SHOT.rifle;
    const a = this.atten(pos) * (d > 60 ? .35 : 1);
    if (a < .02) return;
    const out = this._pan(pos);
    if (!out) return;
    this._noise(s.body[2] * 1.6, 'lowpass', 1400 * (d > 30 ? .3 : .8), 260, 1.2, s.gain * a * .8, out, .004);
    if (d < 26) this._tone(s.thump[0], s.thump[1], s.thump[2] * 1.2, s.gain * a * .35, 'sine', out);
  }

  // ── weapon handling ──────────────────────────────────────────────────────
  reloadStart(def) {
    if (!this.ctx || !this.on.sfx) return;
    const fast = def && def.perShell;
    this._click(760, .16);
    if (fast) setTimeout(() => this._click(520, .13), 180);
    else setTimeout(() => this._click(560, .14), 150);
  }
  reloadEnd(def) {
    if (!this.ctx || !this.on.sfx) return;
    this._click(1180, .17);
    setTimeout(() => this._click(700, .13), 90);
    if (def && (def.mode === 'bolt' || def.mode === 'pump')) setTimeout(() => this._click(1500, .12), 210);
  }
  reloadAt(pos, v) {
    if (!this.ctx || !this.on.sfx) return;
    const out = this._pan(pos); if (!out) return;
    this._noise(.05, 'bandpass', 900, 400, 2, .18 * v * this.atten(pos), out, .002);
  }
  _click(f, g) {
    if (!this.ctx || !this.on.sfx || !this.busSfx) return;
    this._noise(.035, 'bandpass', f, f * .55, 3.5, g, this.busSfx, .001);
    this._tone(f * .3, f * .18, .05, g * .4, 'square', this.busSfx);
  }
  swap(instant) {
    if (instant) return;
    this._click(430, .1);
    setTimeout(() => this._click(880, .08), 90);
  }

  // ── movement ─────────────────────────────────────────────────────────────
  step(crouch, sprint) {
    if (!this.ctx || !this.on.sfx) return;
    const g = crouch ? .09 : sprint ? .2 : .14;
    this._noise(.09, 'bandpass', 240 + Math.random() * 180, 90, 1.2, g, this.busSfx, .004);
    this._noise(.05, 'highpass', 2600, 0, .8, g * .35, this.busSfx, .002);
  }
  slide() {
    if (!this.ctx || !this.on.sfx) return;
    this._noise(.5, 'bandpass', 700, 160, .9, .24, this.busSfx, .05);
  }
  land(v) {
    if (!this.ctx || !this.on.sfx) return;
    this._noise(.14, 'lowpass', 400, 90, 1, .1 + v * .3, this.busSfx, .004);
  }

  // ── feedback ─────────────────────────────────────────────────────────────
  hitmark(kind) {
    if (!this.ctx || !this.on.sfx) return;
    if (kind === 'head') { this._tone(1550, 1200, .07, .3, 'square'); setTimeout(() => this._tone(2100, 1500, .06, .22, 'square'), 40); }
    else if (kind === 'kill') { this._tone(1180, 880, .09, .3, 'triangle'); this._tone(1760, 1320, .1, .18, 'sine'); }
    else this._tone(1180, 980, .045, .2, 'square');
  }
  hurt() {
    if (!this.ctx || !this.on.sfx) return;
    this._noise(.3, 'lowpass', 380, 110, 1, .3, this.busSfx, .002);
    this._tone(160, 70, .28, .2, 'sine');
  }
  plate() { if (!this.ctx || !this.on.sfx) return; this._tone(700, 1300, .18, .18, 'triangle'); this._click(1500, .1); }
  plateStart() { if (!this.ctx || !this.on.sfx) return; this._noise(.18, 'bandpass', 500, 300, 1.5, .12, this.busSfx, .02); }
  revive() { if (!this.ctx || !this.on.sfx) return; this._tone(300, 900, .5, .2, 'sine'); this._tone(450, 1350, .45, .12, 'triangle', null, .08); }
  nadeThrow() { if (!this.ctx || !this.on.sfx) return; this._click(900, .12); this._noise(.2, 'bandpass', 1200, 300, 1.2, .1, this.busSfx, .01); }
  cook() { if (!this.ctx) return; this._tone(1400, 1400, .05, .07, 'square'); }
  explosion(pos, big = 1) {
    if (!this.ctx || !this.on.sfx) return;
    const a = this.atten(pos);
    const out = this._pan(pos) || this.busSfx;
    const d = pos ? Math.hypot(pos.x - this.camPos.x, pos.y - this.camPos.y, pos.z - this.camPos.z) : 4;
    this._noise(.9 * big, 'lowpass', d < 12 ? 900 : 420, 70, .8, (.75 - a * .1) * big, out, .008);
    this._tone(90 * big, 26, .8 * big, .55 * big * (.3 + a), 'sine', out);
    for (let i = 0; i < 5; i++) setTimeout(() => this._noise(.18, 'bandpass', 700 + Math.random() * 900, 200, 1.6, .07 * big, out, .005), 60 + i * 70 + Math.random() * 90);
  }
  impact(kind) {
    if (!this.ctx || !this.on.sfx) return;
    if (kind === 'flesh') { this._noise(.09, 'lowpass', 700, 180, 1.1, .18, this.busSfx, .002); return; }
    this._noise(.06, 'bandpass', kind === 'metal' ? 2600 : 1300, kind === 'metal' ? 900 : 400, 1.4, .1, this.busSfx, .001);
  }
  whiz() {
    if (!this.ctx || !this.on.sfx) return;
    this._noise(.14, 'bandpass', 2200 + Math.random() * 1400, 700, 6, .16, this.busSfx, .03);
  }

  // ── UI / events ──────────────────────────────────────────────────────────
  ui(kind) {
    if (!this.ctx || !this.on.sfx) return;
    if (kind === 'hover') this._tone(880, 940, .04, .05, 'triangle');
    else if (kind === 'back') this._tone(420, 240, .12, .1, 'triangle');
    else { this._tone(660, 990, .07, .1, 'triangle'); this._tone(1320, 1320, .05, .05, 'sine', null, .05); }
  }
  say(txt) {
    if (!this.ctx || !this.on.sfx) return;
    // radio squelch under the subtitle line
    this._noise(.06, 'bandpass', 1800, 900, 2.5, .06, this.busSfx, .003);
    this._noise(.05, 'bandpass', 1500, 700, 2.5, .05, this.busSfx, .003);
    void txt;
  }
  ping() { if (!this.ctx || !this.on.sfx) return; this._tone(760, 900, .1, .13, 'sine'); this._tone(760, 900, .1, .13, 'sine', null, .16); }
  streakReady() { if (!this.ctx || !this.on.sfx) return; [880, 1180, 1480].forEach((f, i) => this._tone(f, f * 1.02, .1, .1, 'triangle', null, i * .07)); }
  medal() { if (!this.ctx || !this.on.sfx) return; [1046, 1318, 1568, 2093].forEach((f, i) => this._tone(f, f, .16, .09, 'triangle', null, i * .05)); }
  waveStart() { if (!this.ctx || !this.on.sfx) return; this._tone(180, 130, .7, .2, 'sawtooth'); this._noise(.7, 'lowpass', 500, 120, .8, .12, this.busSfx, .05); }
  waveClear() { if (!this.ctx || !this.on.sfx) return; [523, 659, 784, 1046].forEach((f, i) => this._tone(f, f, .35, .11, 'triangle', null, i * .11)); }
  killfeed() { if (!this.ctx || !this.on.sfx) return; this._click(1600, .05); }
  deploy() {
    if (!this.ctx) return;
    this._tone(120, 340, .8, .22, 'sawtooth');
    this._noise(1.2, 'lowpass', 900, 200, .8, .2, this.busSfx, .2);
  }
  heartbeat() { if (!this.ctx || !this.on.sfx) return; this._tone(64, 44, .16, .18, 'sine'); }
  lowAmmo() { if (!this.ctx || !this.on.sfx) return; this._click(1900, .06); }

  // ── ambience + reactive score ────────────────────────────────────────────
  _wind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = .4;
    const g = ctx.createGain(); g.gain.value = .1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = .07;
    const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg); lg.connect(flt.frequency); lfo.start();
    src.connect(flt); flt.connect(g); g.connect(this.busAmb);
    src.start();
    this.windGain = g;
  }
  ambience(on) {
    if (!this.ctx || !this.busAmb) return;
    this.busAmb.gain.setTargetAtTime(on ? .55 : 0, this.t, 1.2);
  }
  _music() {
    const ctx = this.ctx;
    this.step = 0;
    const bpm = 94, spb = 60 / bpm;
    const scale = [0, 3, 5, 7, 10, 12, 15];
    this.musicTimer = setInterval(() => {
      if (!this.on.music || !this.ctx) return;
      const s = this.step++;
      const bar = s % 16;
      const inten = this.intensity;
      const dest = this.busMusic;
      // sub pulse every beat
      if (bar % 4 === 0) {
        const o = ctx.createOscillator(); o.type = 'sine';
        const g = ctx.createGain();
        const t = ctx.currentTime;
        o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(38, t + .3);
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.5, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .42);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + .45);
      }
      // hats when it heats up
      if (inten > .25 && bar % 2 === 1) {
        const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 2.4;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
        const g = ctx.createGain(); const t = ctx.currentTime;
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.06 * inten, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + .06);
        src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random()); src.stop(t + .09);
      }
      // ostinato 16ths
      if (inten > .4 && bar % 1 === 0) {
        const deg = scale[(s * 3) % scale.length];
        const freq = 110 * Math.pow(2, deg / 12);
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + inten * 2600; f.Q.value = 4;
        const g = ctx.createGain(); const t = ctx.currentTime;
        o.frequency.value = freq * (s % 8 === 7 ? 2 : 1);
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.1 * inten, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + spb * .5);
        o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + spb * .55);
      }
      // slow pad
      if (bar === 0) {
        [55, 82.5].forEach((freq, i) => {
          const o = ctx.createOscillator(); o.type = i ? 'triangle' : 'sine';
          const g = ctx.createGain(); const t = ctx.currentTime;
          o.frequency.value = freq * (1 + (Math.random() - .5) * .004);
          g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.1 + inten * .08, t + .8); g.gain.exponentialRampToValueAtTime(.0001, t + spb * 15);
          o.connect(g); g.connect(dest); o.start(t); o.stop(t + spb * 16);
        });
      }
    }, spb * 1000 / 4);
  }
  setIntensity(v) {
    this.intensity = v;
    if (!this.ctx) return;
    if (this.busMusic && this.on.music) this.busMusic.gain.setTargetAtTime(this.vol.music * (.5 + v * .6), this.t, 1.4);
  }
}

export const audio = new AudioSys();

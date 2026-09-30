// ── Synthesized Web Audio Engine for The Long Drive 3D ───────────────────────
import { RADIO_STATIONS } from './data.js';

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.radioGain = null;
    this.sfxOn = true;
    this.radioOn = true;
    this.stationIdx = 0;
    this._unlocked = false;
    this._radioTimer = null;
    this._radioStep = 0;
    this.engineRunning = false;
    this._knockTimer = 0;
  }

  unlock() {
    if (this._unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.82;
      this.master.connect(this.ctx.destination);

      this.radioGain = this.ctx.createGain();
      this.radioGain.gain.value = 0.16;
      this.radioGain.connect(this.master);

      this._unlocked = true;
      this._initEngineNodes();
      this._startRadioLoop();
    } catch (e) {
      /* AudioContext blocked or unavailable */
    }
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.82 : 0.0, this.ctx.currentTime, 0.05);
    }
  }

  _tone(freq, dur, type = 'square', vol = 0.18, when = 0, slideTo = null) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, vol = 0.25, freq = 1000, q = 1.0, when = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.7);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  // ── Continuous Car Engine & Overheat Steam ──
  _initEngineNodes() {
    const c = this.ctx;
    this.engOsc1 = c.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2 = c.createOscillator();
    this.engOsc2.type = 'triangle';
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 280;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;

    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.engOsc1.start();
    this.engOsc2.start();
  }

  updateEngine(running, rpm01, pitchScale = 1.0, lowOil = false, overheating = false, inCar = true) {
    if (!this.ctx || !this.engGain) return;
    this.engineRunning = running;
    if (!running || !this.sfxOn) {
      this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      return;
    }
    const baseFreq = (38 + rpm01 * 155) * pitchScale;
    const flutter = lowOil ? Math.sin(performance.now() * 0.045) * 9 : 0;
    this.engOsc1.frequency.setTargetAtTime(baseFreq + flutter, this.ctx.currentTime, 0.04);
    this.engOsc2.frequency.setTargetAtTime(baseFreq * 0.5 + 2, this.ctx.currentTime, 0.04);
    this.engFilter.frequency.setTargetAtTime(220 + rpm01 * 1250, this.ctx.currentTime, 0.06);

    const distAtten = inCar ? 1.0 : 0.42;
    this.engGain.gain.setTargetAtTime((0.05 + rpm01 * 0.065) * distAtten, this.ctx.currentTime, 0.08);

    // Metallic knock if low oil, or steam hiss if overheating
    const now = performance.now();
    if (lowOil && now - this._knockTimer > 240 - rpm01 * 130) {
      this._knockTimer = now;
      this._tone(520, 0.03, 'square', 0.05 * distAtten);
    }
    if (overheating && Math.random() < 0.12) {
      this._noise(0.14, 0.06 * distAtten, 3200, 0.7);
    }
  }

  // ── Starter Crank ──
  starterCrank(success = true) {
    if (!this.ctx || !this.sfxOn) return;
    for (let i = 0; i < 3; i++) {
      this._tone(95, 0.11, 'sawtooth', 0.18, i * 0.14, 135);
      this._noise(0.08, 0.12, 600, 1.2, i * 0.14);
    }
    if (success) {
      this._tone(70, 0.28, 'sawtooth', 0.22, 0.44, 180);
    } else {
      this._tone(110, 0.18, 'square', 0.12, 0.45, 55);
    }
  }

  // ── One-Shot Sound Effects ──
  click() {
    this._tone(680, 0.045, 'triangle', 0.11);
  }

  step(onAsphalt = false) {
    if (onAsphalt) {
      this._noise(0.055, 0.07, 1400, 1.5);
    } else {
      this._noise(0.075, 0.09, 850, 0.9);
    }
  }

  door(open = true) {
    if (open) {
      this._tone(240, 0.08, 'square', 0.12, 0, 320);
      this._noise(0.07, 0.14, 900, 1.2, 0.04);
    } else {
      this._noise(0.11, 0.24, 380, 0.9);
      this._tone(115, 0.12, 'triangle', 0.22, 0, 65);
    }
  }

  glug() {
    this._tone(260 + Math.random() * 80, 0.09, 'sine', 0.16, 0, 420);
  }

  scrub() {
    this._noise(0.11, 0.18, 2400, 0.8);
  }

  spray() {
    this._noise(0.12, 0.15, 4200, 0.6);
  }

  wrench() {
    this._tone(820, 0.05, 'square', 0.14, 0, 1180);
    this._tone(980, 0.06, 'square', 0.14, 0.07, 1340);
  }

  pickup() {
    this._tone(520, 0.06, 'triangle', 0.14);
    this._tone(740, 0.08, 'triangle', 0.14, 0.05);
  }

  eat() {
    this._noise(0.09, 0.22, 950, 1.1, 0);
    this._noise(0.09, 0.20, 820, 1.1, 0.14);
    this._tone(320, 0.12, 'triangle', 0.12, 0.26, 480);
  }

  drink() {
    this._tone(310, 0.11, 'sine', 0.18, 0, 460);
    this._tone(340, 0.12, 'sine', 0.18, 0.16, 510);
  }

  shoot() {
    this._noise(0.26, 0.48, 750, 0.6);
    this._tone(190, 0.18, 'sawtooth', 0.32, 0, 48);
  }

  horn() {
    this._tone(340, 0.28, 'sawtooth', 0.20);
    this._tone(425, 0.28, 'sawtooth', 0.18);
  }

  crash(intensity = 0.5) {
    const v = Math.min(0.45, 0.12 + intensity * 0.35);
    this._noise(0.24, v, 480, 0.7);
    this._tone(130, 0.2, 'square', v * 0.7, 0, 45);
  }

  rabbitHit() {
    this._tone(780, 0.14, 'sawtooth', 0.16, 0, 320);
  }

  radioStaticBurst() {
    this._noise(0.18, 0.18, 1800, 0.5);
  }

  // ── Multi-Station Car Radio Synthesizer ──
  nextStation() {
    this.stationIdx = (this.stationIdx + 1) % RADIO_STATIONS.length;
    this.radioStaticBurst();
    return RADIO_STATIONS[this.stationIdx];
  }

  toggleRadio() {
    this.radioOn = !this.radioOn;
    this.click();
    return this.radioOn;
  }

  _startRadioLoop() {
    if (!this.ctx || this._radioTimer) return;
    const synthBass = [110, 110, 130.8, 146.8, 98, 98, 110, 130.8];
    const synthArp = [440, 523.2, 659.2, 880, 659.2, 523.2, 440, 392];

    const countryBass = [146.8, 110, 146.8, 164.8, 196, 146.8, 110, 146.8];
    const countryLead = [293.6, 329.6, 370, 440, 0, 370, 329.6, 293.6, 246.9, 0, 293.6, 370, 440, 0, 293.6, 0];

    const chillChords = [
      [261.6, 329.6, 392, 493.8],
      [220, 261.6, 329.6, 392],
      [174.6, 220, 261.6, 349.2],
      [196, 246.9, 293.6, 392],
    ];

    this._radioStep = 0;
    this._radioTimer = setInterval(() => {
      if (!this.ctx || !this.sfxOn || !this.radioOn || !this.radioAudible) return;
      const st = RADIO_STATIONS[this.stationIdx];
      const s = this._radioStep++;
      const now = this.ctx.currentTime;

      const playRadioNote = (freq, dur, type, vol) => {
        if (!freq) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(vol, now);
        g.gain.exponentialRampToValueAtTime(0.002, now + dur);
        o.connect(g);
        g.connect(this.radioGain);
        o.start(now);
        o.stop(now + dur + 0.02);
      };

      if (st.mode === 'synthwave') {
        if (s % 2 === 0) playRadioNote(synthBass[(s >> 1) % synthBass.length], 0.32, 'sawtooth', 0.28);
        playRadioNote(synthArp[s % synthArp.length], 0.16, 'triangle', 0.22);
      } else if (st.mode === 'country') {
        if (s % 2 === 0) playRadioNote(countryBass[(s >> 1) % countryBass.length], 0.28, 'triangle', 0.34);
        const m = countryLead[s % countryLead.length];
        if (m) playRadioNote(m, 0.22, 'sawtooth', 0.18);
      } else if (st.mode === 'chill') {
        if (s % 4 === 0) {
          const chord = chillChords[(s >> 2) % chillChords.length];
          chord.forEach((f) => playRadioNote(f, 0.78, 'sine', 0.14));
        }
      } else if (st.mode === 'numbers') {
        // Eerie Morse / Numbers station bleeps
        if (s % 3 === 0) {
          playRadioNote(780 + ((s * 137) % 420), 0.12, 'sine', 0.22);
        }
      }
    }, 215);
  }
}

export const audio = new AudioSys();

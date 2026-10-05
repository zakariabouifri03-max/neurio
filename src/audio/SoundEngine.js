// ============================================================
// SoundEngine.js — Procedural Web Audio Sound Synthesizer
// ============================================================

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.ambientGain = null;
    this.isMuted = false;
    this.pcHumNode = null;
    this.rainNode = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      if (typeof window === 'undefined') return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      this.ambientGain.connect(this.masterGain);

      this.initialized = true;
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMasterVolume(val) {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, val)), this.ctx.currentTime);
  }

  // --- FOOTSTEPS ---
  playFootstep(surface = 'wood') {
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    let baseFreq = 80;
    let filterFreq = 300;
    let dur = 0.08;

    if (surface === 'tile') {
      baseFreq = 160;
      filterFreq = 800;
      dur = 0.06;
    } else if (surface === 'concrete') {
      baseFreq = 110;
      filterFreq = 500;
      dur = 0.09;
    } else if (surface === 'carpet') {
      baseFreq = 65;
      filterFreq = 200;
      dur = 0.12;
    }

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq + Math.random() * 20, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + dur);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + dur);
  }

  // --- INTERACTION SOUNDS ---
  playDoor(open = true) {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Wood squeak / creak
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(open ? 180 : 320, t);
    osc.frequency.exponentialRampToValueAtTime(open ? 320 : 120, t + 0.18);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(280, t);

    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.22);

    // Latch click
    setTimeout(() => {
      this.playClick(0.15, 600);
    }, open ? 10 : 180);
  }

  playFridgeOpen() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Rubber seal suction pop
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(190, t + 0.08);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  playClick(volume = 0.1, freq = 900) {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.03);

    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  playKeyboard() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freqs = [1200, 1400, 1600, 1800, 2100];
    const freq = freqs[Math.floor(Math.random() * freqs.length)];
    this.playClick(0.08, freq);
  }

  playMicrowave() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Microwave ding
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, t); // A6
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 1.2);
  }

  playEat() {
    this.ensureContext();
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.playClick(0.12, 350 + Math.random() * 200);
      }, i * 90);
    }
  }

  playDrink() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(450, t + 0.18);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  playWaterStream(duration = 2.0) {
    this.ensureContext();
    if (!this.ctx) return;
    // Filtered noise for sink / shower water
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, this.ctx.currentTime);
    filter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime + duration - 0.4);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noise.start();
    noise.stop(this.ctx.currentTime + duration);
  }

  // --- STREAMING ALERTS & NOTIFICATIONS ---
  playNotification() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Pleasant two-tone chime
    const notes = [659.25, 880]; // E5, A5
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = t + idx * 0.09;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  }

  playFollowAlert() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 4-note ascending joyful chime (G4, C5, E5, G5)
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = t + idx * 0.08;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }

  playDonationChime(amount = 10) {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Cash register cha-ching
    this.playCashRegister();

    // Celebratory arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = t + idx * 0.07;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  playCashRegister() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Metal chime ring
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2400, t);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.15);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  playMilestoneFanfare() {
    this.ensureContext();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Heroic brass synth chords
    const chords = [
      [523.25, 659.25, 783.99], // C
      [587.33, 739.99, 880.00], // D
      [659.25, 783.99, 987.77], // Em
      [783.99, 987.77, 1174.66] // G
    ];

    chords.forEach((chord, step) => {
      const stepTime = t + step * 0.18;
      chord.forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, stepTime);

        gain.gain.setValueAtTime(0.14, stepTime);
        gain.gain.exponentialRampToValueAtTime(0.001, stepTime + 0.35);

        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(stepTime);
        osc.stop(stepTime + 0.4);
      });
    });
  }

  // --- PC HUM AMBIENCE ---
  startPCHum(load = 0.3) {
    this.ensureContext();
    if (!this.ctx || this.pcHumNode) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, this.ctx.currentTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220 + load * 200, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.03 + load * 0.05, this.ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambientGain);

      osc.start();
      this.pcHumNode = { osc, gain, filter };
    } catch (e) {
      console.warn('PC hum failed:', e);
    }
  }

  stopPCHum() {
    if (this.pcHumNode) {
      try {
        this.pcHumNode.osc.stop();
      } catch (e) {}
      this.pcHumNode = null;
    }
  }

  // --- RAIN SOUND AMBIENCE ---
  startRain() {
    this.ensureContext();
    if (!this.ctx || this.rainNode) return;

    try {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.2;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambientGain);

      noise.start();
      this.rainNode = { noise, gain };
    } catch (e) {
      console.warn('Rain audio failed:', e);
    }
  }

  stopRain() {
    if (this.rainNode) {
      try {
        this.rainNode.noise.stop();
      } catch (e) {}
      this.rainNode = null;
    }
  }
}

export const soundEngine = new SoundEngine();

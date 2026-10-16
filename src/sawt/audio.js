// SAWT+ audio engine — clean boost chain.
// sources → EQ (bass/treble) → boost gain → limiter → soft-clip → master → analyser → output.
// The soft-clip stage keeps loud boosts from turning into digital crackle (bla tachawch).

const NOISE_SECONDS = 4;

function fillWhite(data) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function fillPink(data) {
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

function fillBrown(data) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
}

function softClipCurve() {
  const n = 2048,
    curve = new Float32Array(n),
    k = 1.9;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

export class SoundEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC({ latencyHint: "interactive" }) : null;
    if (this.ctx) this.#buildChain();
    this.sounds = new Map();
    this.fileAudio = null;
    this.fileSource = null;
    this.micStream = null;
    this.micNode = null;
    this.micGain = null;
    this.levels = { rms: 0, peak: 0 };
    this.wave = new Float32Array(1024);
    this.buffers = new Map();
    this.noiseTimers = new Map();
    this.fileUrl = null;
  }

  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("no-audio");
      this.ctx = new AC({ latencyHint: "interactive" });
      this.#buildChain();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  #buildChain() {
    const ctx = this.ctx;
    this.inputBus = ctx.createGain();
    this.bass = ctx.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = 130;
    this.treble = ctx.createBiquadFilter();
    this.treble.type = "highshelf";
    this.treble.frequency.value = 5500;
    this.boost = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = softClipCurve();
    this.shaper.oversample = "2x";
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.65;
    this.inputBus.connect(this.bass);
    this.bass.connect(this.treble);
    this.treble.connect(this.boost);
    this.boost.connect(this.limiter);
    this.limiter.connect(this.shaper);
    this.shaper.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.setLimiter(true);
    this.setMaster(0.8);
    this.setBoost(2);
    this.setBassDb(0);
    this.setTrebleDb(0);
  }

  #noiseBuffer(kind) {
    if (this.buffers.has(kind)) return this.buffers.get(kind);
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * NOISE_SECONDS),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    if (kind === "pink") fillPink(data);
    else if (kind === "brown") fillBrown(data);
    else fillWhite(data);
    this.buffers.set(kind, buffer);
    return buffer;
  }

  #loopNoise(kind) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noiseBuffer(kind);
    src.loop = true;
    return src;
  }

  setBoost(gain) {
    if (!this.ctx) return;
    this.boost.gain.setTargetAtTime(
      Math.max(0.05, gain),
      this.ctx.currentTime,
      0.02,
    );
  }

  setBassDb(db) {
    if (!this.ctx) return;
    this.bass.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02);
  }

  setTrebleDb(db) {
    if (!this.ctx) return;
    this.treble.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02);
  }

  setLimiter(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on) {
      this.limiter.threshold.setTargetAtTime(-8, t, 0.02);
      this.limiter.ratio.setTargetAtTime(12, t, 0.02);
    } else {
      this.limiter.threshold.setTargetAtTime(0, t, 0.02);
      this.limiter.ratio.setTargetAtTime(1, t, 0.02);
    }
  }

  setMaster(v) {
    if (!this.ctx) return;
    this.masterLevel = v;
    if (this.muted) return;
    this.master.gain.setTargetAtTime(
      Math.max(0, Math.min(1, v)),
      this.ctx.currentTime,
      0.02,
    );
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(
      muted ? 0 : Math.max(0, Math.min(1, this.masterLevel ?? 0.8)),
      this.ctx.currentTime,
      0.02,
    );
  }

  tickLevels() {
    if (!this.analyser) return this.levels;
    const wave = this.wave;
    this.analyser.getFloatTimeDomainData(wave);
    let peak = 0,
      sum = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = wave[i],
        a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    this.levels = { peak, rms: Math.sqrt(sum / wave.length) };
    return this.levels;
  }

  // ── Ambient + noise tiles ──────────────────────────────────────────────
  startSound(id) {
    if (!this.ctx || this.sounds.has(id)) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.inputBus);
    const nodes = [];

    if (id === "white" || id === "pink" || id === "brown") {
      const src = this.#loopNoise(id);
      src.connect(out);
      src.start();
      nodes.push(src);
    } else if (id === "rain") {
      const src = this.#loopNoise("white");
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1600;
      band.Q.value = 0.6;
      const high = ctx.createBiquadFilter();
      high.type = "highshelf";
      high.frequency.value = 4000;
      high.gain.value = 4;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 240;
      lfo.connect(lfoGain).connect(band.frequency);
      src.connect(band).connect(high).connect(out);
      src.start();
      lfo.start();
      nodes.push(src, lfo);
    } else if (id === "ocean") {
      const src = this.#loopNoise("brown");
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 480;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.32;
      const swell = ctx.createGain();
      swell.gain.value = 0.68;
      lfo.connect(lfoGain).connect(swell.gain);
      src.connect(low).connect(swell).connect(out);
      src.start();
      lfo.start();
      nodes.push(src, lfo);
    } else if (id === "wind") {
      const src = this.#loopNoise("pink");
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 520;
      band.Q.value = 1.1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(band.frequency);
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.05;
      const lfo2Gain = ctx.createGain();
      lfo2Gain.gain.value = 0.22;
      const swell = ctx.createGain();
      swell.gain.value = 0.78;
      lfo2.connect(lfo2Gain).connect(swell.gain);
      src.connect(band).connect(swell).connect(out);
      src.start();
      lfo.start();
      lfo2.start();
      nodes.push(src, lfo, lfo2);
    } else if (id === "fire") {
      const src = this.#loopNoise("brown");
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 620;
      src.connect(low).connect(out);
      src.start();
      nodes.push(src);
      const timer = setInterval(() => {
        if (!this.sounds.has("fire") || !this.ctx) return;
        if (Math.random() < 0.35) return;
        this.#crackle(out);
      }, 180);
      this.noiseTimers.set("fire", timer);
    } else if (id === "fan") {
      const src = this.#loopNoise("pink");
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 340;
      src.connect(low).connect(out);
      src.start();
      const hum = ctx.createOscillator();
      hum.type = "triangle";
      hum.frequency.value = 82;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.028;
      hum.connect(humGain).connect(out);
      hum.start();
      nodes.push(src, hum);
    }

    this.sounds.set(id, { out, nodes });
  }

  #crackle(dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, 1600, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    src.buffer = buffer;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 1400;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.5 + Math.random() * 0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(high).connect(gain).connect(dest);
    src.start(t, Math.random() * 2);
    src.onended = () => {
      try {
        src.disconnect();
        high.disconnect();
        gain.disconnect();
      } catch {}
    };
  }

  stopSound(id) {
    const sound = this.sounds.get(id);
    if (!sound) return;
    this.sounds.delete(id);
    const timer = this.noiseTimers.get(id);
    if (timer) clearInterval(timer);
    this.noiseTimers.delete(id);
    const t = this.ctx.currentTime;
    sound.out.gain.setTargetAtTime(0, t, 0.03);
    setTimeout(() => {
      for (const node of sound.nodes) {
        try {
          node.stop();
        } catch {}
        try {
          node.disconnect();
        } catch {}
      }
      try {
        sound.out.disconnect();
      } catch {}
    }, 160);
  }

  stopAllSounds() {
    for (const id of [...this.sounds.keys()]) this.stopSound(id);
  }

  get playingSounds() {
    return [...this.sounds.keys()];
  }

  // ── Microphone amplifier ───────────────────────────────────────────────
  async startMic() {
    await this.ensure();
    if (this.micNode) return true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.micStream = stream;
    this.micNode = this.ctx.createMediaStreamSource(stream);
    this.micGain = this.ctx.createGain();
    this.micGain.gain.value = 1;
    this.micNode.connect(this.micGain).connect(this.inputBus);
    return true;
  }

  stopMic() {
    if (this.micNode) {
      try {
        this.micNode.disconnect();
        this.micGain.disconnect();
      } catch {}
      this.micNode = null;
      this.micGain = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
  }

  get micActive() {
    return !!this.micNode;
  }

  // ── Local file boost ───────────────────────────────────────────────────
  async loadFile(file) {
    await this.ensure();
    this.stopFile();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    const audio = new Audio(this.fileUrl);
    audio.preload = "auto";
    audio.loop = false;
    audio.crossOrigin = "anonymous";
    this.fileSource = this.ctx.createMediaElementSource(audio);
    this.fileSource.connect(this.inputBus);
    this.fileAudio = audio;
    this.fileName = file.name;
    return new Promise((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(audio), {
        once: true,
      });
      audio.addEventListener("error", () => reject(new Error("file-load")), {
        once: true,
      });
      audio.load();
    });
  }

  filePlay() {
    return this.fileAudio?.play().catch(() => {});
  }

  filePause() {
    this.fileAudio?.pause();
  }

  fileSeek(seconds) {
    if (this.fileAudio && Number.isFinite(seconds))
      this.fileAudio.currentTime = seconds;
  }

  setFileLoop(loop) {
    if (this.fileAudio) this.fileAudio.loop = !!loop;
  }

  stopFile() {
    if (this.fileAudio) {
      this.fileAudio.pause();
      try {
        this.fileSource?.disconnect();
      } catch {}
      this.fileAudio = null;
      this.fileSource = null;
    }
  }

  get fileState() {
    const a = this.fileAudio;
    return a
      ? {
          name: this.fileName || "audio",
          playing: !a.paused && !a.ended,
          time: a.currentTime,
          duration: Number.isFinite(a.duration) ? a.duration : 0,
          loop: a.loop,
        }
      : null;
  }

  dispose() {
    this.stopAllSounds();
    this.stopMic();
    this.stopFile();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

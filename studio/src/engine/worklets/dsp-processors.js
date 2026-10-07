/* AudioWorklet processors: granular pitch shifter and RMS noise gate. Plain JS (loaded as a module URL). */

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.grain = 2048; // samples (~43ms @48k)
    this.size = 16384;
    this.buffers = [];
    this.write = 0;
    this.phase = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    const ratio = params.ratio[0];
    const ch = input.length;
    while (this.buffers.length < ch) this.buffers.push(new Float32Array(this.size));
    const n = input[0].length;
    const grain = this.grain;
    const size = this.size;
    const inc = (1 - ratio) / grain; // phase advance per sample (delay grows when ratio<1)
    for (let i = 0; i < n; i++) {
      // write
      for (let c = 0; c < ch; c++) this.buffers[c][this.write] = input[c][i];
      if (Math.abs(ratio - 1) < 1e-4) {
        for (let c = 0; c < ch; c++) output[c][i] = input[c][i];
      } else {
        this.phase += inc;
        this.phase -= Math.floor(this.phase);
        let acc = new Array(ch).fill(0);
        for (let k = 0; k < 2; k++) {
          let ph = this.phase + k * 0.5;
          ph -= Math.floor(ph);
          const delay = ph * grain + 1;
          const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph); // Hann
          let rp = this.write - delay;
          while (rp < 0) rp += size;
          const i0 = Math.floor(rp), i1 = (i0 + 1) % size, fr = rp - i0;
          for (let c = 0; c < ch; c++) {
            const b = this.buffers[c];
            acc[c] += (b[i0] * (1 - fr) + b[i1] * fr) * win;
          }
        }
        for (let c = 0; c < ch; c++) output[c][i] = acc[c];
      }
      this.write = (this.write + 1) % size;
    }
    return true;
  }
}

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: 0.02, minValue: 0, maxValue: 1 },
      { name: 'amount', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || !input.length) return true;
    const th = params.threshold[0], amount = params.amount[0];
    const n = input[0].length;
    const attack = 0.002, release = 0.0004; // per-sample smoothing coefficients
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += Math.abs(input[c][i]);
      s /= input.length;
      this.env += (s - this.env) * (s > this.env ? 0.01 : 0.0008);
      const target = this.env > th ? 1 : Math.max(0, 1 - amount);
      this.gain += (target - this.gain) * (target > this.gain ? attack * 20 : release * 20);
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ? input[c][i] : 0) * this.gain;
    }
    return true;
  }
}

registerProcessor('neurio-pitch-shift', PitchShiftProcessor);
registerProcessor('neurio-noise-gate', NoiseGateProcessor);

import { LookaheadLimiter } from "./dsp.mjs";
class SafiLimiter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.limiter = new LookaheadLimiter(sampleRate, 2);
  }
  process(inputs, outputs) {
    this.limiter.process(inputs[0] || [], outputs[0]);
    return true;
  }
}
registerProcessor("safi-limiter", SafiLimiter);

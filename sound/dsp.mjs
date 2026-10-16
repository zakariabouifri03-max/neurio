/** Sample-peak look-ahead limiter. Not a true-peak / hearing-safety guarantee. */
export class LookaheadLimiter {
  constructor(sampleRate, channels = 2) {
    this.delay = Math.max(1, Math.round(sampleRate * 0.005));
    this.length = this.delay + 1;
    this.buffers = Array.from(
      { length: channels },
      () => new Float32Array(this.length),
    );
    this.capacity = this.length + 1;
    this.peaks = new Float64Array(this.capacity);
    this.times = new Float64Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.time = 0;
    this.position = 0;
    this.gain = 1;
    this.ceiling = Math.pow(10, -1 / 20);
    this.release = Math.exp(-1 / (sampleRate * 0.12));
  }
  process(input, output) {
    const frames = output[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let ch = 0; ch < this.buffers.length; ch++) {
        const raw = input[ch]?.[i] ?? 0;
        const sample = Number.isFinite(raw) ? raw : 0;
        this.buffers[ch][this.position] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      // Monotonic queue: maximum over the delayed sample AND its look-ahead.
      while (this.count && this.times[this.head] < this.time - this.delay) {
        this.head = (this.head + 1) % this.capacity;
        this.count--;
      }
      while (this.count) {
        const last = (this.tail - 1 + this.capacity) % this.capacity;
        if (this.peaks[last] > peak) break;
        this.tail = last;
        this.count--;
      }
      this.peaks[this.tail] = peak;
      this.times[this.tail] = this.time;
      this.tail = (this.tail + 1) % this.capacity;
      this.count++;
      const maximum = this.peaks[this.head];
      const target = maximum > this.ceiling ? this.ceiling / maximum : 1;
      this.gain =
        target < this.gain
          ? target
          : target + this.release * (this.gain - target);
      const read = (this.position + 1) % this.length;
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = (this.buffers[ch]?.[read] ?? 0) * this.gain;
      }
      this.position = read;
      this.time++;
    }
  }
}

import { abortError } from './errors.js';

const now = () => Number(process.hrtime.bigint()) / 1e9;

export class BandwidthLimiter {
  constructor(rateBytesPerSecond = null) {
    this.rate = this.normalize(rateBytesPerSecond);
    this.tokens = 0;
    this.lastRefill = now();
  }

  normalize(value) {
    if (value == null || value === '' || value === 'unlimited') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : null;
  }

  setRate(value) {
    this.refill();
    this.rate = this.normalize(value);
    this.tokens = 0;
    this.lastRefill = now();
  }

  refill() {
    const time = now();
    if (this.rate) {
      // A short burst bucket avoids excessive syscall overhead while keeping a
      // custom limit close to its long-term rate.
      const capacity = Math.max(16_384, this.rate * 0.2);
      this.tokens = Math.min(capacity, this.tokens + (time - this.lastRefill) * this.rate);
    }
    this.lastRefill = time;
  }

  async consume(byteCount, signal) {
    if (!this.rate || byteCount <= 0) return;
    let remaining = byteCount;
    while (remaining > 0) {
      if (signal?.aborted) throw abortError();
      this.refill();
      if (this.tokens >= 1) {
        const consumed = Math.min(remaining, Math.floor(this.tokens));
        this.tokens -= consumed;
        remaining -= consumed;
        continue;
      }
      const waitMs = Math.max(5, Math.min(250, Math.ceil((1 - this.tokens) / this.rate * 1000)));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(done, waitMs);
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(abortError());
        };
        function done() {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}

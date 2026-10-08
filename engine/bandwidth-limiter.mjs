import { DownloadError } from './errors.mjs';

// A shared leaky-bucket gate. Reservations are serialized across all downloads,
// so the selected rate is an aggregate limit rather than a per-connection limit.
export class BandwidthLimiter {
  constructor(limitBps = 0) {
    this.limitBps = Math.max(0, Number(limitBps) || 0);
    this.nextAvailableAt = 0;
    this._tail = Promise.resolve();
  }

  setLimit(limitBps) {
    this.limitBps = Math.max(0, Number(limitBps) || 0);
    if (!this.limitBps) this.nextAvailableAt = 0;
  }

  async consume(bytes, signal) {
    if (!this.limitBps || bytes <= 0) return;
    if (signal?.aborted) throw signal.reason || new DownloadError('Operation aborted.', { code: 'ABORT_ERR' });
    const limit = this.limitBps;
    let release;
    const previous = this._tail;
    this._tail = new Promise(resolve => { release = resolve; });
    await previous;
    let due;
    try {
      const now = Date.now();
      const start = Math.max(now, this.nextAvailableAt);
      due = start + Math.ceil((bytes / limit) * 1000);
      this.nextAvailableAt = due;
    } finally {
      release();
    }
    const waitMs = Math.max(0, due - Date.now());
    if (!waitMs) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, waitMs);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal.reason || new DownloadError('Operation aborted.', { code: 'ABORT_ERR' }));
      };
      function done() {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

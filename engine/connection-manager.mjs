export class ConnectionManager {
  constructor(logger) {
    this.logger = logger;
  }

  initialize(job, selected) {
    job.connectionLimit = Math.max(1, Number(selected) || 1);
    job.activeConnections = 0;
    job.failureStreak = 0;
    job._adaptive = { startedAt: Date.now(), sampleAt: Date.now(), sampleBytes: 0, bestRate: 0, slowWindows: 0, lastReduceAt: 0 };
  }

  reduce(job, reason, minimum = 1) {
    const before = job.connectionLimit || 1;
    if (before <= minimum) return before;
    const after = Math.max(minimum, Math.floor(before / 2));
    job.connectionLimit = after;
    this.logger?.warn(`Reducing parallel connections from ${before} to ${after}: ${reason}.`, { jobId: job.id });
    return after;
  }

  noteFailure(job, error) {
    job.failureStreak = (job.failureStreak || 0) + 1;
    if (error?.status === 429) this.reduce(job, 'the server returned HTTP 429 (rate limited)');
    else if (error?.status === 403) this.reduce(job, 'the server denied a connection (HTTP 403)');
    else if (job.failureStreak >= 2) {
      this.reduce(job, 'repeated connection errors');
      job.failureStreak = 0;
    }
  }

  noteSuccess(job) {
    job.failureStreak = 0;
  }

  observeBytes(job, byteCount, { bandwidthLimited = false } = {}) {
    const adaptive = job._adaptive;
    if (!adaptive || byteCount <= 0) return;
    adaptive.sampleBytes += byteCount;
    const now = Date.now();
    const elapsed = now - adaptive.sampleAt;
    if (elapsed < 5000) return;
    const rate = adaptive.sampleBytes / (elapsed / 1000);
    adaptive.sampleAt = now;
    adaptive.sampleBytes = 0;
    if (bandwidthLimited || job.connectionLimit <= 1 || adaptive.bestRate <= 0) {
      adaptive.bestRate = Math.max(adaptive.bestRate, rate);
      adaptive.slowWindows = 0;
      return;
    }
    if (rate < adaptive.bestRate * 0.45) adaptive.slowWindows += 1;
    else {
      adaptive.slowWindows = 0;
      adaptive.bestRate = Math.max(adaptive.bestRate, rate);
    }
    if (adaptive.slowWindows >= 2 && now - adaptive.lastReduceAt > 10_000) {
      this.reduce(job, 'the server throughput has remained substantially slower');
      adaptive.lastReduceAt = now;
      adaptive.bestRate = rate;
      adaptive.slowWindows = 0;
    }
  }
}

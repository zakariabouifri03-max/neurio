import { DownloadError, isAbortError } from './errors.mjs';

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(120_000, date - now)) : null;
}

export class RetryManager {
  constructor({ maxAttempts = 5, baseDelayMs = 750, maxDelayMs = 30_000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  shouldRetry(error, attempt) {
    if (isAbortError(error)) return false;
    if (error?.code === 'RANGE_FALLBACK' || error?.code === 'INTEGRITY_ERROR') return false;
    if (attempt >= this.maxAttempts) return false;
    if (error instanceof DownloadError) return Boolean(error.retryable);
    return ['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EHOSTDOWN', 'EAI_AGAIN', 'ENOTFOUND'].includes(error?.code);
  }

  delay(attempt, retryAfterMs = null) {
    if (retryAfterMs != null) return Math.min(120_000, Math.max(0, retryAfterMs));
    const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
    return Math.round(exponential * (0.85 + Math.random() * 0.3));
  }

  async wait(ms, signal) {
    if (signal?.aborted) throw signal.reason || new DownloadError('Operation aborted.', { code: 'ABORT_ERR' });
    if (ms <= 0) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(finish, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal.reason || new DownloadError('Operation aborted.', { code: 'ABORT_ERR' }));
      };
      function finish() {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

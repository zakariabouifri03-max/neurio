import { isAbortError, isRetryableError, abortError } from './errors.js';

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export class RetryManager {
  constructor({ maxAttempts = 6, baseDelayMs = 700, maxDelayMs = 30_000, random = Math.random } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.random = random;
  }

  async run(operation, { signal, label = 'transfer', onRetry = () => {}, onAttemptSuccess = () => {}, beforeRetry = () => {} } = {}) {
    let attempt = 0;
    while (attempt < this.maxAttempts) {
      if (signal?.aborted) throw abortError();
      attempt += 1;
      try {
        const result = await operation(attempt);
        onAttemptSuccess(attempt);
        return result;
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw abortError();
        if (!isRetryableError(error) || attempt >= this.maxAttempts) {
          error.attempts = attempt;
          throw error;
        }
        const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** (attempt - 1)));
        const jittered = Math.round(exponential * (0.8 + this.random() * 0.4));
        // Retry-After is a server instruction, not a hint to retry earlier.
        const delayMs = Math.max(jittered, error.retryAfterMs || 0);
        beforeRetry(error, attempt);
        onRetry({ attempt, nextAttempt: attempt + 1, delayMs, error, label });
        await sleep(delayMs, signal);
      }
    }
  }
}

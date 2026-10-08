//! Bandwidth limiter — a token bucket shared by every connection of a download.
//!
//! The bucket is a *leaky bucket with debt*: a caller reports the bytes it is
//! about to transfer and receives the delay it must sleep for. Sleeping happens
//! in the caller (not inside the mutex), so pausing or cancelling a download is
//! never blocked behind a throttled socket.
//!
//! The measured throughput of a limited download converges on the configured
//! rate; SwiftLoad never claims a limit it cannot enforce, and it never removes
//! bytes from the stream — it only delays reads/writes.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Largest burst allowed by the bucket. Small enough to feel instant, large
/// enough that ordinary TCP behaviour is not disturbed.
const BURST_FLOOR: u64 = 64 * 1024;
const BURST_CEILING: u64 = 2 * 1024 * 1024;
/// A single wait is capped so pause/cancel stay responsive; any leftover debt
/// simply produces another short wait on the next chunk.
pub const MAX_SINGLE_WAIT: Duration = Duration::from_millis(500);

#[derive(Debug)]
struct Bucket {
    rate: Option<u64>,
    tokens: f64,
    burst: u64,
    last: Instant,
}

#[derive(Debug)]
pub struct BandwidthLimiter {
    state: Mutex<Bucket>,
    /// Bytes accounted since construction — diagnostics only.
    accounted: Mutex<u64>,
}

impl BandwidthLimiter {
    /// `None` means unlimited.
    pub fn new(rate: Option<u64>) -> Self {
        Self {
            state: Mutex::new(Bucket {
                rate,
                tokens: burst_for(rate) as f64,
                burst: burst_for(rate),
                last: Instant::now(),
            }),
            accounted: Mutex::new(0),
        }
    }

    /// Changes the limit at runtime (used when settings change mid-download).
    pub fn set_rate(&self, rate: Option<u64>) {
        let mut state = self.lock();
        if state.rate == rate {
            return;
        }
        state.rate = rate;
        state.burst = burst_for(rate);
        // Start the new rate with a full burst so the change is immediate.
        state.tokens = state.burst as f64;
        state.last = Instant::now();
    }

    pub fn rate(&self) -> Option<u64> {
        self.lock().rate
    }

    pub fn is_unlimited(&self) -> bool {
        self.lock().rate.is_none()
    }

    /// Accounts `bytes` and returns how long the caller must wait before the
    /// next chunk. `Duration::ZERO` when unlimited or when the bucket still has
    /// enough tokens.
    pub fn consume(&self, bytes: u64) -> Duration {
        let mut state = self.lock();
        let Some(rate) = state.rate else {
            return Duration::ZERO;
        };
        if rate == 0 {
            return Duration::ZERO;
        }

        let now = Instant::now();
        let elapsed = now.saturating_duration_since(state.last).as_secs_f64();
        state.last = now;
        state.tokens = (state.tokens + elapsed * rate as f64).min(state.burst as f64);
        state.tokens -= bytes as f64;

        if let Ok(mut total) = self.accounted.lock() {
            *total = total.saturating_add(bytes);
        }

        if state.tokens >= 0.0 {
            return Duration::ZERO;
        }
        let seconds = -state.tokens / rate as f64;
        Duration::from_secs_f64(seconds.min(MAX_SINGLE_WAIT.as_secs_f64() * 8.0))
    }

    /// Convenience wrapper: accounts and sleeps.
    pub async fn wait(&self, bytes: u64) {
        let delay = self.consume(bytes);
        if delay > Duration::ZERO {
            tokio::time::sleep(delay.min(MAX_SINGLE_WAIT)).await;
        }
    }

    /// Total bytes accounted so far.
    pub fn accounted_bytes(&self) -> u64 {
        self.accounted.lock().map(|v| *v).unwrap_or(0)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Bucket> {
        match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn burst_for(rate: Option<u64>) -> u64 {
    match rate {
        None => BURST_CEILING,
        Some(rate) => (rate / 4).clamp(BURST_FLOOR, BURST_CEILING),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlimited_never_waits() {
        let limiter = BandwidthLimiter::new(None);
        assert_eq!(limiter.consume(10 * 1024 * 1024), Duration::ZERO);
        assert!(limiter.is_unlimited());
    }

    #[test]
    fn small_transfers_fit_in_the_burst() {
        let limiter = BandwidthLimiter::new(Some(1024 * 1024));
        // Burst is 256 KiB for a 1 MiB/s limit.
        assert_eq!(limiter.consume(64 * 1024), Duration::ZERO);
        assert_eq!(limiter.consume(64 * 1024), Duration::ZERO);
    }

    #[test]
    fn exceeding_the_burst_produces_a_proportional_delay() {
        let limiter = BandwidthLimiter::new(Some(100_000));
        // Drain the burst (64 KiB floor).
        let _ = limiter.consume(64 * 1024);
        // 50 000 bytes at 100 000 B/s should be ~0.5 s.
        let delay = limiter.consume(50_000);
        assert!(delay >= Duration::from_millis(400), "delay was {delay:?}");
        assert!(delay <= Duration::from_millis(600), "delay was {delay:?}");
    }

    #[test]
    fn changing_the_rate_resets_the_bucket() {
        let limiter = BandwidthLimiter::new(Some(100_000));
        let _ = limiter.consume(64 * 1024);
        limiter.set_rate(Some(10 * 1024 * 1024));
        assert_eq!(limiter.rate(), Some(10 * 1024 * 1024));
        assert_eq!(limiter.consume(128 * 1024), Duration::ZERO);
        limiter.set_rate(None);
        assert!(limiter.is_unlimited());
    }

    #[tokio::test]
    async fn one_second_of_transfer_matches_the_limit() {
        // 512 KiB/s for 1 MiB of accounting: the sum of the returned delays
        // should be close to 2 s minus the initial burst.
        let limiter = BandwidthLimiter::new(Some(512 * 1024));
        let mut waited = Duration::ZERO;
        let mut sent = 0u64;
        let chunk = 64 * 1024;
        while sent < 2 * 1024 * 1024 {
            waited += limiter.consume(chunk);
            sent += chunk;
        }
        // 2 MiB at 512 KiB/s is 4 s; the 128 KiB burst removes ~0.25 s.
        let secs = waited.as_secs_f64();
        assert!((3.0..=4.0).contains(&secs), "waited {secs}s");
    }
}

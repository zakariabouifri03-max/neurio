//! Retry manager — controlled exponential backoff for *transient* failures only.
//!
//! * Permanent failures (invalid URL, 404, 403, unsupported scheme, TLS trust
//!   failure, hash mismatch) are never retried: retrying them wastes bandwidth
//!   and hides the real problem from the user.
//! * Transient failures (timeouts, resets, DNS hiccups, 5xx, 408, 429) are
//!   retried with `base * 2^(attempt-1)`, capped by `retry_max_delay_ms`:
//!   `1s, 2s, 4s, 8s, 16s …`
//! * When the server asks for a specific delay (`Retry-After`), SwiftLoad obeys
//!   it — the server knows its own rate limits better than a fixed table does.

use std::time::Duration;

use crate::error::AppError;
use crate::settings::DownloadSettings;

/// Upper bound on an honoured `Retry-After`, so a hostile server cannot park a
/// download for hours.
pub const MAX_SERVER_DELAY: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, PartialEq)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub multiplier: f64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 5,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
            multiplier: 2.0,
        }
    }
}

impl RetryPolicy {
    pub fn from_settings(settings: &DownloadSettings) -> Self {
        Self {
            max_retries: settings.max_retries,
            base_delay: Duration::from_millis(settings.retry_delay_ms.max(1)),
            max_delay: Duration::from_millis(settings.retry_max_delay_ms.max(settings.retry_delay_ms.max(1))),
            multiplier: 2.0,
        }
    }

    /// `true` when another attempt is allowed and the failure is worth retrying.
    ///
    /// `attempt` is the number of attempts already made (1 = the first attempt
    /// just failed).
    pub fn should_retry(&self, attempt: u32, error: &AppError) -> bool {
        if attempt > self.max_retries {
            return false;
        }
        if !error.is_transient() {
            return false;
        }
        // A cancelled or paused download is not a failure to retry.
        !matches!(error, AppError::Cancelled)
    }

    /// Exponential backoff for the given attempt: 1 -> base, 2 -> 2·base, …
    pub fn backoff(&self, attempt: u32) -> Duration {
        if attempt == 0 {
            return self.base_delay;
        }
        let exponent = (attempt - 1).min(63) as i32;
        let factor = self.multiplier.powi(exponent);
        let nanos = self.base_delay.as_nanos() as f64 * factor;
        let capped = nanos.min(self.max_delay.as_nanos() as f64);
        Duration::from_nanos(capped.max(0.0) as u64)
    }

    /// The delay actually used: the server's `Retry-After` when it is longer
    /// than our own backoff.
    pub fn delay_for(&self, attempt: u32, error: &AppError) -> Duration {
        let backoff = self.backoff(attempt);
        match error.retry_after() {
            Some(server) => server.min(MAX_SERVER_DELAY).max(backoff),
            None => backoff,
        }
    }

    pub fn exhausted(&self, attempt: u32) -> bool {
        attempt > self.max_retries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> RetryPolicy {
        RetryPolicy::default()
    }

    #[test]
    fn backoff_doubles_from_one_second() {
        let policy = policy();
        assert_eq!(policy.backoff(1), Duration::from_secs(1));
        assert_eq!(policy.backoff(2), Duration::from_secs(2));
        assert_eq!(policy.backoff(3), Duration::from_secs(4));
        assert_eq!(policy.backoff(4), Duration::from_secs(8));
        assert_eq!(policy.backoff(5), Duration::from_secs(16));
    }

    #[test]
    fn backoff_is_capped() {
        let policy = RetryPolicy {
            max_retries: 40,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
            multiplier: 2.0,
        };
        assert_eq!(policy.backoff(20), Duration::from_secs(60));
    }

    #[test]
    fn permanent_failures_are_not_retried() {
        let policy = policy();
        let not_found = AppError::http(404, "Not Found", None);
        let forbidden = AppError::http(403, "Forbidden", None);
        let invalid = AppError::InvalidUrl("nope".into());
        assert!(!policy.should_retry(1, &not_found));
        assert!(!policy.should_retry(1, &forbidden));
        assert!(!policy.should_retry(1, &invalid));
        assert!(!policy.should_retry(1, &AppError::Tls("bad certificate".into())));
        assert!(!policy.should_retry(1, &AppError::HashMismatch {
            expected: "a".into(),
            actual: "b".into()
        }));
    }

    #[test]
    fn transient_failures_are_retried_until_exhausted() {
        let policy = policy();
        let timeout = AppError::Timeout("no response".into());
        assert!(policy.should_retry(1, &timeout));
        assert!(policy.should_retry(5, &timeout));
        assert!(!policy.should_retry(6, &timeout));
        assert!(policy.exhausted(6));

        assert!(policy.should_retry(1, &AppError::http(500, "Internal Server Error", None)));
        assert!(policy.should_retry(1, &AppError::http(503, "Unavailable", None)));
        assert!(policy.should_retry(1, &AppError::http(429, "Too Many Requests", None)));
        assert!(policy.should_retry(1, &AppError::http(408, "Request Timeout", None)));
    }

    #[test]
    fn server_hint_wins_when_longer() {
        let policy = policy();
        let error = AppError::http(429, "Too Many Requests", Some(30));
        assert_eq!(policy.delay_for(1, &error), Duration::from_secs(30));
        // ... but never exceeds the sanity cap.
        let hostile = AppError::http(429, "Too Many Requests", Some(86_400));
        assert_eq!(policy.delay_for(1, &hostile), MAX_SERVER_DELAY);
        // A short hint does not undercut our own backoff.
        let short = AppError::http(429, "Too Many Requests", Some(1));
        assert_eq!(policy.delay_for(4, &short), Duration::from_secs(8));
    }

    #[test]
    fn retry_after_parses_seconds_and_dates() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "42".parse().unwrap());
        assert_eq!(crate::net::parse_retry_after(&headers), Some(42));

        let future = chrono::Utc::now() + chrono::Duration::seconds(20);
        headers.insert(
            reqwest::header::RETRY_AFTER,
            future.to_rfc2822().parse().unwrap(),
        );
        let parsed = crate::net::parse_retry_after(&headers).unwrap();
        assert!((18..=21).contains(&parsed), "parsed {parsed}");
    }

    #[test]
    fn settings_are_honoured() {
        let mut settings = DownloadSettings {
            max_concurrent: 3,
            connections_per_download: 4,
            max_connections_per_download: 8,
            adaptive_connections: true,
            min_segment_bytes: 1024,
            max_retries: 3,
            retry_delay_ms: 500,
            retry_max_delay_ms: 2_000,
            speed_limit_bps: None,
            verify_on_resume: true,
            keep_partial_files: true,
            verify_ranges: true,
            compute_sha256: false,
            check_free_space: true,
        };
        let policy = RetryPolicy::from_settings(&settings);
        assert_eq!(policy.max_retries, 3);
        assert_eq!(policy.backoff(1), Duration::from_millis(500));
        assert_eq!(policy.backoff(2), Duration::from_millis(1000));
        // Capped: 500ms * 2^3 = 4s would exceed the configured 2s ceiling.
        assert_eq!(policy.backoff(4), Duration::from_millis(2000));

        settings.retry_max_delay_ms = 100; // nonsense input
        let policy = RetryPolicy::from_settings(&settings);
        assert!(policy.max_delay >= policy.base_delay);
    }
}

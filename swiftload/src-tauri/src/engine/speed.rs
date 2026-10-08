//! Speed monitor — every number it produces comes from real byte counters.
//!
//! * **Instantaneous speed** is measured over a sliding window: the monitor
//!   keeps `(instant, bytes)` samples and sums the deltas that fall inside
//!   [`DEFAULT_WINDOW`]. When the window has not been filled yet (the first
//!   moments of a download) the rate is computed over the time actually
//!   elapsed, so the display never over-reports.
//! * **Average speed** is `bytes / active_time`. Active time excludes paused
//!   periods, so a download paused for an hour does not show a meaningless
//!   average afterwards.
//! * **Remaining time** is `remaining_bytes / speed`; it is reported as `None`
//!   when no honest estimate exists (speed still zero) instead of guessing.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Sampling window for the instantaneous rate.
pub const DEFAULT_WINDOW: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone)]
struct Sample {
    at: Instant,
    bytes: u64,
}

#[derive(Debug)]
pub struct SpeedMonitor {
    window: Duration,
    samples: VecDeque<Sample>,
    /// Total bytes accounted for this download.
    cumulative: u64,
    /// Bytes transferred during the current active session.
    session_bytes: u64,
    /// Time spent actively transferring, excluding pauses.
    active: Duration,
    /// `Some(t0)` while the transfer is running.
    running_since: Option<Instant>,
    /// Last time bytes were received (drives the stall watchdog).
    last_data_at: Option<Instant>,
}

impl Default for SpeedMonitor {
    fn default() -> Self {
        Self::new(DEFAULT_WINDOW)
    }
}

impl SpeedMonitor {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            samples: VecDeque::with_capacity(64),
            cumulative: 0,
            session_bytes: 0,
            active: Duration::ZERO,
            running_since: None,
            last_data_at: None,
        }
    }

    /// Resumes accounting from a previously persisted total (after a restart).
    pub fn seed(&mut self, cumulative: u64) {
        self.cumulative = cumulative;
    }

    /// Forgets every measurement (used by "restart from scratch").
    pub fn reset(&mut self) {
        self.samples.clear();
        self.cumulative = 0;
        self.session_bytes = 0;
        self.active = Duration::ZERO;
        self.running_since = None;
        self.last_data_at = None;
    }

    /// Marks the start of an active transfer window.
    pub fn start_session(&mut self, now: Instant) {
        if self.running_since.is_none() {
            self.running_since = Some(now);
        }
        self.session_bytes = 0;
        self.samples.clear();
        self.last_data_at = Some(now);
    }

    /// Closes the active window (pause, stop, error) and folds the elapsed time
    /// into the active total.
    pub fn end_session(&mut self, now: Instant) {
        if let Some(started) = self.running_since.take() {
            self.active += now.saturating_duration_since(started);
        }
        self.samples.clear();
    }

    /// Records `bytes` delivered by any connection.
    pub fn record(&mut self, bytes: u64, now: Instant) {
        if bytes == 0 {
            return;
        }
        self.cumulative = self.cumulative.saturating_add(bytes);
        self.session_bytes = self.session_bytes.saturating_add(bytes);
        self.last_data_at = Some(now);
        self.samples.push_back(Sample { at: now, bytes });
        self.prune(now);
    }

    fn prune(&mut self, now: Instant) {
        let cutoff = now.checked_sub(self.window).unwrap_or(now);
        while let Some(front) = self.samples.front() {
            if front.at < cutoff {
                self.samples.pop_front();
            } else {
                break;
            }
        }
    }

    /// Instantaneous rate in bytes/second over the sliding window.
    pub fn speed(&mut self, now: Instant) -> f64 {
        self.prune(now);
        if self.samples.is_empty() || self.running_since.is_none() {
            return 0.0;
        }
        let bytes: u64 = self.samples.iter().map(|s| s.bytes).sum();
        let first = self.samples.front().map(|s| s.at).unwrap_or(now);
        let span = now.saturating_duration_since(first);
        // Use the full window once samples cover it, otherwise the real span.
        let divisor = if span < self.window { span } else { self.window };
        let secs = divisor.as_secs_f64();
        if secs <= 0.0 {
            return 0.0;
        }
        bytes as f64 / secs
    }

    /// Mean rate over the whole (active) lifetime of the download.
    pub fn average(&self, now: Instant) -> f64 {
        let elapsed = self.active_elapsed(now);
        let secs = elapsed.as_secs_f64();
        if secs <= 0.000_001 || self.cumulative == 0 {
            return 0.0;
        }
        self.cumulative as f64 / secs
    }

    pub fn active_elapsed(&self, now: Instant) -> Duration {
        match self.running_since {
            Some(started) => self.active + now.saturating_duration_since(started),
            None => self.active,
        }
    }

    pub fn cumulative(&self) -> u64 {
        self.cumulative
    }

    pub fn session_bytes(&self) -> u64 {
        self.session_bytes
    }

    /// Bytes/sec of the current session (used by the adaptive controller, which
    /// needs to know whether *this* attempt is faster than the previous one).
    pub fn session_speed(&self, now: Instant) -> f64 {
        let elapsed = match self.running_since {
            Some(started) => now.saturating_duration_since(started),
            None => return 0.0,
        };
        let secs = elapsed.as_secs_f64();
        if secs < 0.25 {
            return 0.0;
        }
        self.session_bytes as f64 / secs
    }

    pub fn last_data_at(&self) -> Option<Instant> {
        self.last_data_at
    }

    /// Time since the last received byte, or `None` if nothing was received yet.
    pub fn idle_for(&self, now: Instant) -> Option<Duration> {
        self.last_data_at.map(|at| now.saturating_duration_since(at))
    }

    /// Honest ETA: `None` while no measurement exists.
    pub fn eta_seconds(&mut self, remaining: u64, now: Instant) -> Option<u64> {
        if remaining == 0 {
            return Some(0);
        }
        let speed = self.speed(now);
        let speed = if speed > 1.0 { speed } else { self.average(now) };
        if speed <= 1.0 {
            return None;
        }
        Some((remaining as f64 / speed).ceil() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speed_is_measured_over_the_window() {
        let mut monitor = SpeedMonitor::new(Duration::from_millis(1000));
        let t0 = Instant::now();
        monitor.start_session(t0);
        // 100 KiB every 100 ms == 1 MiB/s after enough window coverage.
        for step in 1..=20 {
            monitor.record(100 * 1024, t0 + Duration::from_millis(step * 100));
        }
        let now = t0 + Duration::from_millis(2000);
        let speed = monitor.speed(now);
        // Window holds the last 10 samples (1 MiB) spread over <= 1 s.
        assert!(speed > 900_000.0 && speed < 1_150_000.0, "unexpected speed {speed}");
    }

    #[test]
    fn speed_decays_to_zero_when_data_stops() {
        let mut monitor = SpeedMonitor::new(Duration::from_millis(1000));
        let t0 = Instant::now();
        monitor.start_session(t0);
        monitor.record(512 * 1024, t0);
        assert!(monitor.speed(t0) > 0.0);
        // Five seconds later, with no further data, the window is empty.
        assert_eq!(monitor.speed(t0 + Duration::from_secs(5)), 0.0);
    }

    #[test]
    fn paused_time_does_not_dilute_the_average() {
        let mut monitor = SpeedMonitor::new(Duration::from_millis(1000));
        let t0 = Instant::now();
        monitor.start_session(t0);
        monitor.record(1_000_000, t0 + Duration::from_secs(1));
        monitor.end_session(t0 + Duration::from_secs(1));
        // 30 s paused...
        monitor.start_session(t0 + Duration::from_secs(31));
        monitor.record(1_000_000, t0 + Duration::from_secs(32));
        monitor.end_session(t0 + Duration::from_secs(32));
        let avg = monitor.average(t0 + Duration::from_secs(40));
        // 2 MiB over 2 s of active time == ~1 MiB/s, not 2 MiB over 32 s.
        assert!(avg > 900_000.0, "average was diluted by paused time: {avg}");
    }

    #[test]
    fn eta_is_none_without_a_measurement() {
        let mut monitor = SpeedMonitor::default();
        let t0 = Instant::now();
        monitor.start_session(t0);
        assert_eq!(monitor.eta_seconds(1000, t0), None);
        monitor.record(1_000_000, t0 + Duration::from_secs(1));
        let eta = monitor.eta_seconds(1_000_000, t0 + Duration::from_secs(1)).unwrap();
        assert!(eta <= 2, "eta {eta}");
    }

    #[test]
    fn idle_tracking_supports_the_stall_watchdog() {
        let mut monitor = SpeedMonitor::default();
        let t0 = Instant::now();
        monitor.start_session(t0);
        assert_eq!(monitor.idle_for(t0 + Duration::from_secs(3)), Some(Duration::from_secs(3)));
        monitor.record(10, t0 + Duration::from_secs(4));
        assert_eq!(monitor.idle_for(t0 + Duration::from_secs(4)), Some(Duration::ZERO));
    }
}

//! Adaptive connection controller.
//!
//! SwiftLoad never "adds connections for speed". It runs a small hill-climbing
//! loop that only keeps a change when the measurement supports it:
//!
//! 1. Start at the configured connection count (default 4).
//! 2. Every [`MIN_INTERVAL`] compare the smoothed throughput with the throughput
//!    measured *before* the previous change.
//! 3. Improvement (`>= +5 %`) → try one more connection, up to the configured
//!    maximum. The marginal connection also has to have enough work: a segment
//!    must be at least `min_segment_bytes`, otherwise splitting it costs more
//!    than it gains.
//! 4. Regression (`<= -5 %`) → give the connection back and stop pushing in that
//!    direction for a while (prevents oscillation).
//! 5. Server pressure (more than 15 % of responses failing) → reduce.
//! 6. A congested link (average per-connection throughput below 32 KiB/s) → fall
//!    back to a single connection, because more sockets cannot create bandwidth
//!    that the network does not have.
//!
//! All thresholds are conservative on purpose: an unreliable "boost" is worse
//! than a steady connection count.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Shortest interval between two connection-count changes.
pub const MIN_INTERVAL: Duration = Duration::from_secs(10);
/// Relative improvement/regression that counts as a signal.
pub const SIGNIFICANCE: f64 = 0.05;
/// Throughput per connection below which the link itself is the bottleneck.
pub const CONGESTED_PER_CONNECTION: f64 = 32.0 * 1024.0;
/// Fraction of failed responses that makes the controller back off.
pub const ERROR_RATE_LIMIT: f64 = 0.15;
/// Smoothed samples kept for the comparison.
const SAMPLE_WINDOW: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdaptiveDecision {
    /// Keep the current connection count.
    Hold,
    /// Add one connection (the caller must have an incomplete segment to split).
    Increase,
    /// Remove one connection.
    Decrease,
}

#[derive(Debug)]
pub struct AdaptiveController {
    enabled: bool,
    /// Connection count the engine should currently run.
    current: u32,
    min: u32,
    max: u32,
    last_change: Instant,
    /// Throughput observed just before the last change (0.0 before any change).
    baseline: f64,
    /// Direction of the last accepted change: +1 grew, -1 shrank, 0 steady.
    direction: i8,
    samples: VecDeque<f64>,
    requests: u32,
    failures: u32,
    /// Set when a decrease happened: do not grow again until the throughput
    /// proves stable for a whole interval.
    cooldown_until: Option<Instant>,
}

impl AdaptiveController {
    pub fn new(enabled: bool, initial: u32, max: u32) -> Self {
        let initial = initial.clamp(1, max.max(1));
        Self {
            enabled,
            current: initial,
            min: 1,
            max: max.max(1),
            last_change: Instant::now(),
            baseline: 0.0,
            direction: 0,
            samples: VecDeque::with_capacity(SAMPLE_WINDOW),
            requests: 0,
            failures: 0,
            cooldown_until: None,
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn connections(&self) -> u32 {
        self.current
    }

    pub fn set_connections(&mut self, value: u32) {
        self.current = value.clamp(self.min, self.max);
    }

    pub fn max(&self) -> u32 {
        self.max
    }

    /// Records one throughput sample (bytes/second of the whole download).
    pub fn observe(&mut self, speed_bps: f64) {
        if !speed_bps.is_finite() || speed_bps <= 0.0 {
            return;
        }
        if self.samples.len() == SAMPLE_WINDOW {
            self.samples.pop_front();
        }
        self.samples.push_back(speed_bps);
    }

    /// Records the outcome of one HTTP request/response cycle.
    pub fn note_request(&mut self, failed: bool) {
        self.requests = self.requests.saturating_add(1);
        if failed {
            self.failures = self.failures.saturating_add(1);
        }
    }

    /// Smoothed throughput of the current window.
    pub fn smoothed(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        self.samples.iter().sum::<f64>() / self.samples.len() as f64
    }

    /// Evaluates whether the connection count should change.
    ///
    /// * `remaining` — bytes still to download;
    /// * `min_segment_bytes` — smallest segment the caller is willing to create.
    pub fn decide(&mut self, now: Instant, remaining: u64, min_segment_bytes: u64) -> AdaptiveDecision {
        if !self.enabled {
            return AdaptiveDecision::Hold;
        }
        let smoothed = self.smoothed();
        if smoothed <= 0.0 {
            return AdaptiveDecision::Hold;
        }

        let elapsed = now.saturating_duration_since(self.last_change);
        if elapsed < MIN_INTERVAL {
            return AdaptiveDecision::Hold;
        }

        // Reset the error window every decision so it reflects recent behaviour.
        let error_rate = if self.requests == 0 {
            0.0
        } else {
            self.failures as f64 / self.requests as f64
        };

        // 1. Server pressure: back off regardless of speed.
        if error_rate > ERROR_RATE_LIMIT && self.current > self.min {
            self.accept_change(now, -1, smoothed);
            return AdaptiveDecision::Decrease;
        }

        // 1b. Congested link: more sockets cannot create bandwidth.
        let per_connection = smoothed / self.current.max(1) as f64;
        if per_connection < CONGESTED_PER_CONNECTION && self.current > self.min {
            self.accept_change(now, -1, smoothed);
            return AdaptiveDecision::Decrease;
        }

        match self.direction {
            // 2. We are growing: did the last change help?
            1 => {
                if smoothed >= self.baseline * (1.0 + SIGNIFICANCE) {
                    self.accept_change(now, 1, smoothed);
                    return AdaptiveDecision::Increase;
                }
                if smoothed <= self.baseline * (1.0 - SIGNIFICANCE) {
                    self.accept_change(now, -1, smoothed);
                    return AdaptiveDecision::Decrease;
                }
                self.direction = 0;
                self.cooldown_until = Some(now + MIN_INTERVAL);
                self.last_change = now;
                self.baseline = smoothed;
                AdaptiveDecision::Hold
            }
            // 3. We just shrank: only grow again on clear evidence, and never
            //    twice in a row.
            -1 => {
                let cooled = self.cooldown_until.map(|at| now >= at).unwrap_or(true);
                if cooled && smoothed >= self.baseline * (1.0 + SIGNIFICANCE) {
                    self.accept_change(now, 1, smoothed);
                    return AdaptiveDecision::Increase;
                }
                self.baseline = smoothed;
                self.last_change = now;
                AdaptiveDecision::Hold
            }
            // 4. Steady: try to grow when there is enough work left for another
            //    full segment.
            _ => {
                let room_for_more = self.current < self.max;
                let enough_work = remaining
                    >= min_segment_bytes
                        .saturating_mul(self.current as u64 + 1)
                        / self.current.max(1) as u64;
                if room_for_more && enough_work && error_rate <= ERROR_RATE_LIMIT {
                    self.accept_change(now, 1, smoothed);
                    return AdaptiveDecision::Increase;
                }
                self.last_change = now;
                self.baseline = smoothed;
                AdaptiveDecision::Hold
            }
        }
    }

    fn accept_change(&mut self, now: Instant, direction: i8, smoothed: f64) {
        if direction > 0 && self.current < self.max {
            self.current += 1;
        } else if direction < 0 && self.current > self.min {
            self.current -= 1;
        }
        self.baseline = smoothed;
        self.last_change = now;
        self.direction = direction;
        self.requests = 0;
        self.failures = 0;
        self.cooldown_until = if direction < 0 {
            Some(now + MIN_INTERVAL)
        } else {
            None
        };
    }

    /// Human-readable state, for the log and the diagnostics panel.
    pub fn describe(&self) -> String {
        format!(
            "connections={} direction={} smoothed={:.0} B/s baseline={:.0} B/s errors={}/{}",
            self.current,
            self.direction,
            self.smoothed(),
            self.baseline,
            self.failures,
            self.requests
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn controller() -> AdaptiveController {
        AdaptiveController::new(true, 4, 8)
    }

    #[test]
    fn disabled_controller_never_changes() {
        let mut controller = AdaptiveController::new(false, 4, 8);
        let start = Instant::now();
        controller.observe(10_000_000.0);
        assert_eq!(
            controller.decide(start + Duration::from_secs(60), 10u64 << 30, 1024),
            AdaptiveDecision::Hold
        );
        assert_eq!(controller.connections(), 4);
    }

    #[test]
    fn waits_for_the_minimum_interval() {
        let mut controller = controller();
        let start = Instant::now();
        controller.observe(1_000_000.0);
        assert_eq!(controller.decide(start, 1u64 << 30, 1024), AdaptiveDecision::Hold);
        assert_eq!(controller.connections(), 4);
    }

    #[test]
    fn grows_while_throughput_improves_and_stops_at_the_maximum() {
        let mut controller = controller();
        let mut now = Instant::now();
        controller.observe(1_000_000.0); // steady baseline
        // First decision: steady -> try one more connection.
        now += MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(
            controller.decide(now, 100u64 << 20, 1024 * 1024),
            AdaptiveDecision::Increase
        );
        assert_eq!(controller.connections(), 5);

        // Throughput improved: keep growing.
        controller.observe(2_000_000.0);
        now += MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(
            controller.decide(now, 100u64 << 20, 1024 * 1024),
            AdaptiveDecision::Increase
        );
        // ... up to the configured maximum.
        for _ in 0..10 {
            controller.observe(5_000_000.0);
            now += MIN_INTERVAL + Duration::from_millis(1);
            controller.decide(now, 100u64 << 20, 1024 * 1024);
        }
        assert_eq!(controller.connections(), 8);
    }

    #[test]
    fn reverts_when_throughput_regresses() {
        let mut controller = controller();
        let mut now = Instant::now();
        controller.observe(1_000_000.0);
        now += MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(
            controller.decide(now, 100u64 << 20, 1024),
            AdaptiveDecision::Increase
        );
        // Much slower after adding a connection: give it back.
        controller.observe(500_000.0);
        now += MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(
            controller.decide(now, 100u64 << 20, 1024),
            AdaptiveDecision::Decrease
        );
        assert_eq!(controller.connections(), 4);
    }

    #[test]
    fn refuses_to_split_without_enough_work_left() {
        let mut controller = controller();
        let mut now = Instant::now();
        controller.observe(1_000_000.0);
        now += MIN_INTERVAL + Duration::from_millis(1);
        // 1 MiB left, 4 MiB minimum segment: adding a connection is pointless.
        assert_eq!(
            controller.decide(now, 1024 * 1024, 4 * 1024 * 1024),
            AdaptiveDecision::Hold
        );
        assert_eq!(controller.connections(), 4);
    }

    #[test]
    fn backs_off_on_server_errors() {
        let mut controller = controller();
        let mut now = Instant::now();
        controller.observe(4_000_000.0);
        for _ in 0..10 {
            controller.note_request(true);
        }
        controller.note_request(false);
        now += MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(
            controller.decide(now, 100u64 << 20, 1024),
            AdaptiveDecision::Decrease
        );
        assert_eq!(controller.connections(), 3);
    }

    #[test]
    fn congested_link_falls_back_to_one_connection() {
        let mut controller = controller();
        let mut now = Instant::now();
        // 60 KiB/s across 4 connections == 15 KiB/s each: the link is the limit.
        controller.observe(60.0 * 1024.0);
        for _ in 0..10 {
            now += MIN_INTERVAL + Duration::from_millis(1);
            controller.decide(now, 100u64 << 20, 1024);
        }
        assert_eq!(controller.connections(), 1, "{}", controller.describe());
    }

    #[test]
    fn never_goes_below_one_or_above_the_maximum() {
        let mut controller = AdaptiveController::new(true, 1, 1);
        let mut now = Instant::now();
        controller.observe(1.0);
        for _ in 0..5 {
            now += MIN_INTERVAL + Duration::from_millis(1);
            assert_eq!(controller.decide(now, 100u64 << 20, 1024), AdaptiveDecision::Hold);
        }
        assert_eq!(controller.connections(), 1);

        let mut controller = AdaptiveController::new(true, 8, 8);
        controller.observe(1_000_000.0);
        now += MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(controller.decide(now, 1u64 << 40, 1024), AdaptiveDecision::Hold);
        assert_eq!(controller.connections(), 8);
    }

    #[test]
    fn ignores_nonsense_measurements() {
        let mut controller = controller();
        controller.observe(f64::NAN);
        controller.observe(-5.0);
        controller.observe(0.0);
        assert_eq!(controller.smoothed(), 0.0);
        assert_eq!(
            controller.decide(Instant::now() + Duration::from_secs(60), 1 << 30, 1024),
            AdaptiveDecision::Hold
        );
    }
}

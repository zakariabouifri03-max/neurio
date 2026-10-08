//! Small dependency-free helpers shared across the backend.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Monotonic counter guaranteeing uniqueness of [`random_id`] within a process.
static COUNTER: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
/// Per-process PRNG state (xorshift64*), seeded from the clock and the pid.
static STATE: AtomicU64 = AtomicU64::new(0);

fn seed() -> u64 {
    let mut s = STATE.load(Ordering::Relaxed);
    if s == 0 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x1234_5678);
        s = nanos ^ (std::process::id() as u64).wrapping_mul(0x2545_F491_4F6C_DD1D);
        if s == 0 {
            s = 0xBAD_C0FFEE;
        }
        STATE.store(s, Ordering::Relaxed);
    }
    s
}

/// A short, collision-resistant identifier (16 hex chars) used for download IDs.
///
/// This is deliberately *not* a cryptographic generator: IDs are local database
/// keys, never secrets. Entropy comes from the clock, the pid and a counter.
pub fn random_id() -> String {
    let mut x = seed();
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    STATE.store(x, Ordering::Relaxed);
    let counter = COUNTER.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
    let mixed = x ^ counter.rotate_left(31);
    format!("{:016x}", mixed)
}

/// Locks a mutex, recovering from poisoning.
///
/// A panic in an unrelated task must not turn a shared resource into a
/// permanently unusable one: the data behind these mutexes (download records,
/// segment lists) is plain data with no invariants that a panic could break.
pub fn lock<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Standard base64 (RFC 4648) encoder.
///
/// Used for `Authorization: Basic` when a download URL embeds credentials.
/// Implemented here rather than pulling in a dependency for ~15 lines.
pub fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Clamps `value` into `min..=max`.
pub fn clamp<T: PartialOrd>(value: T, min: T, max: T) -> T {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

/// Human-readable byte count for log lines and diagnostics.
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

/// Human-readable transfer rate for log lines.
pub fn human_rate(bytes_per_sec: f64) -> String {
    if !bytes_per_sec.is_finite() || bytes_per_sec <= 0.0 {
        return "0 B/s".to_string();
    }
    format!("{}/s", human_bytes(bytes_per_sec as u64))
}

/// Renders a duration as `1h 02m 03s` / `4m 12s` / `12s`.
pub fn human_duration(seconds: u64) -> String {
    let (h, m, s) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    if h > 0 {
        format!("{h}h {m:02}m {s:02}s")
    } else if m > 0 {
        format!("{m}m {s:02}s")
    } else {
        format!("{s}s")
    }
}

/// Folds a value into `0.0..=1.0` for progress ratios.
pub fn ratio(done: u64, total: u64) -> f64 {
    if total == 0 {
        1.0
    } else {
        (done as f64 / total as f64).clamp(0.0, 1.0)
    }
}

/// Formats an `f64` for logs without printing `NaN`/`inf`.
pub fn fmt_f64(value: f64, decimals: usize) -> String {
    if value.is_finite() {
        format!("{value:.decimals$}")
    } else {
        "n/a".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_hex() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..10_000 {
            let id = random_id();
            assert_eq!(id.len(), 16);
            assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(seen.insert(id), "duplicate id generated");
        }
    }

    #[test]
    fn byte_formatting() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(1024), "1.00 KB");
        assert_eq!(human_bytes(1024 * 1024 * 3 / 2), "1.50 MB");
        assert_eq!(human_rate(0.0), "0 B/s");
    }

    #[test]
    fn duration_formatting() {
        assert_eq!(human_duration(9), "9s");
        assert_eq!(human_duration(252), "4m 12s");
        assert_eq!(human_duration(3723), "1h 02m 03s");
    }

    #[test]
    fn base64_encodes() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"user:pa$$"), "dXNlcjpwYSQk");
    }

    #[test]
    fn ratio_is_bounded() {
        assert_eq!(ratio(0, 0), 1.0);
        assert_eq!(ratio(5, 10), 0.5);
        assert_eq!(ratio(20, 10), 1.0);
    }
}

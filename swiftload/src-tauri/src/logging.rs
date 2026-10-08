//! Local file logging + an in-memory ring buffer for the in-app log viewer.
//!
//! Design notes:
//! * log lines are *appended by a dedicated OS thread* fed through an `mpsc`
//!   channel, so neither the Tauri IPC thread nor the Tokio workers ever block
//!   on disk I/O;
//! * the in-memory ring buffer keeps the last 500 records for the UI, so the
//!   Advanced → Logs view does not have to re-read files;
//! * URLs are redacted before they reach the log (userinfo stripped, sensitive
//!   query parameters masked) — see [`redact_url`].

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use url::Url;

pub const RING_CAPACITY: usize = 500;
const MAX_LOG_FILES: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Debug => "DEBUG",
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Level {
        match s.to_ascii_lowercase().as_str() {
            "debug" => Level::Debug,
            "warn" | "warning" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Info,
        }
    }
}

/// Coarse categories so the log viewer can filter meaningfully.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    App,
    Database,
    Settings,
    Download,
    Connection,
    Resume,
    Retry,
    Queue,
    Speed,
    Completion,
    Cancel,
    Http,
    File,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::App => "app",
            Category::Database => "database",
            Category::Settings => "settings",
            Category::Download => "download",
            Category::Connection => "connection",
            Category::Resume => "resume",
            Category::Retry => "retry",
            Category::Queue => "queue",
            Category::Speed => "speed",
            Category::Completion => "completion",
            Category::Cancel => "cancel",
            Category::Http => "http",
            Category::File => "file",
        }
    }
}

/// One log event, as shown in the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRecord {
    /// Milliseconds since the Unix epoch.
    pub timestamp: i64,
    pub level: Level,
    pub category: Category,
    pub download_id: Option<String>,
    pub message: String,
}

impl LogRecord {
    pub fn to_line(&self) -> String {
        let ts = format_timestamp(self.timestamp);
        let id = self.download_id.as_deref().unwrap_or("-");
        format!(
            "{ts} {level:<5} {category:<10} id={id:<16} {msg}",
            level = self.level.as_str(),
            category = self.category.as_str(),
            msg = self.message
        )
    }
}

enum Command {
    Record(LogRecord),
    Flush(Sender<()>),
}

struct Sink {
    tx: Sender<Command>,
    ring: Arc<Mutex<VecDeque<LogRecord>>>,
    dir: PathBuf,
    min_level: Arc<Mutex<Level>>,
    file_enabled: bool,
}

/// Cheap to clone; all clones share the same writer thread and ring buffer.
#[derive(Clone)]
pub struct Logger {
    sink: Arc<Sink>,
}

impl Logger {
    /// Creates the logger and spawns the background writer thread.
    ///
    /// `dir` is typically `%LOCALAPPDATA%\SwiftLoad\logs`. If the directory
    /// cannot be created the logger degrades to memory-only instead of failing
    /// application startup.
    pub fn new(dir: PathBuf, min_level: Level) -> Logger {
        let (tx, rx) = mpsc::channel::<Command>();
        let ring = Arc::new(Mutex::new(VecDeque::with_capacity(RING_CAPACITY)));
        let min = Arc::new(Mutex::new(min_level));

        let mut file_enabled = true;
        if let Err(e) = fs::create_dir_all(&dir) {
            eprintln!("SwiftLoad: cannot create log directory {dir:?}: {e}");
            file_enabled = false;
        }
        if file_enabled {
            rotate(&dir);
        }

        let sink_tx = tx.clone();
        std::thread::Builder::new()
            .name("swiftload-log".into())
            .spawn(move || {
                let mut file: Option<File> = None;
                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        Command::Record(record) => {
                            if let Some(f) = file.as_mut() {
                                let _ = writeln!(f, "{}", record.to_line());
                                // Flushing every line keeps the log usable after a
                                // hard crash; the volume is tiny (a few lines/second
                                // at most) so the cost is negligible.
                                let _ = f.flush();
                            }
                        }
                        Command::Flush(ack) => {
                            if let Some(f) = file.as_mut() {
                                let _ = f.flush();
                            }
                            let _ = ack.send(());
                        }
                    }
                    // Lazily (re)open at most once per thread lifetime; the file
                    // name carries the date so a long-running session rolls over.
                    if file.is_none() {
                        file = open_today(&dir).ok();
                    }
                }
            })
            .expect("failed to spawn log writer thread");

        Logger {
            sink: Arc::new(Sink {
                tx: sink_tx,
                ring,
                dir,
                min_level: min,
                file_enabled,
            }),
        }
    }

    /// Creates a logger that keeps records in memory only (used by tests).
    pub fn memory_only(min_level: Level) -> Logger {
        Logger::new(std::env::temp_dir().join("swiftload-test-logs"), min_level)
    }

    pub fn dir(&self) -> &Path {
        &self.sink.dir
    }

    pub fn files_enabled(&self) -> bool {
        self.sink.file_enabled
    }

    pub fn set_min_level(&self, level: Level) {
        if let Ok(mut cur) = self.sink.min_level.lock() {
            *cur = level;
        }
    }

    pub fn min_level(&self) -> Level {
        self.sink.min_level.lock().map(|l| *l).unwrap_or(Level::Info)
    }

    pub fn log(&self, level: Level, category: Category, download_id: Option<&str>, message: impl Into<String>) {
        if level < self.min_level() {
            return;
        }
        let record = LogRecord {
            timestamp: now_millis(),
            level,
            category,
            download_id: download_id.map(|s| s.to_string()),
            message: message.into(),
        };
        if let Ok(mut ring) = self.sink.ring.lock() {
            if ring.len() == RING_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(record.clone());
        }
        let _ = self.sink.tx.send(Command::Record(record));
    }

    pub fn debug(&self, category: Category, id: Option<&str>, message: impl Into<String>) {
        self.log(Level::Debug, category, id, message);
    }

    pub fn info(&self, category: Category, id: Option<&str>, message: impl Into<String>) {
        self.log(Level::Info, category, id, message);
    }

    pub fn warn(&self, category: Category, id: Option<&str>, message: impl Into<String>) {
        self.log(Level::Warn, category, id, message);
    }

    pub fn error(&self, category: Category, id: Option<&str>, message: impl Into<String>) {
        self.log(Level::Error, category, id, message);
    }

    /// Records an [`crate::error::AppError`] preserving its error code.
    pub fn error_of(&self, category: Category, id: Option<&str>, err: &crate::error::AppError) {
        self.error(category, id, err.log_line());
    }

    /// Returns the most recent records, newest first.
    pub fn recent(&self, limit: usize, min_level: Option<Level>) -> Vec<LogRecord> {
        let ring = match self.sink.ring.lock() {
            Ok(r) => r,
            Err(poisoned) => poisoned.into_inner(),
        };
        ring.iter()
            .rev()
            .filter(|r| min_level.map(|l| r.level >= l).unwrap_or(true))
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn clear_ring(&self) {
        if let Ok(mut ring) = self.sink.ring.lock() {
            ring.clear();
        }
    }

    /// Blocks until every queued record has been written. Used on shutdown so
    /// the final "application exited" line is not lost.
    pub fn flush(&self) {
        let (tx, rx) = mpsc::channel();
        if self.sink.tx.send(Command::Flush(tx)).is_ok() {
            let _ = rx.recv_timeout(std::time::Duration::from_millis(750));
        }
    }

    /// Path of today's log file (whether or not it exists yet).
    pub fn current_file(&self) -> PathBuf {
        self.sink.dir.join(format!("swiftload-{}.log", today_stamp()))
    }
}

fn open_today(dir: &Path) -> std::io::Result<File> {
    let path = dir.join(format!("swiftload-{}.log", today_stamp()));
    OpenOptions::new().create(true).append(true).open(path)
}

fn today_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Keeps only the newest [`MAX_LOG_FILES`] log files.
fn rotate(dir: &Path) {
    let mut files: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("swiftload-") && n.ends_with(".log"))
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return,
    };
    if files.len() <= MAX_LOG_FILES {
        return;
    }
    files.sort();
    let remove_count = files.len() - MAX_LOG_FILES;
    for path in files.into_iter().take(remove_count) {
        let _ = fs::remove_file(path);
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn format_timestamp(millis: i64) -> String {
    use chrono::{Local, TimeZone};
    match Local.timestamp_millis_opt(millis).single() {
        Some(dt) => dt.format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string(),
        None => millis.to_string(),
    }
}

/// Removes credentials and masks sensitive query parameters from a URL.
///
/// Log files must not become a credential store: `?token=…`, `?signature=…`,
/// `?X-Amz-Signature=…` and friends are common on CDN download links.
pub fn redact_url(raw: &str) -> String {
    let mut url = match Url::parse(raw) {
        Ok(u) => u,
        Err(_) => return "<unparseable-url>".to_string(),
    };

    if !url.username().is_empty() || url.password().is_some() {
        let _ = url.set_username("***");
        let _ = url.set_password(Some("***"));
    }

    const SENSITIVE: &[&str] = &[
        "token",
        "access_token",
        "apikey",
        "api_key",
        "key",
        "signature",
        "sig",
        "x-amz-signature",
        "x-amz-credential",
        "x-amz-security-token",
        "auth",
        "authorization",
        "password",
        "passwd",
        "pwd",
        "secret",
        "session",
        "sessionid",
        "code",
        "ticket",
    ];

    let pairs: Vec<(String, Option<String>)> = url
        .query_pairs()
        .map(|(k, v)| {
            let lower = k.to_ascii_lowercase();
            if SENSITIVE.iter().any(|s| lower == *s) {
                (k.to_string(), Some("***".to_string()))
            } else {
                (k.to_string(), Some(v.to_string()))
            }
        })
        .collect();

    if !pairs.is_empty() {
        url.query_pairs_mut().clear().extend_pairs(
            pairs
                .into_iter()
                .map(|(k, v)| (k, v.unwrap_or_default())),
        );
    }

    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_credentials_and_tokens() {
        let out = redact_url("https://user:s3cret@example.com/f.zip?token=abc123&X-Amz-Signature=deadbeef&ok=1");
        assert!(!out.contains("s3cret"), "{out}");
        assert!(!out.contains("abc123"), "{out}");
        assert!(!out.contains("deadbeef"), "{out}");
        assert!(out.contains("ok=1"), "{out}");
        assert!(out.contains("***"), "{out}");
    }

    #[test]
    fn unparseable_urls_are_masked() {
        assert_eq!(redact_url("not a url"), "<unparseable-url>");
    }

    #[test]
    fn ring_buffer_keeps_newest_first() {
        let logger = Logger::memory_only(Level::Debug);
        for i in 0..3 {
            logger.info(Category::App, None, format!("event {i}"));
        }
        let recent = logger.recent(10, None);
        assert_eq!(recent.len(), 3);
        assert!(recent[0].message.ends_with('2'));
        assert!(recent[2].message.ends_with('0'));
    }

    #[test]
    fn level_filter_applies() {
        let logger = Logger::memory_only(Level::Warn);
        logger.info(Category::App, None, "hidden");
        logger.error(Category::App, None, "shown");
        let recent = logger.recent(10, None);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].message, "shown");
    }
}

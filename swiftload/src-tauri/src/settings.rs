//! Application settings.
//!
//! Persisted one-row-per-key in the SQLite `settings` table (see
//! [`crate::db::settings`]). Loading is *forward compatible*: unknown keys are
//! ignored, missing keys fall back to the defaults, and values whose JSON type
//! does not match the declared type are discarded with a warning rather than
//! crashing the application.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::Database;
use crate::error::{AppError, Result};
use crate::logging::{Category, Level, Logger};
use crate::util::clamp;

/// Theme selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

impl Theme {
    pub fn as_str(self) -> &'static str {
        match self {
            Theme::Dark => "dark",
            Theme::Light => "light",
            Theme::System => "system",
        }
    }
}

/// How to reach the network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    /// No proxy at all (direct connections only).
    Off,
    /// Use the Windows/registry proxy configuration.
    System,
    /// Use [`AppSettings::proxy_url`].
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub default_download_dir: String,
    pub start_with_windows: bool,
    pub notifications: bool,
    pub confirm_before_delete: bool,
    pub theme: Theme,
    pub compact_mode: bool,
    /// Watch the clipboard for URLs and offer them in the New Download dialog.
    pub clipboard_watch: bool,
    /// Bring the window to the front when a download finishes (only when the
    /// user enabled notifications).
    pub focus_on_complete: bool,
    pub language: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    /// Maximum number of downloads transferring at the same time.
    pub max_concurrent: u32,
    /// Default connection count for a new download (fragmented servers only).
    pub connections_per_download: u32,
    /// Upper bound the adaptive controller may reach.
    pub max_connections_per_download: u32,
    /// Let the engine grow/shrink the connection count while downloading.
    pub adaptive_connections: bool,
    /// Never create a segment smaller than this.
    pub min_segment_bytes: u64,
    pub max_retries: u32,
    pub retry_delay_ms: u64,
    pub retry_max_delay_ms: u64,
    /// `None` = unlimited.
    pub speed_limit_bps: Option<u64>,
    /// Re-download a segment when its resume boundary fails validation.
    pub verify_on_resume: bool,
    /// Keep `.part` files when a download is cancelled.
    pub keep_partial_files: bool,
    /// Compare the fine-grained per-segment integrity markers after finishing.
    pub verify_ranges: bool,
    /// Compute and store a SHA-256 for every finished file (slower, stronger).
    pub compute_sha256: bool,
    /// Ask before starting a download that does not fit on the target volume.
    pub check_free_space: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub connect_timeout_ms: u64,
    /// Abort a transfer that receives no bytes for this long. `0` disables the
    /// watchdog. This is deliberately separate from a whole-request timeout:
    /// a global request timeout would kill legitimate multi-hour downloads.
    pub stall_timeout_ms: u64,
    pub proxy_mode: ProxyMode,
    pub proxy_url: String,
    /// Comma separated hosts/CIDRs that bypass the proxy.
    pub no_proxy: String,
    pub user_agent: String,
    pub max_redirects: u32,
    /// Force HTTP/1.1 (some servers mis-handle HTTP/2 with large ranges).
    pub http1_only: bool,
    /// Number of idle connections kept per host.
    pub pool_idle_per_host: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSettings {
    pub log_level: Level,
    /// `None`/empty = store temporary files next to the target file.
    pub temp_dir: String,
    /// UI refresh interval for progress events, in milliseconds.
    pub ui_refresh_ms: u64,
    /// How often resumable state is checkpointed to disk.
    pub checkpoint_interval_ms: u64,
    /// Size of the per-connection write buffer.
    pub write_buffer_bytes: u64,
    /// Apply the OS "sparse file" attribute to preallocated files.
    pub sparse_files: bool,
    /// Push a desktop notification when a download completes.
    pub notify_on_complete: bool,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            log_level: Level::Info,
            temp_dir: String::new(),
            ui_refresh_ms: 250,
            checkpoint_interval_ms: 2000,
            write_buffer_bytes: 256 * 1024,
            sparse_files: true,
            notify_on_complete: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub downloads: DownloadSettings,
    pub network: NetworkSettings,
    pub advanced: AdvancedSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            general: GeneralSettings {
                default_download_dir: String::new(),
                start_with_windows: false,
                notifications: true,
                confirm_before_delete: true,
                theme: Theme::Dark,
                compact_mode: false,
                clipboard_watch: false,
                focus_on_complete: true,
                language: "en".to_string(),
            },
            downloads: DownloadSettings {
                max_concurrent: 3,
                connections_per_download: 4,
                max_connections_per_download: 16,
                adaptive_connections: true,
                min_segment_bytes: 4 * 1024 * 1024,
                max_retries: 5,
                retry_delay_ms: 1000,
                retry_max_delay_ms: 60_000,
                speed_limit_bps: None,
                verify_on_resume: true,
                keep_partial_files: true,
                verify_ranges: true,
                compute_sha256: false,
                check_free_space: true,
            },
            network: NetworkSettings {
                connect_timeout_ms: 15_000,
                stall_timeout_ms: 60_000,
                proxy_mode: ProxyMode::System,
                proxy_url: String::new(),
                no_proxy: String::new(),
                user_agent: format!("SwiftLoad/{} (+https://github.com/zakariabouifri03-max/neurio)", env!("CARGO_PKG_VERSION")),
                max_redirects: 10,
                http1_only: false,
                pool_idle_per_host: 8,
            },
            advanced: AdvancedSettings::default(),
        }
    }
}

impl AppSettings {
    /// Loads settings, filling in `default_dir` for a first run.
    pub fn load(db: &Database, logger: &Logger, default_dir: &Path) -> Result<AppSettings> {
        let mut settings = AppSettings::default();
        if settings.general.default_download_dir.trim().is_empty() {
            settings.general.default_download_dir = default_dir.to_string_lossy().to_string();
        }

        let stored = db.all_settings()?;
        if stored.is_empty() {
            // First run: persist the defaults so the file is inspectable.
            settings.sanitize();
            settings.save(db, logger)?;
            return Ok(settings);
        }

        let merged = merge_json(serde_json::to_value(&settings)?, Value::Object(stored), logger);
        match serde_json::from_value::<AppSettings>(merged) {
            Ok(parsed) => {
                settings = parsed;
            }
            Err(e) => {
                logger.warn(
                    Category::Settings,
                    None,
                    format!("stored settings could not be parsed, using defaults: {e}"),
                );
            }
        }
        if settings.general.default_download_dir.trim().is_empty() {
            settings.general.default_download_dir = default_dir.to_string_lossy().to_string();
        }
        settings.sanitize();
        Ok(settings)
    }

    /// Writes every field back, one row per setting.
    pub fn save(&self, db: &Database, logger: &Logger) -> Result<()> {
        let value = serde_json::to_value(self).map_err(|e| AppError::Server(e.to_string()))?;
        let map = match value {
            Value::Object(map) => map,
            _ => return Err(AppError::Server("settings did not serialise to an object".into())),
        };
        let mut entries = Vec::new();
        for (section, section_value) in map {
            let fields = match section_value {
                Value::Object(fields) => fields,
                other => {
                    entries.push((section, other));
                    continue;
                }
            };
            for (key, field) in fields {
                entries.push((format!("{section}.{key}"), field));
            }
        }
        db.set_settings(&entries)?;
        logger.debug(
            Category::Settings,
            None,
            format!("saved {} settings", entries.len()),
        );
        Ok(())
    }

    /// Clamps every value into a range the engine can actually honour.
    ///
    /// Settings are user input from a *UI*: treating them as trusted would let a
    /// typo (e.g. 100000 connections) create thousands of sockets.
    pub fn sanitize(&mut self) {
        let d = &mut self.downloads;
        d.max_concurrent = clamp(d.max_concurrent, 1, 16);
        d.connections_per_download = clamp(d.connections_per_download, 1, 32);
        d.max_connections_per_download = clamp(d.max_connections_per_download, d.connections_per_download, 32);
        d.min_segment_bytes = clamp(d.min_segment_bytes, 256 * 1024, 512 * 1024 * 1024);
        d.max_retries = clamp(d.max_retries, 0, 20);
        d.retry_delay_ms = clamp(d.retry_delay_ms, 100, 300_000);
        d.retry_max_delay_ms = clamp(d.retry_max_delay_ms, d.retry_delay_ms, 3_600_000);
        if let Some(limit) = d.speed_limit_bps {
            d.speed_limit_bps = Some(clamp(limit, 1024, 10 * 1024 * 1024 * 1024));
        }

        let n = &mut self.network;
        n.connect_timeout_ms = clamp(n.connect_timeout_ms, 1_000, 600_000);
        n.stall_timeout_ms = if n.stall_timeout_ms == 0 {
            0
        } else {
            clamp(n.stall_timeout_ms, 5_000, 3_600_000)
        };
        n.max_redirects = clamp(n.max_redirects, 0, 30);
        n.pool_idle_per_host = clamp(n.pool_idle_per_host, 0, 64);
        n.user_agent = n.user_agent.trim().to_string();
        if n.user_agent.is_empty() {
            n.user_agent = AppSettings::default().network.user_agent;
        }
        n.user_agent = n.user_agent.chars().take(256).collect();
        n.proxy_url = n.proxy_url.trim().to_string();
        if !n.proxy_url.is_empty() && crate::net::validate_url(&n.proxy_url).is_err() {
            // Invalid proxy URL: fall back to the system proxy instead of
            // handing reqwest something it will reject at request time.
            n.proxy_mode = ProxyMode::System;
            n.proxy_url.clear();
        }

        let a = &mut self.advanced;
        a.ui_refresh_ms = clamp(a.ui_refresh_ms, 100, 5_000);
        a.checkpoint_interval_ms = clamp(a.checkpoint_interval_ms, 500, 60_000);
        a.write_buffer_bytes = clamp(a.write_buffer_bytes, 32 * 1024, 4 * 1024 * 1024);

        if self.general.language.trim().is_empty() {
            self.general.language = "en".to_string();
        }
    }

    pub fn default_download_dir_path(&self) -> PathBuf {
        PathBuf::from(&self.general.default_download_dir)
    }

    pub fn stall_timeout(&self) -> Option<std::time::Duration> {
        if self.network.stall_timeout_ms == 0 {
            None
        } else {
            Some(std::time::Duration::from_millis(self.network.stall_timeout_ms))
        }
    }

    pub fn connect_timeout(&self) -> std::time::Duration {
        std::time::Duration::from_millis(self.network.connect_timeout_ms)
    }

    pub fn ui_refresh(&self) -> std::time::Duration {
        std::time::Duration::from_millis(self.advanced.ui_refresh_ms)
    }

    pub fn checkpoint_interval(&self) -> std::time::Duration {
        std::time::Duration::from_millis(self.advanced.checkpoint_interval_ms)
    }
}

/// Recursively overlays stored values onto the defaults, keeping the default
/// whenever a stored value has an incompatible JSON type.
fn merge_json(defaults: Value, stored: Value, logger: &Logger) -> Value {
    match (defaults, stored) {
        (Value::Object(mut defaults), Value::Object(stored)) => {
            for (key, stored_value) in stored {
                match defaults.remove(&key) {
                    Some(default_value) => {
                        let merged = merge_json(default_value, stored_value, logger);
                        defaults.insert(key, merged);
                    }
                    None => {
                        logger.debug(
                            Category::Settings,
                            None,
                            format!("ignoring unknown setting '{key}'"),
                        );
                    }
                }
            }
            Value::Object(defaults)
        }
        (Value::Array(default_items), Value::Array(stored_items)) => {
            // Arrays are taken wholesale when both sides are arrays of the same
            // length; otherwise the default wins (settings have no arrays today,
            // this branch exists so the merge stays total).
            if default_items.len() == stored_items.len() {
                Value::Array(stored_items)
            } else {
                Value::Array(default_items)
            }
        }
        (default_value, stored_value) => {
            if same_kind(&default_value, &stored_value) {
                stored_value
            } else {
                logger.warn(
                    Category::Settings,
                    None,
                    format!(
                        "setting has unexpected type (expected {}, got {}); keeping the default",
                        kind_name(&default_value),
                        kind_name(&stored_value)
                    ),
                );
                default_value
            }
        }
    }
}

fn same_kind(a: &Value, b: &Value) -> bool {
    matches!(
        (a, b),
        (Value::Null, _)
            | (Value::Bool(_), Value::Bool(_))
            | (Value::Number(_), Value::Number(_))
            | (Value::String(_), Value::String(_))
    )
}

fn kind_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Maps a filename to one of the categories used for icons and history filters.
pub fn categorize_filename(filename: &str) -> String {
    let extension = std::path::Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let category = match extension.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "webm" | "flv" | "m4v" | "mpg" | "mpeg" => "video",
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "opus" | "m4a" | "wma" => "audio",
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "tiff" | "heic" => "image",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst" | "iso" => "archives",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "txt" | "md" | "csv" | "epub" => "documents",
        "exe" | "msi" | "dmg" | "deb" | "rpm" | "apk" | "appx" => "programs",
        _ => "other",
    };
    category.to_string()
}

/// Serialises the settings for the UI (same shape as the struct).
pub fn to_json(settings: &AppSettings) -> Result<Map<String, Value>> {
    match serde_json::to_value(settings).map_err(|e| AppError::Server(e.to_string()))? {
        Value::Object(map) => Ok(map),
        _ => Err(AppError::Server("settings did not serialise to an object".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logger() -> Logger {
        Logger::memory_only(Level::Error)
    }

    #[test]
    fn categories_follow_the_extension() {
        assert_eq!(categorize_filename("movie.MKV"), "video");
        assert_eq!(categorize_filename("song.flac"), "audio");
        assert_eq!(categorize_filename("photo.jpeg"), "image");
        assert_eq!(categorize_filename("archive.tar.gz"), "archives");
        assert_eq!(categorize_filename("manual.pdf"), "documents");
        assert_eq!(categorize_filename("setup.exe"), "programs");
        assert_eq!(categorize_filename("swiftload"), "other");
    }

    #[test]
    fn sanitize_clamps_hostile_values() {
        let mut settings = AppSettings::default();
        settings.downloads.max_concurrent = 9_999;
        settings.downloads.connections_per_download = 0;
        settings.downloads.max_retries = 1_000;
        settings.network.max_redirects = 500;
        settings.advanced.write_buffer_bytes = 4;
        settings.network.proxy_url = "not a url".into();
        settings.sanitize();

        assert_eq!(settings.downloads.max_concurrent, 16);
        assert_eq!(settings.downloads.connections_per_download, 1);
        assert_eq!(settings.downloads.max_retries, 20);
        assert_eq!(settings.network.max_redirects, 30);
        assert_eq!(settings.advanced.write_buffer_bytes, 32 * 1024);
        assert!(settings.network.proxy_url.is_empty());
        assert_eq!(settings.network.proxy_mode, ProxyMode::System);
    }

    #[test]
    fn merge_keeps_defaults_for_wrong_types() {
        let log = logger();
        let defaults = serde_json::to_value(AppSettings::default()).unwrap();
        let stored = serde_json::json!({
            "general": { "theme": "light", "compactMode": "yes", "unknownKey": 5 },
            "downloads": { "maxConcurrent": 7 }
        });
        let merged = merge_json(defaults, stored, &log);
        let settings: AppSettings = serde_json::from_value(merged).unwrap();
        assert_eq!(settings.general.theme, Theme::Light);
        // Wrong type -> default kept (true would have been accepted).
        assert!(!settings.general.compact_mode);
        assert_eq!(settings.downloads.max_concurrent, 7);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let db = Database::open_in_memory().unwrap();
        let log = logger();
        let dir = std::env::temp_dir();
        let mut settings = AppSettings::load(&db, &log, &dir).unwrap();
        assert_eq!(settings.general.default_download_dir, dir.to_string_lossy());

        settings.downloads.max_concurrent = 5;
        settings.general.theme = Theme::Light;
        settings.downloads.speed_limit_bps = Some(1_048_576);
        settings.save(&db, &log).unwrap();

        let reloaded = AppSettings::load(&db, &log, &dir).unwrap();
        assert_eq!(reloaded.downloads.max_concurrent, 5);
        assert_eq!(reloaded.general.theme, Theme::Light);
        assert_eq!(reloaded.downloads.speed_limit_bps, Some(1_048_576));
    }
}

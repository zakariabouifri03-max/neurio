//! Shared vocabulary between the download engine, the database and the frontend.
//!
//! Everything that crosses the Tauri IPC boundary is `serde`-serialised with the
//! `camelCase` convention so the TypeScript definitions in `src/lib/types.ts`
//! map one-to-one onto these structs.

use serde::{Deserialize, Serialize};

/// Lifecycle of a single download. Stored verbatim (as the lowercase string) in
/// SQLite so that a crash cannot leave an inconsistent numeric representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    /// Every segment resumed from byte 0 — nothing on disk yet.
    Queued,
    /// Waiting for a queue slot (status is not persisted; `queued` is shown to
    /// the user for both cases).
    Connecting,
    Downloading,
    Paused,
    /// A transient error occurred; the retry manager is backing off.
    Retrying,
    Completed,
    Failed,
    Cancelled,
    /// Finished downloading but the resulting file failed integrity checks.
    Corrupt,
}

impl DownloadStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            DownloadStatus::Queued => "queued",
            DownloadStatus::Connecting => "connecting",
            DownloadStatus::Downloading => "downloading",
            DownloadStatus::Paused => "paused",
            DownloadStatus::Retrying => "retrying",
            DownloadStatus::Completed => "completed",
            DownloadStatus::Failed => "failed",
            DownloadStatus::Cancelled => "cancelled",
            DownloadStatus::Corrupt => "corrupt",
        }
    }

    pub fn parse(s: &str) -> DownloadStatus {
        match s {
            "connecting" => DownloadStatus::Connecting,
            "downloading" => DownloadStatus::Downloading,
            "paused" => DownloadStatus::Paused,
            "retrying" => DownloadStatus::Retrying,
            "completed" => DownloadStatus::Completed,
            "failed" => DownloadStatus::Failed,
            "cancelled" => DownloadStatus::Cancelled,
            "corrupt" => DownloadStatus::Corrupt,
            _ => DownloadStatus::Queued,
        }
    }

    /// `true` while the engine owns network resources for this download.
    pub fn is_live(self) -> bool {
        matches!(
            self,
            DownloadStatus::Connecting | DownloadStatus::Downloading | DownloadStatus::Retrying
        )
    }

    /// `true` when the download can never be resumed into a completion.
    pub fn is_terminal(self) -> bool {
        matches!(self, DownloadStatus::Completed | DownloadStatus::Cancelled)
    }
}

/// Sentinel `end` for a range whose real end is unknown (the server did not
/// report a `Content-Length`). It makes "download until the body ends"
/// expressible with the same arithmetic as a normal range.
pub const OPEN_END: u64 = u64::MAX;

/// A contiguous byte range of the remote file that one connection is
/// responsible for. `start`/`end` are **inclusive** and map directly onto an
/// HTTP `Range: bytes=start-end` header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SegmentPlan {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    /// Bytes already held on disk for this segment (`start + downloaded - 1`
    /// is the last received byte).
    pub downloaded: u64,
    pub done: bool,
}

impl SegmentPlan {
    pub fn new(index: usize, start: u64, end: u64) -> Self {
        Self {
            index,
            start,
            end,
            downloaded: 0,
            done: false,
        }
    }

    pub fn len(&self) -> u64 {
        self.end.saturating_sub(self.start).saturating_add(1)
    }

    pub fn remaining(&self) -> u64 {
        self.len().saturating_sub(self.downloaded)
    }

    /// Plan for the part of the segment that still has to be requested.
    pub fn remaining_range(&self) -> Option<(u64, u64)> {
        if self.done || self.remaining() == 0 {
            return None;
        }
        Some((self.start + self.downloaded, self.end))
    }

    /// Amount of *already validated* contiguous data that can safely be kept.
    ///
    /// `verified` is the number of bytes the reader proved were written after an
    /// AMBIGUOUS failure (connection torn down without an HTTP error status).
    /// Because writes are issued with the "commit at EOF" strategy, everything
    /// beyond the last verified position is discarded — re-downloading a few
    /// KiB is always cheaper than shipping a corrupt gigabyte.
    pub fn apply_verified_boundary(&mut self, verified: u64) {
        let verified = verified.min(self.len());
        self.downloaded = verified;
        self.done = verified == self.len();
    }
}

/// Live, per-download measurements. Never synthesised: `speed_bps` and
/// `avg_speed_bps` come from the byte counters in [`crate::engine::speed`],
/// `eta_secs` is derived from those, and sizes come from the filesystem/server.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressInfo {
    pub downloaded: u64,
    /// `None` while the total is still unknown (chunked response).
    pub total: Option<u64>,
    /// Instantaneous throughput over the last sampling window, bytes/second.
    pub speed_bps: f64,
    /// `downloaded / elapsed_active_time`, bytes/second.
    pub avg_speed_bps: f64,
    /// Seconds, `None` when it cannot be estimated honestly.
    pub eta_secs: Option<u64>,
    /// Number of segments currently transferring bytes.
    pub active_connections: u32,
    /// Segments that have been allocated to a worker.
    pub total_connections: u32,
    pub status: DownloadStatus,
}

impl ProgressInfo {
    /// Completion ratio in `0.0..=1.0`, or `None` when the total is unknown.
    pub fn ratio(&self) -> Option<f64> {
        let total = self.total?;
        if total == 0 {
            return Some(1.0);
        }
        Some((self.downloaded as f64 / total as f64).clamp(0.0, 1.0))
    }

    /// Remaining bytes, or `None` when the total is unknown.
    pub fn remaining_bytes(&self) -> Option<u64> {
        self.total.map(|t| t.saturating_sub(self.downloaded))
    }
}

/// Immutable metadata captured while probing the server.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMeta {
    pub final_url: String,
    pub filename: String,
    pub total_bytes: Option<u64>,
    pub accepts_ranges: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    /// When `true` the file is written progressively and *no* re-validation of
    /// the `(etag, last-modified, total)` triple happens on resume.
    pub changed_remote: bool,
    pub probed_size_bytes: u64,
    pub probe_elapsed_ms: u64,
    pub http_status: u16,
}

/// Everything the queue/engine needs to know about one download.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub final_url: String,
    pub filename: String,
    pub dest_dir: String,
    pub file_path: String,
    pub part_path: String,
    pub status: DownloadStatus,
    pub error: Option<String>,
    pub fragmentable: bool,
    pub connections: u32,
    pub segments: Vec<SegmentPlan>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    pub sha256: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    /// Active-time accumulator (seconds) used for the average speed, so that
    /// time spent paused does not dilute the average.
    pub elapsed_secs: f64,
    /// User-controlled queue position, lower runs first.
    pub position: i64,
    pub retry_count: u32,
    pub speed_limit_bps: Option<u64>,
    pub category: String,
    /// What to do when the destination file already exists when the download
    /// finishes (the user's answer to Replace / Rename / Cancel).
    pub on_conflict: ConflictAction,
}

impl DownloadRecord {
    pub fn is_fragmented(&self) -> bool {
        self.segments.len() > 1
    }

    /// Sum of `downloaded` across all segments.
    pub fn computed_downloaded(&self) -> u64 {
        self.segments.iter().map(|s| s.downloaded).sum()
    }

    /// A resume is only safe if the server still exposes the same representation
    /// of the resource. `HEAD`-probe before resuming whenever we have validators.
    pub fn needs_revalidation(&self) -> bool {
        !self.is_fragmented() && self.downloaded > 0 && (self.etag.is_some() || self.last_modified.is_some())
    }

    pub fn validators_match(&self, meta: &ResourceMeta) -> bool {
        let etag_ok = match (&self.etag, &meta.etag) {
            (Some(a), Some(b)) => a == b,
            (Some(_), None) => false,
            _ => true,
        };
        let lm_ok = match (&self.last_modified, &meta.last_modified) {
            (Some(a), Some(b)) => a == b,
            (Some(_), None) => false,
            _ => true,
        };
        let size_ok = match (self.total, meta.total_bytes) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        };
        etag_ok && lm_ok && size_ok
    }
}

/// Statistics for the dashboard, all derived from persisted real measurements.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    pub active: u32,
    pub queued: u32,
    pub completed: u32,
    pub failed: u32,
    pub paused: u32,
    /// Sum of the instantaneous speeds of every live download, bytes/second.
    pub total_speed_bps: f64,
    /// Total number of bytes written to disk by completed downloads.
    pub total_downloaded_bytes: u64,
    /// Mean of `bytes / duration` over completed downloads, bytes/second.
    pub average_speed_bps: f64,
    pub total_downloads: u32,
}

/// A row of the history view (completed / failed downloads).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub file_path: String,
    pub status: DownloadStatus,
    pub total: Option<u64>,
    pub downloaded: u64,
    pub error: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub average_speed_bps: f64,
    pub connections: u32,
}

/// Result of the pre-flight probe shown in the "New Download" dialog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub final_url: String,
    pub filename: String,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub accepts_ranges: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub http_status: u16,
    pub suggested_destination: String,
    pub existing_file: Option<ExistingFile>,
}

/// Details about a filename collision, surfaced so the UI can offer
/// Replace / Rename / Cancel (we never overwrite silently).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingFile {
    pub path: String,
    pub size: u64,
    pub modified: i64,
    /// A non-colliding name that "Rename" can pre-fill.
    pub suggested_alternative: String,
}

/// How to resolve a filename collision, chosen by the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictAction {
    Replace,
    Rename,
    Cancel,
}

impl ConflictAction {
    pub fn as_str(self) -> &'static str {
        match self {
            ConflictAction::Replace => "replace",
            ConflictAction::Rename => "rename",
            ConflictAction::Cancel => "cancel",
        }
    }

    pub fn parse(s: &str) -> ConflictAction {
        match s.to_ascii_lowercase().as_str() {
            "replace" => ConflictAction::Replace,
            "rename" => ConflictAction::Rename,
            _ => ConflictAction::Cancel,
        }
    }
}

/// Parameters accepted by `download_add`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDownloadArgs {
    pub url: String,
    /// Destination directory; `None` uses the configured default.
    pub dest_dir: Option<String>,
    /// Filename override; `None` uses the name resolved from the response.
    pub filename: Option<String>,
    /// Connection count for this download; clamped to the configured maximum.
    pub connections: Option<u32>,
    pub sha256: Option<String>,
    /// How to resolve an existing file. `None` is treated as `Rename`.
    pub on_conflict: Option<ConflictAction>,
    /// Start immediately (`false` leaves it queued/paused).
    pub start: Option<bool>,
}

/// A generic structured error handed to the frontend.
///
/// `code` is a stable machine-readable identifier (see `src/lib/errors.ts`) and
/// `message` is a human sentence that explains what actually went wrong.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
    pub retryable: bool,
}

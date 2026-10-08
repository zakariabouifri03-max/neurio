//! The download engine: queue, lifecycle control, statistics and events.
//!
//! The engine owns every piece of mutable download state and is the only
//! component allowed to talk to the database about downloads. The frontend
//! talks to it through the plain method API below (exposed as Tauri commands in
//! [`crate::commands`]) and receives updates through an [`EventSink`].

pub mod adaptive;
pub mod download;
pub mod files;
pub mod limiter;
pub mod resume;
pub mod retry;
pub mod speed;
pub mod worker;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use tokio::sync::Notify;

use crate::db::downloads::{HistoryFilter, HistoryScope};
use crate::db::Database;
use crate::error::{AppError, Result};
use crate::logging::{Category, Level, Logger};
use crate::net::HttpClient;
use crate::settings::AppSettings;
use crate::types::{
    AddDownloadArgs, ConflictAction, DownloadRecord, DownloadStatus, HistoryEntry, ProgressInfo,
    ProbeResult, StatsSnapshot,
};

use download::DownloadRuntime;
use limiter::BandwidthLimiter;

/// Live measurements for one download, pushed to the UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub info: ProgressInfo,
}

/// Everything the engine sends to the frontend.
#[derive(Debug, Clone)]
pub enum EngineEvent {
    /// The full, ordered download list changed (add, remove, reorder, status).
    Records(Vec<DownloadRecord>),
    /// A single download changed.
    Record(Box<DownloadRecord>),
    /// A download was removed from the list.
    Removed { id: String },
    /// Batched live measurements.
    Progress(Vec<DownloadProgress>),
    /// Dashboard counters.
    Stats(Box<StatsSnapshot>),
    /// Desktop notification request.
    Notify { title: String, body: String },
    /// Bring the window to the front.
    FocusWindow,
}

/// Receives engine events. Implemented for the Tauri app handle in `lib.rs`;
/// tests use a recording sink.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
}

/// Sink that drops everything (tests, headless builds).
pub struct NullSink;

impl EventSink for NullSink {
    fn emit(&self, _event: EngineEvent) {}
}

/// Sink that records events so tests can assert on them.
#[derive(Default)]
pub struct RecordingSink {
    pub events: Mutex<Vec<EngineEvent>>,
}

impl EventSink for RecordingSink {
    fn emit(&self, event: EngineEvent) {
        crate::util::lock(&self.events).push(event);
    }
}

impl RecordingSink {
    pub fn take(&self) -> Vec<EngineEvent> {
        std::mem::take(&mut *crate::util::lock(&self.events))
    }
}

/// Immutable dependencies plus the mutable global state of the application.
pub struct Engine {
    db: Arc<Database>,
    logger: Logger,
    settings: RwLock<Arc<AppSettings>>,
    http: RwLock<HttpClient>,
    sink: Arc<dyn EventSink>,
    state: Mutex<EngineState>,
    /// Wakes the dispatcher when the queue state changes.
    notify: Notify,
    shutting_down: AtomicBool,
}

struct EngineState {
    /// Download ids in queue order.
    order: Vec<String>,
    runtimes: HashMap<String, Arc<DownloadRuntime>>,
}

impl Engine {
    pub fn new(
        db: Arc<Database>,
        logger: Logger,
        settings: AppSettings,
        sink: Arc<dyn EventSink>,
    ) -> Result<Arc<Engine>> {
        let http = HttpClient::build(&settings.network, logger.clone())?;
        Ok(Arc::new(Engine {
            db,
            logger,
            settings: RwLock::new(Arc::new(settings)),
            http: RwLock::new(http),
            sink,
            state: Mutex::new(EngineState {
                order: Vec::new(),
                runtimes: HashMap::new(),
            }),
            notify: Notify::new(),
            shutting_down: AtomicBool::new(false),
        }))
    }

    // -----------------------------------------------------------------------
    // Startup / shutdown
    // -----------------------------------------------------------------------

    /// Loads the persisted download list. Any download that was live when the
    /// process died comes back **paused** with its partial data intact.
    pub fn initialize(self: &Arc<Engine>) -> Result<()> {
        let mut records = self.db.list_downloads()?;
        records.sort_by_key(|record| (record.position, record.created_at));

        let interrupted = self.db.mark_live_downloads_as_paused()?;
        if !interrupted.is_empty() {
            self.logger.info(
                Category::Queue,
                None,
                format!(
                    "{} download(s) were interrupted by the previous session and are now paused",
                    interrupted.len()
                ),
            );
        }

        let settings = self.settings_snapshot();
        let mut state = crate::util::lock(&self.state);
        for mut record in records {
            if record.status.is_live() {
                record.status = DownloadStatus::Paused;
                record.error = None;
            }
            let limiter = Arc::new(BandwidthLimiter::new(
                record
                    .speed_limit_bps
                    .or(settings.downloads.speed_limit_bps),
            ));
            let ids = record.id.clone();
            state.runtimes.insert(ids.clone(), DownloadRuntime::new(record, limiter));
            state.order.push(ids);
        }
        drop(state);

        // Re-number the queue densely after any deletions from a previous run.
        let _ = self.persist_order();
        Ok(())
    }

    /// Async part of startup: starts the dispatcher loop. Call it from inside a
    /// Tokio runtime.
    pub async fn run(self: Arc<Engine>) {
        self.logger.info(Category::App, None, "engine started");
        self.emit_records();
        self.emit_stats();
        loop {
            if self.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            self.dispatch_step().await;
            let wait = if self.has_live_downloads() {
                Duration::from_millis(250)
            } else {
                Duration::from_secs(20)
            };
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(wait) => {}
            }
        }
        self.logger.info(Category::App, None, "engine stopped");
    }

    /// Stops the dispatcher and asks every running download to pause so that its
    /// state is written to disk before the process exits.
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        let runtimes = {
            let state = crate::util::lock(&self.state);
            state.runtimes.values().cloned().collect::<Vec<_>>()
        };
        for runtime in runtimes {
            if runtime.running.load(Ordering::SeqCst) {
                runtime.gates.pause();
            }
        }
        // Give the supervisors a moment to checkpoint, then force the issue.
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            let still_running = {
                let state = crate::util::lock(&self.state);
                state
                    .runtimes
                    .values()
                    .any(|runtime| runtime.running.load(Ordering::SeqCst))
            };
            if !still_running {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        for runtime in {
            let state = crate::util::lock(&self.state);
            state.runtimes.values().cloned().collect::<Vec<_>>()
        } {
            download::checkpoint(self, &runtime, true);
        }
        self.notify_dispatcher();
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    // -----------------------------------------------------------------------
    // Accessors used by the engine internals
    // -----------------------------------------------------------------------

    pub fn db(&self) -> &Arc<Database> {
        &self.db
    }

    pub fn logger(&self) -> &Logger {
        &self.logger
    }

    pub fn settings_snapshot(&self) -> Arc<AppSettings> {
        match self.settings.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub fn http(&self) -> HttpClient {
        match self.http.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub fn emit(&self, event: EngineEvent) {
        self.sink.emit(event);
    }

    pub fn notify_dispatcher(&self) {
        self.notify.notify_one();
    }

    /// Emits the ordered download list.
    pub fn emit_records(&self) {
        self.emit(EngineEvent::Records(self.list()));
    }

    pub fn emit_stats(&self) {
        let stats = self.stats();
        self.emit(EngineEvent::Stats(Box::new(stats)));
    }

    pub fn runtime(&self, id: &str) -> Option<Arc<DownloadRuntime>> {
        crate::util::lock(&self.state).runtimes.get(id).cloned()
    }

    fn runtime_or_error(&self, id: &str) -> Result<Arc<DownloadRuntime>> {
        self.runtime(id)
            .ok_or_else(|| AppError::NotFound(format!("download {id} does not exist")))
    }

    /// Writes the full record to the database (state transitions).
    pub fn save_record(&self, record: &DownloadRecord) -> Result<()> {
        self.db.update_download(record)
    }

    /// Updates a record's status, persists it and informs the UI.
    pub fn set_runtime_status(
        &self,
        runtime: &Arc<DownloadRuntime>,
        status: DownloadStatus,
        error: Option<String>,
    ) -> DownloadRecord {
        let record = runtime.update(|record| {
            record.status = status;
            record.error = error;
            if record.started_at.is_none() && status.is_live() {
                record.started_at = Some(crate::logging::now_millis());
            }
            record.downloaded = {
                let segments = crate::util::lock(&runtime.segments);
                segments.iter().map(|s| s.written).sum()
            };
            record.segments = {
                let segments = crate::util::lock(&runtime.segments);
                segments.iter().map(|s| s.to_plan()).collect()
            };
        });
        if let Err(error) = self.save_record(&record) {
            self.logger.warn(
                Category::Database,
                Some(&record.id),
                format!("could not persist the status change: {error}"),
            );
        }
        self.emit(EngineEvent::Record(Box::new(record.clone())));
        record
    }

    fn has_live_downloads(&self) -> bool {
        let state = crate::util::lock(&self.state);
        state
            .runtimes
            .values()
            .any(|runtime| runtime.running.load(Ordering::SeqCst))
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    pub fn list(&self) -> Vec<DownloadRecord> {
        let state = crate::util::lock(&self.state);
        state
            .order
            .iter()
            .filter_map(|id| state.runtimes.get(id))
            .map(|runtime| runtime.snapshot())
            .collect()
    }

    pub fn get(&self, id: &str) -> Result<DownloadRecord> {
        Ok(self.runtime_or_error(id)?.snapshot())
    }

    pub fn progress(&self, id: &str) -> Result<ProgressInfo> {
        Ok(self
            .runtime_or_error(id)?
            .progress_info(Instant::now()))
    }

    pub fn all_progress(&self) -> Vec<DownloadProgress> {
        let now = Instant::now();
        let state = crate::util::lock(&self.state);
        state
            .order
            .iter()
            .filter_map(|id| state.runtimes.get(id).map(|runtime| (id, runtime)))
            .map(|(id, runtime)| DownloadProgress {
                id: id.clone(),
                info: runtime.progress_info(now),
            })
            .collect()
    }

    /// Aggregated counters for the dashboard (all values are measurements).
    pub fn stats(&self) -> StatsSnapshot {
        let live: Vec<ProgressInfo> = self.all_progress().into_iter().map(|p| p.info).collect();
        match self.db.stats(&live) {
            Ok(mut stats) => {
                // `queued` must include downloads waiting for a queue slot.
                stats.queued = self.list().iter().filter(|r| r.status == DownloadStatus::Queued).count() as u32;
                stats
            }
            Err(error) => {
                self.logger
                    .warn(Category::Database, None, format!("statistics failed: {error}"));
                StatsSnapshot::default()
            }
        }
    }

    pub fn history(&self, filter: HistoryFilter) -> Result<Vec<HistoryEntry>> {
        self.db.list_history(&filter)
    }

    pub fn history_delete(&self, id: &str) -> Result<()> {
        self.db.delete_history(id)
    }

    pub fn history_clear(&self, scope: HistoryScope) -> Result<u64> {
        self.db.clear_history(scope)
    }

    // -----------------------------------------------------------------------
    // Queue commands
    // -----------------------------------------------------------------------

    /// Adds a download. The URL must already be validated by the caller's UI,
    /// but it is validated again here — the engine never trusts its input.
    pub async fn add(self: &Arc<Engine>, args: AddDownloadArgs) -> Result<DownloadRecord> {
        let url = crate::net::validate_url(&args.url)?;
        let settings = self.settings_snapshot();

        let dest_dir = match args.dest_dir.as_deref() {
            Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
            _ => settings.default_download_dir_path(),
        };
        crate::paths::AppPaths::verify_target_dir(&dest_dir)?;

        // The filename usually comes from the dialog (which probed the URL);
        // probe here only when it is missing so we never invent a name.
        let (filename, probed) = match args
            .filename
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            Some(name) => (files::sanitize_filename(name), None),
            None => {
                let meta = self.http().probe(&url).await?;
                (files::sanitize_filename(&meta.filename), Some(meta))
            }
        };

        let action = args.on_conflict.unwrap_or(ConflictAction::Rename);
        let destination = files::resolve_destination(&dest_dir, &filename, action)?;
        let filename = destination
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or(filename);
        files::ensure_within(&dest_dir, &destination)?;

        // Pre-flight disk space check (only when the size is actually known).
        if settings.downloads.check_free_space {
            if let Some(total) = probed.as_ref().and_then(|meta| meta.total_bytes) {
                if let Some(free) = files::available_space(&dest_dir) {
                    // Keep a small safety margin so a nearly-full volume is not
                    // filled to the last byte.
                    let needed = total.saturating_add(16 * 1024 * 1024);
                    if free < needed {
                        return Err(AppError::Disk(format!(
                            "not enough free space: {} needed, {} available in {}",
                            crate::util::human_bytes(needed),
                            crate::util::human_bytes(free),
                            dest_dir.display()
                        )));
                    }
                }
            }
        }

        let id = crate::util::random_id();
        let temp_dir = if settings.advanced.temp_dir.trim().is_empty() {
            None
        } else {
            Some(PathBuf::from(settings.advanced.temp_dir.trim()))
        };
        let location = files::plan_part_location(&dest_dir, &filename, &id, temp_dir.as_deref());

        let connections = args
            .connections
            .unwrap_or(settings.downloads.connections_per_download)
            .clamp(1, settings.downloads.max_connections_per_download);

        let now = crate::logging::now_millis();
        let start = args.start.unwrap_or(true);
        let record = DownloadRecord {
            id: id.clone(),
            url: url.to_string(),
            final_url: probe_final_url(&probed, &url),
            filename: filename.clone(),
            dest_dir: dest_dir.to_string_lossy().to_string(),
            file_path: destination.to_string_lossy().to_string(),
            part_path: location.part.to_string_lossy().to_string(),
            status: if start {
                DownloadStatus::Queued
            } else {
                DownloadStatus::Paused
            },
            error: None,
            fragmentable: false,
            connections,
            segments: Vec::new(),
            downloaded: 0,
            total: probed.as_ref().and_then(|meta| meta.total_bytes),
            etag: probed.as_ref().and_then(|meta| meta.etag.clone()),
            last_modified: probed.as_ref().and_then(|meta| meta.last_modified.clone()),
            content_type: probed.as_ref().and_then(|meta| meta.content_type.clone()),
            sha256: args.sha256.clone().filter(|hash| !hash.trim().is_empty()),
            created_at: now,
            started_at: None,
            completed_at: None,
            elapsed_secs: 0.0,
            position: 0,
            retry_count: 0,
            speed_limit_bps: None,
            category: crate::settings::categorize_filename(&filename),
            on_conflict: action,
        };

        let mut record = record;
        // New downloads go to the end of the queue.
        record.position = self.db.max_position()?.max(-1).saturating_add(1);
        self.db.insert_download(&record)?;

        let limiter = Arc::new(BandwidthLimiter::new(
            record
                .speed_limit_bps
                .or(settings.downloads.speed_limit_bps),
        ));
        let runtime = DownloadRuntime::new(record.clone(), limiter);
        {
            let mut state = crate::util::lock(&self.state);
            state.order.push(id.clone());
            state.runtimes.insert(id.clone(), runtime);
        }

        self.logger.info(
            Category::Download,
            Some(&id),
            format!(
                "added {} from {}",
                filename,
                crate::logging::redact_url(url.as_str())
            ),
        );
        self.persist_order()?;
        self.emit_records();
        self.emit_stats();
        self.notify_dispatcher();
        Ok(record)
    }

    /// Puts a download in the running queue.
    pub fn start(self: &Arc<Engine>, id: &str) -> Result<DownloadRecord> {
        let runtime = self.runtime_or_error(id)?;
        runtime.attempts.store(0, Ordering::SeqCst);
        runtime.force_single_stream.store(false, Ordering::SeqCst);
        runtime.gates.reset();
        let record = self.set_runtime_status(&runtime, DownloadStatus::Queued, None);
        if record.started_at.is_none() {
            runtime.update(|record| record.started_at = Some(crate::logging::now_millis()));
        }
        self.emit_records();
        self.notify_dispatcher();
        Ok(record)
    }

    pub fn pause(self: &Arc<Engine>, id: &str) -> Result<DownloadRecord> {
        let runtime = self.runtime_or_error(id)?;
        runtime.gates.pause();
        let record = if runtime.running.load(Ordering::SeqCst) {
            // The supervisor observes the gate, flushes the buffer and writes the
            // final "paused" state itself.
            runtime.snapshot()
        } else {
            self.set_runtime_status(&runtime, DownloadStatus::Paused, None)
        };
        self.logger
            .info(Category::Download, Some(id), "pause requested");
        self.notify_dispatcher();
        Ok(record)
    }

    pub fn resume(self: &Arc<Engine>, id: &str) -> Result<DownloadRecord> {
        self.start(id)
    }

    pub fn retry(self: &Arc<Engine>, id: &str) -> Result<DownloadRecord> {
        let runtime = self.runtime_or_error(id)?;
        let status = runtime.snapshot().status;
        if status.is_terminal() {
            return Err(AppError::Busy(format!(
                "this download is already {status:?}; use Restart instead"
            )));
        }
        self.logger
            .info(Category::Retry, Some(id), "manual retry requested");
        self.start(id)
    }

    /// Deletes the partial data and starts over from byte zero.
    pub fn restart(self: &Arc<Engine>, id: &str) -> Result<DownloadRecord> {
        let runtime = self.runtime_or_error(id)?;
        if let Some(location) = crate::util::lock(&runtime.location).clone() {
            files::remove_partials(&location);
        }
        runtime.set_segments(Vec::new());
        {
            let mut speed = crate::util::lock(&runtime.speed);
            speed.reset();
        }
        runtime.update(|record| {
            record.downloaded = 0;
            record.completed_at = None;
            record.error = None;
            record.segments = Vec::new();
            record.elapsed_secs = 0.0;
        });
        runtime.force_single_stream.store(false, Ordering::SeqCst);
        self.logger
            .info(Category::Download, Some(id), "restart requested (partial data removed)");
        self.start(id)
    }

    /// Cancels a download. Partial data is kept unless the user disabled it.
    pub async fn cancel(self: &Arc<Engine>, id: &str) -> Result<DownloadRecord> {
        let runtime = self.runtime_or_error(id)?;
        runtime.gates.cancel();
        self.logger
            .info(Category::Cancel, Some(id), "cancel requested");
        if runtime.running.load(Ordering::SeqCst) {
            // The supervisor performs the cleanup (partial files, history row).
            self.wait_stopped(&runtime, Duration::from_secs(3)).await;
        } else {
            download::cancel_cleanup(self, &runtime).await;
        }
        self.emit_records();
        self.emit_stats();
        self.notify_dispatcher();
        Ok(runtime.snapshot())
    }

    /// Pauses everything (running and queued).
    pub fn pause_all(self: &Arc<Engine>) {
        for record in self.list() {
            if record.status.is_live() || record.status == DownloadStatus::Queued {
                let _ = self.pause(&record.id);
            }
        }
        self.emit_records();
    }

    /// Starts everything that is not finished or cancelled.
    pub fn start_all(self: &Arc<Engine>) {
        for record in self.list() {
            if matches!(
                record.status,
                DownloadStatus::Paused
                    | DownloadStatus::Queued
                    | DownloadStatus::Failed
                    | DownloadStatus::Corrupt
            ) {
                let _ = self.start(&record.id);
            }
        }
        self.emit_records();
    }

    /// Removes a download from the list, optionally deleting the file.
    pub async fn remove(
        self: &Arc<Engine>,
        id: &str,
        delete_file: bool,
    ) -> Result<()> {
        let runtime = self.runtime_or_error(id)?;
        if runtime.running.load(Ordering::SeqCst) {
            runtime.gates.cancel();
            self.wait_stopped(&runtime, Duration::from_secs(3)).await;
        }

        let record = runtime.snapshot();

        // Temporary data always goes: it belongs to us, not to the user.
        if let Some(location) = crate::util::lock(&runtime.location).clone() {
            files::remove_partials(&location);
        } else {
            let location = files::PartLocation {
                dir: PathBuf::from(&record.part_path)
                    .parent()
                    .map(PathBuf::from)
                    .unwrap_or_default(),
                part: PathBuf::from(&record.part_path),
                meta: PathBuf::from(&record.part_path).with_extension("swlmeta"),
            };
            files::remove_partials(&location);
        }

        if delete_file {
            self.delete_downloaded_file(&record)?;
        }

        {
            let mut state = crate::util::lock(&self.state);
            state.order.retain(|existing| existing != id);
            state.runtimes.remove(id);
        }
        self.db.delete_download(id)?;
        self.persist_order()?;

        self.logger.info(
            Category::File,
            Some(id),
            format!(
                "removed {} from the list{}",
                record.filename,
                if delete_file { " and deleted the file" } else { "" }
            ),
        );
        self.emit(EngineEvent::Removed { id: id.to_string() });
        self.emit_records();
        self.emit_stats();
        self.notify_dispatcher();
        Ok(())
    }

    /// Deletes the finished file of a download (explicit user action only).
    pub fn delete_downloaded_file(&self, record: &DownloadRecord) -> Result<()> {
        let path = PathBuf::from(&record.file_path);
        if !path.exists() {
            return Ok(());
        }
        // Safety: only ever delete a regular file that lives inside the download
        // folder we were told to use.
        let dest_dir = PathBuf::from(&record.dest_dir);
        files::ensure_within(&dest_dir, &path)?;
        let metadata = std::fs::metadata(&path)
            .map_err(|e| AppError::Disk(format!("cannot inspect {path:?}: {e}")))?;
        if !metadata.is_file() {
            return Err(AppError::Disk(format!("{path:?} is not a file")));
        }
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Disk(format!("cannot delete {path:?}: {e}")))?;
        self.logger
            .info(Category::File, Some(&record.id), format!("deleted {path:?}"));
        Ok(())
    }

    /// Removes every finished/cancelled entry, optionally deleting their files.
    pub async fn remove_finished(self: &Arc<Engine>, delete_files: bool) -> Result<u32> {
        let finished: Vec<String> = self
            .list()
            .into_iter()
            .filter(|record| {
                matches!(
                    record.status,
                    DownloadStatus::Completed | DownloadStatus::Cancelled
                )
            })
            .map(|record| record.id)
            .collect();
        let mut removed = 0u32;
        for id in finished {
            if self.remove(&id, delete_files).await.is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Moves a download one step up in the queue.
    pub fn move_up(self: &Arc<Engine>, id: &str) -> Result<()> {
        self.reorder(id, -1)
    }

    pub fn move_down(self: &Arc<Engine>, id: &str) -> Result<()> {
        self.reorder(id, 1)
    }

    fn reorder(self: &Arc<Engine>, id: &str, delta: i64) -> Result<()> {
        {
            let mut state = crate::util::lock(&self.state);
            let Some(index) = state.order.iter().position(|existing| existing == id) else {
                return Err(AppError::NotFound(format!("download {id} does not exist")));
            };
            let target = index as i64 + delta;
            if target < 0 || target >= state.order.len() as i64 {
                return Ok(());
            }
            state.order.swap(index, target as usize);
        }
        self.persist_order()?;
        self.emit_records();
        Ok(())
    }

    /// Moves a download to an explicit position (drag & drop in the list).
    pub fn reorder_to(self: &Arc<Engine>, id: &str, position: usize) -> Result<()> {
        {
            let mut state = crate::util::lock(&self.state);
            let Some(index) = state.order.iter().position(|existing| existing == id) else {
                return Err(AppError::NotFound(format!("download {id} does not exist")));
            };
            let entry = state.order.remove(index);
            let target = position.min(state.order.len());
            state.order.insert(target, entry);
        }
        self.persist_order()?;
        self.emit_records();
        Ok(())
    }

    /// Writes the queue order and the per-record positions to the database.
    fn persist_order(&self) -> Result<()> {
        let ordered: Vec<String> = crate::util::lock(&self.state).order.clone();
        self.db.set_positions(&ordered)?;
        for (position, id) in ordered.iter().enumerate() {
            if let Some(runtime) = self.runtime(id) {
                runtime.update(|record| record.position = position as i64);
            }
        }
        Ok(())
    }

    /// Sets a per-download speed limit (`None` = follow the global setting).
    pub fn set_speed_limit(self: &Arc<Engine>, id: &str, limit: Option<u64>) -> Result<()> {
        let runtime = self.runtime_or_error(id)?;
        let settings = self.settings_snapshot();
        runtime.limiter.set_rate(limit.or(settings.downloads.speed_limit_bps));
        let record = runtime.update(|record| record.speed_limit_bps = limit);
        self.save_record(&record)?;
        self.emit(EngineEvent::Record(Box::new(record)));
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------

    /// Applies new settings: persists them, rebuilds the HTTP client when the
    /// network configuration changed, and pushes the new speed limit to every
    /// download that does not override it.
    pub fn apply_settings(self: &Arc<Engine>, mut settings: AppSettings) -> Result<AppSettings> {
        settings.sanitize();
        let previous = self.settings_snapshot();

        self.logger.set_min_level(settings.advanced.log_level);
        settings.save(&self.db, &self.logger)?;

        if settings.network != previous.network {
            let client = HttpClient::build(&settings.network, self.logger.clone())?;
            match self.http.write() {
                Ok(mut guard) => *guard = client,
                Err(poisoned) => *poisoned.into_inner() = client,
            }
            self.logger
                .info(Category::Connection, None, "HTTP client rebuilt from new network settings");
        }

        {
            match self.settings.write() {
                Ok(mut guard) => *guard = Arc::new(settings.clone()),
                Err(poisoned) => *poisoned.into_inner() = Arc::new(settings.clone()),
            }
        }

        if settings.downloads.speed_limit_bps != previous.downloads.speed_limit_bps {
            for runtime in self.all_runtimes() {
                if runtime.snapshot().speed_limit_bps.is_none() {
                    runtime.limiter.set_rate(settings.downloads.speed_limit_bps);
                }
            }
        }

        if settings.downloads.max_concurrent < previous.downloads.max_concurrent {
            self.logger.info(
                Category::Queue,
                None,
                format!(
                    "maximum simultaneous downloads reduced to {}",
                    settings.downloads.max_concurrent
                ),
            );
        }
        self.logger
            .debug(Category::Settings, None, "settings applied");
        self.notify_dispatcher();
        Ok(settings)
    }

    fn all_runtimes(&self) -> Vec<Arc<DownloadRuntime>> {
        let state = crate::util::lock(&self.state);
        state.runtimes.values().cloned().collect()
    }

    // -----------------------------------------------------------------------
    // Probing (New Download dialog)
    // -----------------------------------------------------------------------

    /// Probes a URL and reports everything the dialog needs, including whether
    /// the target file already exists in the destination folder.
    pub async fn probe(self: &Arc<Engine>, url: &str, dest_dir: Option<&str>) -> Result<ProbeResult> {
        let parsed = crate::net::validate_url(url)?;
        let settings = self.settings_snapshot();
        let dir = match dest_dir.map(str::trim).filter(|dir| !dir.is_empty()) {
            Some(dir) => PathBuf::from(dir),
            None => settings.default_download_dir_path(),
        };
        crate::paths::AppPaths::verify_target_dir(&dir)?;

        let meta = self.http().probe(&parsed).await?;
        let filename = files::sanitize_filename(&meta.filename);
        let path = dir.join(&filename);
        let existing = files::describe_existing(&path);

        Ok(ProbeResult {
            final_url: meta.final_url,
            filename,
            content_type: meta.content_type,
            content_length: meta.total_bytes,
            accepts_ranges: meta.accepts_ranges,
            etag: meta.etag,
            last_modified: meta.last_modified,
            http_status: meta.http_status,
            suggested_destination: dir.to_string_lossy().to_string(),
            existing_file: existing,
        })
    }

    // -----------------------------------------------------------------------
    // Dispatcher
    // -----------------------------------------------------------------------

    /// Starts as many queued downloads as the concurrency limit allows.
    async fn dispatch_step(self: &Arc<Engine>) {
        let settings = self.settings_snapshot();
        let max = settings.downloads.max_concurrent as usize;

        let (running, queued) = {
            let state = crate::util::lock(&self.state);
            let running = state
                .runtimes
                .values()
                .filter(|runtime| runtime.running.load(Ordering::SeqCst))
                .count();
            let mut queued: Vec<Arc<DownloadRuntime>> = state
                .order
                .iter()
                .filter_map(|id| state.runtimes.get(id))
                .filter(|runtime| {
                    !runtime.running.load(Ordering::SeqCst)
                        && runtime.snapshot().status == DownloadStatus::Queued
                        && !runtime.gates.is_paused()
                        && !runtime.gates.is_cancelled()
                })
                .cloned()
                .collect();
            // Keep the user's order stable.
            queued.truncate(max);
            (running, queued)
        };

        let mut free = max.saturating_sub(running);
        for runtime in queued {
            if free == 0 {
                break;
            }
            free -= 1;
            self.launch(runtime);
        }

        if running > 0 || free < max {
            self.emit_stats();
        }
    }

    fn launch(self: &Arc<Engine>, runtime: Arc<DownloadRuntime>) {
        let id = runtime.id();
        runtime.running.store(true, Ordering::SeqCst);
        if runtime.snapshot().started_at.is_none() {
            runtime.update(|record| record.started_at = Some(crate::logging::now_millis()));
        }
        self.set_runtime_status(&runtime, DownloadStatus::Connecting, None);

        let engine = self.clone();
        let task_runtime = runtime.clone();
        let handle = tokio::spawn(async move {
            download::supervise(engine, task_runtime).await;
        });
        *crate::util::lock(&runtime.handle) = Some(handle);
        self.logger
            .debug(Category::Queue, Some(&id), "supervisor started");
        self.emit_records();
    }

    /// Waits (bounded) until a supervisor has stopped.
    async fn wait_stopped(&self, runtime: &Arc<DownloadRuntime>, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while runtime.running.load(Ordering::SeqCst) && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    // -----------------------------------------------------------------------
    // File helpers used by the commands
    // -----------------------------------------------------------------------

    /// Absolute path of the finished file (for "Open file").
    pub fn file_path_of(&self, id: &str) -> Result<PathBuf> {
        let record = self.get(id)?;
        let path = PathBuf::from(&record.file_path);
        if record.status == DownloadStatus::Completed && path.exists() {
            return Ok(path);
        }
        if path.exists() {
            return Ok(path);
        }
        Err(AppError::NotFound(format!(
            "{} has not been downloaded to disk yet",
            record.filename
        )))
    }

    /// Directory to reveal in Explorer for "Open folder".
    pub fn folder_path_of(&self, id: &str) -> Result<PathBuf> {
        let record = self.get(id)?;
        let dir = PathBuf::from(&record.dest_dir);
        if dir.is_dir() {
            Ok(dir)
        } else {
            Err(AppError::NotFound(format!(
                "the download folder {} no longer exists",
                dir.display()
            )))
        }
    }

    /// Usage summary for the diagnostics panel.
    pub fn diagnostics(&self) -> serde_json::Value {
        let records = self.list();
        let partial_bytes: u64 = records
            .iter()
            .filter(|record| {
                !matches!(
                    record.status,
                    DownloadStatus::Completed | DownloadStatus::Cancelled
                )
            })
            .map(|record| record.downloaded)
            .sum();
        serde_json::json!({
            "downloads": records.len(),
            "active": records.iter().filter(|r| r.status.is_live()).count(),
            "queued": records.iter().filter(|r| r.status == DownloadStatus::Queued).count(),
            "paused": records.iter().filter(|r| r.status == DownloadStatus::Paused).count(),
            "completed": records.iter().filter(|r| r.status == DownloadStatus::Completed).count(),
            "failed": records.iter().filter(|r| matches!(r.status, DownloadStatus::Failed | DownloadStatus::Corrupt)).count(),
            "partialBytes": partial_bytes,
            "dbPath": self.db.path().to_string_lossy(),
            "logDir": self.logger.dir().to_string_lossy(),
            "filesEnabled": self.logger.files_enabled(),
            "schemaVersion": self.db.schema_version().unwrap_or(-1),
        })
    }
}

fn probe_final_url(probed: &Option<crate::types::ResourceMeta>, fallback: &url::Url) -> String {
    probed
        .as_ref()
        .map(|meta| meta.final_url.clone())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logging::Level;

    /// Minimal executor so synchronous tests can await one future.
    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn engine() -> Arc<Engine> {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let settings = AppSettings::default();
        let logger = Logger::memory_only(Level::Error);
        let engine = Engine::new(db, logger, settings, Arc::new(NullSink)).unwrap();
        engine.initialize().unwrap();
        engine
    }

    fn args(url: &str) -> AddDownloadArgs {
        AddDownloadArgs {
            url: url.to_string(),
            dest_dir: None,
            filename: Some("file.bin".into()),
            connections: Some(4),
            sha256: None,
            on_conflict: Some(ConflictAction::Rename),
            start: Some(false),
        }
    }

    #[tokio::test]
    async fn adds_and_lists_a_download() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-engine-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.start = Some(false);

        let record = engine.add(request).await.unwrap();
        assert_eq!(record.filename, "file.bin");
        assert_eq!(record.status, DownloadStatus::Paused);
        assert!(record.part_path.contains(".swiftload"));
        assert_eq!(engine.list().len(), 1);
        assert_eq!(engine.get(&record.id).unwrap().id, record.id);
        assert!(engine.runtime(&record.id).is_some());

        // Persisted: a second list call on a fresh engine sees it.
        let stored = engine.db().list_downloads().unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, record.id);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn rejects_invalid_urls_and_bad_folders() {
        let engine = engine();
        assert!(matches!(
            engine.add(args("not a url")).await,
            Err(AppError::InvalidUrl(_))
        ));
        assert!(matches!(
            engine.add(args("ftp://example.com/f")).await,
            Err(AppError::UnsupportedScheme(_))
        ));

        let mut request = args("https://example.com/f.bin");
        // A file cannot be used as a download folder.
        let file = std::env::temp_dir().join(format!("swiftload-file-{}", crate::util::random_id()));
        std::fs::write(&file, b"x").unwrap();
        request.dest_dir = Some(file.to_string_lossy().to_string());
        assert!(matches!(engine.add(request).await, Err(AppError::Disk(_))));
        let _ = std::fs::remove_file(&file);
    }

    #[tokio::test]
    async fn conflict_actions_are_honoured() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-conflict-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("file.bin"), b"existing").unwrap();

        // Cancel refuses to add at all.
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.on_conflict = Some(ConflictAction::Cancel);
        assert!(matches!(engine.add(request).await, Err(AppError::Cancelled)));

        // Rename picks a free name.
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.on_conflict = Some(ConflictAction::Rename);
        let record = engine.add(request).await.unwrap();
        assert_eq!(record.filename, "file (2).bin");
        assert_eq!(record.on_conflict, ConflictAction::Rename);

        // Replace keeps the name and remembers the choice.
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.on_conflict = Some(ConflictAction::Replace);
        let replaced = engine.add(request).await.unwrap();
        assert_eq!(replaced.filename, "file.bin");
        assert_eq!(replaced.on_conflict, ConflictAction::Replace);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn queue_ordering_and_limits() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-queue-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();

        let mut ids = Vec::new();
        for index in 0..3 {
            let mut request = args("https://example.com/file.bin");
            request.dest_dir = Some(dir.to_string_lossy().to_string());
            request.filename = Some(format!("file{index}.bin"));
            request.start = Some(false);
            ids.push(engine.add(request).await.unwrap().id);
        }

        let order: Vec<String> = engine.list().into_iter().map(|r| r.id).collect();
        assert_eq!(order, ids);

        engine.move_down(&ids[0]).unwrap();
        let order: Vec<String> = engine.list().into_iter().map(|r| r.id).collect();
        assert_eq!(order, vec![ids[1].clone(), ids[0].clone(), ids[2].clone()]);

        engine.move_up(&ids[2]).unwrap();
        let order: Vec<String> = engine.list().into_iter().map(|r| r.id).collect();
        assert_eq!(order, vec![ids[1].clone(), ids[2].clone(), ids[0].clone()]);

        // Positions are persisted densely.
        let stored = engine.db().list_downloads().unwrap();
        let positions: Vec<i64> = stored.iter().map(|r| r.position).collect();
        assert_eq!(positions, vec![0, 1, 2]);

        // Moving past the edge is a no-op rather than an error.
        assert!(engine.move_up(&ids[1]).is_ok());
        let order: Vec<String> = engine.list().into_iter().map(|r| r.id).collect();
        assert_eq!(order, vec![ids[1].clone(), ids[2].clone(), ids[0].clone()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn removing_a_download_cleans_up() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-remove-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.start = Some(false);
        let record = engine.add(request).await.unwrap();

        // Simulate a partially downloaded file.
        std::fs::create_dir_all(dir.join(crate::paths::WORK_DIR_NAME)).unwrap();
        std::fs::write(&record.part_path, b"partial").unwrap();
        std::fs::write(std::path::Path::new(&record.part_path).with_extension("swlmeta"), b"{}").unwrap();
        // And a finished file that the user asked to keep.
        std::fs::write(&record.file_path, b"finished").unwrap();

        engine.remove(&record.id, false).await.unwrap();
        assert!(engine.list().is_empty());
        assert!(!std::path::Path::new(&record.part_path).exists());
        assert!(
            std::path::Path::new(&record.file_path).exists(),
            "the file must survive a plain removal"
        );

        // With delete_file = true the file goes as well.
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.filename = Some("second.bin".into());
        request.start = Some(false);
        let second = engine.add(request).await.unwrap();
        std::fs::write(&second.file_path, b"finished").unwrap();
        engine.remove(&second.id, true).await.unwrap();
        assert!(!std::path::Path::new(&second.file_path).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn file_deletion_is_confined_to_the_download_folder() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-safe-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let outside = dir
            .parent()
            .unwrap()
            .join(format!("swiftload-outside-{}.bin", crate::util::random_id()));
        std::fs::write(&outside, b"do not delete").unwrap();

        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.start = Some(false);
        let record = engine.add(request).await.unwrap();

        // Point the record at a file outside the download folder.
        let mut escaped = record.clone();
        escaped.file_path = outside.to_string_lossy().to_string();
        assert!(engine.delete_downloaded_file(&escaped).is_err());
        assert!(outside.exists(), "a file outside the folder must never be deleted");

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn speed_limits_are_applied_per_download() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-limit-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut request = args("https://example.com/file.bin");
        request.dest_dir = Some(dir.to_string_lossy().to_string());
        request.start = Some(false);
        let record = engine.add(request).await.unwrap();
        let runtime = engine.runtime(&record.id).unwrap();

        assert!(runtime.limiter.is_unlimited());
        engine.set_speed_limit(&record.id, Some(1024 * 1024)).unwrap();
        assert_eq!(runtime.limiter.rate(), Some(1024 * 1024));
        assert_eq!(
            engine.get(&record.id).unwrap().speed_limit_bps,
            Some(1024 * 1024)
        );
        engine.set_speed_limit(&record.id, None).unwrap();
        assert!(runtime.limiter.is_unlimited());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_round_trip_through_the_engine() {
        let engine = engine();
        let mut settings = engine.settings_snapshot().as_ref().clone();
        settings.downloads.max_concurrent = 7;
        settings.downloads.speed_limit_bps = Some(500 * 1024);
        settings.general.theme = crate::settings::Theme::Light;

        let applied = engine.apply_settings(settings).unwrap();
        assert_eq!(applied.downloads.max_concurrent, 7);

        let reloaded = engine.settings_snapshot();
        assert_eq!(reloaded.downloads.max_concurrent, 7);
        assert_eq!(reloaded.downloads.speed_limit_bps, Some(500 * 1024));
        assert_eq!(reloaded.general.theme, crate::settings::Theme::Light);

        // Out-of-range values are clamped, not rejected.
        let mut hostile = reloaded.as_ref().clone();
        hostile.downloads.max_concurrent = 999;
        let applied = engine.apply_settings(hostile).unwrap();
        assert_eq!(applied.downloads.max_concurrent, 16);
    }

    #[test]
    fn restart_clears_partial_state() {
        let engine = engine();
        let dir = std::env::temp_dir().join(format!("swiftload-restart-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let record = block_on(engine.add({
            let mut request = args("https://example.com/file.bin");
            request.dest_dir = Some(dir.to_string_lossy().to_string());
            request.start = Some(false);
            request
        }))
        .unwrap();

        let runtime = engine.runtime(&record.id).unwrap();
        runtime.set_segments(vec![download::SegState {
            id: 1,
            index: 0,
            start: 0,
            end: 99,
            written: 50,
            tail: Some("aa".into()),
            done: false,
            active: false,
        }]);
        assert_eq!(runtime.downloaded(), 50);

        engine.restart(&record.id).unwrap();
        assert_eq!(runtime.downloaded(), 0);
        assert_eq!(engine.get(&record.id).unwrap().status, DownloadStatus::Queued);
        let _ = std::fs::remove_dir_all(&dir);
    }

}

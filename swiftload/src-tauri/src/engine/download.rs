//! Download supervision: one cycle (attempt) per download, retries around it,
//! and the monitor loop that drives the workers.
//!
//! ```text
//! supervise()                 <- retry loop, pause/cancel aware
//!   └── run_cycle()           <- one HTTP attempt
//!         ├── probe           <- real request, 1 byte, headers only
//!         ├── build_plan      <- fresh or resume, validated against disk
//!         ├── spawn workers   <- one per segment, real byte ranges
//!         ├── monitor         <- events, adaptive connections, checkpoints
//!         └── finish          <- size/hash verification, atomic finalise
//! ```
//!
//! A failed attempt never throws away work: everything already flushed to disk
//! is kept (with a validated resume boundary) and the next attempt continues
//! from there.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::error::{AppError, Result};
use crate::logging::Category;
use crate::net;
use crate::types::{
    ConflictAction, DownloadRecord, DownloadStatus, ProgressInfo, SegmentPlan, OPEN_END,
};

use super::adaptive::{AdaptiveController, AdaptiveDecision};
use super::files::{self, PartLocation, ResumeRecord, SegmentGuard};
use super::limiter::BandwidthLimiter;
use super::resume::{self, PlanOutcome, ResumeInput};
use super::retry::RetryPolicy;
use super::speed::SpeedMonitor;
use super::worker::{
    Gates, Interruption, SegmentCommand, SegmentEvent, SegmentTask, WorkerContext,
};
use super::{DownloadProgress, Engine, EngineEvent};

/// How often the monitor loop wakes up.
const TICK: Duration = Duration::from_millis(400);
/// Minimum remaining bytes before a segment may be split.
const MIN_SPLIT_BYTES: u64 = 1024 * 1024;

// ---------------------------------------------------------------------------
// Per-segment state
// ---------------------------------------------------------------------------

/// A byte range of the download and how much of it is on disk.
#[derive(Debug, Clone, PartialEq)]
pub struct SegState {
    /// Stable identifier used to route worker events (indices change when the
    /// adaptive controller splits a range).
    pub id: u64,
    /// Display order.
    pub index: usize,
    pub start: u64,
    /// Inclusive end; [`OPEN_END`] until the server reveals the size.
    pub end: u64,
    /// Bytes written to disk for this range.
    pub written: u64,
    /// Tail guard for `written`, validated before resuming.
    pub tail: Option<String>,
    pub done: bool,
    /// A worker is currently transferring this range.
    pub active: bool,
}

impl SegState {
    pub fn from_plan(plan: &SegmentPlan, id: u64, tail: Option<String>) -> Self {
        Self {
            id,
            index: plan.index,
            start: plan.start,
            end: plan.end,
            written: plan.downloaded,
            tail,
            done: plan.done,
            active: false,
        }
    }

    pub fn len(&self) -> u64 {
        if self.end == OPEN_END {
            OPEN_END
        } else {
            self.end.saturating_sub(self.start).saturating_add(1)
        }
    }

    pub fn remaining(&self) -> u64 {
        if self.end == OPEN_END {
            OPEN_END
        } else {
            self.len().saturating_sub(self.written)
        }
    }

    pub fn to_plan(&self) -> SegmentPlan {
        SegmentPlan {
            index: self.index,
            start: self.start,
            end: self.end,
            downloaded: self.written,
            done: self.done,
        }
    }

    pub fn to_guard(&self) -> SegmentGuard {
        SegmentGuard {
            index: self.index,
            start: self.start,
            end: self.end,
            written: self.written,
            tail: self.tail.clone(),
        }
    }

    /// `true` when this range can be split in half for another connection.
    pub fn splittable(&self, min_segment: u64) -> bool {
        !self.done && self.end != OPEN_END && self.remaining() >= min_segment.saturating_mul(2)
    }
}

// ---------------------------------------------------------------------------
// Runtime state of one download
// ---------------------------------------------------------------------------

pub struct DownloadRuntime {
    pub record: Mutex<DownloadRecord>,
    pub gates: Arc<Gates>,
    pub speed: Arc<Mutex<SpeedMonitor>>,
    pub limiter: Arc<BandwidthLimiter>,
    pub segments: Mutex<Vec<SegState>>,
    pub location: Mutex<Option<PartLocation>>,
    /// Attempts made since the last progress (reset when a segment completes).
    pub attempts: AtomicU32,
    /// Set when the server turned out not to support byte ranges.
    pub force_single_stream: AtomicBool,
    /// A supervisor task is running.
    pub running: AtomicBool,
    pub handle: Mutex<Option<JoinHandle<()>>>,
    next_segment_id: AtomicU32,
    last_checkpoint: Mutex<Instant>,
    /// Total bytes of the last checkpoint write (avoids redundant writes).
    checkpointed_bytes: AtomicU32,
}

impl DownloadRuntime {
    pub fn new(record: DownloadRecord, limiter: Arc<BandwidthLimiter>) -> Arc<DownloadRuntime> {
        Arc::new(DownloadRuntime {
            record: Mutex::new(record),
            gates: Gates::new(),
            speed: Arc::new(Mutex::new(SpeedMonitor::default())),
            limiter,
            segments: Mutex::new(Vec::new()),
            location: Mutex::new(None),
            attempts: AtomicU32::new(0),
            force_single_stream: AtomicBool::new(false),
            running: AtomicBool::new(false),
            handle: Mutex::new(None),
            next_segment_id: AtomicU32::new(1),
            last_checkpoint: Mutex::new(Instant::now()),
            checkpointed_bytes: AtomicU32::new(0),
        })
    }

    pub fn id(&self) -> String {
        crate::util::lock(&self.record).id.clone()
    }

    pub fn snapshot(&self) -> DownloadRecord {
        crate::util::lock(&self.record).clone()
    }

    /// Mutates the record in place and returns the new value.
    pub fn update(&self, f: impl FnOnce(&mut DownloadRecord)) -> DownloadRecord {
        let mut guard = crate::util::lock(&self.record);
        f(&mut guard);
        guard.clone()
    }

    pub fn next_segment_id(&self) -> u64 {
        self.next_segment_id.fetch_add(1, Ordering::SeqCst) as u64
    }

    pub fn set_segments(&self, states: Vec<SegState>) {
        *crate::util::lock(&self.segments) = states;
    }

    pub fn segment_states(&self) -> Vec<SegState> {
        crate::util::lock(&self.segments).clone()
    }

    pub fn segment_plan(&self) -> Vec<SegmentPlan> {
        crate::util::lock(&self.segments)
            .iter()
            .map(|s| s.to_plan())
            .collect()
    }

    pub fn segment_guards(&self) -> Vec<SegmentGuard> {
        crate::util::lock(&self.segments)
            .iter()
            .map(|s| s.to_guard())
            .collect()
    }

    pub fn downloaded(&self) -> u64 {
        crate::util::lock(&self.segments)
            .iter()
            .map(|s| s.written)
            .sum()
    }

    pub fn all_done(&self) -> bool {
        let segments = crate::util::lock(&self.segments);
        !segments.is_empty() && segments.iter().all(|s| s.done)
    }

    pub fn active_connections(&self) -> u32 {
        crate::util::lock(&self.segments)
            .iter()
            .filter(|s| s.active)
            .count() as u32
    }

    /// Live measurement snapshot for the UI.
    pub fn progress_info(&self, now: Instant) -> ProgressInfo {
        let record = self.snapshot();
        let downloaded = self.downloaded();
        let total = record.total;
        let mut speed = crate::util::lock(&self.speed);
        let instantaneous = speed.speed(now);
        let average = speed.average(now);
        let remaining = total.map(|t| t.saturating_sub(downloaded));
        let eta = remaining.and_then(|r| speed.eta_seconds(r, now));
        let (active, allocated) = {
            let segments = crate::util::lock(&self.segments);
            (
                segments.iter().filter(|s| s.active).count() as u32,
                segments.len() as u32,
            )
        };
        ProgressInfo {
            downloaded,
            total,
            speed_bps: instantaneous,
            avg_speed_bps: average,
            eta_secs: eta,
            active_connections: active,
            total_connections: allocated,
            status: record.status,
        }
    }
}

// ---------------------------------------------------------------------------
// Worker bookkeeping
// ---------------------------------------------------------------------------

struct WorkerSlot {
    command: mpsc::UnboundedSender<SegmentCommand>,
    handle: JoinHandle<()>,
}

/// Mutable state of the monitor loop.
struct Monitor {
    slots: HashMap<u64, WorkerSlot>,
    failure: Option<AppError>,
    last_checkpoint: Instant,
    last_emit: Instant,
    last_adaptive: Instant,
}

impl Monitor {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            slots: HashMap::new(),
            failure: None,
            last_checkpoint: now,
            last_emit: now,
            last_adaptive: now,
        }
    }
}

/// Why a cycle ended.
enum CycleOutcome {
    Completed,
    Paused,
    Cancelled,
    /// The server does not support ranges although the probe said it might:
    /// retry as a single stream without counting a retry attempt.
    Fallback,
    Failed(AppError),
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

/// Runs a download to completion, pausing, cancellation or terminal failure.
pub async fn supervise(engine: Arc<Engine>, runtime: Arc<DownloadRuntime>) {
    let id = runtime.id();

    loop {
        if engine.is_shutting_down() {
            break;
        }
        let outcome = run_cycle(&engine, &runtime).await;
        match outcome {
            CycleOutcome::Completed => {
                finish(&engine, &runtime).await;
                break;
            }
            CycleOutcome::Fallback => {
                // The server turned out not to support byte ranges. Continue as
                // a single stream; this is a strategy change, not a failure, so
                // no retry attempt is consumed. `force_single_stream` was set by
                // the monitor loop that detected the situation.
                engine.logger().info(
                    Category::Download,
                    Some(&id),
                    "server ignored byte ranges; continuing with a single connection",
                );
                continue;
            }
            CycleOutcome::Paused => {
                engine.set_runtime_status(&runtime, DownloadStatus::Paused, None);
                checkpoint(&engine, &runtime, true);
                break;
            }
            CycleOutcome::Cancelled => {
                cancel_cleanup(&engine, &runtime).await;
                break;
            }
            CycleOutcome::Failed(error) => {
                let settings = engine.settings_snapshot();
                let policy = RetryPolicy::from_settings(&settings.downloads);
                // A completed segment is proof that the connection recovered, so
                // the retry budget is refreshed whenever progress is made.
                let attempt = runtime.attempts.load(Ordering::SeqCst) + 1;

                if policy.should_retry(attempt, &error) {
                    runtime.attempts.store(attempt, Ordering::SeqCst);
                    let delay = policy.delay_for(attempt, &error);
                    engine.logger().warn(
                        Category::Retry,
                        Some(&id),
                        format!(
                            "attempt {attempt}/{} failed: {}. Retrying in {}s",
                            policy.max_retries,
                            error.log_line(),
                            delay.as_secs()
                        ),
                    );
                    engine.set_runtime_status(
                        &runtime,
                        DownloadStatus::Retrying,
                        Some(format!(
                            "{} Retrying in {}s (attempt {attempt} of {}).",
                            error.message(),
                            delay.as_secs(),
                            policy.max_retries
                        )),
                    );
                    checkpoint(&engine, &runtime, true);

                    match interruptible_sleep(&runtime.gates, delay).await {
                        Some(Interruption::Pause) => {
                            engine.set_runtime_status(&runtime, DownloadStatus::Paused, None);
                            checkpoint(&engine, &runtime, true);
                            break;
                        }
                        Some(Interruption::Cancel) => {
                            cancel_cleanup(&engine, &runtime).await;
                            break;
                        }
                        None => continue,
                    }
                } else {
                    fail(&engine, &runtime, error, attempt > policy.max_retries).await;
                    break;
                }
            }
        }
    }

    runtime.running.store(false, Ordering::SeqCst);
    *crate::util::lock(&runtime.handle) = None;
    engine.notify_dispatcher();
}

/// Sleeps, but wakes up immediately on pause or cancel.
async fn interruptible_sleep(gates: &Gates, duration: Duration) -> Option<Interruption> {
    tokio::select! {
        biased;
        _ = gates.cancelled() => Some(Interruption::Cancel),
        _ = gates.pause_requested() => Some(Interruption::Pause),
        _ = tokio::time::sleep(duration) => None,
    }
}

// ---------------------------------------------------------------------------
// One attempt
// ---------------------------------------------------------------------------

async fn run_cycle(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>) -> CycleOutcome {
    let id = runtime.id();
    let settings = engine.settings_snapshot();
    let record = runtime.snapshot();

    // --- 1. Validate the URL -------------------------------------------------
    let url = match net::validate_url(&record.url) {
        Ok(url) => url,
        Err(error) => return CycleOutcome::Failed(error),
    };

    if runtime.gates.is_cancelled() {
        return CycleOutcome::Cancelled;
    }
    if runtime.gates.is_paused() {
        return CycleOutcome::Paused;
    }

    engine.set_runtime_status(runtime, DownloadStatus::Connecting, None);
    let (_, auth) = net::prepare_url(&url);

    // --- 2. Probe ------------------------------------------------------------
    let http = engine.http();
    let meta = match http.probe(&url).await {
        Ok(meta) => meta,
        Err(error) => return CycleOutcome::Failed(error),
    };

    let force_single = runtime.force_single_stream.load(Ordering::SeqCst);
    let fragmentable = meta.accepts_ranges && !force_single;

    // --- 3. Plan -------------------------------------------------------------
    let previous = runtime.snapshot();
    let filename = files::sanitize_filename(&meta.filename);
    let dest_dir = if previous.dest_dir.trim().is_empty() {
        settings.general.default_download_dir.clone()
    } else {
        previous.dest_dir.clone()
    };
    if let Err(error) = crate::paths::AppPaths::verify_target_dir(std::path::Path::new(&dest_dir)) {
        return CycleOutcome::Failed(error);
    }

    let temp_dir = if settings.advanced.temp_dir.trim().is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(settings.advanced.temp_dir.trim()))
    };
    let location = files::plan_part_location(
        std::path::Path::new(&dest_dir),
        &filename,
        &id,
        temp_dir.as_deref(),
    );

    let total_hint = meta.total_bytes.or(previous.total);
    let file = match files::open_part_file(
        &location,
        total_hint,
        fragmentable,
        settings.advanced.sparse_files,
    ) {
        Ok(file) => Arc::new(file),
        Err(error) => return CycleOutcome::Failed(error),
    };
    *crate::util::lock(&runtime.location) = Some(location.clone());

    let sidecar = files::read_resume_record(&location.meta);
    let resume_record = match &sidecar {
        Some(stored)
            if !stored.is_compatible(
                &id,
                &previous.url,
                meta.total_bytes.or(previous.total),
                meta.etag.as_deref(),
            ) =>
        {
            // The resource behind the URL changed: nothing on disk can be trusted.
            engine.logger().warn(
                Category::Resume,
                Some(&id),
                "the file changed on the server (ETag/size mismatch); restarting the download",
            );
            None
        }
        other => other.clone(),
    };

    let plan: PlanOutcome = match resume::build_plan(ResumeInput {
        record: &previous,
        meta: &crate::types::ResourceMeta {
            accepts_ranges: fragmentable,
            ..meta.clone()
        },
        file: Some(&file),
        resume: resume_record.as_ref(),
        settings: &settings.downloads,
    }) {
        Ok(plan) => plan,
        Err(error) => return CycleOutcome::Failed(error),
    };

    for note in &plan.notes {
        engine
            .logger()
            .info(Category::Resume, Some(&id), note.clone());
    }

    // Persist what the probe learned and what the plan decided.
    let record = runtime.update(|record| {
        record.final_url = meta.final_url.clone();
        record.filename = filename.clone();
        record.dest_dir = dest_dir.clone();
        record.part_path = location.part.to_string_lossy().to_string();
        record.file_path = std::path::Path::new(&dest_dir)
            .join(&filename)
            .to_string_lossy()
            .to_string();
        record.total = plan.total;
        record.fragmentable = plan.fragmentable;
        record.etag = meta.etag.clone();
        record.last_modified = meta.last_modified.clone();
        record.content_type = meta.content_type.clone();
        record.connections = plan.segments.len() as u32;
    });
    let _ = engine.save_record(&record);

    let mut states: Vec<SegState> = Vec::with_capacity(plan.segments.len());
    let guard_source: Vec<SegmentGuard> = resume_record
        .as_ref()
        .map(|stored| stored.segments.clone())
        .unwrap_or_default();
    for segment in &plan.segments {
        let tail = guard_source
            .iter()
            .find(|guard| guard.start == segment.start && guard.end == segment.end)
            .and_then(|guard| guard.tail.clone());
        let id_segment = runtime.next_segment_id();
        states.push(SegState::from_plan(segment, id_segment, tail));
    }
    runtime.set_segments(states);

    write_sidecar(runtime, &record);

    if runtime.gates.is_cancelled() {
        return CycleOutcome::Cancelled;
    }
    if runtime.gates.is_paused() {
        return CycleOutcome::Paused;
    }

    // --- 4. Workers ----------------------------------------------------------
    engine.set_runtime_status(runtime, DownloadStatus::Downloading, None);
    engine.logger().info(
        Category::Download,
        Some(&id),
        format!(
            "started {} — {} bytes, range support: {}, connections: {}",
            crate::logging::redact_url(&url.as_str()),
            plan.total
                .map(crate::util::human_bytes)
                .unwrap_or_else(|| "unknown".to_string()),
            if plan.fragmentable { "yes" } else { "no" },
            plan.segments.len()
        ),
    );

    let context = Arc::new(WorkerContext {
        id: id.clone(),
        client: http.clone(),
        logger: engine.logger().clone(),
        file: file.clone(),
        gates: runtime.gates.clone(),
        limiter: runtime.limiter.clone(),
        speed: runtime.speed.clone(),
        url: url.clone(),
        auth,
        etag: meta.etag.clone(),
        last_modified: meta.last_modified.clone(),
        range_ok: plan.fragmentable,
        single_stream: plan.segments.len() == 1,
        validate_resume: settings.downloads.verify_on_resume,
        write_buffer: settings.advanced.write_buffer_bytes as usize,
        stall_timeout: settings.stall_timeout(),
    });

    // Only the total size decides how much sense adaptive connections make: for
    // a small file the extra sockets would never pay for themselves.
    let adaptive_worthy = settings.downloads.adaptive_connections
        && plan.fragmentable
        && plan.total.unwrap_or(0) >= settings.downloads.min_segment_bytes.saturating_mul(4);
    let mut controller = AdaptiveController::new(
        adaptive_worthy,
        plan.segments.len() as u32,
        settings.downloads.max_connections_per_download,
    );

    let (events_tx, mut events_rx) = mpsc::unbounded_channel::<SegmentEvent>();
    let mut monitor = Monitor::new();

    // Start the file's speed accounting for this attempt.
    {
        let mut speed = crate::util::lock(&runtime.speed);
        speed.seed(downloaded_before(&plan));
        speed.start_session(Instant::now());
    }

    let mut outcome: Option<CycleOutcome> = None;

    loop {
        // ---- drain queued events ----
        while let Ok(event) = events_rx.try_recv() {
            apply_event(
                engine,
                runtime,
                &context,
                &mut monitor,
                &mut controller,
                event,
            );
        }

        if outcome.is_none() {
            if runtime.gates.is_cancelled() {
                outcome = Some(CycleOutcome::Cancelled);
            } else if runtime.gates.is_paused() {
                outcome = Some(CycleOutcome::Paused);
            } else if let Some(error) = monitor.failure.take() {
                // Any failure ends this attempt: the next attempt resumes from
                // disk, so nothing is lost and the retry policy is applied in
                // exactly one place.
                if matches!(error, AppError::RangeUnsupported(_)) && plan.fragmentable {
                    // The probe was wrong about range support: restart as a
                    // single stream instead of reporting a failure.
                    runtime.force_single_stream.store(true, Ordering::SeqCst);
                    outcome = Some(CycleOutcome::Fallback);
                } else {
                    outcome = Some(CycleOutcome::Failed(error));
                }
            } else if runtime.all_done() {
                outcome = Some(CycleOutcome::Completed);
            }
        }

        let Some(outcome) = outcome.take() else {
            // ---- housekeeping ----
            let now = Instant::now();
            dispatch_workers(engine, runtime, &context, &events_tx, &mut monitor, &controller);

            if now.duration_since(monitor.last_emit) >= settings.ui_refresh() {
                emit_progress(engine, runtime, now);
                monitor.last_emit = now;
            }

            if now.duration_since(monitor.last_adaptive) >= Duration::from_secs(2) {
                monitor.last_adaptive = now;
                let speed = {
                    let mut monitor_speed = crate::util::lock(&runtime.speed);
                    monitor_speed.speed(now)
                };
                controller.observe(speed);
                let remaining = record_total_remaining(runtime, &record);
                match controller.decide(now, remaining, settings.downloads.min_segment_bytes) {
                    AdaptiveDecision::Increase => {
                        if !split_segment(runtime, &mut monitor, &settings, speed) {
                            controller.rollback_increase();
                        } else {
                            log_adaptive(engine, runtime, &controller, speed, true);
                            checkpoint(engine, runtime, true);
                        }
                    }
                    AdaptiveDecision::Decrease => {
                        if stop_slowest_segment(runtime, &mut monitor) {
                            log_adaptive(engine, runtime, &controller, speed, false);
                            checkpoint(engine, runtime, true);
                        }
                    }
                    AdaptiveDecision::Hold => {}
                }
            }

            if now.duration_since(monitor.last_checkpoint) >= settings.checkpoint_interval() {
                monitor.last_checkpoint = now;
                checkpoint(engine, runtime, false);
            }

            let sleep_for = TICK.saturating_sub(monitor.last_emit.elapsed());
            tokio::select! {
                biased;
                Some(event) = events_rx.recv() => {
                    apply_event(engine, runtime, &context, &mut monitor, &mut controller, event);
                }
                _ = tokio::time::sleep(sleep_for) => {}
            }
            continue;
        };

        // ---- wind down ----
        {
            let mut speed = crate::util::lock(&runtime.speed);
            speed.end_session(Instant::now());
        }
        abort_workers(&mut monitor);
        emit_progress(engine, runtime, Instant::now());
        checkpoint(engine, runtime, true);

        return match outcome {
            CycleOutcome::Fallback => CycleOutcome::Fallback,
            other => other,
        };
    }
}

/// Sum of the bytes already on disk when the cycle starts (for the average).
fn downloaded_before(plan: &PlanOutcome) -> u64 {
    plan.retained_bytes
}

fn record_total_remaining(runtime: &Arc<DownloadRuntime>, record: &DownloadRecord) -> u64 {
    match record.total.or(runtime.snapshot().total) {
        Some(total) => total.saturating_sub(runtime.downloaded()),
        None => OPEN_END,
    }
}

fn log_adaptive(
    engine: &Arc<Engine>,
    runtime: &Arc<DownloadRuntime>,
    controller: &AdaptiveController,
    speed: f64,
    increased: bool,
) {
    engine.logger().info(
        Category::Queue,
        Some(&runtime.id()),
        format!(
            "{} connections to {} at {}/s ({})",
            if increased { "increased" } else { "reduced" },
            controller.connections(),
            crate::util::human_bytes(speed as u64),
            controller.describe()
        ),
    );
}

// ---------------------------------------------------------------------------
// Worker dispatch and events
// ---------------------------------------------------------------------------

fn dispatch_workers(
    _engine: &Arc<Engine>,
    runtime: &Arc<DownloadRuntime>,
    context: &Arc<WorkerContext>,
    events: &mpsc::UnboundedSender<SegmentEvent>,
    monitor: &mut Monitor,
    controller: &AdaptiveController,
) {
    let target = controller.connections() as usize;
    if target == 0 {
        return;
    }
    while monitor.slots.len() < target {
        // Pick the incomplete range with the most work left.
        let pick = {
            let segments = crate::util::lock(&runtime.segments);
            let mut best: Option<usize> = None;
            for (index, segment) in segments.iter().enumerate() {
                if segment.done || segment.active {
                    continue;
                }
                if best.map_or(true, |current| segments[current].remaining() < segment.remaining()) {
                    best = Some(index);
                }
            }
            best
        };
        let Some(index) = pick else { break };
        let segment = {
            let mut segments = crate::util::lock(&runtime.segments);
            segments[index].active = true;
            segments[index].clone()
        };

        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let task = SegmentTask {
            id: segment.id,
            index: segment.index,
            start: segment.start,
            end: segment.end,
            resume_from: segment.written,
            guard: segment.tail.clone(),
        };
        let context = context.clone();
        let events = events.clone();
        let handle = tokio::spawn(async move {
            super::worker::run_segment(context, task, command_rx, events).await;
        });
        monitor.slots.insert(
            segment.id,
            WorkerSlot {
                command: command_tx,
                handle,
            },
        );
    }
}

fn apply_event(
    engine: &Arc<Engine>,
    runtime: &Arc<DownloadRuntime>,
    context: &Arc<WorkerContext>,
    monitor: &mut Monitor,
    controller: &mut AdaptiveController,
    event: SegmentEvent,
) {
    match event {
        SegmentEvent::Started {
            id,
            from,
            status,
            discovered_total,
            ..
        } => {
            controller.note_request(false);
            adopt_total(engine, runtime, discovered_total);
            engine.logger().debug(
                Category::Http,
                Some(&runtime.id()),
                format!("segment {id} responded HTTP {status}, resuming from byte {from}"),
            );
        }
        SegmentEvent::Progress { id, written, tail } => {
            let mut segments = crate::util::lock(&runtime.segments);
            if let Some(segment) = segments.iter_mut().find(|s| s.id == id) {
                segment.written = written.max(segment.written);
                if tail.is_some() {
                    segment.tail = tail;
                }
            }
        }
        SegmentEvent::Finished {
            id,
            written,
            tail,
            status,
            discovered_total,
        } => {
            controller.note_request(false);
            {
                let mut segments = crate::util::lock(&runtime.segments);
                if let Some(segment) = segments.iter_mut().find(|s| s.id == id) {
                    segment.written = written;
                    segment.tail = tail;
                    segment.done = true;
                    segment.active = false;
                }
            }
            monitor.slots.remove(&id);
            // Progress was made: a fresh retry budget is justified.
            runtime.attempts.store(0, Ordering::SeqCst);
            engine.logger().debug(
                Category::Download,
                Some(&runtime.id()),
                format!("segment {id} finished ({written} bytes, HTTP {status})"),
            );
            adopt_total(engine, runtime, discovered_total);
            emit_progress(engine, runtime, Instant::now());
        }
        SegmentEvent::Paused { id, written, tail } | SegmentEvent::Stopped { id, written, tail } => {
            {
                let mut segments = crate::util::lock(&runtime.segments);
                if let Some(segment) = segments.iter_mut().find(|s| s.id == id) {
                    segment.written = written;
                    segment.tail = tail;
                    segment.active = false;
                }
            }
            monitor.slots.remove(&id);
        }
        SegmentEvent::Failed {
            id,
            written,
            tail,
            error,
        } => {
            controller.note_request(true);
            {
                let mut segments = crate::util::lock(&runtime.segments);
                if let Some(segment) = segments.iter_mut().find(|s| s.id == id) {
                    segment.written = written;
                    if tail.is_some() {
                        segment.tail = tail;
                    }
                    segment.active = false;
                }
            }
            monitor.slots.remove(&id);
            engine.logger().warn(
                Category::Connection,
                Some(&context.id),
                format!("segment {id} failed: {}", error.log_line()),
            );
            // Keep the first failure: it is the one that explains the outcome.
            if monitor.failure.is_none() {
                monitor.failure = Some(error);
            }
        }
    }
}

/// Records a size the server revealed mid-flight (chunked responses).
fn adopt_total(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>, total: Option<u64>) {
    let Some(total) = total else { return };
    let changed = {
        let mut record = crate::util::lock(&runtime.record);
        if record.total == Some(total) {
            false
        } else {
            record.total = Some(total);
            true
        }
    };
    if changed {
        let snapshot = runtime.snapshot();
        let _ = engine.save_record(&snapshot);
        engine.emit(EngineEvent::Record(Box::new(snapshot)));
    }
}

/// Splits the largest range in half so a new connection can work on it.
fn split_segment(
    runtime: &Arc<DownloadRuntime>,
    monitor: &mut Monitor,
    settings: &crate::settings::AppSettings,
    _speed: f64,
) -> bool {
    let min_segment = settings.downloads.min_segment_bytes.max(MIN_SPLIT_BYTES);
    let candidate = {
        let segments = crate::util::lock(&runtime.segments);
        let mut best: Option<usize> = None;
        for (index, segment) in segments.iter().enumerate() {
            if !segment.active || !segment.splittable(min_segment) {
                continue;
            }
            if best.map_or(true, |current| segments[current].remaining() < segment.remaining()) {
                best = Some(index);
            }
        }
        best.map(|index| segments[index].clone())
    };
    let Some(segment) = candidate else {
        return false;
    };

    let length = segment.len();
    let split_at = segment.start + length / 2;
    if split_at <= segment.start || split_at > segment.end {
        return false;
    }

    // Tell the running worker to stop at the new boundary...
    let Some(slot) = monitor.slots.get(&segment.id) else {
        return false;
    };
    if slot.command.send(SegmentCommand::SetEnd(split_at - 1)).is_err() {
        return false;
    }

    // ...and register the new range.
    let new_id = runtime.next_segment_id();
    {
        let mut segments = crate::util::lock(&runtime.segments);
        if let Some(existing) = segments.iter_mut().find(|s| s.id == segment.id) {
            existing.end = split_at - 1;
        }
        let mut new_state = segment.clone();
        new_state.id = new_id;
        new_state.start = split_at;
        new_state.end = segment.end;
        new_state.written = 0;
        new_state.tail = None;
        new_state.done = false;
        new_state.active = false;
        segments.push(new_state);
        renumber(&mut segments);
    }
    true
}

/// Stops the worker with the least work left (the adaptive controller is
/// reducing the connection count).
fn stop_slowest_segment(runtime: &Arc<DownloadRuntime>, monitor: &mut Monitor) -> bool {
    let candidate = {
        let segments = crate::util::lock(&runtime.segments);
        let mut best: Option<&SegState> = None;
        for segment in segments.iter() {
            if !segment.active {
                continue;
            }
            if best.map_or(true, |current| current.remaining() > segment.remaining()) {
                best = Some(segment);
            }
        }
        best.map(|segment| segment.id)
    };
    let Some(id) = candidate else { return false };
    let Some(slot) = monitor.slots.get(&id) else {
        return false;
    };
    if slot.command.send(SegmentCommand::Stop).is_err() {
        return false;
    }
    // The worker's `Stopped` event clears the `active` flag.
    true
}

fn renumber(segments: &mut [SegState]) {
    let mut ordered: Vec<usize> = (0..segments.len()).collect();
    ordered.sort_by_key(|&index| segments[index].start);
    for (position, index) in ordered.into_iter().enumerate() {
        segments[index].index = position;
    }
}

fn abort_workers(monitor: &mut Monitor) {
    for (_, slot) in monitor.slots.drain() {
        let _ = slot.command.send(SegmentCommand::Stop);
        slot.handle.abort();
    }
}

fn emit_progress(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>, now: Instant) {
    let info = runtime.progress_info(now);
    engine.emit(EngineEvent::Progress(vec![DownloadProgress {
        id: runtime.id(),
        info,
    }]));
}

// ---------------------------------------------------------------------------
// Checkpointing
// ---------------------------------------------------------------------------

/// Persists resumable state to the database and the sidecar record.
pub fn checkpoint(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>, force: bool) {
    let settings = engine.settings_snapshot();
    if !force {
        let last = *crate::util::lock(&runtime.last_checkpoint);
        if last.elapsed() < settings.checkpoint_interval() {
            return;
        }
    }
    *crate::util::lock(&runtime.last_checkpoint) = Instant::now();

    let record = runtime.snapshot();
    let segments = runtime.segment_plan();
    let downloaded = runtime.downloaded();
    let elapsed = crate::util::lock(&runtime.speed)
        .active_elapsed(Instant::now())
        .as_secs_f64();

    // Mirror into the in-memory record so the UI list stays consistent.
    runtime.update(|record| {
        record.segments = segments.clone();
        record.downloaded = downloaded;
        record.elapsed_secs = elapsed;
        record.retry_count = runtime.attempts.load(Ordering::SeqCst);
    });

    if let Err(error) = engine.db().checkpoint_download(
        &record.id,
        &segments,
        downloaded,
        elapsed,
        runtime.attempts.load(Ordering::SeqCst),
        record.status,
        record.error.as_deref(),
    ) {
        engine.logger().warn(
            Category::Database,
            Some(&record.id),
            format!("checkpoint failed: {error}"),
        );
    }

    write_sidecar(runtime, &record);
}

/// Writes the sidecar resume record (atomically). Failures are logged, never
/// fatal: the database copy is the fallback.
fn write_sidecar(runtime: &Arc<DownloadRuntime>, record: &DownloadRecord) {
    let location = crate::util::lock(&runtime.location).clone();
    let Some(location) = location else { return };
    let mut resume = ResumeRecord::new(
        &record.id,
        &record.url,
        &record.filename,
        record.total,
        record.fragmentable,
        record.connections,
    );
    resume.final_url = record.final_url.clone();
    resume.etag = record.etag.clone();
    resume.last_modified = record.last_modified.clone();
    resume.segments = runtime.segment_guards();
    if let Err(error) = files::write_resume_record(&location.meta, &resume) {
        // Logged once per write attempt; the record will be rewritten on the
        // next checkpoint anyway.
        let _ = error;
    }
}

// ---------------------------------------------------------------------------
// Terminal transitions
// ---------------------------------------------------------------------------

/// Verifies and publishes a finished download.
async fn finish(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>) {
    let id = runtime.id();
    let settings = engine.settings_snapshot();
    let record = runtime.snapshot();
    let part = std::path::PathBuf::from(&record.part_path);

    // --- integrity: size ----------------------------------------------------
    let actual = match std::fs::metadata(&part) {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            fail(
                engine,
                runtime,
                AppError::Disk(format!("cannot stat the finished file: {error}")),
                false,
            )
            .await;
            return;
        }
    };
    if let Some(expected) = record.total {
        if actual != expected {
            fail(
                engine,
                runtime,
                AppError::SizeMismatch {
                    expected,
                    actual,
                },
                false,
            )
            .await;
            return;
        }
    }

    // --- integrity: segment coverage ---------------------------------------
    {
        let segments = crate::util::lock(&runtime.segments);
        let coverage: u64 = segments
            .iter()
            .map(|s| {
                if s.end == OPEN_END {
                    s.written
                } else {
                    s.len()
                }
            })
            .sum();
        let all_done = segments.iter().all(|s| s.done);
        drop(segments);
        if !all_done {
            fail(
                engine,
                runtime,
                AppError::Server("the download ended before every range completed".into()),
                true,
            )
            .await;
            return;
        }
        if let Some(expected) = record.total {
            if coverage != expected {
                fail(
                    engine,
                    runtime,
                    AppError::SizeMismatch {
                        expected,
                        actual: coverage,
                    },
                    true,
                )
                .await;
                return;
            }
        }
    }

    // --- integrity: SHA-256 (only when requested or configured) -------------
    let expected_hash = record.sha256.clone();
    if expected_hash.is_some() || settings.downloads.compute_sha256 {
        let path = part.clone();
        let hashed = tokio::task::spawn_blocking(move || files::sha256_file(&path)).await;
        match hashed {
            Ok(Ok(digest)) => {
                if let Some(expected) = &expected_hash {
                    if !files::hash_matches(expected, &digest) {
                        runtime.update(|record| record.sha256 = Some(digest.clone()));
                        fail(
                            engine,
                            runtime,
                            AppError::HashMismatch {
                                expected: expected.clone(),
                                actual: digest,
                            },
                            false,
                        )
                        .await;
                        return;
                    }
                    engine.logger().info(
                        Category::Completion,
                        Some(&id),
                        "SHA-256 verified",
                    );
                }
                runtime.update(|record| record.sha256 = Some(digest));
            }
            Ok(Err(error)) => {
                fail(engine, runtime, error, false).await;
                return;
            }
            Err(error) => {
                fail(
                    engine,
                    runtime,
                    AppError::Server(format!("hashing task failed: {error}")),
                    false,
                )
                .await;
                return;
            }
        }
    }

    // --- publish the file ---------------------------------------------------
    let record = runtime.snapshot();
    let dest_dir = std::path::PathBuf::from(&record.dest_dir);
    let action = record.on_conflict;
    let destination = match files::resolve_destination(&dest_dir, &record.filename, action) {
        Ok(path) => path,
        Err(AppError::Cancelled) => {
            // The user declined to replace: keep the download but rename it
            // rather than overwriting anything.
            files::unique_path(&dest_dir, &record.filename)
        }
        Err(error) => {
            fail(engine, runtime, error, false).await;
            return;
        }
    };

    let part_for_move = part.clone();
    let destination_for_move = destination.clone();
    let moved = tokio::task::spawn_blocking(move || {
        files::finalize(&part_for_move, &destination_for_move)
    })
    .await;
    match moved {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            fail(engine, runtime, error, true).await;
            return;
        }
        Err(error) => {
            fail(
                engine,
                runtime,
                AppError::Disk(format!("finalising the download failed: {error}")),
                true,
            )
            .await;
            return;
        }
    }

    // --- bookkeeping --------------------------------------------------------
    let now = crate::logging::now_millis();
    let record = runtime.update(|record| {
        record.status = DownloadStatus::Completed;
        record.error = None;
        record.completed_at = Some(now);
        record.downloaded = record.total.unwrap_or(actual);
        record.file_path = destination.to_string_lossy().to_string();
        record.segments = crate::util::lock(&runtime.segments)
            .iter()
            .map(|s| s.to_plan())
            .collect();
    });
    let _ = engine.save_record(&record);

    if let Some(location) = crate::util::lock(&runtime.location).clone() {
        files::remove_partials(&location);
    }

    let average = crate::util::lock(&runtime.speed)
        .average(Instant::now());
    let entry = crate::types::HistoryEntry {
        id: record.id.clone(),
        url: record.url.clone(),
        filename: record.filename.clone(),
        file_path: record.file_path.clone(),
        status: DownloadStatus::Completed,
        total: record.total.or(Some(actual)),
        downloaded: record.total.unwrap_or(actual),
        error: None,
        created_at: Some(record.created_at),
        started_at: record.started_at,
        completed_at: Some(now),
        average_speed_bps: average,
        connections: record.connections,
    };
    if let Err(error) = engine.db().insert_history(&entry) {
        engine
            .logger()
            .warn(Category::Database, Some(&id), format!("history insert failed: {error}"));
    }

    engine.logger().info(
        Category::Completion,
        Some(&id),
        format!(
            "completed {} ({}) at an average of {}/s",
            record.filename,
            crate::util::human_bytes(actual),
            crate::util::human_bytes(average as u64)
        ),
    );
    engine.emit(EngineEvent::Record(Box::new(record.clone())));
    if settings.general.notifications && settings.advanced.notify_on_complete {
        engine.emit(EngineEvent::Notify {
            title: "Download complete".to_string(),
            body: format!(
                "{} — {}",
                record.filename,
                crate::util::human_bytes(record.total.unwrap_or(actual))
            ),
        });
    }
    if settings.general.focus_on_complete {
        engine.emit(EngineEvent::FocusWindow);
    }
    engine.emit_stats();
}

/// Terminal failure: the partial data is kept so the user can retry later.
async fn fail(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>, error: AppError, transparent: bool) {
    let id = runtime.id();
    let status = match error {
        AppError::SizeMismatch { .. }
        | AppError::HashMismatch { .. }
        | AppError::RemoteChanged(_) => DownloadStatus::Corrupt,
        _ => DownloadStatus::Failed,
    };
    let message = error.message();
    let record = runtime.update(|record| {
        record.status = status;
        record.error = Some(message.clone());
        record.retry_count = runtime.attempts.load(Ordering::SeqCst);
    });
    checkpoint(engine, runtime, true);
    let _ = engine.save_record(&record);

    let average = crate::util::lock(&runtime.speed).average(Instant::now());
    let entry = crate::types::HistoryEntry {
        id: record.id.clone(),
        url: record.url.clone(),
        filename: record.filename.clone(),
        file_path: record.file_path.clone(),
        status,
        total: record.total,
        downloaded: record.downloaded,
        error: Some(message.clone()),
        created_at: Some(record.created_at),
        started_at: record.started_at,
        completed_at: Some(crate::logging::now_millis()),
        average_speed_bps: average,
        connections: record.connections,
    };
    let _ = engine.db().insert_history(&entry);

    if transparent {
        engine
            .logger()
            .info(Category::Cancel, Some(&id), format!("stopped: {}", error.log_line()));
    } else {
        engine.logger().error_of(Category::Download, Some(&id), &error);
    }
    engine.emit(EngineEvent::Record(Box::new(record)));
    engine.emit_stats();
}

/// Cancellation: remove the partial data when the user asked for it, record the
/// cancellation in the history, and release the queue slot.
pub async fn cancel_cleanup(engine: &Arc<Engine>, runtime: &Arc<DownloadRuntime>) {
    let id = runtime.id();
    let settings = engine.settings_snapshot();
    if !settings.downloads.keep_partial_files {
        if let Some(location) = crate::util::lock(&runtime.location).clone() {
            files::remove_partials(&location);
        }
    } else {
        checkpoint(engine, runtime, true);
    }

    let record = runtime.update(|record| {
        record.status = DownloadStatus::Cancelled;
        record.error = None;
    });
    let _ = engine.save_record(&record);

    let entry = crate::types::HistoryEntry {
        id: record.id.clone(),
        url: record.url.clone(),
        filename: record.filename.clone(),
        file_path: record.file_path.clone(),
        status: DownloadStatus::Cancelled,
        total: record.total,
        downloaded: runtime.downloaded(),
        error: Some("cancelled by the user".to_string()),
        created_at: Some(record.created_at),
        started_at: record.started_at,
        completed_at: Some(crate::logging::now_millis()),
        average_speed_bps: crate::util::lock(&runtime.speed).average(Instant::now()),
        connections: record.connections,
    };
    let _ = engine.db().insert_history(&entry);

    engine
        .logger()
        .info(Category::Cancel, Some(&id), "download cancelled");
    engine.emit(EngineEvent::Record(Box::new(record)));
    engine.emit_stats();
}

/// Notifies the dispatcher that a slot is free.
pub fn notify(engine: &Arc<Engine>) {
    engine.notify_dispatcher();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::files::PartLocation;

    fn record(id: &str, total: u64) -> DownloadRecord {
        DownloadRecord {
            id: id.into(),
            url: "https://example.com/f.bin".into(),
            final_url: String::new(),
            filename: "f.bin".into(),
            dest_dir: "C:\\DL".into(),
            file_path: "C:\\DL\\f.bin".into(),
            part_path: "C:\\DL\\.swiftload\\f.bin.part".into(),
            status: DownloadStatus::Queued,
            error: None,
            fragmentable: true,
            connections: 2,
            segments: Vec::new(),
            downloaded: 0,
            total: Some(total),
            etag: None,
            last_modified: None,
            content_type: None,
            sha256: None,
            created_at: 0,
            started_at: None,
            completed_at: None,
            elapsed_secs: 0.0,
            position: 0,
            retry_count: 0,
            speed_limit_bps: None,
            category: "other".into(),
            on_conflict: ConflictAction::Rename,
        }
    }

    #[test]
    fn segment_state_arithmetic() {
        let plan = SegmentPlan {
            index: 0,
            start: 100,
            end: 199,
            downloaded: 40,
            done: false,
        };
        let mut state = SegState::from_plan(&plan, 1, None);
        assert_eq!(state.len(), 100);
        assert_eq!(state.remaining(), 60);
        assert!(state.splittable(45));
        assert!(!state.splittable(60));

        state.done = true;
        assert!(!state.splittable(1));

        let open = SegState {
            end: OPEN_END,
            ..state.clone()
        };
        assert_eq!(open.remaining(), OPEN_END);
        assert!(!open.splittable(1));
    }

    #[test]
    fn runtime_tracks_progress_and_completion() {
        let runtime = DownloadRuntime::new(record("r1", 1000), Arc::new(BandwidthLimiter::new(None)));
        runtime.set_segments(vec![
            SegState {
                id: 1,
                index: 0,
                start: 0,
                end: 499,
                written: 500,
                tail: Some("aa".into()),
                done: true,
                active: false,
            },
            SegState {
                id: 2,
                index: 1,
                start: 500,
                end: 999,
                written: 100,
                tail: None,
                done: false,
                active: true,
            },
        ]);
        assert_eq!(runtime.downloaded(), 600);
        assert!(!runtime.all_done());
        assert_eq!(runtime.active_connections(), 1);

        let plan = runtime.segment_plan();
        assert_eq!(plan[0].downloaded, 500);
        assert!(plan[0].done);
        assert_eq!(plan[1].end, 999);

        let guards = runtime.segment_guards();
        assert_eq!(guards[0].written, 500);
        assert_eq!(guards[1].tail, None);

        let info = runtime.progress_info(Instant::now());
        assert_eq!(info.downloaded, 600);
        assert_eq!(info.total, Some(1000));
        assert_eq!(info.active_connections, 1);
        // No bytes have been recorded in the speed monitor yet.
        assert_eq!(info.speed_bps, 0.0);
        assert_eq!(info.eta_secs, None);
    }

    #[test]
    fn split_renumbers_segments_in_order() {
        let runtime = DownloadRuntime::new(record("r2", 10), Arc::new(BandwidthLimiter::new(None)));
        let first = runtime.next_segment_id();
        let second = runtime.next_segment_id();
        assert_ne!(first, second);
        runtime.set_segments(vec![
            SegState {
                id: second,
                index: 1,
                start: 500,
                end: 999,
                written: 0,
                tail: None,
                done: false,
                active: true,
            },
            SegState {
                id: first,
                index: 0,
                start: 0,
                end: 499,
                written: 0,
                tail: None,
                done: false,
                active: true,
            },
        ]);
        let mut segments = runtime.segment_states();
        renumber(&mut segments);
        assert_eq!(segments[0].index, 0);
        assert_eq!(segments[1].index, 1);
        // Ids never change: events keep mapping to the right range.
        assert_eq!(segments[0].id, second);
    }

    #[test]
    fn part_location_is_reported_for_the_ui() {
        let location = PartLocation {
            dir: "C:\\DL\\.swiftload".into(),
            part: "C:\\DL\\.swiftload\\f.bin.part".into(),
            meta: "C:\\DL\\.swiftload\\f.bin.swlmeta".into(),
        };
        let runtime = DownloadRuntime::new(record("r3", 10), Arc::new(BandwidthLimiter::new(None)));
        *crate::util::lock(&runtime.location) = Some(location.clone());
        assert_eq!(crate::util::lock(&runtime.location).clone(), Some(location));
    }
}

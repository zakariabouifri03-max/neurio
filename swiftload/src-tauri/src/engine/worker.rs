//! Download worker — one task per connection, streaming a byte range to disk.
//!
//! ## Byte accounting
//! Two counters are kept strictly apart:
//!
//! * `committed` — bytes that have been **written to the file**; every progress
//!   report, every resume boundary and the final size check use this number;
//! * `received` — bytes sitting in the write buffer, used only to decide when to
//!   flush and how many bytes are still missing from the range.
//!
//! Because the UI and the on-disk state can therefore never disagree, a pause, a
//! network failure or a crash cannot leave the application claiming bytes the
//! file does not contain.
//!
//! ## Cancellation semantics
//! Every stop is graceful: the pending buffer is flushed, a tail guard is
//! recorded and exactly one terminal event is sent. The engine decides what a
//! stop *means* (paused, cancelled, retried, re-planned).
//!
//! ## Pause
//! Pausing sets a flag *and* wakes the worker's `select!`, so the in-flight
//! socket read is dropped at once and the connection is released. No bytes are
//! read while paused — the transfer really stops.

use std::fs::File;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use tokio::sync::{mpsc, Notify};
use tokio_stream::StreamExt;

use crate::error::{AppError, Result};
use crate::logging::{Category, Logger};
use crate::net::{self, HttpClient};
use crate::types::{SegmentPlan, OPEN_END};

use super::files::{tail_guard, verify_guard, write_at_blocking, GUARD_LEN};
use super::limiter::{BandwidthLimiter, MAX_SINGLE_WAIT};
use super::speed::SpeedMonitor;

/// Largest slice handed to the limiter/writer at once: bounds throttling
/// granularity and keeps pause/cancel latency in the millisecond range.
const MAX_SLICE: usize = 128 * 1024;

/// How often progress is reported while bytes are flowing.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);

// ---------------------------------------------------------------------------
// Pause / cancel signalling
// ---------------------------------------------------------------------------

/// Pause and cancel flags with wake-ups, shared by the engine and its workers.
#[derive(Debug, Default)]
pub struct Gates {
    paused: AtomicBool,
    cancelled: AtomicBool,
    pause_notify: Notify,
    cancel_notify: Notify,
}

/// What interrupted a worker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interruption {
    Pause,
    Cancel,
}

impl Gates {
    pub fn new() -> Arc<Gates> {
        Arc::new(Gates::default())
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
        self.pause_notify.notify_waiters();
    }

    pub fn unpause(&self) {
        self.paused.store(false, Ordering::SeqCst);
        // Notify on resume as well: a waiter that registered after the pause
        // notification must still be able to observe the cleared flag.
        self.pause_notify.notify_waiters();
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.cancel_notify.notify_waiters();
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Resolves as soon as the download is paused.
    ///
    /// Cancel-safe: the notification future is registered *before* the flag is
    /// re-checked, which closes the race between observing the flag as `false`
    /// and the notification being delivered.
    pub async fn pause_requested(&self) {
        loop {
            let notified = self.pause_notify.notified();
            if self.is_paused() {
                return;
            }
            notified.await;
        }
    }

    /// Resolves as soon as the download is cancelled.
    pub async fn cancelled(&self) {
        loop {
            let notified = self.cancel_notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

// ---------------------------------------------------------------------------
// Engine <-> worker messages
// ---------------------------------------------------------------------------

/// Commands the engine sends to a running worker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SegmentCommand {
    /// Shrink the range (the adaptive controller is adding a connection).
    SetEnd(u64),
    /// Stop gracefully, keeping every flushed byte (removing a connection).
    Stop,
}

/// Everything a worker reports back.
#[derive(Debug, Clone)]
pub enum SegmentEvent {
    /// The HTTP response was accepted: reports the effective resume offset, the
    /// status code, and any size discovered from the response.
    Started {
        id: u64,
        from: u64,
        status: u16,
        discovered_total: Option<u64>,
        accept_ranges: bool,
    },
    /// Bytes written to the file (absolute within the segment).
    Progress {
        id: u64,
        written: u64,
        tail: Option<String>,
    },
    Finished {
        id: u64,
        written: u64,
        tail: Option<String>,
        status: u16,
        discovered_total: Option<u64>,
    },
    Paused {
        id: u64,
        written: u64,
        tail: Option<String>,
    },
    /// Stopped on request (connection count reduced) or cancelled; the engine
    /// distinguishes the two by looking at the download's cancel flag.
    Stopped {
        id: u64,
        written: u64,
        tail: Option<String>,
    },
    Failed {
        id: u64,
        written: u64,
        tail: Option<String>,
        error: AppError,
    },
}

impl SegmentEvent {
    /// Identity of the range this event belongs to (stable across splits).
    pub fn segment_id(&self) -> u64 {
        match self {
            SegmentEvent::Started { id, .. }
            | SegmentEvent::Progress { id, .. }
            | SegmentEvent::Finished { id, .. }
            | SegmentEvent::Paused { id, .. }
            | SegmentEvent::Stopped { id, .. }
            | SegmentEvent::Failed { id, .. } => *id,
        }
    }
}

/// Immutable description of the range a worker must fetch.
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentTask {
    /// Stable identity assigned by the engine (survives range splits).
    pub id: u64,
    /// Display order of the range.
    pub index: usize,
    pub start: u64,
    /// Inclusive end; [`OPEN_END`] means "until the server closes the body".
    pub end: u64,
    /// Bytes of this segment already on disk (validated by the caller).
    pub resume_from: u64,
    /// Tail guard for that boundary.
    pub guard: Option<String>,
}

impl SegmentTask {
    pub fn from_plan(plan: &SegmentPlan, id: u64, guard: Option<String>) -> Self {
        Self {
            id,
            index: plan.index,
            start: plan.start,
            end: plan.end,
            resume_from: plan.downloaded,
            guard,
        }
    }

    /// Bytes this range covers, if the end is known.
    pub fn length(&self) -> Option<u64> {
        expected_for(self.end, self.start)
    }
}

/// Shared, immutable context for every worker of one download.
pub struct WorkerContext {
    pub id: String,
    pub client: HttpClient,
    pub logger: Logger,
    pub file: Arc<File>,
    pub gates: Arc<Gates>,
    pub limiter: Arc<BandwidthLimiter>,
    pub speed: Arc<Mutex<SpeedMonitor>>,
    pub url: url::Url,
    pub auth: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// Whether the server proved byte-range support.
    pub range_ok: bool,
    /// `true` when the plan consists of a single segment covering the whole file.
    pub single_stream: bool,
    /// Validate resume boundaries before trusting them.
    pub validate_resume: bool,
    /// File write buffer size in bytes.
    pub write_buffer: usize,
    pub stall_timeout: Option<Duration>,
}

impl WorkerContext {
    /// Shared speed monitor for tests and the engine.
    pub fn speed_monitor(&self) -> &Mutex<SpeedMonitor> {
        &self.speed
    }
}

/// Terminal states a worker can report.
enum Terminal {
    Finished {
        status: u16,
        discovered_total: Option<u64>,
    },
    Interrupted(Interruption),
    Failed(AppError),
}

/// Runs one connection until its range is complete, an interruption arrives, or
/// a failure occurs. Always sends exactly one terminal event.
pub async fn run_segment(
    context: Arc<WorkerContext>,
    mut task: SegmentTask,
    mut commands: mpsc::UnboundedReceiver<SegmentCommand>,
    events: mpsc::UnboundedSender<SegmentEvent>,
) {
    let id = task.id;
    let outcome = match work(&context, &mut task, &mut commands, &events).await {
        Ok(terminal) => terminal,
        Err(error) => Terminal::Failed(error),
    };

    let written = task.resume_from;
    let tail = task.guard.clone();
    let event = match outcome {
        Terminal::Finished {
            status,
            discovered_total,
        } => SegmentEvent::Finished {
            id,
            written,
            tail,
            status,
            discovered_total,
        },
        Terminal::Interrupted(Interruption::Pause) => SegmentEvent::Paused { id, written, tail },
        Terminal::Interrupted(Interruption::Cancel) => SegmentEvent::Stopped { id, written, tail },
        Terminal::Failed(error) => SegmentEvent::Failed {
            id,
            written,
            tail,
            error,
        },
    };
    let _ = events.send(event);
}

/// Outcome of one `select!` round.
enum SelectOutcome {
    Data(Option<Bytes>),
    Interrupted,
}

/// The worker's body: issue the request, then stream the body to disk.
async fn work(
    context: &Arc<WorkerContext>,
    task: &mut SegmentTask,
    commands: &mut mpsc::UnboundedReceiver<SegmentCommand>,
    events: &mpsc::UnboundedSender<SegmentEvent>,
) -> Result<Terminal> {
    // --- 1. Trust nothing on disk until the guard proves it ------------------
    if task.resume_from > 0 && context.validate_resume {
        let boundary = task.start + task.resume_from;
        let valid = verify_guard(&context.file, boundary, task.resume_from, task.guard.as_deref())
            .unwrap_or(false);
        if !valid {
            context.logger.warn(
                Category::Resume,
                Some(&context.id),
                format!(
                    "segment {0}: resume boundary at byte {boundary} failed its integrity check, re-downloading that range",
                    task.index
                ),
            );
            task.resume_from = 0;
            task.guard = None;
        }
    }

    // --- 2. Request ----------------------------------------------------------
    let range = request_range(task, context.range_ok);
    let validator = net::if_range_validator(context.etag.as_deref(), context.last_modified.as_deref());
    let response = context
        .client
        .get(&context.url, range, validator.as_deref(), context.auth.as_deref())
        .await?;

    let status = response.status();
    let mut discovered_total: Option<u64> = None;

    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        // Verify the server honoured *our* offset instead of assuming it did:
        // an ignored Range header would silently corrupt a fragmented file.
        let content_range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(net::parse_content_range);
        let Some(content_range) = content_range else {
            return Err(AppError::RangeUnsupported(
                "the server sent a partial response without a usable Content-Range header".into(),
            ));
        };
        let expected_start = task.start + task.resume_from;
        if content_range.start != expected_start {
            return Err(AppError::RemoteChanged(format!(
                "asked for byte {expected_start} but the server started at {}",
                content_range.start
            )));
        }
        if let Some(total) = content_range.total {
            discovered_total = Some(total);
            if let Some(expected) = task_expected_total(task) {
                if total != expected {
                    return Err(AppError::RemoteChanged(format!(
                        "the file is now {total} bytes, it was {expected} bytes"
                    )));
                }
            }
        }
        if task.end == OPEN_END {
            // Open-ended range: the server tells us where the file ends.
            task.end = content_range.end;
        } else if content_range.end < task.end {
            return Err(AppError::RemoteChanged(format!(
                "the server returned bytes {}-{} but {} was the requested end",
                content_range.start, content_range.end, task.end
            )));
        }
    } else if status == reqwest::StatusCode::OK {
        // A full-body response is only acceptable when this worker asked for the
        // whole file from byte zero.
        let whole_file_request = task.start == 0 && task.resume_from == 0;
        if !whole_file_request || !(context.single_stream || task.end == OPEN_END) {
            return Err(if validator.is_some() && task.resume_from > 0 {
                AppError::RemoteChanged(
                    "the server sent the whole file instead of the requested range, so the file changed"
                        .into(),
                )
            } else {
                AppError::RangeUnsupported(
                    "the server ignored the byte range request and does not support resuming".into(),
                )
            });
        }
        let length = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        if let Some(total) = length {
            if total == 0 {
                return Err(AppError::Server("the server reported a zero-length file".into()));
            }
            discovered_total = Some(total);
            task.end = if context.single_stream {
                task.start + total - 1
            } else {
                task.end
            };
        }
    } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        // Everything requested is already on disk.
        if let Some(length) = task.length() {
            if task.resume_from >= length {
                task.resume_from = length;
                return Ok(Terminal::Finished {
                    status: 416,
                    discovered_total,
                });
            }
        }
        return Err(AppError::RangeUnsupported(
            "the server rejected the byte range (HTTP 416)".into(),
        ));
    } else {
        return Err(AppError::http(
            status.as_u16(),
            status.canonical_reason().unwrap_or(""),
            net::parse_retry_after(response.headers()),
        ));
    }

    let accept_ranges = net::response_accepts_ranges(response.headers());
    let status_code = status.as_u16();
    let _ = events.send(SegmentEvent::Started {
        id: task.id,
        from: task.resume_from,
        status: status_code,
        discovered_total,
        accept_ranges,
    });

    // --- 3. Stream the body into the file -----------------------------------
    let mut committed = task.resume_from;
    let mut buffer: Vec<u8> = Vec::with_capacity(context.write_buffer + MAX_SLICE);
    let mut tail_window: Vec<u8> = Vec::with_capacity(GUARD_LEN);
    if committed > 0 {
        if let Some(guard) = task.guard.as_deref() {
            if let Ok(bytes) = hex::decode(guard) {
                tail_window.extend_from_slice(&bytes);
            }
        }
    }
    let mut stream = response.bytes_stream();

    let mut stall_logged = false;
    loop {
        // ---- terminal flag checks (cheap, no await) ----
        if context.gates.is_cancelled() {
            stop(
                context,
                task,
                &mut buffer,
                &mut committed,
                &mut tail_window,
                events,
            )?;
            return Ok(Terminal::Interrupted(Interruption::Cancel));
        }
        if context.gates.is_paused() {
            stop(
                context,
                task,
                &mut buffer,
                &mut committed,
                &mut tail_window,
                events,
            )?;
            return Ok(Terminal::Interrupted(Interruption::Pause));
        }

        // ---- complete? ----
        if let Some(expected) = expected_for(task.end, task.start) {
            if committed + buffer.len() as u64 >= expected {
                stop(
                    context,
                    task,
                    &mut buffer,
                    &mut committed,
                    &mut tail_window,
                    events,
                )?;
                context.file.sync_data().map_err(AppError::from)?;
                return Ok(Terminal::Finished {
                    status: status_code,
                    discovered_total,
                });
            }
        }

        // ---- drain commands sent while we were writing ----
        while let Ok(command) = commands.try_recv() {
            match command {
                SegmentCommand::SetEnd(new_end) => {
                    if new_end < task.end {
                        task.end = new_end;
                    }
                }
                SegmentCommand::Stop => {
                    stop(
                        context,
                        task,
                        &mut buffer,
                        &mut committed,
                        &mut tail_window,
                        events,
                    )?;
                    return Ok(Terminal::Interrupted(Interruption::Cancel));
                }
            }
        }

        // ---- wait for the next chunk, racing pause/cancel/commands ----
        let outcome = {
            tokio::select! {
                    biased;
                    _ = context.gates.cancelled() => SelectOutcome::Interrupted,
                    _ = context.gates.pause_requested() => SelectOutcome::Interrupted,
                    command = commands.recv() => match command {
                        Some(SegmentCommand::SetEnd(new_end)) => {
                            if new_end < task.end {
                                task.end = new_end;
                            }
                            continue;
                        }
                        Some(SegmentCommand::Stop) | None => SelectOutcome::Interrupted,
                    },
                    result = next_chunk(context.stall_timeout, &mut stream) => match result {
                        Ok(chunk) => SelectOutcome::Data(chunk),
                        Err(error) => {
                            if !stall_logged {
                                context.logger.warn(
                                    Category::Connection,
                                    Some(&context.id),
                                    format!("segment {}: {}", task.index, error.log_line()),
                                );
                                stall_logged = true;
                            }
                            return Err(error);
                        }
                    },
                }
        };

        let Some(chunk) = (match outcome {
            SelectOutcome::Interrupted => continue,
            SelectOutcome::Data(chunk) => chunk,
        }) else {
            // ---- clean end of body ----
            stop(
                context,
                task,
                &mut buffer,
                &mut committed,
                &mut tail_window,
                events,
            )?;
            context.file.sync_data().map_err(AppError::from)?;

            if let Some(expected) = expected_for(task.end, task.start) {
                if committed < expected {
                    // A short body for an explicit range means the response was
                    // truncated; the bytes we have are safe, the rest is retried.
                    return Err(AppError::SizeMismatch {
                        expected,
                        actual: committed,
                    });
                }
            }
            let discovered = if task.end == OPEN_END {
                Some(task.start + committed)
            } else {
                discovered_total
            };
            return Ok(Terminal::Finished {
                status: status_code,
                discovered_total: discovered,
            });
        };

        // ---- write the chunk in bounded slices ----
        let mut cursor = 0usize;
        let mut completed_range = false;
        while cursor < chunk.len() {
            let room = match expected_for(task.end, task.start) {
                Some(expected) => expected.saturating_sub(committed + buffer.len() as u64),
                None => u64::MAX,
            };
            if room == 0 {
                completed_range = true;
                break;
            }
            let slice_len = MAX_SLICE
                .min(chunk.len() - cursor)
                .min(room.min(usize::MAX as u64) as usize);
            if slice_len == 0 {
                break;
            }
            let slice = &chunk[cursor..cursor + slice_len];
            cursor += slice_len;

            buffer.extend_from_slice(slice);
            if let Ok(mut speed) = context.speed.lock() {
                speed.record(slice_len as u64, Instant::now());
            }

            if buffer.len() >= context.write_buffer {
                commit(
                    context,
                    task,
                    &mut buffer,
                    &mut committed,
                    &mut tail_window,
                    events,
                    false,
                )?;
            }

            // Throttle at the network side: the limiter decides how long the
            // next slice must wait.
            let delay = context.limiter.consume(slice_len as u64);
            if delay > Duration::ZERO {
                if let Some(interruption) = throttle_sleep(&context.gates, delay).await {
                    stop(
                        context,
                        task,
                        &mut buffer,
                        &mut committed,
                        &mut tail_window,
                        events,
                    )?;
                    return Ok(Terminal::Interrupted(interruption));
                }
            }

            if let Some(expected) = expected_for(task.end, task.start) {
                if committed + buffer.len() as u64 >= expected {
                    completed_range = true;
                    break;
                }
            }
        }

        if completed_range {
            stop(
                context,
                task,
                &mut buffer,
                &mut committed,
                &mut tail_window,
                events,
            )?;
            context.file.sync_data().map_err(AppError::from)?;
            return Ok(Terminal::Finished {
                status: status_code,
                discovered_total,
            });
        }
    }
}

/// `Range` header for this task, or `None` for a plain full-body GET.
fn request_range(task: &SegmentTask, range_ok: bool) -> Option<(u64, u64)> {
    if !range_ok {
        return None;
    }
    let from = task.start + task.resume_from;
    if from == 0 && task.end == OPEN_END {
        // Nothing to resume and no known end: a plain GET is correct.
        return None;
    }
    Some((from, task.end))
}

/// Byte count of `[start, end]`, or `None` for open-ended ranges.
fn expected_for(end: u64, start: u64) -> Option<u64> {
    if end == OPEN_END {
        None
    } else {
        Some(end.saturating_sub(start).saturating_add(1))
    }
}

fn task_expected_total(task: &SegmentTask) -> Option<u64> {
    if task.end == OPEN_END {
        None
    } else {
        Some(task.end.saturating_add(1))
    }
}

/// Writes the pending buffer to disk, advancing `committed` by exactly the bytes
/// written and refreshing the tail guard. This is the only place bytes become
/// visible to progress reporting.
fn commit(
    context: &Arc<WorkerContext>,
    task: &mut SegmentTask,
    buffer: &mut Vec<u8>,
    committed: &mut u64,
    tail_window: &mut Vec<u8>,
    events: &mpsc::UnboundedSender<SegmentEvent>,
    sync: bool,
) -> Result<()> {
    if !buffer.is_empty() {
        let offset = task.start + *committed;
        write_at_blocking(&context.file, buffer, offset)
            .map_err(|e| AppError::Disk(format!("writing at byte {offset} failed: {e}")))?;
        *committed += buffer.len() as u64;
        push_tail(tail_window, buffer);
        buffer.clear();
    }
    if sync {
        context.file.sync_data().map_err(AppError::from)?;
    }
    task.resume_from = *committed;
    task.guard = tail_guard(tail_window);
    let _ = events.send(SegmentEvent::Progress {
        id: task.id,
        written: *committed,
        tail: task.guard.clone(),
    });
    Ok(())
}

/// Commits the buffer and syncs: used at every stop point so that a paused or
/// interrupted download is durable on disk, not merely scheduled.
fn stop(
    context: &Arc<WorkerContext>,
    task: &mut SegmentTask,
    buffer: &mut Vec<u8>,
    committed: &mut u64,
    tail_window: &mut Vec<u8>,
    events: &mpsc::UnboundedSender<SegmentEvent>,
) -> Result<()> {
    commit(context, task, buffer, committed, tail_window, events, true)
}

fn push_tail(window: &mut Vec<u8>, data: &[u8]) {
    if data.len() >= GUARD_LEN {
        window.clear();
        window.extend_from_slice(&data[data.len() - GUARD_LEN..]);
        return;
    }
    let total = window.len() + data.len();
    if total > GUARD_LEN {
        let drop = total - GUARD_LEN;
        window.drain(..drop);
    }
    window.extend_from_slice(data);
}

/// Waits for the throttle delay, remaining responsive to pause and cancel.
async fn throttle_sleep(gates: &Gates, delay: Duration) -> Option<Interruption> {
    let delay = delay.min(MAX_SINGLE_WAIT);
    tokio::select! {
        biased;
        _ = gates.cancelled() => Some(Interruption::Cancel),
        _ = gates.pause_requested() => Some(Interruption::Pause),
        _ = tokio::time::sleep(delay) => None,
    }
}

/// `stream.next()` with the stall watchdog applied.
async fn next_chunk<S>(stall: Option<Duration>, stream: &mut S) -> Result<Option<Bytes>>
where
    S: tokio_stream::Stream<Item = reqwest::Result<Bytes>> + Unpin,
{
    match stall {
        None => match stream.next().await {
            Some(item) => Ok(Some(item?)),
            None => Ok(None),
        },
        Some(timeout) => match tokio::time::timeout(timeout, stream.next()).await {
            Ok(Some(item)) => Ok(Some(item?)),
            Ok(None) => Ok(None),
            Err(_) => Err(AppError::Timeout(format!(
                "no data received for {} seconds",
                timeout.as_secs()
            ))),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(index: usize, start: u64, end: u64, resume_from: u64) -> SegmentTask {
        SegmentTask {
            id: index as u64 + 1,
            index,
            start,
            end,
            resume_from,
            guard: None,
        }
    }

    #[test]
    fn request_range_matches_the_strategy() {
        assert_eq!(request_range(&task(0, 1024, 2047, 0), true), Some((1024, 2047)));
        assert_eq!(request_range(&task(0, 1024, 2047, 500), true), Some((1524, 2047)));
        assert_eq!(request_range(&task(0, 0, 4095, 1000), true), Some((1000, 4095)));
        // Unknown size, nothing downloaded: no Range header at all.
        assert_eq!(request_range(&task(0, 0, OPEN_END, 0), true), None);
        // Resume of an unknown-size file: open-ended range.
        assert_eq!(request_range(&task(0, 0, OPEN_END, 700), true), Some((700, OPEN_END)));
        // The server does not support ranges: never send one.
        assert_eq!(request_range(&task(0, 1024, 2047, 0), false), None);
    }

    #[test]
    fn expected_lengths() {
        assert_eq!(expected_for(2047, 1024), Some(1024));
        assert_eq!(expected_for(OPEN_END, 1024), None);
        assert_eq!(expected_for(0, 0), Some(1));
    }

    #[test]
    fn tail_window_keeps_the_last_guard_bytes() {
        let mut window = Vec::new();
        push_tail(&mut window, &[1, 2, 3]);
        assert_eq!(window, vec![1, 2, 3]);
        push_tail(&mut window, &[4; 100]);
        assert_eq!(window.len(), GUARD_LEN);
        assert_eq!(window[GUARD_LEN - 1], 4);
        assert_eq!(tail_guard(&window).unwrap().len(), GUARD_LEN * 2);
        assert_eq!(tail_guard(&[]), None);
    }

    #[tokio::test]
    async fn pause_gate_resolves_immediately_when_already_paused() {
        let gates = Gates::new();
        gates.pause();
        tokio::time::timeout(Duration::from_millis(200), gates.pause_requested())
            .await
            .expect("pause_requested hung on an already-paused gate");
        gates.unpause();
        assert!(tokio::time::timeout(Duration::from_millis(50), gates.pause_requested())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn cancel_gate_wakes_waiters() {
        let gates = Gates::new();
        let waiter = {
            let gates = gates.clone();
            tokio::spawn(async move { gates.cancelled().await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        gates.cancel();
        tokio::time::timeout(Duration::from_millis(500), waiter)
            .await
            .expect("cancel did not wake the waiter")
            .unwrap();
    }

    #[tokio::test]
    async fn throttle_sleep_reacts_to_pause() {
        let gates = Gates::new();
        let handle = {
            let gates = gates.clone();
            tokio::spawn(async move { throttle_sleep(&gates, Duration::from_secs(30)).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        gates.pause();
        let result = tokio::time::timeout(Duration::from_millis(500), handle)
            .await
            .expect("throttle_sleep ignored pause")
            .unwrap();
        assert_eq!(result, Some(Interruption::Pause));
    }

    #[tokio::test]
    async fn throttle_sleep_completes_normally() {
        assert_eq!(throttle_sleep(&Gates::new(), Duration::from_millis(10)).await, None);
    }

    /// Bytes must be counted exactly once, at the offsets they were written to.
    #[test]
    fn commit_accounts_bytes_exactly_once() {
        let dir = std::env::temp_dir().join(format!("swiftload-worker-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("f.part");

        let context = Arc::new(WorkerContext {
            id: "test".into(),
            client: HttpClient::build(
                &crate::settings::NetworkSettings {
                    connect_timeout_ms: 1000,
                    stall_timeout_ms: 1000,
                    proxy_mode: crate::settings::ProxyMode::Off,
                    proxy_url: String::new(),
                    no_proxy: String::new(),
                    user_agent: "test".into(),
                    max_redirects: 1,
                    http1_only: true,
                    pool_idle_per_host: 1,
                },
                Logger::memory_only(crate::logging::Level::Error),
            )
            .unwrap(),
            logger: Logger::memory_only(crate::logging::Level::Error),
            file: Arc::new(
                std::fs::OpenOptions::new()
                    .create(true)
                    .read(true)
                    .write(true)
                    .open(&path)
                    .unwrap(),
            ),
            gates: Gates::new(),
            limiter: Arc::new(BandwidthLimiter::new(None)),
            speed: Arc::new(Mutex::new(SpeedMonitor::default())),
            url: url::Url::parse("https://example.com/f.bin").unwrap(),
            auth: None,
            etag: None,
            last_modified: None,
            range_ok: true,
            single_stream: true,
            validate_resume: true,
            write_buffer: 64 * 1024,
            stall_timeout: None,
        });
        let (events, mut receiver) = mpsc::unbounded_channel();
        let mut task = task(0, 0, 99_999, 0);
        let mut committed = 0u64;
        let mut tail = Vec::new();

        let mut buffer = vec![7u8; 1000];
        stop(&context, &mut task, &mut buffer, &mut committed, &mut tail, &events).unwrap();
        assert_eq!(committed, 1000);
        assert!(buffer.is_empty());
        assert_eq!(task.resume_from, 1000);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 1000);

        // An empty commit changes nothing.
        stop(&context, &mut task, &mut buffer, &mut committed, &mut tail, &events).unwrap();
        assert_eq!(committed, 1000);

        // A second segment writes at its own offset.
        let mut task2 = task(1, 1000, 99_999, 0);
        let mut buffer2 = vec![9u8; 500];
        let mut committed2 = 0u64;
        let mut tail2 = Vec::new();
        stop(&context, &mut task2, &mut buffer2, &mut committed2, &mut tail2, &events).unwrap();
        assert_eq!(committed2, 500);

        let mut contents = vec![0u8; 1500];
        {
            use std::io::Read;
            std::fs::File::open(&path)
                .unwrap()
                .read_exact(&mut contents)
                .unwrap();
        }
        assert!(contents[..1000].iter().all(|b| *b == 7));
        assert!(contents[1000..].iter().all(|b| *b == 9));

        // The guard is current for the boundary it reports.
        assert!(verify_guard(&context.file, 500, 500, task2.guard.as_deref()).unwrap());
        assert!(receiver.try_recv().is_ok(), "progress must be reported");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

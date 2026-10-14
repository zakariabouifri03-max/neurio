"""The parallel download engine (Steps B–D).

Design notes
------------
* The engine is **Qt-free**: it communicates through plain callback
  events so it can be unit-tested headlessly.  ``manager.py`` bridges
  events to Qt signals.
* One worker thread per byte-range part.  All workers are submitted to
  a pool sized exactly ``part_count`` so every part starts immediately
  and progresses independently — part 2 never waits for part 1.
* Parts write **in place** into a single preallocated temporary file
  (``<name>.udpart``) using per-worker file handles positioned at the
  part's offset.  There is no post-download merge and therefore **no
  duplicated disk usage** (temporary space = the file size itself).
  "Assembly" (Step D) is verification + checksum + atomic rename.
* Memory is bounded: chunks of :data:`CHUNK_SIZE` bytes are streamed
  straight to disk; a 80 GB game never lives in RAM.
* Servers that ignore ``Range`` (answer 200 to a ranged GET) are
  detected per worker and the engine safely falls back to a single
  full-file stream — never writing the whole file into every part.
* 64-bit safety: all offsets are Python ints (arbitrary precision);
  files are preallocated with ``truncate()`` and written with buffered
  sequential writes per handle.
"""

from __future__ import annotations

import errno
import logging
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

import requests

from .models import (DownloadStatus, DownloadTask, PartState, PartStatus,
                     ProbeResult, RangeSupport)
from .ranges import parse_content_range, split_byte_ranges, validate_coverage
from .speed import CompositeLimiter, RateLimiter, SpeedTracker
from .utils import compute_checksum, compute_eta, format_bytes

log = logging.getLogger(__name__)

#: Streamed write chunk (256 KiB keeps 40 workers under ~10 MiB of RAM).
CHUNK_SIZE = 256 * 1024

#: How often the monitor thread emits progress events.
MONITOR_INTERVAL = 0.25

#: Sentinel end offset for unknown-size single-stream downloads.
_UNKNOWN_END = (1 << 62) - 1


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

class EngineEventType(str, Enum):
    STATE = "state"
    PROGRESS = "progress"
    PARTS = "parts"
    LOG = "log"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class EngineEvent:
    type: EngineEventType
    download_id: Optional[int]
    data: dict = field(default_factory=dict)


EventSink = Callable[[EngineEvent], None]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class EngineError(Exception):
    """Base class for engine errors."""

    kind = "error"


class TransientPartError(EngineError):
    """Worth retrying with backoff (timeouts, 5xx, 429, truncated body…)."""

    kind = "network"


class PermanentPartError(EngineError):
    """Do not retry (404, 401/403, invalid response, disk full…)."""

    kind = "permanent"


class _RangeIgnoredSignal(EngineError):
    """Internal: server answered 200 to a ranged GET → fall back."""

    kind = "range_unsupported"


def _misbehavior(msg: str) -> TransientPartError:
    """Transient error caused by a malformed/unexpected server response
    (not by connection pressure — excluded from adaptive concurrency)."""
    err = TransientPartError(msg)
    err.server_misbehavior = True
    return err


class _WaveAbort(EngineError):
    """Internal: orchestrator wants every worker to stop now."""

    kind = "internal"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class EngineConfig:
    chunk_size: int = CHUNK_SIZE
    connect_timeout: float = 15.0
    read_timeout: float = 60.0
    max_retries: int = 5                 # per part, consecutive failures
    backoff_base: float = 0.5            # exponential backoff base seconds
    backoff_cap: float = 30.0
    speed_limit: int = 0                 # bytes/sec for this download (0=off)
    user_agent: str = "UltraDownload/1.0"
    extra_headers: Dict[str, str] = field(default_factory=dict)
    allow_overwrite: bool = False
    verify_checksum: bool = True
    monitor_interval: float = MONITOR_INTERVAL
    #: shared, process-wide bandwidth limiter (may be None)
    global_limiter: Optional[RateLimiter] = None


# ---------------------------------------------------------------------------
# Adjustable semaphore (adaptive concurrency when a server pushes back)
# ---------------------------------------------------------------------------

class AdjustableSemaphore:
    """Counting semaphore whose permit ceiling can be lowered at runtime."""

    def __init__(self, permits: int) -> None:
        self._cond = threading.Condition()
        self._active = 0
        self._permits = max(1, int(permits))

    @property
    def permits(self) -> int:
        with self._cond:
            return self._permits

    def acquire(self) -> None:
        with self._cond:
            while self._active >= self._permits:
                self._cond.wait(0.2)
            self._active += 1

    def release(self) -> None:
        with self._cond:
            self._active = max(0, self._active - 1)
            self._cond.notify_all()

    def set_permits(self, permits: int) -> None:
        with self._cond:
            self._permits = max(1, int(permits))
            self._cond.notify_all()

    def __enter__(self) -> "AdjustableSemaphore":
        self.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self.release()


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class DownloadEngine:
    """Runs one download task: inspect → split → parallel fetch → verify."""

    def __init__(self,
                 task: DownloadTask,
                 config: Optional[EngineConfig] = None,
                 event_sink: Optional[EventSink] = None,
                 probe: Optional[ProbeResult] = None) -> None:
        self.task = task
        self.config = config or EngineConfig()
        self._sink = event_sink or (lambda evt: None)
        self.probe = probe

        # --- runtime state --------------------------------------------------
        self._parts: List[PartState] = list(task.parts)
        self._trackers: Dict[int, SpeedTracker] = {}
        self._range_mode = False          # set in _prepare()
        self._unknown_size = task.total_size < 0
        self._cancel = threading.Event()
        self._paused = threading.Event()
        self._resume_evt = threading.Event()
        self._abort_wave = threading.Event()
        self._range_ignored = threading.Event()
        self._lock = threading.RLock()
        self._session: Optional[requests.Session] = None
        self._sem: Optional[AdjustableSemaphore] = None
        self._thread: Optional[threading.Thread] = None
        self._monitor_thread: Optional[threading.Thread] = None
        self._running = False
        self._active_connections = 0
        self._active_lock = threading.Lock()
        self._failure_timestamps: List[float] = []
        self._concurrency_reduced = False
        self._fallback_count = 0
        self._final_path = ""
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None

        if task.status in (DownloadStatus.QUEUED, DownloadStatus.PAUSED):
            pass  # keep
        self._status = task.status if task.status != DownloadStatus.COMPLETED \
            else DownloadStatus.QUEUED

    # -- public API ----------------------------------------------------------

    @property
    def parts(self) -> List[PartState]:
        return self._parts

    @property
    def status(self) -> DownloadStatus:
        return self._status

    def downloaded_bytes(self) -> int:
        return sum(p.downloaded for p in self._parts)

    def total_speed(self) -> float:
        return sum(t.speed() for t in self._trackers.values())

    def start(self) -> None:
        """Launch the orchestrator + monitor threads (non-blocking)."""
        with self._lock:
            if self._running:
                return
            self._running = True
        self._cancel.clear()
        self._paused.clear()
        self._resume_evt.set()
        self.start_time = time.monotonic()
        self._set_status(DownloadStatus.ACTIVE)
        self._thread = threading.Thread(target=self._run,
                                        name=f"engine-{self.task.id}",
                                        daemon=True)
        self._thread.start()
        self._monitor_thread = threading.Thread(target=self._monitor_loop,
                                                name=f"monitor-{self.task.id}",
                                                daemon=True)
        self._monitor_thread.start()

    def pause(self) -> None:
        """Suspend every worker at the next chunk boundary (Step: Pause)."""
        if self._status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED):
            return
        self._resume_evt.clear()
        self._paused.set()
        self._emit_log("Download paused; partial data preserved.", "info")

    def resume(self) -> None:
        """Continue from saved per-part offsets (Step: Resume)."""
        if self._status == DownloadStatus.COMPLETED:
            return
        # Resuming a failed download behaves like Retry (failed parts only).
        if self._status == DownloadStatus.FAILED:
            self.retry_failed()
            return
        if not self._running:
            # Orchestrator had exited → restart it.
            self.start()
            return
        self._paused.clear()
        self._resume_evt.set()
        self._emit_log("Download resumed.", "info")

    def retry_failed(self) -> None:
        """Retry only the failed parts; completed parts are kept."""
        with self._lock:
            failed = [p for p in self._parts if p.status == PartStatus.FAILED]
            for part in failed:
                part.status = PartStatus.PENDING
                part.error = ""
            if self._status == DownloadStatus.FAILED:
                self._status = DownloadStatus.QUEUED
                self.task.error = ""
        if failed:
            self._emit_log(
                f"Retrying {len(failed)} failed part(s); "
                f"{sum(1 for p in self._parts if p.status == PartStatus.COMPLETED)} "
                "completed part(s) are kept.", "info")
        if not self._running:
            self.start()
        else:
            self.resume()

    def cancel(self, delete_temp: bool = True, join_timeout: float = 15.0) -> None:
        """Stop workers, cancel HTTP requests, optionally delete temp data."""
        self._cancel.set()
        self._resume_evt.set()   # unblock a paused orchestrator
        self._abort_wave.set()
        self._delete_temp_requested = delete_temp
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=join_timeout)
        if self._monitor_thread is not None and self._monitor_thread.is_alive():
            self._monitor_thread.join(timeout=2.0)
        self._cleanup(delete_temp)
        self._set_status(DownloadStatus.CANCELLED)

    def join(self, timeout: Optional[float] = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def wait_for_end(self, timeout: Optional[float] = None) -> DownloadStatus:
        """Block until the orchestrator thread exits (tests / manager)."""
        self.join(timeout=timeout)
        if self._monitor_thread is not None:
            self._monitor_thread.join(timeout=2.0)
        return self._status

    def snapshot(self) -> dict:
        """Live stats for GUI/DB: task fields + parts + aggregate speed."""
        total = self.task.total_size
        downloaded = self.downloaded_bytes()
        speed = self.total_speed()
        return {
            "task": self.task.to_dict(),
            "parts": [p.to_dict() for p in self._parts],
            "downloaded": downloaded,
            "total": total,
            "speed": speed,
            "eta": compute_eta(downloaded, total, speed),
            "status": self._status.value,
            "active_connections": self._active_connections,
            "range_mode": self._range_mode,
            "final_path": self._final_path,
        }

    # -- orchestrator ---------------------------------------------------------

    def _run(self) -> None:
        try:
            self._prepare_parts()
            while True:
                if self._cancel.is_set():
                    self._set_status(DownloadStatus.CANCELLED)
                    return
                if self._paused.is_set():
                    self._set_status(DownloadStatus.PAUSED)
                    self._resume_evt.wait(timeout=0.25)
                    continue
                if self._status == DownloadStatus.FAILED:
                    # finalize()/wave failed permanently; only an explicit
                    # retry_failed() (which clears the status) restarts us.
                    return

                self._set_status(DownloadStatus.ACTIVE)
                outcome = self._run_wave()
                if outcome == "cancel":
                    self._set_status(DownloadStatus.CANCELLED)
                    return
                if outcome == "pause":
                    self._set_status(DownloadStatus.PAUSED)
                    self._resume_evt.wait(timeout=0.25)
                    continue
                if outcome == "fallback":
                    self._switch_to_single_stream()
                    continue
                if outcome == "complete":
                    if self._finalize():
                        return
                    continue
                if outcome == "failed":
                    self._set_status(DownloadStatus.FAILED)
                    return
                # Unexpected: avoid a hot loop.
                self._set_status(DownloadStatus.FAILED)
                self.task.error = "Internal engine error."
                self._emit(EngineEventType.FAILED,
                           {"error": self.task.error, "kind": "internal"})
                return
        except OSError as exc:
            self._fail_permanently(self._oserror_message(exc),
                                   kind=_classify_oserror(exc))
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("Engine crashed for task %s", self.task.id)
            self._fail_permanently(f"Unexpected error: {exc}", kind="internal")
        finally:
            self._running = False
            self._close_session()
            self.end_time = time.monotonic()

    def _prepare_parts(self) -> None:
        """Compute the byte-range plan (Step B) and open the temp file.

        Works both for fresh downloads (no parts yet) and for resumed
        downloads whose parts were restored from the database.
        """
        total = self.task.total_size
        self._unknown_size = total < 0
        if total == 0:
            self._range_mode = False
            self._parts = []
        elif total < 0:
            self._range_mode = False
            if not self._parts:
                self._parts = [PartState(0, 0, _UNKNOWN_END)]
        elif self.task.range_support == RangeSupport.NO:
            self._range_mode = False
            if not self._parts or len(self._parts) != 1 \
                    or self._parts[0].end != total - 1:
                self._parts = [PartState(0, 0, total - 1)]
        else:
            self._range_mode = True
            ranges = split_byte_ranges(total, self.task.part_count)
            ok, msg = validate_coverage(ranges, total)
            if not ok:  # pragma: no cover - defensive
                raise EngineError(f"Range plan invalid: {msg}")
            if self._parts:
                # Resuming: validate saved parts against the current plan.
                valid = len(ranges) == len(self._parts) and all(
                    r.start == p.start and r.end == p.end
                    for r, p in zip(ranges, self._parts))
                if not valid:
                    self._emit_log(
                        "Saved part layout does not match the current file "
                        "size/part count — restarting all parts.", "warning")
                    self._parts = [PartState(i, r.start, r.end)
                                   for i, r in enumerate(ranges)]
            else:
                self._parts = [PartState(i, r.start, r.end)
                               for i, r in enumerate(ranges)]
        self.task.parts = self._parts
        for p in self._parts:
            if p.index not in self._trackers:
                self._trackers[p.index] = SpeedTracker()
        self._sem = AdjustableSemaphore(max(1, len(self._parts)))
        self._prepare_temp_file()

    def _prepare_temp_file(self) -> None:
        temp = self.task.temp_path
        total = self.task.total_size
        if self._cancel.is_set():
            return
        if total == 0:
            with open(temp, "wb"):
                pass
            return
        if os.path.exists(temp):
            size_on_disk = os.path.getsize(temp)
            if total > 0 and size_on_disk != total:
                self._emit_log(
                    f"Temporary file has unexpected size "
                    f"({size_on_disk} != {total}); re-creating.", "warning")
                self._reset_all_parts()
                os.remove(temp)
            elif self._unknown_size or not self._range_mode:
                # Without range support a stream cannot be continued from an
                # offset — any recorded progress must restart from zero.
                if self._parts and self._parts[0].downloaded > 0:
                    self._emit_log(
                        "Resuming without range support restarts the single "
                        "stream from byte 0.", "warning")
                    self._reset_all_parts()
        else:
            if self._parts and any(p.downloaded > 0 for p in self._parts):
                self._emit_log(
                    "Temporary file is missing — restarting all parts.",
                    "warning")
                self._reset_all_parts()
        if not os.path.exists(temp):
            with open(temp, "wb") as fh:
                if total > 0:
                    fh.truncate(total)   # preallocate (sparse on NTFS/ext4)
                fh.flush()
                try:
                    os.fsync(fh.fileno())
                except OSError:  # pragma: no cover
                    pass
        self._emit_log(
            f"Temporary file: {temp} "
            f"(additional disk space needed: "
            f"{format_bytes(max(total, 0)) if total >= 0 else 'unknown size'})",
            "info")

    def _reset_all_parts(self) -> None:
        for p in self._parts:
            p.downloaded = 0
            p.status = PartStatus.PENDING
            p.error = ""
            p.retries = 0
        for t in self._trackers.values():
            t.reset()

    def _run_wave(self) -> str:
        """Submit every unfinished part at once; return the wave outcome."""
        self._abort_wave.clear()
        self._range_ignored.clear()
        self._close_session()
        pending = [p for p in self._parts
                   if p.status not in (PartStatus.COMPLETED,)]
        if self.task.total_size == 0 and not pending:
            return "complete"
        if not pending:
            return "complete"
        for p in pending:
            if p.status == PartStatus.FAILED:
                # Permanent failure from a previous wave, user did not retry.
                self.task.error = p.error or "Part failed."
                self._emit(EngineEventType.FAILED,
                           {"error": self.task.error, "kind": "part_failed",
                            "part": p.index})
                return "failed"
        self._session = self._build_session()
        max_workers = max(1, len(pending))
        with ThreadPoolExecutor(max_workers=max_workers,
                                thread_name_prefix=f"part-{self.task.id}") as pool:
            futures = {pool.submit(self._download_part, p): p for p in pending}
            for fut in futures:
                try:
                    fut.result()
                except _RangeIgnoredSignal:
                    self._range_ignored.set()
                except _WaveAbort:
                    pass
                except PermanentPartError as exc:
                    part = futures[fut]
                    part.status = PartStatus.FAILED
                    part.error = str(exc)
                    self._emit_log(f"Part {part.index + 1} failed: {exc}",
                                   "error")
                except TransientPartError as exc:  # retries exhausted
                    part = futures[fut]
                    part.status = PartStatus.FAILED
                    part.error = str(exc)
                    part.retries += 1
                    self._emit_log(
                        f"Part {part.index + 1} gave up after retries: {exc}",
                        "error")
                except Exception as exc:  # pragma: no cover - defensive
                    part = futures[fut]
                    part.status = PartStatus.FAILED
                    part.error = f"Unexpected worker error: {exc}"
                    log.exception("Part worker crashed")
        if self._cancel.is_set():
            return "cancel"
        if self._range_ignored.is_set():
            return "fallback"
        if self._paused.is_set():
            return "pause"
        if any(p.status == PartStatus.FAILED for p in self._parts):
            first = next(p for p in self._parts if p.status == PartStatus.FAILED)
            self.task.error = first.error or "Download failed."
            self._emit(EngineEventType.FAILED,
                       {"error": self.task.error, "kind": "part_failed",
                        "part": first.index})
            return "failed"
        if all(p.status == PartStatus.COMPLETED for p in self._parts):
            return "complete"
        return "pause" if self._paused.is_set() else "retry"

    def _switch_to_single_stream(self) -> None:
        """Server ignored Range requests → safe single-connection fallback."""
        self._fallback_count += 1
        if self._fallback_count > 3:
            self._fail_permanently(
                "The server repeatedly ignored HTTP Range requests and the "
                "fallback stream could not be established.",
                kind="range_unsupported")
            return
        self.task.range_support = RangeSupport.NO
        self._range_mode = False
        total = self.task.total_size
        self._emit_log(
            "This server does not support HTTP Range requests — the "
            f"requested {self.task.part_count} parallel connections cannot be "
            "maintained. Falling back to a single-connection download.",
            "warning")
        if total > 0:
            self._parts = [PartState(0, 0, total - 1)]
        else:
            self._unknown_size = True
            self._parts = [PartState(0, 0, _UNKNOWN_END)]
        self.task.part_count = 1
        self.task.parts = self._parts
        self._trackers = {0: SpeedTracker()}
        self._sem = AdjustableSemaphore(1)
        # Old parallel fragments are useless without ranges: start clean.
        temp = self.task.temp_path
        try:
            if os.path.exists(temp):
                os.remove(temp)
            with open(temp, "wb") as fh:
                if total > 0:
                    fh.truncate(total)
        except OSError as exc:
            self._fail_permanently(self._oserror_message(exc),
                                   kind=_classify_oserror(exc))

    # -- part worker ----------------------------------------------------------

    def _download_part(self, part: PartState) -> None:
        """One part worker: streams its byte range straight to disk."""
        cfg = self.config
        consecutive_failures = 0
        while True:
            if self._cancel.is_set():
                return
            if self._paused.is_set():
                part.status = PartStatus.PAUSED
                return
            if self._abort_wave.is_set():
                raise _WaveAbort()
            if part.status == PartStatus.COMPLETED:
                return
            if not self._unknown_size and part.remaining <= 0:
                part.status = PartStatus.COMPLETED
                return
            part.status = PartStatus.RUNNING
            bytes_before = part.downloaded
            try:
                with self._sem:
                    if self._cancel.is_set() or self._abort_wave.is_set():
                        raise _WaveAbort()
                    self._note_connection_open()
                    try:
                        self._stream_part_once(part)
                    finally:
                        self._note_connection_close()
                # Stream finished without exception.
                if self._cancel.is_set():
                    return
                if self._paused.is_set():
                    part.status = PartStatus.PAUSED
                    return
                if self._unknown_size or part.remaining <= 0:
                    part.status = PartStatus.COMPLETED
                    part.error = ""
                    self._emit_log(
                        f"Part {part.index + 1} completed "
                        f"({format_bytes(part.downloaded)}).", "info")
                    return
                raise TransientPartError(
                    f"Connection closed early: received "
                    f"{format_bytes(part.downloaded - bytes_before)} of "
                    f"{format_bytes(part.size - bytes_before)} requested bytes.")
            except _RangeIgnoredSignal:
                part.status = PartStatus.PAUSED
                raise
            except _WaveAbort:
                part.status = PartStatus.PAUSED
                return
            except PermanentPartError as exc:
                part.status = PartStatus.FAILED
                part.error = str(exc)
                raise
            except (TransientPartError, requests.RequestException) as exc:
                if self._cancel.is_set() or self._abort_wave.is_set():
                    part.status = PartStatus.PAUSED
                    return
                consecutive_failures += 1
                part.retries += 1
                if not getattr(exc, "server_misbehavior", False):
                    # Only connection-level failures feed the adaptive
                    # concurrency heuristic (validation errors would not
                    # improve by lowering parallelism).
                    self._note_connection_failure()
                made_progress = part.downloaded > bytes_before
                if made_progress:
                    consecutive_failures = max(0, consecutive_failures - 1)
                if not self._range_mode:
                    # No range support ⇒ this stream restarts from byte 0.
                    part.downloaded = 0
                    self._trackers[part.index].reset()
                message = str(exc) or exc.__class__.__name__
                if consecutive_failures > cfg.max_retries:
                    part.status = PartStatus.FAILED
                    part.error = (f"Gave up after {cfg.max_retries} retries. "
                                  f"Last error: {message}")
                    raise TransientPartError(part.error) from exc
                delay = self._backoff_delay(consecutive_failures, exc)
                self._emit_log(
                    f"Part {part.index + 1}: {message} — retry "
                    f"{consecutive_failures}/{cfg.max_retries} in "
                    f"{delay:.1f}s", "warning")
                part.status = PartStatus.PENDING
                if self._interruptible_sleep(delay):
                    return  # cancelled / paused / abort during backoff
            except OSError as exc:
                part.status = PartStatus.FAILED
                part.error = self._oserror_message(exc)
                raise PermanentPartError(part.error) from exc

    def _backoff_delay(self, failures: int, exc: Exception) -> float:
        retry_after = getattr(exc, "retry_after", None)
        if retry_after:
            return min(float(retry_after), self.config.backoff_cap)
        base = self.config.backoff_base * (2 ** (failures - 1))
        jitter = random.uniform(0, base * 0.25)
        return min(base + jitter, self.config.backoff_cap)

    def _interruptible_sleep(self, seconds: float) -> bool:
        """Sleep in small steps; True if the worker should stop."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self._cancel.is_set() or self._abort_wave.is_set():
                return True
            if self._paused.is_set():
                return True
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))
        return self._cancel.is_set() or self._abort_wave.is_set()

    def _stream_part_once(self, part: PartState) -> None:
        """Single HTTP attempt for ``part`` (may raise engine errors)."""
        cfg = self.config
        assert self._session is not None
        headers = {"User-Agent": cfg.user_agent, "Accept": "*/*"}
        headers.update(cfg.extra_headers)
        headers.update(self.task.headers)
        req_start = part.start + part.downloaded
        expected_len = None
        if self._range_mode and not self._unknown_size:
            headers["Range"] = f"bytes={req_start}-{part.end}"
            expected_len = part.end - req_start + 1
        elif not self._unknown_size and part.start == 0 \
                and part.end == self.task.total_size - 1 \
                and part.downloaded == 0:
            expected_len = part.size
        url = self.task.final_url or self.task.url
        if not self._range_mode:
            # Single-stream mode never sends Range: the body always starts
            # at byte 0, so writing must too (defensive reset — normally
            # already zero).
            part.downloaded = 0
            req_start = 0
            if not self._unknown_size:
                expected_len = part.size
        tracker = self._trackers[part.index]
        limiter = self._make_limiter()

        resp = self._session.get(
            url, headers=headers, stream=True,
            timeout=(cfg.connect_timeout, cfg.read_timeout),
            allow_redirects=True)
        try:
            status = resp.status_code
            if status == 429:
                err = TransientPartError(
                    "Server is rate-limiting requests (HTTP 429).")
                retry_after = resp.headers.get("Retry-After")
                try:
                    err.retry_after = min(float(retry_after), cfg.backoff_cap)
                except (TypeError, ValueError):
                    pass
                raise err
            if status in (401, 403):
                raise PermanentPartError(
                    f"Access denied (HTTP {status}). The link may require "
                    "authentication or may have expired.")
            if status in (404, 410):
                raise PermanentPartError(
                    f"File not found (HTTP {status}). The link may be dead.")
            if 500 <= status <= 599:
                raise TransientPartError(f"Server error (HTTP {status}).")
            if status == 416:
                if expected_len is not None and part.remaining == 0:
                    part.status = PartStatus.COMPLETED
                    return
                raise PermanentPartError(
                    "Range not satisfiable (HTTP 416) — the remote file "
                    "appears to have changed. Please retry the download.")
            if status == 206:
                self._validate_206(resp, part, req_start, expected_len)
            elif status == 200:
                if self._range_mode and expected_len is not None \
                        and expected_len != self.task.total_size:
                    # We asked for a slice; server offered the whole file.
                    resp.close()
                    raise _RangeIgnoredSignal(
                        f"Server ignored Range request for part {part.index}")
                if self._range_mode and expected_len == self.task.total_size:
                    # Part covering the entire file (part_count == 1):
                    # a 200 with the full body is equivalent.
                    pass
                cl = resp.headers.get("Content-Length")
                if cl is not None and not self._unknown_size:
                    try:
                        cl_i = int(cl)
                    except ValueError:
                        cl_i = -1
                    if cl_i >= 0 and part.downloaded == 0 \
                            and cl_i != part.size:
                        raise _misbehavior(
                            f"Unexpected Content-Length {cl_i} "
                            f"(expected {part.size}).")
            else:
                raise PermanentPartError(f"Unexpected HTTP status {status}.")

            self._write_stream(resp, part, tracker, limiter)
        finally:
            try:
                resp.close()
            except Exception:  # pragma: no cover
                pass

    def _validate_206(self, resp: requests.Response, part: PartState,
                      req_start: int, expected_len: Optional[int]) -> None:
        cr = resp.headers.get("Content-Range")
        parsed = parse_content_range(cr)
        if parsed is None:
            cl = resp.headers.get("Content-Length")
            if cr:
                raise _misbehavior(
                    f"Invalid Content-Range header '{cr}' for part "
                    f"{part.index + 1}.")
            if cl is not None and expected_len is not None:
                try:
                    if int(cl) != expected_len:
                        raise _misbehavior(
                            f"206 response length {cl} does not match the "
                            f"requested range length {expected_len}.")
                except ValueError:
                    raise _misbehavior(
                        f"Unparsable Content-Length '{cl}' in 206 response.")
            return
        first, last, total = parsed
        if first != req_start:
            raise _misbehavior(
                f"Server returned the wrong slice: Content-Range starts at "
                f"{first}, expected {req_start} (part {part.index + 1}).")
        if last > part.end:
            raise _misbehavior(
                f"Content-Range end {last} exceeds the requested end "
                f"{part.end} (part {part.index + 1}).")
        if total >= 0 and self.task.total_size >= 0 \
                and total != self.task.total_size:
            raise PermanentPartError(
                f"Remote file size changed mid-download "
                f"({total} != {self.task.total_size}). Please restart.")
        cl = resp.headers.get("Content-Length")
        if cl is not None:
            try:
                cl_i = int(cl)
                want = last - first + 1
                if cl_i != want:
                    raise _misbehavior(
                        f"Content-Length {cl_i} disagrees with "
                        f"Content-Range span {want}.")
            except ValueError:
                raise _misbehavior(f"Unparsable Content-Length '{cl}'.")

    def _write_stream(self, resp: requests.Response, part: PartState,
                      tracker: SpeedTracker, limiter) -> None:
        temp = self.task.temp_path
        offset = part.start + part.downloaded
        fh = self._open_part_handle(temp)
        try:
            fh.seek(offset)
            for chunk in resp.iter_content(self.config.chunk_size):
                if not chunk:
                    continue
                if self._cancel.is_set() or self._abort_wave.is_set():
                    part.status = PartStatus.PAUSED
                    return
                if self._paused.is_set():
                    part.status = PartStatus.PAUSED
                    return
                limiter.acquire(len(chunk))
                fh.write(chunk)
                part.downloaded += len(chunk)
                tracker.add(len(chunk))
                if not self._unknown_size and part.downloaded > part.size:
                    raise PermanentPartError(
                        f"Server sent more data than the requested range "
                        f"(part {part.index + 1}).")
            fh.flush()
        except requests.RequestException:
            fh.flush()
            raise
        except OSError as exc:
            raise self._wrap_oserror(exc) from exc
        finally:
            try:
                fh.close()
            except OSError:  # pragma: no cover
                pass

    def _open_part_handle(self, path: str):
        """Open the part's write handle with a few retries (Windows AV locks)."""
        last_exc = None
        for attempt in range(3):
            try:
                mode = "r+b" if os.path.exists(path) else "w+b"
                return open(path, mode, buffering=1024 * 1024)
            except OSError as exc:
                last_exc = exc
                if exc.errno in (errno.EACCES, errno.EPERM) and attempt < 2:
                    time.sleep(0.3 * (attempt + 1))
                    continue
                raise self._wrap_oserror(exc) from exc
        raise self._wrap_oserror(last_exc)  # pragma: no cover

    @staticmethod
    def _wrap_oserror(exc: OSError) -> EngineError:
        return PermanentPartError(DownloadEngine._oserror_message(exc))

    @staticmethod
    def _oserror_message(exc: OSError) -> str:
        if isinstance(exc, PermissionError):
            return (f"Permission denied: {exc.filename or 'destination file'}. "
                    "Choose a folder you are allowed to write to, or close the "
                    "program locking the file.")
        if exc.errno == errno.ENOSPC or "space" in str(exc).lower():
            return ("Not enough disk space to store the download and its "
                    "temporary file. Free up space and retry.")
        if exc.errno in (errno.ENOENT,):
            return (f"Path not found: {exc.filename or 'destination'}. "
                    "The download folder may have been removed.")
        if exc.errno in (errno.EACCES, errno.EPERM):
            return (f"Permission denied: {exc.filename or 'destination file'}.")
        return f"File system error: {exc}"

    def _make_limiter(self):
        limiters = []
        if self.task.speed_limit > 0:
            limiters.append(self._per_download_limiter())
        if self.config.global_limiter is not None:
            limiters.append(self.config.global_limiter)
        if not limiters:
            class _Unlimited:
                def acquire(self, n):  # noqa: D401 - trivial
                    return None
            return _Unlimited()
        if len(limiters) == 1:
            return limiters[0]
        return CompositeLimiter(limiters)

    def _per_download_limiter(self) -> RateLimiter:
        with self._lock:
            limiter = getattr(self, "_dl_limiter", None)
            if limiter is None:
                limiter = RateLimiter(self.task.speed_limit)
                self._dl_limiter = limiter
            elif abs(limiter.rate - self.task.speed_limit) > 1:
                limiter.set_rate(self.task.speed_limit)
            return limiter

    # -- adaptive concurrency -------------------------------------------------

    def _note_connection_open(self) -> None:
        with self._active_lock:
            self._active_connections += 1

    def _note_connection_close(self) -> None:
        with self._active_lock:
            self._active_connections = max(0, self._active_connections - 1)

    def _note_connection_failure(self) -> None:
        now = time.monotonic()
        with self._lock:
            self._failure_timestamps.append(now)
            self._failure_timestamps = [
                t for t in self._failure_timestamps if now - t <= 15.0]
            failures = len(self._failure_timestamps)
            threshold = max(3, (len(self._parts) + 1) // 2)
            if failures >= threshold and self._sem is not None \
                    and self._sem.permits > 2 and not self._cancel.is_set():
                new_permits = max(2, self._sem.permits // 2)
                self._sem.set_permits(new_permits)
                self._concurrency_reduced = True
                self._failure_timestamps.clear()
                self._emit_log(
                    f"The server appears to limit concurrent connections "
                    f"({failures} recent failures). Active connections were "
                    f"reduced to {new_permits}; the requested "
                    f"{len(self._parts)} connections could not be maintained. "
                    "Remaining parts continue in a queue.", "warning")

    # -- finalization (Step D) ------------------------------------------------

    def _finalize(self) -> bool:
        """Verify → checksum → atomic rename.  True when fully complete."""
        temp = self.task.temp_path
        total = self.task.total_size
        # 1. every part present and correct size
        for part in self._parts:
            if part.status != PartStatus.COMPLETED:
                self._fail_permanently(
                    f"Part {part.index + 1} is not complete.",
                    kind="part_failed")
                return False
            if not self._unknown_size and part.downloaded != part.size:
                self._fail_permanently(
                    f"Part {part.index + 1} downloaded {part.downloaded} of "
                    f"{part.size} bytes.", kind="corrupt")
                return False
        if not os.path.exists(temp):
            self._fail_permanently("Temporary file disappeared before "
                                   "assembly.", kind="missing_temp")
            return False
        actual_size = os.path.getsize(temp)
        if self._unknown_size:
            self.task.total_size = actual_size
            self._unknown_size = False
        elif actual_size != total:
            self._fail_permanently(
                f"Assembled size mismatch: file is {actual_size} bytes, "
                f"expected {total}. Partial data was preserved.",
                kind="corrupt")
            return False
        # 2. flush to physical media
        try:
            with open(temp, "r+b") as fh:
                fh.flush()
                os.fsync(fh.fileno())
        except OSError as exc:
            self._fail_permanently(self._oserror_message(exc),
                                   kind=_classify_oserror(exc))
            return False
        # 3. checksum verification (when the user supplied one)
        if self.config.verify_checksum and self.task.checksum_value \
                and self.task.checksum_algo:
            self._emit_log(
                f"Verifying {self.task.checksum_algo.upper()} checksum…",
                "info")
            try:
                digest = compute_checksum(temp, self.task.checksum_algo)
            except (OSError, ValueError) as exc:
                self._fail_permanently(f"Checksum verification failed: {exc}",
                                       kind="checksum")
                return False
            if digest.lower() != self.task.checksum_value.strip().lower():
                self._fail_permanently(
                    f"Checksum mismatch! Expected "
                    f"{self.task.checksum_value.strip().lower()}, computed "
                    f"{digest}. The file was NOT renamed — temporary parts "
                    "were preserved.", kind="checksum")
                return False
            self._emit_log("Checksum OK.", "info")
        # 4. destination conflict policy
        final_path = self.task.final_path
        if os.path.exists(final_path) and not self.config.allow_overwrite:
            self._fail_permanently(
                f"'{self.task.filename}' already exists in the destination "
                "folder. Choose Overwrite or pick another name.",
                kind="file_exists")
            return False
        # 5. atomic rename (with a short retry loop for Windows AV locks)
        for attempt in range(5):
            try:
                os.replace(temp, final_path)
                break
            except OSError as exc:
                if attempt == 4:
                    self._fail_permanently(
                        self._oserror_message(exc) +
                        " Partial data was preserved for retry.",
                        kind=_classify_oserror(exc))
                    return False
                time.sleep(0.4 * (attempt + 1))
        self._final_path = final_path
        self._set_status(DownloadStatus.COMPLETED)
        self.task.error = ""
        self._emit(EngineEventType.COMPLETED, {"path": final_path})
        self._emit_log(f"Download complete: {final_path}", "info")
        return True

    # -- monitor / events ------------------------------------------------------

    def _monitor_loop(self) -> None:
        interval = max(0.05, self.config.monitor_interval)
        last_parts_sig = ""
        while self._running or self._status == DownloadStatus.ACTIVE:
            time.sleep(interval)
            try:
                downloaded = self.downloaded_bytes()
                speed = self.total_speed()
                total = self.task.total_size
                self._emit(EngineEventType.PROGRESS, {
                    "downloaded": downloaded,
                    "total": total,
                    "speed": speed,
                    "eta": compute_eta(downloaded, total, speed),
                    "active_connections": self._active_connections,
                    "percent": (downloaded * 100.0 / total) if total > 0 else None,
                })
                sig_parts = [
                    (p.index, p.downloaded, p.status.value, round(p.speed))
                    for p in self._parts
                ]
                for p in self._parts:
                    p.speed = self._trackers[p.index].speed() \
                        if p.index in self._trackers else 0.0
                sig = repr(sig_parts)
                if sig != last_parts_sig:
                    last_parts_sig = sig
                    self._emit(EngineEventType.PARTS,
                               {"parts": [p.to_dict() for p in self._parts]})
                if not self._running:
                    break
            except Exception:  # pragma: no cover - defensive
                log.exception("monitor loop error")
                break

    def _set_status(self, status: DownloadStatus) -> None:
        if self._status != status:
            self._status = status
            self.task.status = status
            self.task.updated_at = time.time()
            self._emit(EngineEventType.STATE, {"status": status.value})

    def _emit(self, type_: EngineEventType, data: dict) -> None:
        try:
            self._sink(EngineEvent(type=type_, download_id=self.task.id,
                                   data=data))
        except Exception:  # pragma: no cover - sink must never kill engine
            log.exception("event sink failed")

    def _emit_log(self, message: str, level: str = "info") -> None:
        self._emit(EngineEventType.LOG, {"message": message, "level": level})

    def _fail_permanently(self, message: str, kind: str = "error") -> None:
        self.task.error = message
        self._set_status(DownloadStatus.FAILED)
        self._emit_log(message, "error")
        self._emit(EngineEventType.FAILED, {"error": message, "kind": kind})

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        pool = max(4, len(self._parts) + 2)
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=pool, pool_maxsize=pool, max_retries=0)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        session.trust_env = True
        return session

    def _close_session(self) -> None:
        with self._lock:
            session, self._session = self._session, None
        if session is not None:
            try:
                session.close()
            except Exception:  # pragma: no cover
                pass

    def _cleanup(self, delete_temp: bool) -> None:
        self._close_session()
        if delete_temp:
            temp = self.task.temp_path
            try:
                if os.path.exists(temp):
                    os.remove(temp)
                    self._emit_log(f"Temporary file deleted: {temp}", "info")
            except OSError as exc:
                self._emit_log(f"Could not delete temporary file: {exc}",
                               "warning")
        else:
            self._emit_log(
                "Temporary partial data was kept for a later resume.", "info")


def _classify_oserror(exc: OSError) -> str:
    if isinstance(exc, PermissionError):
        return "permission"
    if exc.errno == errno.ENOSPC:
        return "disk"
    if exc.errno == errno.ENOENT:
        return "missing_path"
    return "filesystem"

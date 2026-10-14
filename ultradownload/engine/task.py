"""The parallel download task: inspection, concurrent part workers, resume.

A :class:`DownloadTask` owns up to ``part_count`` byte ranges of one URL and
downloads every range *concurrently* (a thread pool sized to the number of
active parts — all workers start at once and make progress independently).
Part data is streamed straight to per-part files on disk; nothing is held in
RAM beyond a bounded chunk buffer.
"""

from __future__ import annotations

import logging
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import requests

from ..utils import format_bytes, sanitize_filename
from .bandwidth import BandwidthLimiter, TokenBucket
from .errors import (
    ContentRangeError,
    DownloadCancelled,
    DownloadError,
    DownloadPaused,
    FileExistsError_,
    InsufficientDiskSpaceError,
    PermanentHTTPError,
    RangeIgnoredError,
    StateError,
    TruncatedResponseError,
    TransientHTTPError,
)
from .inspector import URLInfo, inspect_url, validate_url
from .merger import assemble_file
from .parts import PartState, PartStatus
from .ranges import ByteRange, compute_ranges
from .speed import SpeedMeter

log = logging.getLogger("ultradownload.task")

__all__ = ["TaskStatus", "DownloadTask", "TaskListener", "parse_content_range"]

CHUNK_SIZE = 64 * 1024
USER_AGENT = "UltraDownload/1.0"
MAX_BACKOFF = 30.0


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    MERGING = "merging"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def label(self) -> str:
        return {
            TaskStatus.QUEUED: "Queued",
            TaskStatus.RUNNING: "Downloading",
            TaskStatus.MERGING: "Assembling",
            TaskStatus.PAUSED: "Paused",
            TaskStatus.COMPLETED: "Completed",
            TaskStatus.FAILED: "Failed",
            TaskStatus.CANCELLED: "Cancelled",
        }[self]

    @property
    def is_terminal(self) -> bool:
        return self in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED)


_CONTENT_RANGE_RE = re.compile(
    r"bytes\s+(?P<start>\d+)\s*-\s*(?P<end>\d+)\s*/\s*(?P<total>\d+|\*)",
    re.IGNORECASE,
)


def parse_content_range(value: str | None) -> tuple[int, int, int | None]:
    """Parse a Content-Range header → (start, end, total|None)."""
    if not value:
        raise ContentRangeError("206 response without Content-Range header")
    m = _CONTENT_RANGE_RE.match(value.strip())
    if not m:
        raise ContentRangeError(f"Malformed Content-Range: {value!r}")
    start, end = int(m.group("start")), int(m.group("end"))
    total = None if m.group("total") == "*" else int(m.group("total"))
    if end < start:
        raise ContentRangeError(f"Content-Range end < start: {value!r}")
    return start, end, total


class TaskListener:
    """Observer callbacks. Invoked from worker threads — must be thread-safe."""

    def on_task_progress(self, task: "DownloadTask") -> None: ...
    def on_task_status(self, task: "DownloadTask") -> None: ...
    def on_part_update(self, task: "DownloadTask", part: PartState) -> None: ...
    def on_task_log(self, task: "DownloadTask", message: str) -> None: ...


@dataclass
class _TaskConfig:
    part_count: int = 40
    connect_timeout: float = 10.0
    read_timeout: float = 30.0
    max_retries: int = 3
    retry_backoff_base: float = 1.0
    chunk_size: int = CHUNK_SIZE
    speed_limit: float | None = None         # bytes/s, None = unlimited
    checksum: tuple[str, str] | None = None   # (algorithm, hex digest)
    extra_headers: dict | None = None         # in-memory only, never persisted
    overwrite: bool = False


class DownloadTask:
    """One file download, split into parallel byte-range parts."""

    def __init__(
        self,
        url: str,
        dest_dir: str | Path,
        filename: str | None = None,
        *,
        task_id: str | None = None,
        listener: TaskListener | None = None,
        limiter: BandwidthLimiter | None = None,
        checkpoint=None,
        part_count: int = 40,
        connect_timeout: float = 10.0,
        read_timeout: float = 30.0,
        max_retries: int = 3,
        retry_backoff_base: float = 1.0,
        chunk_size: int = CHUNK_SIZE,
        speed_limit: float | None = None,
        checksum: tuple[str, str] | None = None,
        extra_headers: dict | None = None,
        overwrite: bool = False,
    ) -> None:
        self.id = task_id or uuid.uuid4().hex[:12]
        self.url = validate_url(url)
        self.dest_dir = Path(dest_dir)
        self.filename = sanitize_filename(filename) if filename else None
        self.cfg = _TaskConfig(
            part_count=part_count,
            connect_timeout=connect_timeout,
            read_timeout=read_timeout,
            max_retries=max_retries,
            retry_backoff_base=retry_backoff_base,
            chunk_size=chunk_size,
            speed_limit=speed_limit,
            checksum=checksum,
            extra_headers=extra_headers,
            overwrite=overwrite,
        )

        self.listener = listener or TaskListener()
        self.limiter = limiter or BandwidthLimiter()
        self._checkpoint_cb = checkpoint

        self.status = TaskStatus.QUEUED
        self.error: str | None = None
        self.total_size: int | None = None
        self.mime_type: str | None = None
        self.supports_ranges = False
        self.etag: str | None = None
        self.last_modified: str | None = None
        self.notes: list[str] = []
        self.created_at = time.time()
        self.completed_at: float | None = None
        self.priority = 0

        self.parts: list[PartState] = []
        self.single_mode = False            # forced single-stream (no ranges)
        self._unknown_size = False          # single-stream, size not yet known
        self.task_bucket = TokenBucket(self.cfg.speed_limit)

        self._stop = threading.Event()      # set on pause/cancel/abort
        self._cancelled = threading.Event()
        self._range_fallback = threading.Event()
        self._fatal_error: str | None = None
        self._run_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._sessions: dict[int, requests.Session] = {}
        self._sessions_lock = threading.Lock()
        self._meter = SpeedMeter()
        self._notify_at = 0.0
        self._checkpoint_at = 0.0
        self._merge_progress = 0
        self._prepared = False

    # ------------------------------------------------------------------ paths
    @property
    def tmp_dir(self) -> Path:
        return self.dest_dir / ".ultradownload" / self.id

    @property
    def final_path(self) -> Path:
        return self.dest_dir / (self.filename or "download.bin")

    def part_path(self, index: int) -> Path:
        return self.tmp_dir / f"part_{index:05d}.part"

    # ------------------------------------------------------------- inspection
    def prepare(self, info: URLInfo | None = None) -> None:
        """Inspect the URL (unless *info* given), compute ranges, set up disk.

        Safe to call again on resume; existing part files are adopted.
        Raises DownloadError subclasses on failure.
        """
        if info is None:
            info = inspect_url(
                self.url,
                timeout=(self.cfg.connect_timeout, self.cfg.read_timeout),
                extra_headers=self.cfg.extra_headers,
            )
        self.url = info.url
        self.total_size = info.size
        self.mime_type = info.mime_type
        self.etag = info.etag
        self.last_modified = info.last_modified
        self.supports_ranges = info.supports_ranges
        if not self.filename:
            self.filename = info.filename
        self.filename = sanitize_filename(self.filename)

        if info.size is not None and self.final_path.exists() and not self.cfg.overwrite:
            raise FileExistsError_(
                f"'{self.filename}' already exists — choose another name "
                "or allow overwriting.")

        if info.size is None or not info.supports_ranges or self.cfg.part_count <= 1:
            self.single_mode = True
        else:
            self.single_mode = False

        self._check_disk_space(write_bytes=info.size or 0)
        try:
            self.tmp_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            from .errors import PermissionDeniedError
            raise PermissionDeniedError(
                f"Cannot write to {self.dest_dir}: {exc}") from exc

        if not self.parts:
            self._init_parts()
        else:
            self._sync_parts_from_disk()

        self._prepared = True
        self._checkpoint(force=True)

    def _init_parts(self) -> None:
        self._unknown_size = False
        if self.single_mode or self.total_size is None:
            if self.total_size is None:
                # Size unknown: one open-ended stream; length set at EOF.
                self._unknown_size = True
                self.parts = [PartState(range=ByteRange(index=0, start=0, end=-1))]
            elif self.total_size == 0:
                self.parts = []
            else:
                self.parts = [PartState(range=ByteRange(0, 0, self.total_size - 1))]
            return
        if self.total_size == 0:
            self.parts = []
            return
        ranges = compute_ranges(self.total_size, self.cfg.part_count)
        self.parts = [PartState(range=r) for r in ranges]

    def _sync_parts_from_disk(self) -> None:
        """Adopt existing part files (resume / crash recovery)."""
        for part in self.parts:
            path = self.part_path(part.index)
            if path.exists():
                on_disk = path.stat().st_size
                if on_disk > part.length and not self._unknown_size:
                    # Foreign/oversized data — keep only the expected prefix.
                    with open(path, "r+b") as fh:
                        fh.truncate(part.length)
                    on_disk = part.length
                part.downloaded = on_disk
            else:
                part.downloaded = 0
            if (not self._unknown_size) and part.downloaded >= part.length and part.length > 0:
                part.status = PartStatus.DONE
            elif part.status is PartStatus.RUNNING:
                part.status = PartStatus.PAUSED

    def _check_disk_space(self, write_bytes: int, include_merge_copy: bool = True) -> None:
        try:
            free = shutil.disk_usage(self.dest_dir).free
        except OSError:
            return  # cannot stat — writes will surface the real error later
        needed = write_bytes * (2 if include_merge_copy else 1)
        if free < needed:
            raise InsufficientDiskSpaceError(
                f"Not enough disk space in {self.dest_dir}: "
                f"{format_bytes(free)} free, about {format_bytes(needed)} needed "
                f"(downloaded data + temporary parts during assembly).")

    def validate_resume(self) -> None:
        """Ensure the remote file still matches the saved state before resume."""
        if self.total_size is None and not self.parts:
            return
        info = inspect_url(
            self.url,
            timeout=(self.cfg.connect_timeout, self.cfg.read_timeout),
            extra_headers=self.cfg.extra_headers,
        )
        self._compare_with_saved(info)
        self.supports_ranges = info.supports_ranges

    def _compare_with_saved(self, info: URLInfo) -> None:
        if self.total_size is not None and info.size is not None \
                and info.size != self.total_size:
            raise StateError(
                f"The remote file changed size ({self.total_size} → {info.size} bytes). "
                "Restart the download from the beginning.")
        if self.etag and info.etag and info.etag != self.etag:
            raise StateError(
                "The remote file changed (ETag mismatch). Restart the download.")

    # ---------------------------------------------------------- control verbs
    def start(self) -> None:
        with self._run_lock:
            if self._thread and self._thread.is_alive():
                return
            if self.status is TaskStatus.COMPLETED:
                return
            self._stop.clear()
            self._cancelled.clear()
            self._range_fallback.clear()
            self._fatal_error = None
            self._set_status(TaskStatus.RUNNING)
            self._thread = threading.Thread(
                target=self._run, name=f"ud-task-{self.id}", daemon=True)
            self._thread.start()

    def pause(self) -> None:
        if self.status is TaskStatus.QUEUED:
            # Never started — just hold it out of the scheduler.
            self._set_status(TaskStatus.PAUSED)
            return
        if self.status is not TaskStatus.RUNNING:
            return
        self._stop.set()
        self.log("Pause requested — stopping transfers, keeping partial data.")
        self._join()

    def resume(self) -> None:
        if self.status not in (TaskStatus.PAUSED, TaskStatus.FAILED, TaskStatus.QUEUED):
            return
        self.error = None
        for part in self.parts:
            if part.status in (PartStatus.FAILED, PartStatus.CANCELLED):
                part.error = None
                part.status = PartStatus.PAUSED if part.downloaded else PartStatus.QUEUED
        info = inspect_url(
            self.url,
            timeout=(self.cfg.connect_timeout, self.cfg.read_timeout),
            extra_headers=self.cfg.extra_headers,
        )
        self._compare_with_saved(info)
        self.prepare(info=info)
        self.start()

    def cancel(self, delete_parts: bool = False) -> None:
        self._cancelled.set()
        self._stop.set()
        self.log("Cancel requested.")
        self._join()
        self._set_status(TaskStatus.CANCELLED)
        if delete_parts:
            self.cleanup_temp()

    def retry(self) -> None:
        """Retry after failure — completed parts are kept, not re-downloaded."""
        if self.status is TaskStatus.COMPLETED:
            return
        self.error = None
        for part in self.parts:
            if part.status is PartStatus.FAILED:
                part.error = None
                part.status = (PartStatus.DONE
                               if (not self._unknown_size and part.downloaded >= part.length)
                               else PartStatus.QUEUED)
        self._set_status(TaskStatus.QUEUED)
        self.start()

    def cleanup_temp(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def wait(self, timeout: float | None = None) -> bool:
        t = self._thread
        if t is None:
            return True
        t.join(timeout)
        return not t.is_alive()

    # ------------------------------------------------------------- statistics
    def downloaded_bytes(self) -> int:
        return sum(p.downloaded for p in self.parts)

    def progress(self) -> float:
        if self.total_size:
            return min(100.0, self.downloaded_bytes() * 100.0 / self.total_size)
        if self.status is TaskStatus.COMPLETED:
            return 100.0
        return 0.0

    def speed(self) -> float:
        return self._meter.speed() if self.status is TaskStatus.RUNNING else 0.0

    def eta_seconds(self) -> float | None:
        if self.status is TaskStatus.COMPLETED:
            return 0.0
        rate = self.speed()
        if not self.total_size or rate <= 0:
            return None
        remaining = max(0, self.total_size - self.downloaded_bytes())
        return remaining / rate

    def active_connections(self) -> int:
        return sum(1 for p in self.parts if p.status is PartStatus.RUNNING)

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "filename": self.filename,
            "dest_dir": str(self.dest_dir),
            "final_path": str(self.final_path),
            "total_size": self.total_size,
            "downloaded": self.downloaded_bytes(),
            "progress": self.progress(),
            "speed": self.speed(),
            "eta": self.eta_seconds(),
            "status": self.status.value,
            "status_label": self.status.label,
            "error": self.error,
            "mime_type": self.mime_type,
            "part_count": len(self.parts),
            "part_count_requested": self.cfg.part_count,
            "active_connections": self.active_connections(),
            "supports_ranges": self.supports_ranges,
            "single_mode": self.single_mode,
            "notes": list(self.notes),
            "priority": self.priority,
            "checksum": self.cfg.checksum,
            "speed_limit": self.cfg.speed_limit,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "parts": [p.snapshot() for p in self.parts],
        }

    # ---------------------------------------------------------------- logging
    def log(self, message: str) -> None:
        log.info("[%s] %s", self.id, message)
        try:
            self.listener.on_task_log(self, message)
        except Exception:  # listener bugs must not break downloads
            log.exception("listener failed")

    # ----------------------------------------------------------- notifications
    def _notify_progress(self, part: PartState | None = None, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now < self._notify_at:
            return
        self._notify_at = now + 0.2
        try:
            if part is not None:
                self.listener.on_part_update(self, part)
            self.listener.on_task_progress(self)
        except Exception:
            log.exception("listener failed")
        self._checkpoint()

    def _checkpoint(self, force: bool = False) -> None:
        if self._checkpoint_cb is None:
            return
        now = time.monotonic()
        if not force and now < self._checkpoint_at:
            return
        self._checkpoint_at = now + 3.0
        try:
            self._checkpoint_cb(self)
        except Exception:
            log.exception("checkpoint failed")

    def _set_status(self, status: TaskStatus, error: str | None = None) -> None:
        self.status = status
        if error is not None:
            self.error = error
        if status is TaskStatus.COMPLETED:
            self.completed_at = time.time()
        self._checkpoint(force=True)
        try:
            self.listener.on_task_status(self)
        except Exception:
            log.exception("listener failed")

    # ------------------------------------------------------------------ run
    def _join(self, timeout: float | None = 60.0) -> None:
        t = self._thread
        if t and t.is_alive() and t is not threading.current_thread():
            t.join(timeout)

    def _run(self) -> None:
        """Coordinator: run all part workers concurrently, then merge."""
        try:
            if not self._prepared:
                self.prepare()
            self._run_workers()
        except DownloadCancelled:
            self._set_status(TaskStatus.CANCELLED)
            return
        except DownloadError as exc:
            self._set_status(TaskStatus.FAILED, str(exc))
            return
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("task crashed")
            self._set_status(TaskStatus.FAILED, f"Unexpected error: {exc}")
            return

        if self._range_fallback.is_set():
            self._switch_to_single_stream()
            return
        self._finish_if_complete()

    def _finish_if_complete(self) -> None:
        """Common post-worker logic: status decision + merge."""
        if self._cancelled.is_set():
            self._set_status(TaskStatus.CANCELLED)
            return
        if self._fatal_error is not None:
            self._set_status(TaskStatus.FAILED, self._fatal_error)
            return
        if self._stop.is_set():
            self._set_status(TaskStatus.PAUSED)
            return

        failed = [p for p in self.parts if p.status is PartStatus.FAILED]
        if failed:
            self._set_status(TaskStatus.FAILED, failed[0].error or "One or more parts failed.")
            return
        if any(p.status is not PartStatus.DONE for p in self.parts):
            self._set_status(TaskStatus.PAUSED)
            return

        self._set_status(TaskStatus.MERGING)
        try:
            self._check_disk_space(write_bytes=self.total_size or 0,
                                   include_merge_copy=False)
            self._merge()
        except DownloadError as exc:
            self.log(f"Assembly failed — temporary parts preserved: {exc}")
            self._set_status(TaskStatus.FAILED, str(exc))
            return
        except OSError as exc:
            self.log(f"Assembly failed — temporary parts preserved: {exc}")
            self._set_status(TaskStatus.FAILED, f"Could not write the final file: {exc}")
            return

        self._set_status(TaskStatus.COMPLETED)
        self.log(f"Download complete: {self.final_path}")

    def _run_workers(self) -> None:
        pending = [p for p in self.parts if p.status is not PartStatus.DONE]
        if not pending:
            return
        for p in pending:
            if p.status in (PartStatus.FAILED, PartStatus.CANCELLED):
                p.status = PartStatus.QUEUED
        with ThreadPoolExecutor(max_workers=len(pending),
                                thread_name_prefix=f"ud-part-{self.id}") as pool:
            futures = [pool.submit(self._part_loop, p) for p in pending]
            for fut in futures:
                fut.result()

    # ------------------------------------------------------------- fallback
    def _switch_to_single_stream(self) -> None:
        self.log(
            "The server ignored Range requests — falling back to a single-stream "
            "download (the requested number of connections could not be "
            "maintained).")
        self.notes.append("Server ignores Range requests — single-stream fallback used.")
        self.single_mode = True
        self.cfg.part_count = 1
        shutil.rmtree(self.tmp_dir, ignore_errors=True)
        self.tmp_dir.mkdir(parents=True, exist_ok=True)
        self._init_parts()
        self._stop.clear()
        self._range_fallback.clear()
        self._set_status(TaskStatus.RUNNING)
        self._run_workers()
        self._finish_if_complete()

    # --------------------------------------------------------------- workers
    def _session_for(self, index: int) -> requests.Session:
        with self._sessions_lock:
            sess = self._sessions.get(index)
            if sess is None:
                sess = requests.Session()
                sess.headers["User-Agent"] = USER_AGENT
                adapter = requests.adapters.HTTPAdapter(pool_connections=2, pool_maxsize=2)
                sess.mount("http://", adapter)
                sess.mount("https://", adapter)
                self._sessions[index] = sess
            return sess

    def _close_sessions_for(self, index: int) -> None:
        with self._sessions_lock:
            sess = self._sessions.pop(index, None)
        if sess is not None:
            try:
                sess.close()
            except Exception:
                pass

    def _part_loop(self, part: PartState) -> None:
        attempt = 0
        try:
            while True:
                if self._stop.is_set():
                    part.status = (PartStatus.CANCELLED if self._cancelled.is_set()
                                   else PartStatus.PAUSED)
                    self._notify_progress(part, force=True)
                    return
                try:
                    self._fetch_part(part)
                    part.status = PartStatus.DONE
                    part.error = None
                    self._notify_progress(part, force=True)
                    return
                except DownloadPaused:
                    part.status = PartStatus.PAUSED
                    self._notify_progress(part, force=True)
                    return
                except DownloadCancelled:
                    part.status = PartStatus.CANCELLED
                    return
                except RangeIgnoredError:
                    part.status = PartStatus.PAUSED
                    self._range_fallback.set()
                    self._stop.set()
                    self._notify_progress(part, force=True)
                    return
                except DownloadError as exc:
                    if isinstance(exc, PermanentHTTPError) and exc.status_code in (401, 403):
                        # Auth problems will hit every part — fail fast.
                        part.status = PartStatus.FAILED
                        part.error = str(exc)
                        self._fatal_error = str(exc)
                        self._stop.set()
                        self._notify_progress(part, force=True)
                        return
                    transient = getattr(exc, "transient", False)
                    attempt += 1
                    part.retries += 1
                    if not transient or attempt > self.cfg.max_retries:
                        part.status = PartStatus.FAILED
                        part.error = str(exc)
                        self.log(f"Part {part.index + 1} failed: {exc}")
                        self._notify_progress(part, force=True)
                        return
                    delay = self._backoff(attempt, exc)
                    self.log(f"Part {part.index + 1}: {exc} — retry {attempt}/"
                             f"{self.cfg.max_retries} in {delay:.1f}s")
                    self._notify_progress(part, force=True)
                    if self._stop.wait(delay):
                        part.status = (PartStatus.CANCELLED if self._cancelled.is_set()
                                       else PartStatus.PAUSED)
                        return
                except requests.RequestException as exc:
                    attempt += 1
                    part.retries += 1
                    if attempt > self.cfg.max_retries:
                        part.status = PartStatus.FAILED
                        part.error = f"Connection error: {exc}"
                        self.log(f"Part {part.index + 1} failed: {exc}")
                        self._notify_progress(part, force=True)
                        return
                    delay = self._backoff(attempt, exc)
                    self.log(f"Part {part.index + 1}: {exc} — retry {attempt}/"
                             f"{self.cfg.max_retries} in {delay:.1f}s")
                    if self._stop.wait(delay):
                        part.status = (PartStatus.CANCELLED if self._cancelled.is_set()
                                       else PartStatus.PAUSED)
                        return
        finally:
            self._close_sessions_for(part.index)

    def _backoff(self, attempt: int, exc: Exception) -> float:
        retry_after = getattr(exc, "retry_after", None)
        if retry_after and retry_after > 0:
            return min(retry_after, MAX_BACKOFF)
        return min(MAX_BACKOFF, self.cfg.retry_backoff_base * (2 ** (attempt - 1)))

    def _fetch_part(self, part: PartState) -> None:
        """Download (or continue) one part with a single HTTP request."""
        unknown = self._unknown_size and len(self.parts) == 1
        if not unknown and part.downloaded >= part.length:
            part.status = PartStatus.DONE
            return

        offset = part.downloaded
        is_single = self.single_mode or len(self.parts) == 1
        if unknown:
            range_header = f"bytes={offset}-"      # open-ended request
        else:
            range_header = part.range.http_header_from(offset)

        headers = dict(self.cfg.extra_headers or {})
        headers["Range"] = range_header
        timeout = (self.cfg.connect_timeout, self.cfg.read_timeout)
        session = self._session_for(part.index)
        expected_abs_start = part.start + offset

        part.status = PartStatus.RUNNING
        try:
            resp = session.get(self.url, headers=headers, stream=True,
                               timeout=timeout, allow_redirects=True)
        except requests.RequestException:
            raise

        try:
            with resp:
                status = resp.status_code
                if status == 200:
                    if is_single:
                        # Single-stream mode: a 200 body is the whole file.
                        # If we asked to resume and the server ignores Range,
                        # restart this stream from byte 0.
                        if offset > 0:
                            self._reset_part(part)
                        self._stream_to_part(resp, part)
                        return
                    # Parallel mode: server ignored our Range header.
                    raise RangeIgnoredError("Server ignored the Range header")

                if status == 206:
                    start, end, total = parse_content_range(
                        resp.headers.get("Content-Range"))
                    if start != expected_abs_start:
                        raise ContentRangeError(
                            f"Content-Range starts at {start}, expected {expected_abs_start}")
                    if unknown:
                        if total is not None:
                            self.total_size = total
                            self._unknown_size = False
                            part.range = (ByteRange(0, 0, total - 1) if total > 0
                                          else ByteRange(0, 0, -1))
                        self._stream_to_part(resp, part)
                        return
                    if end != part.end:
                        raise ContentRangeError(
                            f"Content-Range ends at {end}, expected {part.end}")
                    if total is not None and self.total_size is not None \
                            and total != self.total_size:
                        raise ContentRangeError(
                            f"Content-Range total {total} != expected {self.total_size}")
                    self._stream_to_part(resp, part)
                    return

                if status == 416:
                    if not unknown and part.downloaded >= part.length:
                        return
                    raise ContentRangeError("Server rejected the byte range (HTTP 416)")

                if status in (408, 429) or status >= 500:
                    retry_after = None
                    ra = resp.headers.get("Retry-After")
                    if ra:
                        try:
                            retry_after = float(ra)
                        except ValueError:
                            retry_after = None
                    raise TransientHTTPError(
                        f"HTTP {status} from server", status_code=status,
                        retry_after=retry_after)

                if status in (401, 403):
                    raise PermanentHTTPError(
                        f"Access denied (HTTP {status}). The link may require "
                        "authentication or may have expired.", status)
                if status in (404, 410):
                    raise PermanentHTTPError(
                        f"The file is no longer available (HTTP {status}).", status)
                raise PermanentHTTPError(f"Unexpected HTTP {status} from server.", status)
        except requests.RequestException as exc:
            # Connection dropped mid-stream → truncated response (transient).
            if part.downloaded > offset:
                raise TruncatedResponseError(
                    f"Connection lost after {part.downloaded - offset} bytes") from exc
            raise

    def _reset_part(self, part: PartState) -> None:
        path = self.part_path(part.index)
        with open(path, "wb"):
            pass
        part.downloaded = 0
        part.meter.reset()

    def _stream_to_part(self, resp, part: PartState) -> None:
        path = self.part_path(part.index)
        offset = part.downloaded
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = "r+b" if path.exists() and offset > 0 else "wb"
        with open(path, mode) as fh:
            if offset > 0:
                fh.seek(offset)
            try:
                for chunk in resp.iter_content(chunk_size=self.cfg.chunk_size):
                    if not chunk:
                        continue
                    if self._stop.is_set():
                        raise (DownloadCancelled() if self._cancelled.is_set()
                               else DownloadPaused())
                    fh.write(chunk)
                    n = len(chunk)
                    with part.lock:
                        part.downloaded += n
                    self._meter.add(n)
                    part.meter.add(n)
                    if not self.limiter.consume(n, self._stop, self.task_bucket):
                        raise (DownloadCancelled() if self._cancelled.is_set()
                               else DownloadPaused())
                    self._notify_progress(part)
            except requests.RequestException as exc:
                raise TruncatedResponseError(
                    f"Connection lost after {part.downloaded - offset} bytes") from exc
            fh.flush()

        unknown = self._unknown_size and len(self.parts) == 1
        if unknown:
            # EOF defines the size.
            self.total_size = part.downloaded
            self._unknown_size = False
            part.range = (ByteRange(0, 0, part.downloaded - 1) if part.downloaded > 0
                          else ByteRange(0, 0, -1))
            return
        if part.downloaded < part.length:
            raise TruncatedResponseError(
                f"Part {part.index + 1} ended early: "
                f"{part.downloaded}/{part.length} bytes")

    # ----------------------------------------------------------------- merge
    def _merge(self) -> None:
        if self.total_size is None:
            self.total_size = self.downloaded_bytes()
        part_paths = [self.part_path(p.index) for p in self.parts]
        sizes = [p.length for p in self.parts]

        def _on_progress(written: int, total: int) -> None:
            self._merge_progress = written
            now = time.monotonic()
            if now >= self._notify_at:
                self._notify_at = now + 0.2
                try:
                    self.listener.on_task_progress(self)
                except Exception:
                    log.exception("listener failed")

        assemble_file(
            part_paths, sizes, self.final_path,
            checksum=self.cfg.checksum,
            progress=_on_progress,
            keep_parts=False,   # parts removed only after full verification
        )
        self.cleanup_temp()

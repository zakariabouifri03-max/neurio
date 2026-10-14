"""Download manager: queue scheduling, settings, persistence and the
Qt-signal bridge between worker engines and the GUI.

Threading model
---------------
* Each active download owns one :class:`~ultradownload.engine.DownloadEngine`
  whose orchestrator + part-worker threads are plain Python threads.
* Engines report through an event sink; the sink only stores data and
  emits Qt signals (auto-queued to the GUI thread), so **widgets are
  never touched from worker threads**.
* Scheduling, statistics and periodic DB persistence run on ``QTimer``s
  in the GUI thread.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Dict, List, Optional

from PySide6.QtCore import QObject, QTimer, Signal

from .db import Database
from .engine import DownloadEngine, EngineConfig, EngineEvent, EngineEventType
from .inspector import probe_url
from .models import (DownloadStatus, DownloadTask, PartState, PartStatus,
                     ProbeResult, RangeSupport)
from .ranges import split_byte_ranges
from .speed import RateLimiter
from .utils import (default_download_dir, ensure_directory, format_bytes,
                    free_disk_space, redact_url, sanitize_filename,
                    unique_path)

log = logging.getLogger(__name__)

#: Safety margin added to the required disk space (headers, DB, slack).
DISK_MARGIN_BYTES = 64 * 1024 * 1024

DEFAULT_SETTINGS: Dict[str, str] = {
    "default_dir": "",
    "max_simultaneous": "3",
    "default_parts": "40",
    "connect_timeout": "15",
    "read_timeout": "60",
    "max_retries": "5",
    "global_speed_limit": "0",        # bytes/s, 0 = unlimited
    "start_minimized": "0",
    "accent": "purple",               # purple | blue
    "auto_cleanup_temp": "0",         # delete temp files on cancel w/o asking
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UltraDownload/1.0",
}


class ManagerError(Exception):
    """User-facing error raised by manager operations."""


class DownloadManager(QObject):
    # --- signals (all emitted on the GUI thread via queued connections) ----
    sig_download_added = Signal(int)
    sig_download_updated = Signal(int, object)     # task dict
    sig_progress = Signal(int, object)             # progress dict
    sig_parts = Signal(int, object)                # list[part dict]
    sig_state_changed = Signal(int, str)           # status value
    sig_completed = Signal(int, str)               # final path
    sig_failed = Signal(int, str)                  # error message
    sig_log = Signal(int, str, str)                # message, level
    sig_stats = Signal(object)                     # aggregate stats dict
    sig_queue_changed = Signal()
    sig_settings_changed = Signal()

    def __init__(self, db: Database, parent: Optional[QObject] = None) -> None:
        super().__init__(parent)
        self.db = db
        self.tasks: Dict[int, DownloadTask] = {}
        self._engines: Dict[int, DownloadEngine] = {}
        self._progress: Dict[int, dict] = {}
        self._dirty: set = set()
        self._lock = threading.RLock()

        self.settings: Dict[str, str] = dict(DEFAULT_SETTINGS)
        self.settings.update(db.get_settings())
        if not self.settings.get("default_dir"):
            self.settings["default_dir"] = default_download_dir()

        self.global_limiter = RateLimiter(self.setting_int("global_speed_limit"))

        self._scheduler = QTimer(self)
        self._scheduler.setInterval(400)
        self._scheduler.timeout.connect(self._schedule_tick)
        self._scheduler.start()

        self._stats_timer = QTimer(self)
        self._stats_timer.setInterval(1000)
        self._stats_timer.timeout.connect(self._emit_stats)
        self._stats_timer.start()

        self._persist_timer = QTimer(self)
        self._persist_timer.setInterval(2000)
        self._persist_timer.timeout.connect(self._persist_tick)
        self._persist_timer.start()

        self._checkpoint_timer = QTimer(self)
        self._checkpoint_timer.setInterval(60_000)
        self._checkpoint_timer.timeout.connect(self.db.checkpoint)
        self._checkpoint_timer.start()

    # ------------------------------------------------------------ settings

    def setting_int(self, key: str, default: int = 0) -> int:
        try:
            return int(str(self.settings.get(key, default)))
        except (TypeError, ValueError):
            return default

    def setting_bool(self, key: str) -> bool:
        return self.setting_int(key, 0) != 0

    def update_settings(self, values: Dict[str, object]) -> None:
        self.settings.update({k: str(v) for k, v in values.items()})
        self.db.save_settings(values)
        if "global_speed_limit" in values:
            self.global_limiter.set_rate(self.setting_int("global_speed_limit"))
        self.sig_settings_changed.emit()

    # ------------------------------------------------------------ recovery

    def load_and_recover(self) -> None:
        """Load persisted tasks; validate temp files after a crash."""
        recovered = 0
        for task in self.db.load_tasks():
            self.tasks[task.id] = task
            if task.status in (DownloadStatus.ACTIVE, DownloadStatus.PAUSED):
                valid = self._validate_temp_data(task)
                task.status = DownloadStatus.PAUSED
                task.error = "" if valid else (
                    "Temporary data was lost — resuming will start over.")
                self.db.update_task_runtime(task.id, task.status, task.error,
                                            task.downloaded_bytes)
                recovered += 1
        if recovered:
            log.info("Recovered %d interrupted download(s) from the database.",
                     recovered)
        self.sig_queue_changed.emit()

    def _validate_temp_data(self, task: DownloadTask) -> bool:
        """Check the temp file and clamp/reset saved part progress."""
        temp = task.temp_path
        ok = True
        if not os.path.exists(temp):
            ok = False
            for part in task.parts:
                part.downloaded = 0
                part.status = PartStatus.PENDING
                part.error = ""
        else:
            size_on_disk = os.path.getsize(temp)
            if task.total_size > 0 and size_on_disk != task.total_size:
                # Preallocated file was truncated/corrupted → start over.
                ok = False
                try:
                    os.remove(temp)
                except OSError:
                    pass
                for part in task.parts:
                    part.downloaded = 0
                    part.status = PartStatus.PENDING
            for part in task.parts:
                part.downloaded = max(0, min(part.downloaded, part.size))
        if task.parts:
            self.db.save_parts(task.id, task.parts)
        return ok

    # ------------------------------------------------------------ adding

    def add_download(self,
                     url: str,
                     dest_dir: str,
                     probe: Optional[ProbeResult] = None,
                     filename: Optional[str] = None,
                     part_count: Optional[int] = None,
                     checksum_algo: str = "",
                     checksum_value: str = "",
                     headers: Optional[Dict[str, str]] = None,
                     priority: int = 0,
                     speed_limit: int = 0,
                     allow_overwrite: bool = False,
                     auto_rename_on_conflict: bool = False) -> DownloadTask:
        """Validate, persist and enqueue a new download (GUI thread)."""
        if probe is None:
            probe = probe_url(url, headers=headers,
                              connect_timeout=self.setting_int("connect_timeout", 15),
                              read_timeout=self.setting_int("read_timeout", 30))
        if not probe.ok:
            raise ManagerError(probe.error or "Could not inspect the URL.")

        dest_dir = os.path.abspath(dest_dir or self.settings["default_dir"])
        try:
            ensure_directory(dest_dir)
        except OSError as exc:
            raise ManagerError(str(exc)) from exc
        from .utils import directory_writable
        if not directory_writable(dest_dir):
            raise ManagerError(
                f"Destination folder is not writable: {dest_dir}")

        name = sanitize_filename(filename or probe.filename or "download")
        part_count = int(part_count if part_count is not None
                         else self.setting_int("default_parts", 40))
        part_count = max(1, min(part_count, 40))

        total = probe.total_size
        if probe.range_support == RangeSupport.NO or total < 0:
            if part_count > 1:
                log.info("Server without range support → single connection.")
            part_count = 1

        task = DownloadTask(
            url=probe.url, filename=name, dest_dir=dest_dir,
            total_size=total, part_count=part_count,
            status=DownloadStatus.QUEUED,
            priority=priority, speed_limit=max(0, int(speed_limit)),
            checksum_algo=(checksum_algo or "").lower(),
            checksum_value=(checksum_value or "").strip().lower(),
            etag=probe.etag, last_modified=probe.last_modified,
            content_type=probe.content_type,
            range_support=probe.range_support,
            final_url=probe.final_url or probe.url,
            requires_auth=bool(headers and any(
                k.lower() in ("authorization", "cookie") for k in headers)),
            allow_overwrite=allow_overwrite,
            headers=dict(headers or {}))

        # --- destination conflict policy -----------------------------------
        final_path = task.final_path
        if os.path.exists(final_path):
            if auto_rename_on_conflict and not allow_overwrite:
                task.filename = os.path.basename(unique_path(dest_dir, name))
            elif not allow_overwrite:
                raise ManagerError(
                    f"'{task.filename}' already exists in {dest_dir}. "
                    "Choose Overwrite, rename, or another folder.")

        # --- disk space check ------------------------------------------------
        self._check_disk_space(task, allow_overwrite)

        if task.checksum_algo and task.checksum_value:
            import re as _re
            expected_len = {"md5": 32, "sha1": 40, "sha256": 64,
                            "sha512": 128}.get(task.checksum_algo)
            if expected_len is None:
                raise ManagerError(
                    f"Unsupported checksum type '{task.checksum_algo}'.")
            if not _re.fullmatch(r"[0-9a-fA-F]+", task.checksum_value) or \
                    len(task.checksum_value) != expected_len:
                raise ManagerError(
                    f"A {task.checksum_algo.upper()} checksum must be "
                    f"{expected_len} hexadecimal characters.")

        # --- plan parts up-front so the queue/details views can show them ---
        if total > 0 and part_count >= 1:
            ranges = split_byte_ranges(total, part_count)
            task.parts = [PartState(i, r.start, r.end)
                          for i, r in enumerate(ranges)]
            task.part_count = len(task.parts)

        with self._lock:
            self.db.save_task(task)
            self.db.save_parts(task.id, task.parts)
            self.tasks[task.id] = task
        log.info("Queued download #%s: %s (%s, %d part(s))", task.id,
                 task.filename,
                 format_bytes(total) if total >= 0 else "unknown size",
                 task.part_count)
        self.sig_download_added.emit(task.id)
        self.sig_queue_changed.emit()
        self._schedule_tick()
        return task

    def _check_disk_space(self, task: DownloadTask,
                          allow_overwrite: bool) -> None:
        free = free_disk_space(task.dest_dir)
        if free is None or task.total_size <= 0:
            return
        needed = task.total_size + DISK_MARGIN_BYTES
        final_path = task.final_path
        if allow_overwrite and os.path.exists(final_path):
            # During os.replace the old and new files may briefly coexist.
            needed += os.path.getsize(final_path)
        if free < needed:
            raise ManagerError(
                f"Not enough disk space: the download needs about "
                f"{format_bytes(needed)} (temporary file included) but only "
                f"{format_bytes(free)} is available on the destination "
                "volume. The temporary file requires the same space as the "
                "final file — no extra copy is made.")

    # ------------------------------------------------------------ scheduling

    def _schedule_tick(self) -> None:
        limit = max(1, self.setting_int("max_simultaneous", 3))
        with self._lock:
            running = sum(1 for e in self._engines.values()
                          if e.status in (DownloadStatus.ACTIVE,
                                          DownloadStatus.PAUSED))
            queued = sorted(
                (t for t in self.tasks.values()
                 if t.status == DownloadStatus.QUEUED and t.id not in self._engines),
                key=lambda t: (-t.priority, t.created_at))
            for task in queued:
                if running >= limit:
                    break
                self._launch(task)
                running += 1

    def _launch(self, task: DownloadTask) -> DownloadEngine:
        cfg = EngineConfig(
            connect_timeout=self.setting_int("connect_timeout", 15),
            read_timeout=self.setting_int("read_timeout", 60),
            max_retries=self.setting_int("max_retries", 5),
            speed_limit=task.speed_limit,
            user_agent=self.settings.get("user_agent", DEFAULT_SETTINGS["user_agent"]),
            extra_headers={},
            allow_overwrite=task.allow_overwrite,
            global_limiter=self.global_limiter)
        engine = DownloadEngine(task=task, config=cfg,
                                event_sink=self._make_sink(task.id),
                                probe=None)
        with self._lock:
            self._engines[task.id] = engine
        engine.start()
        self._persist_task(task)
        return engine

    def _make_sink(self, task_id: int):
        def sink(evt: EngineEvent) -> None:
            try:
                self._on_engine_event(task_id, evt)
            except Exception:  # pragma: no cover - never kill the engine
                log.exception("manager sink error")
        return sink

    def _on_engine_event(self, task_id: int, evt: EngineEvent) -> None:
        data = evt.data
        if evt.type == EngineEventType.PROGRESS:
            self._progress[task_id] = data
            self.sig_progress.emit(task_id, data)
        elif evt.type == EngineEventType.PARTS:
            self._progress.setdefault(task_id, {})["parts"] = data["parts"]
            self._dirty.add(task_id)
            self.sig_parts.emit(task_id, data["parts"])
        elif evt.type == EngineEventType.STATE:
            status = DownloadStatus(data["status"])
            task = self.tasks.get(task_id)
            if task is not None:
                task.status = status
            self.sig_state_changed.emit(task_id, status.value)
            self._persist_task(task)
        elif evt.type == EngineEventType.LOG:
            self.sig_log.emit(task_id, data.get("message", ""),
                              data.get("level", "info"))
        elif evt.type == EngineEventType.COMPLETED:
            task = self.tasks.get(task_id)
            if task is not None:
                task.status = DownloadStatus.COMPLETED
                task.error = ""
                task.updated_at = time.time()
            self._persist_task(task, with_parts=True)
            with self._lock:
                self._engines.pop(task_id, None)
            self.sig_completed.emit(task_id, data.get("path", ""))
            self.sig_queue_changed.emit()
            self._schedule_tick()
        elif evt.type == EngineEventType.FAILED:
            task = self.tasks.get(task_id)
            if task is not None:
                task.status = DownloadStatus.FAILED
                task.error = data.get("error", "")
                task.updated_at = time.time()
            self._persist_task(task, with_parts=True)
            self.sig_failed.emit(task_id, data.get("error", ""))
            self.sig_queue_changed.emit()
            self._schedule_tick()

    def _persist_task(self, task: Optional[DownloadTask],
                      with_parts: bool = False) -> None:
        if task is None:
            return
        try:
            self.db.save_task(task)
            if with_parts and task.parts:
                self.db.save_parts(task.id, task.parts)
        except Exception:  # pragma: no cover - DB errors must not kill engine
            log.exception("failed to persist task %s", task.id)

    def _persist_tick(self) -> None:
        dirty = list(self._dirty)
        self._dirty.clear()
        for task_id in dirty:
            with self._lock:
                engine = self._engines.get(task_id)
            if engine is None:
                continue
            task = self.tasks.get(task_id)
            try:
                self.db.update_part_progress(task_id, engine.parts)
                if task is not None:
                    self.db.update_task_runtime(
                        task_id, engine.status, task.error,
                        engine.downloaded_bytes())
            except Exception:  # pragma: no cover
                log.exception("persist tick failed")

    # ------------------------------------------------------------ controls

    def pause(self, task_id: int) -> None:
        with self._lock:
            engine = self._engines.get(task_id)
        task = self.tasks.get(task_id)
        if engine is not None:
            engine.pause()
        elif task is not None and task.status == DownloadStatus.QUEUED:
            task.status = DownloadStatus.PAUSED
            self._persist_task(task)
            self.sig_state_changed.emit(task_id, task.status.value)
            self.sig_queue_changed.emit()

    def resume(self, task_id: int) -> None:
        """Re-validate the remote file, then continue from saved offsets."""
        task = self.tasks.get(task_id)
        if task is None:
            return
        with self._lock:
            engine = self._engines.get(task_id)
        if engine is None:
            if task.status == DownloadStatus.QUEUED:
                self._schedule_tick()
                return
            if task.status.is_finished:
                self.restart(task_id)
                return
            # Paused without an engine (e.g. after app restart) → requeue.
            task.status = DownloadStatus.QUEUED
            self._persist_task(task)
            self.sig_queue_changed.emit()
            self._schedule_tick()
            return
        # Remote validation runs off the GUI thread.
        threading.Thread(target=self._resume_worker, args=(task_id,),
                         daemon=True,
                         name=f"resume-{task_id}").start()

    def _resume_worker(self, task_id: int) -> None:
        with self._lock:
            engine = self._engines.get(task_id)
        task = self.tasks.get(task_id)
        if engine is None or task is None:
            return
        try:
            probe = probe_url(task.url, headers=task.headers or None,
                              connect_timeout=self.setting_int("connect_timeout", 15),
                              read_timeout=min(30, self.setting_int("read_timeout", 30)),
                              )
            if probe.ok:
                changed_size = (probe.total_size >= 0 and task.total_size >= 0
                                and probe.total_size != task.total_size)
                changed_entity = False
                if probe.etag and task.etag:
                    changed_entity = probe.etag != task.etag
                elif probe.last_modified and task.last_modified:
                    changed_entity = probe.last_modified != task.last_modified
                if changed_size or changed_entity:
                    engine._emit_log(
                        "The remote file changed since the download was "
                        "paused (size/ETag/Last-Modified differ). All parts "
                        "will restart from zero.", "warning")
                    engine._reset_all_parts()
                    task.etag = probe.etag or task.etag
                    task.last_modified = probe.last_modified or task.last_modified
                    self._persist_task(task, with_parts=True)
            else:
                engine._emit_log(
                    f"Could not re-validate the URL ({probe.error}); "
                    "resuming anyway.", "warning")
        except Exception:  # pragma: no cover - defensive
            log.exception("resume validation failed")
        engine.resume()

    def cancel(self, task_id: int, delete_temp: bool = True) -> None:
        with self._lock:
            engine = self._engines.get(task_id)
        task = self.tasks.get(task_id)
        if task is None:
            return
        if engine is None:
            task.status = DownloadStatus.CANCELLED
            task.updated_at = time.time()
            self._persist_task(task)
            if delete_temp and os.path.exists(task.temp_path):
                try:
                    os.remove(task.temp_path)
                except OSError:
                    pass
            self.sig_state_changed.emit(task_id, task.status.value)
            self.sig_queue_changed.emit()
            return
        # Cancelling may block for the join timeout → run off-GUI-thread.
        def _worker():
            engine.cancel(delete_temp=delete_temp)
            task.status = DownloadStatus.CANCELLED
            task.updated_at = time.time()
            self._persist_task(task, with_parts=True)
            with self._lock:
                self._engines.pop(task_id, None)
            self.sig_state_changed.emit(task_id, DownloadStatus.CANCELLED.value)
            self.sig_queue_changed.emit()
            self._schedule_tick()
        threading.Thread(target=_worker, daemon=True,
                         name=f"cancel-{task_id}").start()

    def retry(self, task_id: int) -> None:
        task = self.tasks.get(task_id)
        if task is None:
            return
        with self._lock:
            engine = self._engines.get(task_id)
        if engine is not None:
            if task.status == DownloadStatus.FAILED:
                task.status = DownloadStatus.QUEUED
            engine.retry_failed()
            self._persist_task(task)
            self.sig_queue_changed.emit()
            return
        if task.status in (DownloadStatus.FAILED, DownloadStatus.CANCELLED):
            # Re-create an engine from persisted state.
            self._validate_temp_data(task)
            task.status = DownloadStatus.QUEUED
            task.error = ""
            self._persist_task(task, with_parts=True)
            self.sig_queue_changed.emit()
            self._schedule_tick()

    def restart(self, task_id: int) -> None:
        """Throw away partial data and start the download over."""
        task = self.tasks.get(task_id)
        if task is None:
            return
        with self._lock:
            engine = self._engines.pop(task_id, None)
        if engine is not None:
            engine.cancel(delete_temp=True)
        try:
            if os.path.exists(task.temp_path):
                os.remove(task.temp_path)
        except OSError:
            pass
        for part in task.parts:
            part.downloaded = 0
            part.status = PartStatus.PENDING
            part.error = ""
            part.retries = 0
        task.status = DownloadStatus.QUEUED
        task.error = ""
        task.updated_at = time.time()
        self._persist_task(task, with_parts=True)
        self.sig_state_changed.emit(task_id, task.status.value)
        self.sig_queue_changed.emit()
        self._schedule_tick()

    def remove_record(self, task_id: int) -> None:
        """Delete a finished download's record from history (keeps files)."""
        task = self.tasks.get(task_id)
        if task is None:
            return
        if not task.status.is_finished:
            raise ManagerError("Only finished downloads can be removed from "
                               "the history. Cancel it first.")
        with self._lock:
            self._engines.pop(task_id, None)
            self.tasks.pop(task_id, None)
        self._progress.pop(task_id, None)
        self.db.delete_task(task_id)
        self.sig_queue_changed.emit()

    def set_priority(self, task_id: int, priority: int) -> None:
        task = self.tasks.get(task_id)
        if task is None:
            return
        task.priority = int(priority)
        self._persist_task(task)
        self.sig_queue_changed.emit()

    def pause_all(self) -> None:
        for task_id, task in list(self.tasks.items()):
            if task.status in (DownloadStatus.ACTIVE, DownloadStatus.QUEUED):
                self.pause(task_id)

    def resume_all(self) -> None:
        for task_id, task in list(self.tasks.items()):
            if task.status == DownloadStatus.PAUSED:
                self.resume(task_id)

    # ------------------------------------------------------------ info

    def progress_of(self, task_id: int) -> dict:
        return self._progress.get(task_id, {})

    def engine_of(self, task_id: int) -> Optional[DownloadEngine]:
        with self._lock:
            return self._engines.get(task_id)

    def active_engines(self) -> List[DownloadEngine]:
        with self._lock:
            return list(self._engines.values())

    def stats(self) -> dict:
        total_speed = 0.0
        active = 0
        for engine in self.active_engines():
            if engine.status == DownloadStatus.ACTIVE:
                active += 1
                total_speed += engine.total_speed()
        completed = sum(1 for t in self.tasks.values()
                        if t.status == DownloadStatus.COMPLETED)
        queued = sum(1 for t in self.tasks.values()
                     if t.status == DownloadStatus.QUEUED)
        paused = sum(1 for t in self.tasks.values()
                     if t.status == DownloadStatus.PAUSED)
        failed = sum(1 for t in self.tasks.values()
                     if t.status == DownloadStatus.FAILED)
        total_downloaded = sum(
            (self._progress.get(t.id, {}).get("downloaded", 0)
             if t.status == DownloadStatus.ACTIVE else
             (t.total_size if t.status == DownloadStatus.COMPLETED
              and t.total_size > 0 else t.downloaded_bytes))
            for t in self.tasks.values())
        connections = sum(e.snapshot()["active_connections"]
                          for e in self.active_engines()
                          if e.status == DownloadStatus.ACTIVE)
        disk_free = free_disk_space(self.settings.get("default_dir") or ".")
        return {
            "speed": total_speed,
            "active": active,
            "queued": queued,
            "paused": paused,
            "completed": completed,
            "failed": failed,
            "total_downloaded": total_downloaded,
            "connections": connections,
            "disk_free": disk_free,
            "global_limit": self.global_limiter.rate,
        }

    def _emit_stats(self) -> None:
        try:
            self.sig_stats.emit(self.stats())
        except Exception:  # pragma: no cover
            log.exception("stats error")

    # ------------------------------------------------------------ shutdown

    def shutdown(self, wait_seconds: float = 10.0) -> None:
        """Graceful app shutdown: pause engines, persist, close the DB."""
        self._scheduler.stop()
        self._stats_timer.stop()
        self._persist_timer.stop()
        self._checkpoint_timer.stop()
        engines = self.active_engines()
        for engine in engines:
            if engine.status == DownloadStatus.ACTIVE:
                engine.pause()
        deadline = time.monotonic() + wait_seconds
        for engine in engines:
            remaining = max(0.1, deadline - time.monotonic())
            try:
                engine.join(timeout=remaining)
            except RuntimeError:  # pragma: no cover
                pass
        for task_id, engine in list(self._engines.items()):
            task = self.tasks.get(task_id)
            if task is not None and engine.status != DownloadStatus.COMPLETED:
                if task.status == DownloadStatus.ACTIVE:
                    task.status = DownloadStatus.PAUSED
                self.db.save_task(task)
                self.db.save_parts(task_id, engine.parts)
        self._engines.clear()
        self.db.close()

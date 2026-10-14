"""DownloadManager: download queue, scheduling, persistence, recovery.

The manager owns all :class:`DownloadTask` instances, enforces the maximum
number of simultaneous downloads, assigns priorities, applies the global
speed limit, and keeps SQLite up to date (including crash recovery at
startup).
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from .config import AppSettings
from .engine import BandwidthLimiter, DownloadTask, TaskListener, TaskStatus
from .engine.errors import DownloadError
from .storage import Database

log = logging.getLogger("ultradownload.manager")

__all__ = ["DownloadManager", "ManagerListener"]

ACTIVE_STATUSES = ("running", "merging", "queued", "paused")
HISTORY_STATUSES = ("completed", "failed", "cancelled")


class ManagerListener(TaskListener):
    """Fan-out listener: manager events + per-task events (thread-safe)."""

    def __init__(self) -> None:
        self._subs: list[TaskListener] = []
        self._lock = threading.Lock()

    def subscribe(self, listener: TaskListener) -> None:
        with self._lock:
            self._subs.append(listener)

    def unsubscribe(self, listener: TaskListener) -> None:
        with self._lock:
            if listener in self._subs:
                self._subs.remove(listener)

    def _emit(self, name: str, *args) -> None:
        with self._lock:
            subs = list(self._subs)
        for s in subs:
            try:
                getattr(s, name)(*args)
            except Exception:
                log.exception("manager listener %s failed", name)

    # TaskListener -----------------------------------------------------------
    def on_task_progress(self, task) -> None:
        self._emit("on_task_progress", task)

    def on_task_status(self, task) -> None:
        self._emit("on_task_status", task)

    def on_part_update(self, task, part) -> None:
        self._emit("on_part_update", task, part)

    def on_task_log(self, task, message) -> None:
        self._emit("on_task_log", task, message)


class DownloadManager:
    def __init__(self, db: Database | None = None,
                 settings: AppSettings | None = None) -> None:
        self.db = db or Database(":memory:")
        self.settings = settings or AppSettings()
        self.limiter = BandwidthLimiter(
            self.settings.global_speed_limit or None)
        self.listener = ManagerListener()

        self._tasks: dict[str, DownloadTask] = {}
        self._order: list[str] = []          # queue order (by priority, then add)
        self._lock = threading.RLock()
        self._paused_all = False

        self.load_from_database()

    # ------------------------------------------------------------- creation
    def add_download(
        self,
        url: str,
        dest_dir: str | Path | None = None,
        filename: str | None = None,
        part_count: int | None = None,
        *,
        priority: int = 0,
        checksum: tuple[str, str] | None = None,
        speed_limit: float | None = None,
        extra_headers: dict | None = None,
        overwrite: bool = False,
        auto_start: bool = True,
    ) -> DownloadTask:
        """Create a task from *url*, persist it and (optionally) start it."""
        dest = Path(dest_dir or self.settings.default_dir)
        dest.mkdir(parents=True, exist_ok=True)
        task = DownloadTask(
            url,
            dest,
            filename=filename,
            listener=self.listener,
            limiter=self.limiter,
            checkpoint=self._checkpoint_task,
            part_count=part_count or self.settings.default_parts,
            connect_timeout=self.settings.connect_timeout,
            read_timeout=self.settings.read_timeout,
            max_retries=self.settings.retry_count,
            checksum=checksum,
            speed_limit=speed_limit,
            extra_headers=extra_headers,
            overwrite=overwrite,
        )
        task.priority = priority
        task.hold = not auto_start   # held until start_task() is called
        with self._lock:
            self._tasks[task.id] = task
            self._order.append(task.id)
        self._sort_order()
        self.db.upsert_download(task.snapshot())
        if auto_start:
            self._schedule()
        return task

    def add_from_record(self, record, auto_start: bool = False) -> DownloadTask:
        """Rebuild a live task from a database row (startup recovery)."""
        checksum = None
        if record.get("checksum_algo") and record.get("checksum_value"):
            checksum = (record["checksum_algo"], record["checksum_value"])
        task = DownloadTask(
            record["url"],
            record["dest_dir"],
            filename=record.get("filename"),
            task_id=record["id"],
            listener=self.listener,
            limiter=self.limiter,
            checkpoint=self._checkpoint_task,
            part_count=record.get("part_count") or self.settings.default_parts,
            connect_timeout=self.settings.connect_timeout,
            read_timeout=self.settings.read_timeout,
            max_retries=self.settings.retry_count,
            checksum=checksum,
            speed_limit=record.get("speed_limit"),
            overwrite=True,  # user already accepted this download once
        )
        task.priority = record.get("priority") or 0
        task.total_size = record.get("total_size")
        task.mime_type = record.get("mime_type")
        task.supports_ranges = bool(record.get("supports_ranges"))
        task.single_mode = bool(record.get("single_mode"))
        task.etag = record.get("etag")
        task.last_modified = record.get("last_modified")
        task.notes = list(record.get("notes") or [])
        task.created_at = record.get("created_at") or task.created_at
        task.completed_at = record.get("completed_at")
        task.error = record.get("error")

        # Rebuild part states so resume continues byte-exact.
        from .engine.parts import PartState, PartStatus
        from .engine.ranges import ByteRange
        parts_rows = self.db.get_parts(record["id"])
        if parts_rows:
            task.parts = []
            for row in parts_rows:
                rng = ByteRange(int(row["part_index"]),
                                int(row["start_byte"]), int(row["end_byte"]))
                st = PartState(range=rng, downloaded=int(row["downloaded_bytes"]),
                               retries=int(row["retries"]))
                try:
                    st.status = PartStatus(row["status"])
                except ValueError:
                    st.status = PartStatus.QUEUED
                if st.status is PartStatus.RUNNING:
                    st.status = PartStatus.PAUSED
                task.parts.append(st)

        status = record.get("status")
        if status == "running":
            status = "paused"
        try:
            task.status = TaskStatus(status or "paused")
        except ValueError:
            task.status = TaskStatus.PAUSED

        with self._lock:
            self._tasks[task.id] = task
            if task.id not in self._order:
                self._order.append(task.id)
        self._sort_order()
        task.hold = not auto_start
        if auto_start and task.status in (TaskStatus.QUEUED, TaskStatus.PAUSED):
            self._schedule()
        return task

    # ------------------------------------------------------------- queue ops
    def task(self, task_id: str) -> DownloadTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def tasks(self) -> list[DownloadTask]:
        with self._lock:
            return [self._tasks[i] for i in self._order if i in self._tasks]

    def active_tasks(self) -> list[DownloadTask]:
        return [t for t in self.tasks()
                if t.status in (TaskStatus.RUNNING, TaskStatus.MERGING,
                                TaskStatus.QUEUED, TaskStatus.PAUSED)]

    def history_tasks(self) -> list[DownloadTask]:
        return [t for t in self.tasks() if t.status.is_terminal]

    def queue_tasks(self) -> list[DownloadTask]:
        return [t for t in self.tasks() if t.status is TaskStatus.QUEUED]

    def _sort_order(self) -> None:
        with self._lock:
            self._order.sort(key=lambda i: (
                -(self._tasks[i].priority if i in self._tasks else 0),
                self._tasks[i].created_at if i in self._tasks else 0,
            ))

    def set_priority(self, task_id: str, priority: int) -> None:
        t = self.task(task_id)
        if t is None:
            return
        t.priority = priority
        self.db.set_priority(task_id, priority)
        self._sort_order()
        self._schedule()

    def move_up(self, task_id: str) -> None:
        t = self.task(task_id)
        if t is None:
            return
        self.set_priority(task_id, t.priority + 1)

    def move_down(self, task_id: str) -> None:
        t = self.task(task_id)
        if t is None:
            return
        self.set_priority(task_id, t.priority - 1)

    # ----------------------------------------------------------- control API
    def start_task(self, task_id: str) -> None:
        t = self.task(task_id)
        if t is None:
            return
        t.hold = False
        if t.status in (TaskStatus.FAILED, TaskStatus.CANCELLED):
            threading.Thread(target=t.retry, name=f"ud-retry-{task_id}",
                             daemon=True).start()
        elif t.status is TaskStatus.PAUSED:
            threading.Thread(target=t.resume, name=f"ud-resume-{task_id}",
                             daemon=True).start()
        else:
            self._schedule()

    def pause_task(self, task_id: str) -> None:
        t = self.task(task_id)
        if t:
            # pause() blocks until workers stop; run it off the caller when
            # invoked from the GUI thread via `pause_task_async`.
            t.pause()
            self._schedule()

    def pause_task_async(self, task_id: str) -> None:
        threading.Thread(target=self.pause_task, args=(task_id,),
                         name=f"ud-pause-{task_id}", daemon=True).start()

    def resume_task(self, task_id: str) -> None:
        t = self.task(task_id)
        if t is None:
            return
        t.hold = False
        if t.status is TaskStatus.PAUSED:
            threading.Thread(target=t.resume, name=f"ud-resume-{task_id}",
                             daemon=True).start()
        else:
            self._schedule()

    def retry_task(self, task_id: str) -> None:
        t = self.task(task_id)
        if t is None:
            return
        threading.Thread(target=t.retry, name=f"ud-retry-{task_id}",
                         daemon=True).start()

    def cancel_task(self, task_id: str, delete_parts: bool | None = None) -> None:
        t = self.task(task_id)
        if t is None:
            return
        if delete_parts is None:
            delete_parts = self.settings.auto_cleanup_temp and \
                not self.settings.confirm_cleanup
        threading.Thread(target=t.cancel, kwargs={"delete_parts": delete_parts},
                         name=f"ud-cancel-{task_id}", daemon=True).start()

    def pause_all(self) -> None:
        self._paused_all = True
        for t in self.tasks():
            if t.status in (TaskStatus.RUNNING, TaskStatus.QUEUED):
                threading.Thread(target=t.pause, daemon=True).start()

    def resume_all(self) -> None:
        self._paused_all = False
        for t in self.tasks():
            if t.status is TaskStatus.PAUSED:
                threading.Thread(target=t.resume, daemon=True).start()
        self._schedule()

    def remove_task(self, task_id: str, delete_parts: bool = True) -> None:
        t = self.task(task_id)
        if t is None:
            return
        if t.status in (TaskStatus.RUNNING, TaskStatus.MERGING):
            t.pause()
        if delete_parts:
            t.cleanup_temp()
        with self._lock:
            self._tasks.pop(task_id, None)
            if task_id in self._order:
                self._order.remove(task_id)
        self.db.delete_download(task_id)

    def cleanup_temp_files(self, task_id: str | None = None) -> int:
        """Delete temporary part data. Returns number of tasks cleaned."""
        cleaned = 0
        targets = [self.task(task_id)] if task_id else self.tasks()
        for t in targets:
            if t and t.status.is_terminal:
                if t.tmp_dir.exists():
                    t.cleanup_temp()
                    cleaned += 1
        return cleaned

    # ------------------------------------------------------------- settings
    def apply_settings(self, settings: AppSettings) -> None:
        self.settings = settings
        self.limiter.set_global_rate(settings.global_speed_limit or None)

    # -------------------------------------------------------------- schedule
    def _schedule(self) -> None:
        """Start queued tasks up to the configured concurrency limit."""
        if self._paused_all:
            return
        with self._lock:
            running = sum(1 for t in self._tasks.values()
                          if t.status in (TaskStatus.RUNNING, TaskStatus.MERGING)
                          or getattr(t, "_starting", False))
            limit = max(1, int(self.settings.max_simultaneous_downloads))
            candidates = [self._tasks[i] for i in self._order
                          if i in self._tasks
                          and self._tasks[i].status is TaskStatus.QUEUED
                          and not getattr(self._tasks[i], "_starting", False)
                          and not getattr(self._tasks[i], "hold", False)]
        for t in candidates:
            if running >= limit:
                break
            t._starting = True
            # Never block the caller: prepare may hit the network.
            threading.Thread(target=self._prepare_and_start, args=(t,),
                             name=f"ud-start-{t.id}", daemon=True).start()
            running += 1

    def _prepare_and_start(self, task: DownloadTask) -> None:
        try:
            if not task._prepared:
                task.prepare()
            task._starting = False
            task.start()
        except DownloadError as exc:
            task._starting = False
            task.error = str(exc)
            task.status = TaskStatus.FAILED
            self.db.upsert_download(task.snapshot())
            try:
                self.listener.on_task_status(task)
            except Exception:
                log.exception("listener failed")
        except Exception as exc:
            log.exception("start failed")
            task._starting = False
            task.error = f"Unexpected error: {exc}"
            task.status = TaskStatus.FAILED
            self.db.upsert_download(task.snapshot())
            try:
                self.listener.on_task_status(task)
            except Exception:
                log.exception("listener failed")

    def _checkpoint_task(self, task: DownloadTask) -> None:
        self.db.upsert_download(task.snapshot())
        # Status transitions must free a slot for the next queued download.
        if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED,
                           TaskStatus.CANCELLED, TaskStatus.PAUSED):
            self._schedule()

    def notify_status(self, task: DownloadTask) -> None:
        """Persist immediately on status change (called by listeners)."""
        self.db.upsert_download(task.snapshot())
        self._schedule()

    # -------------------------------------------------------------- recovery
    def load_from_database(self) -> list[DownloadTask]:
        """Restore recoverable downloads after a crash/restart."""
        recovered = []
        for rec in self.db.load_recoverable():
            try:
                t = self.add_from_record(rec, auto_start=False)
                recovered.append(t)
            except Exception:
                log.exception("could not restore download %s", rec.get("id"))
        self._sort_order()
        return recovered

    # ------------------------------------------------------------- shutdown
    def shutdown(self) -> None:
        """Pause everything cleanly and checkpoint the database."""
        self._paused_all = True
        for t in list(self.tasks()):
            if t.status in (TaskStatus.RUNNING, TaskStatus.MERGING):
                try:
                    t.pause()
                except Exception:
                    log.exception("pause during shutdown failed")
            try:
                self.db.upsert_download(t.snapshot())
            except Exception:
                log.exception("checkpoint during shutdown failed")
        self.db.checkpoint()

    # ----------------------------------------------------------- statistics
    def totals(self) -> dict:
        total_speed = 0.0
        total_downloaded = 0
        active = 0
        completed = 0
        for t in self.tasks():
            if t.status in (TaskStatus.RUNNING, TaskStatus.MERGING):
                active += 1
                total_speed += t.speed()
            if t.status is TaskStatus.COMPLETED:
                completed += 1
            total_downloaded += t.downloaded_bytes()
        return {
            "speed": total_speed,
            "downloaded": total_downloaded,
            "active": active,
            "completed": completed,
            "queued": sum(1 for t in self.tasks() if t.status is TaskStatus.QUEUED),
        }

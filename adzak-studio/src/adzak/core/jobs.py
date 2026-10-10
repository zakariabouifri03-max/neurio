"""Background job execution (Qt-free).

Heavy work (encoding, conversion, batch processing) never runs on the UI
thread.  The UI layer wraps :class:`Job` execution in a QThread and relays
the callbacks as Qt signals; the core stays framework-independent and
unit-testable.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from .logging_setup import get_logger

log = get_logger("jobs")


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class JobResult:
    ok: bool
    value: Any = None
    error: str = ""


@dataclass
class Job:
    """A unit of background work with progress reporting.

    ``fn(progress, cancel_event, *args)`` must return the result value, or
    raise.  ``progress`` is a callable taking (fraction, message).
    """

    fn: Callable[..., Any]
    args: tuple = ()
    kwargs: dict = field(default_factory=dict)
    title: str = "Task"
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    message: str = ""
    result: JobResult | None = None

    on_progress: Callable[["Job"], None] | None = None
    on_finished: Callable[["Job"], None] | None = None
    _cancel: threading.Event = field(default_factory=threading.Event, repr=False)

    # ---- called by the worker thread ---------------------------------
    def report(self, fraction: float, message: str = "") -> None:
        self.progress = max(0.0, min(1.0, fraction))
        if message:
            self.message = message
        if self._cancel.is_set():
            raise JobCancelled(self.title)
        if self.on_progress:
            self.on_progress(self)

    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def cancel(self) -> None:
        self._cancel.set()

    def run(self) -> JobResult:
        self.status = JobStatus.RUNNING
        try:
            value = self.fn(self.report, self._cancel, *self.args, **self.kwargs)
            if self._cancel.is_set():
                self.status = JobStatus.CANCELLED
                self.result = JobResult(False, error="cancelled")
            else:
                self.status = JobStatus.DONE
                self.progress = 1.0
                self.result = JobResult(True, value=value)
        except JobCancelled:
            self.status = JobStatus.CANCELLED
            self.result = JobResult(False, error="cancelled")
        except Exception as exc:  # surfaced to the user — never swallowed
            log.exception("job %s failed: %s", self.title, exc)
            self.status = JobStatus.FAILED
            self.result = JobResult(False, error=str(exc))
        if self.on_finished:
            self.on_finished(self)
        return self.result


class JobCancelled(RuntimeError):
    pass


class JobQueue:
    """Simple serial/background job runner with a thread pool."""

    def __init__(self, max_workers: int = 2):
        self._threads: list[threading.Thread] = []
        self._jobs: list[Job] = []
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._max_workers = max(1, max_workers)
        self._active = 0
        self._closed = False

    def submit(self, job: Job) -> Job:
        with self._cond:
            if self._closed:
                raise RuntimeError("queue closed")
            self._jobs.append(job)
            self._cond.notify()
        self._maybe_spawn()
        return job

    def _maybe_spawn(self) -> None:
        with self._cond:
            if self._active >= self._max_workers or not self._jobs:
                return
            job = self._jobs.pop(0)
            self._active += 1
        t = threading.Thread(target=self._run_one, args=(job,), daemon=True)
        t.start()
        with self._lock:
            self._threads.append(t)

    def _run_one(self, job: Job) -> None:
        try:
            job.run()
        finally:
            with self._cond:
                self._active -= 1
                has_more = bool(self._jobs)
            if has_more:
                self._maybe_spawn()

    def active_jobs(self) -> list[Job]:
        with self._lock:
            return [j for j in self._jobs]

    def shutdown(self, wait: bool = True) -> None:
        with self._cond:
            self._closed = True
        if wait:
            for t in list(self._threads):
                t.join(timeout=10)


def run_blocking(job: Job) -> JobResult:
    """Run a job synchronously (used by tests and CLI)."""
    return job.run()

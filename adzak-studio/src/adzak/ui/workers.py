"""Qt threading bridge for background jobs.

``core.jobs.Job`` stays framework-free; this module runs jobs on QThreads and
emits Qt signals the panels bind to.  A small pool limits how many heavy
encodes run at once (default 1 on low-end machines).
"""

from __future__ import annotations

from PySide6.QtCore import QObject, QThread, QTimer, Signal

from ..core.jobs import Job, JobStatus
from ..core.logging_setup import get_logger

log = get_logger("workers")


class JobWorker(QObject):
    progress = Signal(object)      # Job
    finished = Signal(object)      # Job

    def __init__(self, job: Job):
        super().__init__()
        self.job = job

    def run(self) -> None:
        def relay(_job: Job) -> None:
            self.progress.emit(_job)

        self.job.on_progress = relay
        try:
            self.job.run()
        finally:
            self.finished.emit(self.job)


class JobRunner(QObject):
    """Runs submitted Jobs one-at-a-time on worker threads."""

    job_started = Signal(object)
    job_progress = Signal(object)
    job_finished = Signal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._queue: list[Job] = []
        self._thread: QThread | None = None
        self._worker: JobWorker | None = None
        self._jobs: dict[str, Job] = {}

    def submit(self, job: Job) -> Job:
        self._jobs[job.id] = job
        self._queue.append(job)
        self._maybe_start()
        return job

    def _maybe_start(self) -> None:
        if self._thread is not None or not self._queue:
            return
        job = self._queue.pop(0)
        self._thread = QThread(self)
        self._worker = JobWorker(job)
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.finished.connect(self._on_finished)
        self._worker.progress.connect(self.job_progress.emit)
        self.job_started.emit(job)
        self._thread.start()

    def _on_finished(self, job: Job) -> None:
        if self._thread is not None:
            self._thread.quit()
            self._thread.wait(2000)
            self._thread.deleteLater()
        if self._worker is not None:
            self._worker.deleteLater()
        self._thread = None
        self._worker = None
        self.job_finished.emit(job)
        QTimer.singleShot(50, self._maybe_start)

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if job and job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
            job.cancel()
            return True
        return False

    def active_count(self) -> int:
        return 1 if self._thread else 0

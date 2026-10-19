"""Qt background-worker helpers keeping every long task off the UI thread."""
from __future__ import annotations

import traceback
from typing import Any, Callable, Optional

from PySide6.QtCore import QObject, QThread, Signal

from .logging_setup import get_logger

log = get_logger("workers")


class TaskWorker(QObject):
    """Runs ``fn(progress, should_cancel)`` inside a dedicated QThread.

    * ``progress`` is a callback ``(fraction: float, message: str)``.
    * ``should_cancel`` returns True after :meth:`request_cancel`.
    Functions cooperate by checking the cancel flag and raising
    :class:`TaskCancelled`.
    """

    progress = Signal(float, str)
    finished = Signal(object)          # result payload
    failed = Signal(str)
    cancelled = Signal()

    def __init__(self, fn: Callable[..., Any], *args, **kwargs):
        super().__init__()
        self._fn, self._args, self._kwargs = fn, args, kwargs
        self._thread = QThread()
        self.moveToThread(self._thread)
        self._thread.started.connect(self._run)
        self._cancel = False

    def _emit_progress(self, fraction: float, message: str = "") -> None:
        self.progress.emit(max(0.0, min(1.0, float(fraction))), message)

    def _should_cancel(self) -> bool:
        return self._cancel

    def _run(self) -> None:
        try:
            result = self._fn(self._emit_progress, self._should_cancel,
                              *self._args, **self._kwargs)
            self.finished.emit(result)
        except TaskCancelled:
            log.info("Task cancelled: %s", getattr(self._fn, "__name__", "task"))
            self.cancelled.emit()
        except Exception as exc:  # noqa: BLE001 - surface to UI
            log.error("Task failed: %s\n%s", exc, traceback.format_exc())
            self.failed.emit(f"{exc}\n\n{traceback.format_exc()}")
        finally:
            self._thread.quit()

    def start(self) -> None:
        self._thread.start()

    def request_cancel(self) -> None:
        self._cancel = True

    def wait(self, ms: int = 10000) -> None:
        self._thread.wait(ms)


class TaskCancelled(Exception):
    """Raised inside a task function when cooperative cancellation is observed."""


def check_cancel(should_cancel: Optional[Callable[[], bool]]) -> None:
    if should_cancel and should_cancel():
        raise TaskCancelled()

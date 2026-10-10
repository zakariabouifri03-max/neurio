"""Run heavy work off the UI thread. Results and errors are delivered via signals."""
from __future__ import annotations

import threading
from typing import Any, Callable

from PySide6.QtCore import QThread, Signal

from ..core.errors import AppError, OperationCancelled
from ..core.log import get_logger

log = get_logger("worker")


class Worker(QThread):
    progress = Signal(float)
    succeeded = Signal(object)
    failed = Signal(str)

    def __init__(self, fn: Callable[..., Any], *args: Any, **kwargs: Any):
        super().__init__()
        self._fn = fn
        self._args = args
        self._kwargs = kwargs
        self.cancel_event = threading.Event()

    def run(self) -> None:
        try:
            result = self._fn(*self._args, progress=self.progress.emit, cancel=self.cancel_event,
                              **self._kwargs)
            if not self.cancel_event.is_set():
                self.succeeded.emit(result)
        except OperationCancelled:
            self.failed.emit("Cancelled.")
        except AppError as exc:
            log.error("Task failed: %s", exc.details or exc.user_message)
            self.failed.emit(exc.user_message)
        except Exception as exc:  # noqa: BLE001 - last-resort guard so the UI never crashes
            log.exception("Unexpected task error")
            self.failed.emit(f"Unexpected error: {type(exc).__name__}. Details were written to the log.")

    def cancel(self) -> None:
        self.cancel_event.set()

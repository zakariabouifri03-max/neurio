"""Small QRunnable helper for non-blocking metadata and local analysis jobs."""
from __future__ import annotations

import threading
import traceback
from typing import Callable

from PySide6.QtCore import QObject, QRunnable, Signal, Slot


_ACTIVE_WORKERS: set["Worker"] = set()
_ACTIVE_WORKERS_LOCK = threading.Lock()


class WorkerSignals(QObject):
    result = Signal(object)
    error = Signal(str)
    progress = Signal(int, str)
    message = Signal(str)
    finished = Signal()


class Worker(QRunnable):
    def __init__(self, function: Callable, *args, **kwargs):
        super().__init__()
        self.function = function
        self.args = args
        self.kwargs = kwargs
        self.signals = WorkerSignals()
        self.cancel_event = threading.Event()
        self.setAutoDelete(False)
        # Keep the QRunnable and its signal emitter alive if the window closes
        # while work is still completing. Signal connections to deleted widgets
        # are disconnected by Qt; the worker releases itself from this set on exit.
        with _ACTIVE_WORKERS_LOCK:
            _ACTIVE_WORKERS.add(self)

    def cancel(self) -> None:
        self.cancel_event.set()

    @Slot()
    def run(self) -> None:
        try:
            result = self.function(self.cancel_event, self.signals, *self.args, **self.kwargs)
            if not self.cancel_event.is_set():
                self.signals.result.emit(result)
        except Exception as exc:
            if not self.cancel_event.is_set():
                try:
                    self.signals.error.emit(f"{exc}\n\n{traceback.format_exc(limit=6)}")
                except RuntimeError:
                    # A receiver may have been destroyed during application shutdown.
                    pass
        finally:
            try:
                self.signals.finished.emit()
            except RuntimeError:
                pass
            finally:
                with _ACTIVE_WORKERS_LOCK:
                    _ACTIVE_WORKERS.discard(self)

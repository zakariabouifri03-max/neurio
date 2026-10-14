from PySide6.QtCore import QObject, QRunnable, Signal
from .models import DownloadError


class EngineSignals(QObject):
    progress = Signal(str, dict)


class TaskSignals(QObject):
    success = Signal(object)
    failure = Signal(str)
    finished = Signal()


class Task(QRunnable):
    def __init__(self, function):
        super().__init__()
        self.function = function
        self.signals = TaskSignals()

    def run(self):
        try:
            self.signals.success.emit(self.function())
        except Exception as exc:
            message = (
                str(exc)
                if isinstance(exc, (ValueError, OSError, DownloadError))
                else f"Request failed ({type(exc).__name__}). Check the URL and network connection."
            )
            self.signals.failure.emit(message)
        finally:
            self.signals.finished.emit()

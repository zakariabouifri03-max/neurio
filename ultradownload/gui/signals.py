"""Thread-safe bridge between engine threads and Qt widgets.

Worker threads never touch widgets.  They call the bridge's listener methods
(which only append to a queue); a coalescing QTimer on the GUI thread drains
the queue and emits Qt signals at a bounded rate.
"""

from __future__ import annotations

import threading
from collections import deque

from PySide6.QtCore import QObject, QTimer, Signal

from ..engine.task import TaskListener


class QtBridge(QObject, TaskListener):
    task_updated = Signal(str)        # task_id — refresh progress displays
    part_updated = Signal(str, int)   # task_id, part index
    status_changed = Signal(str)      # task_id — lists may need re-building
    log_message = Signal(str, str)    # task_id, message

    def __init__(self, parent=None, interval_ms: int = 200) -> None:
        super().__init__(parent)
        self._lock = threading.Lock()
        self._updates: dict[str, int] = {}
        self._parts: dict[str, set[int]] = {}
        self._statuses: deque[tuple[str, None]] = deque()
        self._logs: deque[tuple[str, str]] = deque()
        self._timer = QTimer(self)
        self._timer.setInterval(interval_ms)
        self._timer.timeout.connect(self._drain)
        self._timer.start()

    # ---- TaskListener (worker threads) ---------------------------------
    def on_task_progress(self, task) -> None:
        with self._lock:
            self._updates[task.id] = 1

    def on_part_update(self, task, part) -> None:
        with self._lock:
            self._updates[task.id] = 1
            self._parts.setdefault(task.id, set()).add(part.index)

    def on_task_status(self, task) -> None:
        with self._lock:
            self._statuses.append((task.id, None))
            self._updates[task.id] = 1

    def on_task_log(self, task, message) -> None:
        with self._lock:
            self._logs.append((task.id, message))

    # ---- GUI thread ----------------------------------------------------
    def _drain(self) -> None:
        with self._lock:
            parts = {k: v for k, v in self._parts.items()}
            self._parts.clear()
            updates = list(self._updates)
            self._updates.clear()
            statuses = list(self._statuses)
            self._statuses.clear()
            logs = list(self._logs)
            self._logs.clear()
        for tid in updates:
            self.task_updated.emit(tid)
        for tid, idxs in parts.items():
            for i in sorted(idxs):
                self.part_updated.emit(tid, i)
        for tid, _ in statuses:
            self.status_changed.emit(tid)
        for tid, msg in logs:
            self.log_message.emit(tid, msg)

    def flush(self) -> None:
        self._drain()

"""Thread-safe transfer-rate metering (sliding window)."""

from __future__ import annotations

import threading
import time
from collections import deque

__all__ = ["SpeedMeter"]


class SpeedMeter:
    """Estimates bytes/second from recent transfer samples.

    Samples recorded with :meth:`add` are kept for ``window`` seconds; speed is
    the total of those samples divided by their timespan (never divided by a
    span shorter than ``min_span`` to avoid spurious spikes after stalls).
    """

    def __init__(self, window: float = 3.0, min_span: float = 0.4) -> None:
        self._window = window
        self._min_span = min_span
        self._lock = threading.Lock()
        self._samples: deque[tuple[float, int]] = deque()
        self._total = 0

    def add(self, nbytes: int) -> None:
        if nbytes <= 0:
            return
        now = time.monotonic()
        with self._lock:
            self._samples.append((now, nbytes))
            self._total += nbytes
            self._prune(now)

    def _prune(self, now: float) -> None:
        cutoff = now - self._window
        while self._samples and self._samples[0][0] < cutoff:
            self._samples.popleft()

    def speed(self) -> float:
        """Recent transfer rate in bytes/second (0 when idle)."""
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            if not self._samples:
                return 0.0
            total = sum(n for _, n in self._samples)
            span = now - self._samples[0][0]
            if span < self._min_span:
                span = self._min_span
            return total / span

    @property
    def total(self) -> int:
        """Cumulative bytes observed since construction."""
        with self._lock:
            return self._total

    def reset(self) -> None:
        with self._lock:
            self._samples.clear()
            self._total = 0

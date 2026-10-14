"""Speed measurement and rate limiting primitives.

* :class:`SpeedTracker` — sliding-window transfer-rate estimator fed
  with byte deltas from worker threads.
* :class:`RateLimiter` — thread-safe token bucket used for per-download
  and global bandwidth limits.  A rate of ``0`` means unlimited.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Iterable, Optional


class SpeedTracker:
    """Sliding-window bytes/second estimator.

    ``add()`` is called from worker threads with the number of bytes
    written; ``speed()`` returns the average rate over the last
    ``window`` seconds (default 3 s — smooth but responsive).
    """

    __slots__ = ("_lock", "_samples", "_total", "window", "_min_interval", "_last_push")

    def __init__(self, window: float = 3.0, min_interval: float = 0.05) -> None:
        self._lock = threading.Lock()
        # samples: (monotonic_time, cumulative_bytes)
        self._samples: deque = deque()
        self._total = 0
        self.window = window
        self._min_interval = min_interval
        self._last_push = 0.0

    def add(self, nbytes: int) -> None:
        if nbytes <= 0:
            return
        now = time.monotonic()
        with self._lock:
            self._total += nbytes
            if not self._samples or (now - self._last_push) >= self._min_interval:
                self._samples.append((now, self._total))
                self._last_push = now
                self._prune(now)

    def _prune(self, now: float) -> None:
        cutoff = now - max(self.window, 0.5) - 1.0
        while len(self._samples) > 2 and self._samples[0][0] < cutoff:
            self._samples.popleft()

    def speed(self) -> float:
        """Average bytes/second over the window; 0.0 when idle/unknown."""
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            if not self._samples:
                return 0.0
            t0, b0 = self._samples[0]
            dt = now - t0
            if dt <= 0.02:
                return 0.0
            return max(0.0, (self._total - b0) / dt)

    @property
    def total(self) -> int:
        with self._lock:
            return self._total

    def reset(self) -> None:
        with self._lock:
            self._samples.clear()
            self._total = 0


class RateLimiter:
    """Token-bucket rate limiter (bytes per second).

    ``acquire(n)`` blocks until ``n`` bytes worth of budget are
    available.  ``rate <= 0`` disables limiting.  ``set_rate()`` may be
    called at any time from any thread (used by the settings UI).
    """

    def __init__(self, rate: float = 0.0, burst_ratio: float = 1.0) -> None:
        self._lock = threading.Condition(threading.Lock())
        self._rate = float(max(0.0, rate))
        self._burst_ratio = burst_ratio
        self._tokens = self._capacity()
        self._last = time.monotonic()

    def _capacity(self) -> float:
        # Allow a small burst (>= one 256 KiB chunk) so large chunks do
        # not deadlock against tiny rates.
        return max(self._rate * self._burst_ratio, 256 * 1024)

    @property
    def rate(self) -> float:
        with self._lock:
            return self._rate

    def set_rate(self, rate: float) -> None:
        with self._lock:
            self._rate = float(max(0.0, rate))
            self._tokens = min(self._tokens, self._capacity())
            self._lock.notify_all()

    def acquire(self, nbytes: int) -> None:
        if nbytes <= 0:
            return
        with self._lock:
            remaining = float(nbytes)
            while True:
                if self._rate <= 0:
                    return
                now = time.monotonic()
                self._tokens = min(self._capacity(),
                                   self._tokens + (now - self._last) * self._rate)
                self._last = now
                if self._tokens >= remaining:
                    self._tokens -= remaining
                    return
                remaining -= self._tokens
                self._tokens = 0.0
                wait = min(remaining / self._rate, 0.25)
                self._lock.wait(max(wait, 0.005))

    def try_acquire(self, nbytes: int) -> bool:
        """Non-blocking variant used by tests."""
        with self._lock:
            if self._rate <= 0:
                return True
            now = time.monotonic()
            self._tokens = min(self._capacity(),
                               self._tokens + (now - self._last) * self._rate)
            self._last = now
            if self._tokens >= nbytes:
                self._tokens -= nbytes
                return True
            return False


class CompositeLimiter:
    """Applies several :class:`RateLimiter` instances in sequence."""

    def __init__(self, limiters: Iterable[RateLimiter]) -> None:
        self._limiters = [l for l in limiters if l is not None]

    def acquire(self, nbytes: int) -> None:
        for limiter in self._limiters:
            limiter.acquire(nbytes)

    def set_rate(self, rate: float) -> None:  # pragma: no cover - convenience
        for limiter in self._limiters:
            limiter.set_rate(rate)

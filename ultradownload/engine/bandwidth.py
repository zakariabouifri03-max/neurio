"""Token-bucket bandwidth limiting (global and per-download)."""

from __future__ import annotations

import threading
import time

__all__ = ["TokenBucket", "BandwidthLimiter"]


class TokenBucket:
    """Classic token bucket. ``rate`` is bytes/second; None/0 means unlimited."""

    def __init__(self, rate: float | None = None) -> None:
        self._lock = threading.Lock()
        self._rate = float(rate) if rate and rate > 0 else None
        self._tokens = self._rate if self._rate else 0.0
        self._updated = time.monotonic()

    def set_rate(self, rate: float | None) -> None:
        with self._lock:
            self._rate = float(rate) if rate and rate > 0 else None
            if self._rate:
                self._tokens = min(self._tokens, self._rate)
            self._updated = time.monotonic()

    @property
    def rate(self) -> float | None:
        with self._lock:
            return self._rate

    def consume(self, nbytes: int, stop_event: threading.Event | None = None) -> bool:
        """Block until *nbytes* of quota are available.

        Returns ``False`` if *stop_event* was set while waiting.
        """
        if nbytes <= 0:
            return True
        while True:
            with self._lock:
                if self._rate is None:
                    return True
                now = time.monotonic()
                elapsed = now - self._updated
                self._updated = now
                self._tokens = min(self._rate, self._tokens + elapsed * self._rate)
                if self._tokens >= nbytes:
                    self._tokens -= nbytes
                    return True
                deficit = nbytes - self._tokens
                wait = deficit / self._rate
            wait = min(max(wait, 0.005), 1.0)
            if stop_event is not None:
                if stop_event.wait(wait):
                    return False
            else:
                time.sleep(wait)


class BandwidthLimiter:
    """A shared (global) bucket plus optional per-download buckets."""

    def __init__(self, global_rate: float | None = None) -> None:
        self.global_bucket = TokenBucket(global_rate)

    def set_global_rate(self, rate: float | None) -> None:
        self.global_bucket.set_rate(rate)

    @property
    def global_rate(self) -> float | None:
        return self.global_bucket.rate

    def consume(
        self,
        nbytes: int,
        stop_event: threading.Event | None = None,
        task_bucket: TokenBucket | None = None,
    ) -> bool:
        """Charge *nbytes* to the global bucket and, if given, the task bucket."""
        if not self.global_bucket.consume(nbytes, stop_event):
            return False
        if task_bucket is not None:
            return task_bucket.consume(nbytes, stop_event)
        return True

import threading
import time
from contextlib import contextmanager

from .models import Stopped


class RateLimiter:
    """Shared 64 KiB token bucket. No future reservations survive cancellation."""

    def __init__(self, rate=0):
        self.rate = rate
        self.tokens = 0.0
        self.last_time = time.monotonic()
        self.lock = threading.Lock()

    def set_rate(self, rate):
        with self.lock:
            self.rate = rate
            self.tokens = 0.0
            self.last_time = time.monotonic()

    def consume(self, size, stop):
        remaining = float(size)
        while remaining > 0:
            if stop.is_set():
                raise Stopped()
            with self.lock:
                if not self.rate:
                    return
                now = time.monotonic()
                self.tokens = min(
                    65536.0, self.tokens + (now - self.last_time) * self.rate
                )
                self.last_time = now
                amount = min(self.tokens, remaining)
                self.tokens -= amount
                remaining -= amount
                delay = min(0.1, remaining / self.rate)
            if remaining > 0 and stop.wait(delay):
                raise Stopped()


class ConnectionBudget:
    def __init__(self, limit):
        self.semaphore = threading.BoundedSemaphore(limit)

    @contextmanager
    def acquire(self, stop):
        while not self.semaphore.acquire(timeout=0.1):
            if stop.is_set():
                raise Stopped()
        try:
            if stop.is_set():
                raise Stopped()
            yield
        finally:
            self.semaphore.release()

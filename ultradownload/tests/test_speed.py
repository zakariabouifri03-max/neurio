"""SpeedTracker accuracy and RateLimiter behaviour."""

from __future__ import annotations

import threading
import time

from ultradownload.speed import CompositeLimiter, RateLimiter, SpeedTracker


class TestSpeedTracker:
    def test_measures_rate(self):
        t = SpeedTracker(window=2.0)
        start = time.monotonic()
        for _ in range(10):
            t.add(100_000)
            time.sleep(0.02)
        elapsed = time.monotonic() - start
        speed = t.speed()
        expected = 1_000_000 / max(elapsed, 1e-6)
        # generous tolerance: sliding window approximation
        assert 0.4 * expected <= speed <= 2.0 * expected

    def test_idle_decay(self):
        t = SpeedTracker(window=0.3)
        t.add(1000)
        time.sleep(0.6)
        assert t.speed() < 1000  # decays toward zero when idle

    def test_thread_safety(self):
        t = SpeedTracker()
        errors = []

        def worker():
            try:
                for _ in range(2000):
                    t.add(64)
            except Exception as exc:  # pragma: no cover
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        [th.start() for th in threads]
        [th.join() for th in threads]
        assert not errors
        assert t.total == 8 * 2000 * 64


class TestRateLimiter:
    def test_unlimited_never_blocks(self):
        rl = RateLimiter(0)
        t0 = time.monotonic()
        for _ in range(100):
            rl.acquire(10 ** 9)
        assert time.monotonic() - t0 < 0.5

    def test_limits_rate(self):
        rl = RateLimiter(200_000, burst_ratio=0.0)
        rl._tokens = 0.0  # start empty for a deterministic measurement
        t0 = time.monotonic()
        rl.acquire(100_000)   # ~0.5 s at 200 KB/s
        elapsed = time.monotonic() - t0
        assert 0.3 <= elapsed <= 1.5

    def test_set_rate_live(self):
        rl = RateLimiter(0)
        rl.set_rate(1_000_000)
        assert rl.rate == 1_000_000
        rl.set_rate(-5)
        assert rl.rate == 0.0

    def test_composite(self):
        a, b = RateLimiter(0), RateLimiter(0)
        c = CompositeLimiter([a, b])
        t0 = time.monotonic()
        c.acquire(10 ** 8)
        assert time.monotonic() - t0 < 0.2

    def test_concurrent_acquire_respects_limit(self):
        rl = RateLimiter(1_000_000, burst_ratio=0.5)
        total = [0]
        lock = threading.Lock()

        def worker():
            for _ in range(20):
                rl.acquire(25_000)
                with lock:
                    total[0] += 25_000

        t0 = time.monotonic()
        threads = [threading.Thread(target=worker) for _ in range(4)]
        [th.start() for th in threads]
        [th.join() for th in threads]
        elapsed = time.monotonic() - t0
        # 2 MB at ~1 MB/s with 0.5 MB burst → at least ~1.4 s
        assert total[0] == 2_000_000
        assert elapsed >= 1.0

import threading
import time
import pytest
from app.chunk_scheduler import schedule
from app.http_client import RateLimiter, Interrupted


def test_futures_are_bounded_and_not_batch_scheduled():
    lock = threading.Lock()
    generated, finished = [], []
    def indices():
        for i in range(105):
            with lock:
                assert len(generated)-len(finished) < 10
                generated.append(i)
            yield i
    def worker(i):
        time.sleep(.003)
        with lock:
            finished.append(i)
    schedule(indices(), worker, threading.Event())
    assert sorted(finished) == list(range(105))


def test_limit_wait_is_interruptible():
    stop = threading.Event()
    limiter = RateLimiter(1)
    stop.set()
    with pytest.raises(Interrupted):
        limiter.consume(64*1024, stop)


def test_scheduler_rejects_more_than_ten():
    with pytest.raises(ValueError):
        schedule(range(20), lambda i: None, threading.Event(), 11)


def test_rate_pacing_measures_real_elapsed_time():
    limiter = RateLimiter(100000)
    stop = threading.Event()
    began = time.monotonic()
    for _ in range(5):
        limiter.consume(10000, stop)
    assert time.monotonic()-began >= .39

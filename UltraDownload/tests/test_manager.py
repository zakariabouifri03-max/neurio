import threading
import time
from app.bandwidth import ConnectionBudget, RateLimiter
from app.download_manager import DownloadManager
from app.http_client import inspect_url
from app.models import CHUNK_SIZE
from .local_range_server import range_server
from .test_pause_resume import wait_until


def test_global_connection_budget(make_engine, db):
    with range_server(b"x" * CHUNK_SIZE * 12, delay=0.15) as server:
        budget = ConnectionBudget(7)
        engines = [make_engine(server, budget=budget) for _ in range(2)]
        threads = [threading.Thread(target=e.run) for e in engines]
        for t in threads:
            t.start()
        for t in threads:
            t.join(20)
            assert not t.is_alive()
        assert 1 < server.peak <= 7
        assert all(db.get(e.identifier)["status"] == "completed" for e in engines)


def test_queue_pause_priority_history(tmp_path, settings):
    settings.simultaneous_files = 1
    with range_server(b"q" * CHUNK_SIZE * 11, delay=0.2) as server:
        manager = DownloadManager(tmp_path / "profile", settings)
        try:
            info = inspect_url(server.url, settings)
            first = manager.add(info, tmp_path / "files", "first.bin")
            wait_until(lambda: first in manager.active)
            second = manager.add(info, tmp_path / "files", "second.bin")
            third = manager.add(info, tmp_path / "files", "third.bin")
            manager.prioritize(third)
            assert manager.db.get(second)["status"] == "queued"
            assert manager.db.downloads()[0]["id"] == third
            manager.pause_all()
            wait_until(lambda: not manager.active)
            assert all(r["status"] == "paused" for r in manager.db.downloads())
            manager.cancel(second, delete=True)
            assert manager.db.get(second)["status"] == "cancelled"
            manager.resume(first)
            wait_until(lambda: manager.db.get(first)["status"] == "completed")
            assert manager.db.get(third)["status"] == "paused"
            assert (tmp_path / "files" / "first.bin").read_bytes() == server.data
        finally:
            manager.close()
        reopened = DownloadManager(tmp_path / "profile", settings)
        try:
            assert len(reopened.db.downloads()) == 3
            assert reopened.db.get(first)["status"] == "completed"
            assert reopened.db.get(third)["status"] == "paused"
        finally:
            reopened.close()


def test_limiter_measures_real_time():
    limiter = RateLimiter(256 * 1024)
    stop = threading.Event()
    start = time.monotonic()
    threads = [
        threading.Thread(target=limiter.consume, args=(64 * 1024, stop))
        for _ in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert time.monotonic() - start >= 0.95


def test_cancelled_throttle_leaves_no_future_debt():
    from app.models import Stopped

    limiter = RateLimiter(64 * 1024)
    stop = threading.Event()

    def transfer():
        try:
            limiter.consume(64 * 1024, stop)
        except Stopped:
            pass

    threads = [threading.Thread(target=transfer) for _ in range(10)]
    for thread in threads:
        thread.start()
    time.sleep(0.05)
    stop.set()
    for thread in threads:
        thread.join(timeout=1)
        assert not thread.is_alive()
    start = time.monotonic()
    limiter.consume(1024, threading.Event())
    assert time.monotonic() - start < 0.5

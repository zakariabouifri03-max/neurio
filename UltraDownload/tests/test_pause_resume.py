import threading
import time
from app.download_engine import DownloadEngine
from app.models import CHUNK_SIZE
from .local_range_server import range_server


def wait_until(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Condition was not reached")


def test_pause_resume_preserves_completed(make_engine, db):
    data = b"x" * (CHUNK_SIZE * 14 + 123)
    with range_server(data, delay=0.2, delays={0: 0.01}, block_delay=0.003) as server:
        e = make_engine(server)
        thread = threading.Thread(target=e.run)
        thread.start()
        wait_until(lambda: db.rows(e.identifier, 0, 1)[0]["status"] == "complete")
        e.pause()
        thread.join(10)
        assert not thread.is_alive()
        assert db.get(e.identifier)["status"] == "paused"
        assert not e.destination.exists()
        before = server.calls[0]
        resumed = DownloadEngine(db, e.identifier, e.temp_root, e.settings)
        resumed.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert server.calls[0] == before
        assert e.destination.read_bytes() == data


def test_cancel_delete_only_owned(make_engine, db, tmp_path):
    with range_server(b"a" * CHUNK_SIZE * 12, delay=0.2) as server:
        e = make_engine(server)
        sentinel = e.temp_root / "unrelated.txt"
        e.temp_root.mkdir(exist_ok=True)
        sentinel.write_text("keep")
        t = threading.Thread(target=e.run)
        t.start()
        wait_until(lambda: server.active > 0)
        e.cancel(delete=True)
        t.join(10)
        assert db.get(e.identifier)["status"] == "cancelled"
        assert not e.folder.exists()
        assert sentinel.read_text() == "keep"

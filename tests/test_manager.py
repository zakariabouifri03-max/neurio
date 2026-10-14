"""DownloadManager: queue scheduling, limits, persistence, crash recovery."""

import time

from tests.range_server import pattern_data
from ultradownload.config import AppSettings
from ultradownload.engine import TaskStatus
from ultradownload.manager import DownloadManager
from ultradownload.storage import Database


def wait_status(task, status, timeout=30.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if task.status is status:
            return True
        time.sleep(0.02)
    return False


class TestManagerQueue:
    def test_add_and_complete(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest), max_simultaneous_downloads=2)
        mgr = DownloadManager(db, settings)
        srv = make_server(size=120_000)
        t = mgr.add_download(srv.url, tmp_dest, part_count=8)
        assert wait_status(t, TaskStatus.COMPLETED)
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(120_000)
        assert db.get_download(t.id)["status"] == "completed"
        mgr.shutdown()

    def test_max_simultaneous_respected(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest),
                               max_simultaneous_downloads=1)
        mgr = DownloadManager(db, settings)
        s1 = make_server(size=200_000, mode="drip", drip_chunk=16384,
                         drip_delay=0.01)
        s2 = make_server(size=200_000, mode="drip", drip_chunk=16384,
                         drip_delay=0.01)
        s3 = make_server(size=200_000, mode="drip", drip_chunk=16384,
                         drip_delay=0.01)
        t1 = mgr.add_download(s1.url, tmp_dest, filename="a.bin", part_count=4)
        t2 = mgr.add_download(s2.url, tmp_dest, filename="b.bin", part_count=4)
        t3 = mgr.add_download(s3.url, tmp_dest, filename="c.bin", part_count=4)

        # With limit=1, exactly one may run at any sample.
        max_running = 0
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            running = sum(1 for t in (t1, t2, t3)
                          if t.status in (TaskStatus.RUNNING, TaskStatus.MERGING))
            max_running = max(max_running, running)
            if all(t.status is TaskStatus.COMPLETED for t in (t1, t2, t3)):
                break
            time.sleep(0.01)
        assert all(wait_status(t, TaskStatus.COMPLETED, 5) for t in (t1, t2, t3))
        assert max_running <= 1
        mgr.shutdown()

    def test_priority_order(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest),
                               max_simultaneous_downloads=1)
        mgr = DownloadManager(db, settings)
        mgr._paused_all = True  # queue them both first
        s1 = make_server(size=60_000, mode="drip", drip_chunk=8192, drip_delay=0.02)
        s2 = make_server(size=60_000, mode="drip", drip_chunk=8192, drip_delay=0.02)
        t_low = mgr.add_download(s1.url, tmp_dest, filename="low.bin",
                                 part_count=2, priority=0)
        t_high = mgr.add_download(s2.url, tmp_dest, filename="high.bin",
                                  part_count=2, priority=10)
        assert t_low.status is TaskStatus.QUEUED
        assert t_high.status is TaskStatus.QUEUED

        mgr._paused_all = False
        mgr._schedule()
        # With limit=1 the high-priority task must start first.
        assert wait_status(t_high, TaskStatus.RUNNING, 15) or \
            t_high.status is TaskStatus.COMPLETED
        assert t_low.status is TaskStatus.QUEUED, \
            "low priority must wait while high priority runs"
        mgr.shutdown()

    def test_pause_resume_all(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest),
                               max_simultaneous_downloads=3)
        mgr = DownloadManager(db, settings)
        srv = make_server(size=1024 * 1024, mode="drip", drip_chunk=8192,
                          drip_delay=0.02)
        t = mgr.add_download(srv.url, tmp_dest, part_count=8)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and t.downloaded_bytes() < 60_000:
            time.sleep(0.005)
        mgr.pause_all()
        assert wait_status(t, TaskStatus.PAUSED, 15)
        mgr.resume_all()
        assert wait_status(t, TaskStatus.COMPLETED, 60)
        assert (tmp_dest / "file.bin").stat().st_size == 1024 * 1024
        mgr.shutdown()

    def test_retry_failed_via_manager(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest))
        mgr = DownloadManager(db, settings)
        srv = make_server(size=80_000, fail_first=999)  # always 500
        t = mgr.add_download(srv.url, tmp_dest, part_count=2)
        assert wait_status(t, TaskStatus.FAILED, 30)
        srv.state.fail_first = 0  # server recovers
        srv.state._fail_counts.clear()
        mgr.retry_task(t.id)
        assert wait_status(t, TaskStatus.COMPLETED, 30)
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(80_000)
        mgr.shutdown()

    def test_cancel_and_remove(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest))
        mgr = DownloadManager(db, settings)
        srv = make_server(size=600_000, mode="drip", drip_chunk=8192,
                          drip_delay=0.02, barrier_count=4)
        t = mgr.add_download(srv.url, tmp_dest, part_count=4)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and t.downloaded_bytes() < 30_000:
            time.sleep(0.005)
        mgr.cancel_task(t.id, delete_parts=True)
        assert wait_status(t, TaskStatus.CANCELLED, 15)
        mgr.remove_task(t.id)
        assert mgr.task(t.id) is None
        assert db.get_download(t.id) is None
        mgr.shutdown()

    def test_totals(self, make_server, tmp_dest):
        db = Database(":memory:")
        settings = AppSettings(default_dir=str(tmp_dest))
        mgr = DownloadManager(db, settings)
        srv = make_server(size=50_000)
        t = mgr.add_download(srv.url, tmp_dest, part_count=4)
        assert wait_status(t, TaskStatus.COMPLETED, 30)
        totals = mgr.totals()
        assert totals["completed"] == 1
        assert totals["downloaded"] >= 50_000
        mgr.shutdown()


class TestManagerPersistence:
    def test_persistence_across_restart(self, make_server, tmp_dest, tmp_path):
        """Simulated crash: DB row + part files survive; a new manager
        restores the task and completes it without restarting done parts."""
        db_path = tmp_path / "app.sqlite3"
        db = Database(db_path)
        settings = AppSettings(default_dir=str(tmp_dest))
        srv = make_server(size=400_000, mode="drip", drip_chunk=4096,
                          drip_delay=0.03, barrier_count=4)
        mgr = DownloadManager(db, settings)
        t = mgr.add_download(srv.url, tmp_dest, part_count=4)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and t.downloaded_bytes() < 60_000:
            time.sleep(0.005)
        # Simulated crash: stop transfers abruptly, then persist the state
        # exactly as a mid-run checkpoint would have left it.
        t._stop.set()
        t._cancelled.set()
        t.wait(10)
        snap = t.snapshot()
        snap["status"] = "running"   # DB row still claims an active transfer
        saved = {p["index"]: p["downloaded"] for p in snap["parts"]}
        db.upsert_download(snap)
        task_id = t.id
        db.close()

        # ---- restart ----
        db2 = Database(db_path)
        mgr2 = DownloadManager(db2, settings)
        t2 = mgr2.task(task_id)
        assert t2 is not None
        assert t2.status is TaskStatus.PAUSED
        assert t2.downloaded_bytes() == sum(saved.values())

        srv.state.drip_delay = 0.0
        mgr2.start_task(task_id)
        assert wait_status(t2, TaskStatus.COMPLETED, 60)
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(400_000)
        mgr2.shutdown()

    def test_queue_survives_restart(self, tmp_path, tmp_dest):
        db_path = tmp_path / "app.sqlite3"
        db = Database(db_path)
        settings = AppSettings(default_dir=str(tmp_dest))
        mgr = DownloadManager(db, settings)
        mgr.add_download("http://127.0.0.1:1/a.bin", tmp_dest,
                         filename="a.bin", part_count=4, auto_start=False)
        mgr.add_download("http://127.0.0.1:1/b.bin", tmp_dest,
                         filename="b.bin", part_count=8, auto_start=False)
        db.close()

        db2 = Database(db_path)
        mgr2 = DownloadManager(db2, settings)
        tasks = mgr2.tasks()
        assert len(tasks) == 2
        names = sorted(t.filename for t in tasks)
        assert names == ["a.bin", "b.bin"]
        db2.close()

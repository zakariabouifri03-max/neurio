"""DownloadManager tests: queueing, scheduling limits, persistence,
crash recovery, conflicts, disk-space checks — with a real Qt event loop
(offscreen) and the local range server.
"""

from __future__ import annotations

import os
import time
from typing import Callable, List

import pytest

PySide6 = pytest.importorskip("PySide6")
from PySide6.QtCore import QCoreApplication  # noqa: E402

from ultradownload.db import Database  # noqa: E402
from ultradownload.manager import (DownloadManager, ManagerError)  # noqa: E402
from ultradownload.models import DownloadStatus  # noqa: E402
from tests.range_server import verify_file_content  # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    app = QCoreApplication.instance() or QCoreApplication([])
    yield app


def spin_until(cond: Callable[[], bool], timeout: float = 45.0,
               interval: float = 0.01) -> bool:
    app = QCoreApplication.instance()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if app is not None:
            app.processEvents()
        if cond():
            return True
        time.sleep(interval)
    return cond()


@pytest.fixture
def manager(qapp, tmp_path):
    db_path = str(tmp_path / "mgr.db")
    db = Database(db_path)
    mgr = DownloadManager(db)
    mgr.update_settings({"default_parts": 4, "max_simultaneous": 3,
                         "connect_timeout": 5, "read_timeout": 10,
                         "max_retries": 3})
    yield mgr
    try:
        mgr.shutdown(wait_seconds=5)
    except Exception:
        pass


DL_DIR = "downloads"


def ws_dir(tmp_path):
    d = tmp_path / DL_DIR
    d.mkdir(exist_ok=True)
    return str(d)


class TestAddAndComplete:
    def test_add_download_completes_and_persists(self, manager, server_factory,
                                                 tmp_path):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        completed: List[int] = []
        manager.sig_completed.connect(lambda tid, path: completed.append(tid))
        task = manager.add_download(srv.file_url, ws_dir(tmp_path))
        assert task.part_count == 4
        assert task.status in (DownloadStatus.QUEUED, DownloadStatus.ACTIVE)
        assert spin_until(lambda: completed, timeout=45)
        final = os.path.join(ws_dir(tmp_path), "file.bin")
        assert verify_file_content(final, size)
        # persisted
        stored = manager.db.get_task(task.id)
        assert stored.status == DownloadStatus.COMPLETED

    def test_invalid_url_rejected(self, manager, tmp_path):
        with pytest.raises(ManagerError):
            manager.add_download("ftp://x/y", ws_dir(tmp_path))

    def test_probe_failure_raises_manager_error(self, manager, server_factory,
                                                tmp_path):
        srv = server_factory(mode="notfound")
        with pytest.raises(ManagerError) as exc:
            manager.add_download(srv.file_url, ws_dir(tmp_path))
        assert "404" in str(exc.value)

    def test_checksum_format_validated(self, manager, server_factory, tmp_path):
        srv = server_factory(size=1024, mode="normal")
        with pytest.raises(ManagerError):
            manager.add_download(srv.file_url, ws_dir(tmp_path),
                                 checksum_algo="sha256", checksum_value="nothex")
        with pytest.raises(ManagerError):
            manager.add_download(srv.file_url, ws_dir(tmp_path),
                                 checksum_algo="crc32", checksum_value="ab" * 16)


class TestConflictsAndDisk:
    def test_existing_file_requires_permission(self, manager, server_factory,
                                               tmp_path):
        srv = server_factory(size=4096, mode="normal")
        ws = ws_dir(tmp_path)
        existing = os.path.join(ws, "file.bin")
        with open(existing, "wb") as fh:
            fh.write(b"KEEP ME")
        with pytest.raises(ManagerError) as exc:
            manager.add_download(srv.file_url, ws)
        assert "already exists" in str(exc.value)
        assert open(existing, "rb").read() == b"KEEP ME"

    def test_auto_rename_on_conflict(self, manager, server_factory, tmp_path):
        srv = server_factory(size=4096, mode="normal")
        ws = ws_dir(tmp_path)
        with open(os.path.join(ws, "file.bin"), "wb") as fh:
            fh.write(b"OLD")
        completed = []
        manager.sig_completed.connect(lambda tid, p: completed.append(p))
        manager.add_download(srv.file_url, ws, auto_rename_on_conflict=True)
        assert spin_until(lambda: completed, timeout=30)
        assert completed[0].endswith("file (1).bin")
        assert open(os.path.join(ws, "file.bin"), "rb").read() == b"OLD"
        assert verify_file_content(completed[0], 4096)

    def test_allow_overwrite(self, manager, server_factory, tmp_path):
        srv = server_factory(size=4096, mode="normal")
        ws = ws_dir(tmp_path)
        with open(os.path.join(ws, "file.bin"), "wb") as fh:
            fh.write(b"OLD")
        completed = []
        manager.sig_completed.connect(lambda tid, p: completed.append(p))
        manager.add_download(srv.file_url, ws, allow_overwrite=True)
        assert spin_until(lambda: completed, timeout=30)
        assert verify_file_content(os.path.join(ws, "file.bin"), 4096)

    def test_insufficient_disk_space_rejected(self, manager, server_factory,
                                              tmp_path, monkeypatch):
        srv = server_factory(size=1024 * 1024, mode="normal")
        monkeypatch.setattr("ultradownload.manager.free_disk_space",
                            lambda p: 10)
        with pytest.raises(ManagerError) as exc:
            manager.add_download(srv.file_url, ws_dir(tmp_path))
        assert "disk space" in str(exc.value).lower()


class TestQueue:
    def test_max_simultaneous_respected(self, qapp, server_factory, tmp_path):
        db = Database(str(tmp_path / "q.db"))
        mgr = DownloadManager(db)
        mgr.update_settings({"default_parts": 4, "max_simultaneous": 2,
                             "connect_timeout": 5, "read_timeout": 10})
        try:
            size = 512 * 1024
            servers = [server_factory(size=size, mode="slow",
                                      throttle_bps=200 * 1024)
                       for _ in range(4)]
            completed: List[int] = []
            mgr.sig_completed.connect(lambda tid, p: completed.append(tid))
            max_active = [0]
            for i, srv in enumerate(servers):
                mgr.add_download(srv.file_url, ws_dir(tmp_path),
                                 filename=f"dl{i}.bin")
            # poll while downloads run
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline and len(completed) < 4:
                qapp.processEvents()
                max_active[0] = max(max_active[0], mgr.stats()["active"])
                time.sleep(0.02)
            assert len(completed) == 4
            assert max_active[0] <= 2, f"saw {max_active[0]} concurrent"
            assert max_active[0] >= 1
        finally:
            mgr.shutdown(wait_seconds=5)

    def test_priority_ordering(self, qapp, server_factory, tmp_path):
        db = Database(str(tmp_path / "p.db"))
        mgr = DownloadManager(db)
        mgr.update_settings({"default_parts": 2, "max_simultaneous": 1,
                             "connect_timeout": 5, "read_timeout": 10})
        try:
            blocker = server_factory(size=2 * 1024 * 1024, mode="slow",
                                     throttle_bps=100 * 1024)
            small_a = server_factory(size=64 * 1024, mode="normal")
            small_b = server_factory(size=64 * 1024, mode="normal")
            active_order: List[int] = []
            mgr.sig_state_changed.connect(
                lambda tid, st: active_order.append(tid)
                if st == DownloadStatus.ACTIVE.value else None)
            t_block = mgr.add_download(blocker.file_url, ws_dir(tmp_path))
            assert spin_until(lambda: mgr.stats()["active"] == 1, timeout=15)
            t_a = mgr.add_download(small_a.file_url, ws_dir(tmp_path),
                                   filename="a.bin", priority=0)
            t_b = mgr.add_download(small_b.file_url, ws_dir(tmp_path),
                                   filename="b.bin", priority=5)
            assert mgr.tasks[t_a.id].status == DownloadStatus.QUEUED
            assert mgr.tasks[t_b.id].status == DownloadStatus.QUEUED
            mgr.cancel(t_block.id, delete_temp=True)
            # after the blocker is gone, the high-priority task must start
            # before the low-priority one (tracked via ACTIVE transitions;
            # polling statuses directly would race tiny fast downloads)
            done: List[int] = []
            mgr.sig_completed.connect(lambda tid, p: done.append(tid))
            assert spin_until(lambda: t_a.id in done and t_b.id in done,
                              timeout=45)
            assert active_order.index(t_b.id) < active_order.index(t_a.id), \
                f"priority ignored, activation order: {active_order}"
        finally:
            mgr.shutdown(wait_seconds=5)

    def test_pause_all_resume_all(self, manager, server_factory, tmp_path):
        srv = server_factory(size=2 * 1024 * 1024, mode="slow",
                             throttle_bps=100 * 1024)
        task = manager.add_download(srv.file_url, ws_dir(tmp_path))
        assert spin_until(lambda: manager.progress_of(task.id).get(
            "downloaded", 0) > 50_000, timeout=30)
        manager.pause_all()
        assert spin_until(lambda: manager.tasks[task.id].status ==
                          DownloadStatus.PAUSED, timeout=20)
        engine = manager.engine_of(task.id)
        time.sleep(0.4)
        d1 = engine.downloaded_bytes()
        time.sleep(0.6)
        assert engine.downloaded_bytes() == d1
        manager.resume_all()
        assert spin_until(lambda: manager.tasks[task.id].status ==
                          DownloadStatus.COMPLETED, timeout=60)
        assert verify_file_content(os.path.join(ws_dir(tmp_path), "file.bin"),
                                   2 * 1024 * 1024)


class TestCrashRecovery:
    def test_interrupted_download_recovered_and_resumed(self, qapp,
                                                        server_factory,
                                                        tmp_path):
        size = 2 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=120 * 1024)
        ws = ws_dir(tmp_path)
        db_path = str(tmp_path / "rec.db")

        # --- session 1: start a download, then "crash" (hard shutdown) ------
        db1 = Database(db_path)
        mgr1 = DownloadManager(db1)
        mgr1.update_settings({"default_parts": 4, "connect_timeout": 5,
                              "read_timeout": 10})
        task = mgr1.add_download(srv.file_url, ws)
        assert spin_until(lambda: mgr1.progress_of(task.id).get(
            "downloaded", 0) > size * 0.25, timeout=40)
        task_id = task.id
        temp_path = task.temp_path
        mgr1.shutdown(wait_seconds=8)   # persists paused state, closes DB

        assert os.path.exists(temp_path)

        # --- session 2: fresh DB + manager, recover -------------------------
        db2 = Database(db_path)
        mgr2 = DownloadManager(db2)
        mgr2.update_settings({"connect_timeout": 5, "read_timeout": 10})
        mgr2.load_and_recover()
        try:
            recovered = mgr2.tasks[task_id]
            assert recovered.status == DownloadStatus.PAUSED
            saved = sum(p.downloaded for p in recovered.parts)
            assert saved > 0, "part progress was not persisted"
            completed = []
            mgr2.sig_completed.connect(lambda tid, p: completed.append(p))
            mgr2.resume(task_id)
            assert spin_until(lambda: completed, timeout=90)
            assert verify_file_content(os.path.join(ws, "file.bin"), size)
        finally:
            mgr2.shutdown(wait_seconds=5)

    def test_missing_temp_file_resets_parts(self, qapp, server_factory,
                                            tmp_path):
        size = 256 * 1024
        srv = server_factory(size=size, mode="normal")
        ws = ws_dir(tmp_path)
        db_path = str(tmp_path / "rec2.db")
        db1 = Database(db_path)
        mgr1 = DownloadManager(db1)
        mgr1.update_settings({"default_parts": 4, "connect_timeout": 5,
                              "read_timeout": 10})
        task = mgr1.add_download(srv.file_url, ws)
        assert spin_until(lambda: task.status == DownloadStatus.COMPLETED,
                          timeout=30)
        tid = task.id
        # fake an interrupted state as if we crashed mid-download:
        # status ACTIVE, half-done parts, final file not written yet,
        # and the temp file lost.
        os.remove(os.path.join(ws, "file.bin"))
        stored = mgr1.db.get_task(tid)
        from ultradownload.models import DownloadStatus as DS
        mgr1.db.update_task_runtime(tid, DS.ACTIVE, "", 0)
        for p in stored.parts:
            p.downloaded = p.size // 2
        mgr1.db.save_parts(tid, stored.parts)
        mgr1.shutdown(wait_seconds=3)

        db2 = Database(db_path)
        mgr2 = DownloadManager(db2)
        mgr2.load_and_recover()
        try:
            recovered = mgr2.tasks[tid]
            assert recovered.status == DownloadStatus.PAUSED
            assert all(p.downloaded == 0 for p in recovered.parts)
            completed = []
            mgr2.sig_completed.connect(lambda t, p: completed.append(p))
            mgr2.resume(tid)
            assert spin_until(lambda: completed, timeout=60)
            assert verify_file_content(os.path.join(ws, "file.bin"), size)
        finally:
            mgr2.shutdown(wait_seconds=5)


class TestSettingsAndStats:
    def test_settings_persist_across_managers(self, qapp, tmp_path):
        path = str(tmp_path / "s.db")
        db1 = Database(path)
        m1 = DownloadManager(db1)
        m1.update_settings({"max_simultaneous": 9, "accent": "blue"})
        m1.shutdown(wait_seconds=1)
        db2 = Database(path)
        m2 = DownloadManager(db2)
        try:
            assert m2.setting_int("max_simultaneous") == 9
            assert m2.settings["accent"] == "blue"
        finally:
            m2.shutdown(wait_seconds=1)

    def test_stats_report_active_and_completed(self, manager, server_factory,
                                               tmp_path):
        srv = server_factory(size=256 * 1024, mode="normal")
        manager.add_download(srv.file_url, ws_dir(tmp_path))
        assert spin_until(lambda: manager.stats()["completed"] >= 1,
                          timeout=30)
        stats = manager.stats()
        assert stats["total_downloaded"] >= 256 * 1024
        assert stats["disk_free"] is None or stats["disk_free"] > 0

    def test_remove_record_from_history(self, manager, server_factory,
                                        tmp_path):
        srv = server_factory(size=64 * 1024, mode="normal")
        task = manager.add_download(srv.file_url, ws_dir(tmp_path))
        assert spin_until(lambda: task.status == DownloadStatus.COMPLETED,
                          timeout=30)
        manager.remove_record(task.id)
        assert task.id not in manager.tasks
        assert manager.db.get_task(task.id) is None
        # the downloaded file itself is kept
        assert os.path.exists(os.path.join(ws_dir(tmp_path), "file.bin"))

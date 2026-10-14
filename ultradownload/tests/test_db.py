"""SQLite persistence layer tests."""

from __future__ import annotations

import os

import pytest

from ultradownload.db import Database
from ultradownload.models import (DownloadStatus, DownloadTask, PartState,
                                  PartStatus, RangeSupport)
from ultradownload.ranges import split_byte_ranges


@pytest.fixture
def db(tmp_path):
    d = Database(str(tmp_path / "test.db"))
    yield d
    d.close()


def make_task(**kw) -> DownloadTask:
    size = kw.pop("total_size", 1_000_000)
    parts_n = kw.pop("part_count", 4)
    task = DownloadTask(url="http://example.com/f.bin", filename="f.bin",
                        dest_dir="/tmp/x", total_size=size,
                        part_count=parts_n, **kw)
    ranges = split_byte_ranges(size, parts_n)
    task.parts = [PartState(i, r.start, r.end) for i, r in enumerate(ranges)]
    return task


class TestTasks:
    def test_save_and_load_roundtrip(self, db):
        task = make_task(etag='W/"abc"', range_support=RangeSupport.YES,
                         priority=5, speed_limit=1234)
        tid = db.save_task(task)
        db.save_parts(tid, task.parts)
        loaded = db.get_task(tid)
        assert loaded is not None
        assert loaded.url == task.url
        assert loaded.total_size == 1_000_000
        assert loaded.etag == 'W/"abc"'
        assert loaded.priority == 5
        assert loaded.speed_limit == 1234
        assert len(loaded.parts) == 4
        assert [(p.start, p.end) for p in loaded.parts] == \
            [(p.start, p.end) for p in task.parts]

    def test_update_status_and_progress(self, db):
        task = make_task()
        tid = db.save_task(task)
        db.save_parts(tid, task.parts)
        task.parts[0].downloaded = 12345
        task.parts[0].status = PartStatus.RUNNING
        db.update_part_progress(tid, task.parts)
        db.update_task_runtime(tid, DownloadStatus.ACTIVE, "", 12345)
        loaded = db.get_task(tid)
        assert loaded.status == DownloadStatus.ACTIVE
        assert loaded.parts[0].downloaded == 12345
        assert loaded.parts[0].status == PartStatus.RUNNING

    def test_64bit_offsets(self, db):
        size = 80 * 1024 ** 3   # 80 GB
        task = make_task(total_size=size, part_count=40)
        task.parts[39].downloaded = 2 ** 40
        tid = db.save_task(task)
        db.save_parts(tid, task.parts)
        loaded = db.get_task(tid)
        assert loaded.total_size == size
        assert loaded.parts[39].end == size - 1
        assert loaded.parts[39].downloaded == 2 ** 40

    def test_delete_cascades_parts(self, db):
        task = make_task()
        tid = db.save_task(task)
        db.save_parts(tid, task.parts)
        db.delete_task(tid)
        assert db.get_task(tid) is None

    def test_sensitive_headers_not_persisted(self, db):
        task = make_task()
        task.headers = {"Authorization": "Bearer super-secret",
                        "Cookie": "session=abc123"}
        tid = db.save_task(task)
        loaded = db.get_task(tid)
        assert loaded.headers == {}
        # raw file must not contain the secret either
        raw = open(db.path, "rb").read()
        assert b"super-secret" not in raw
        assert b"abc123" not in raw


class TestSettings:
    def test_roundtrip(self, db):
        db.save_settings({"default_dir": "/tmp/dl", "max_simultaneous": 5})
        assert db.get_settings()["max_simultaneous"] == "5"
        db.save_setting("max_simultaneous", 7)
        assert db.get_settings()["max_simultaneous"] == "7"


class TestMaintenance:
    def test_checkpoint_and_integrity(self, db):
        db.save_task(make_task())
        db.checkpoint()
        assert db.integrity_check()

    def test_wal_mode_enabled(self, db):
        import sqlite3
        conn = sqlite3.connect(db.path)
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        conn.close()
        assert mode == "wal"

    def test_reopen_after_close(self, tmp_path):
        path = str(tmp_path / "reopen.db")
        db1 = Database(path)
        tid = db1.save_task(make_task())
        db1.close()
        db2 = Database(path)
        assert db2.get_task(tid) is not None
        db2.close()

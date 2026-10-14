"""SQLite persistence: records, settings, checkpoints, crash recovery."""


from ultradownload.engine import DownloadTask
from ultradownload.storage import Database


def _make_task(tmp_dest, url="http://127.0.0.1:1/file.bin", task_id="abc123def456"):
    return DownloadTask(url, tmp_dest, task_id=task_id, part_count=4,
                        filename="game.bin")


class TestDatabase:
    def test_roundtrip_download(self, tmp_path, tmp_dest):
        db = Database(tmp_path / "t.sqlite3")
        task = _make_task(tmp_dest)
        # build fake part states without network
        from ultradownload.engine.parts import PartState
        from ultradownload.engine.ranges import ByteRange
        task.parts = [PartState(range=ByteRange(i, i * 100, i * 100 + 99),
                               downloaded=50 + i)
                      for i in range(4)]
        task.total_size = 400
        db.upsert_download(task.snapshot())

        rec = db.get_download(task.id)
        assert rec["url"] == task.url
        assert rec["filename"] == "game.bin"
        assert rec["total_size"] == 400
        assert rec["part_count"] == 4
        parts = db.get_parts(task.id)
        assert len(parts) == 4
        assert parts[2]["downloaded_bytes"] == 52
        assert parts[0]["start_byte"] == 0
        assert parts[3]["end_byte"] == 399
        db.close()

    def test_update_and_delete(self, tmp_path, tmp_dest):
        db = Database(tmp_path / "t.sqlite3")
        task = _make_task(tmp_dest)
        db.upsert_download(task.snapshot())
        db.update_status(task.id, "failed", error="boom")
        rec = db.get_download(task.id)
        assert rec["status"] == "failed"
        assert rec["error"] == "boom"
        db.delete_download(task.id)
        assert db.get_download(task.id) is None
        assert db.get_parts(task.id) == []
        db.close()

    def test_settings_roundtrip(self, tmp_path):
        db = Database(tmp_path / "t.sqlite3")
        assert db.get_setting("missing", "default") == "default"
        db.set_setting("theme", {"mode": "dark", "accent": "purple"})
        assert db.get_setting("theme") == {"mode": "dark", "accent": "purple"}
        db.set_setting("limit", 1234.5)
        assert db.get_setting("limit") == 1234.5
        db.set_setting("limit", 99)
        assert db.get_setting("limit") == 99
        assert "limit" in db.all_settings()
        db.close()

    def test_ordering_by_priority(self, tmp_path, tmp_dest):
        db = Database(tmp_path / "t.sqlite3")
        for i, prio in enumerate([0, 5, 1]):
            t = DownloadTask("http://127.0.0.1:1/f.bin", tmp_dest,
                             task_id=f"id{i}xxxxxxx", part_count=1)
            t.priority = prio
            t.created_at = 1000 + i
            db.upsert_download(t.snapshot())
        recs = db.all_downloads()
        assert [r["priority"] for r in recs] == [5, 1, 0]
        db.close()

    def test_recovery_marks_running_as_paused(self, tmp_path, tmp_dest):
        db = Database(tmp_path / "t.sqlite3")
        task = _make_task(tmp_dest, task_id="recover00001")
        from ultradownload.engine.parts import PartState
        from ultradownload.engine.ranges import ByteRange
        task.parts = [PartState(range=ByteRange(i, i * 100, i * 100 + 99),
                               downloaded=50) for i in range(2)]
        task.total_size = 200
        snap = task.snapshot()
        snap["status"] = "running"
        db.upsert_download(snap)

        # Simulate the crash: temp part files exist matching the sizes.
        task.tmp_dir.mkdir(parents=True, exist_ok=True)
        for p in task.parts:
            task.part_path(p.index).write_bytes(b"x" * p.downloaded)

        recs = db.load_recoverable()
        assert len(recs) == 1
        assert recs[0]["status"] == "paused"
        assert "Recovered" in recs[0]["error"]
        db.close()

    def test_recovery_missing_parts_marks_failed(self, tmp_path, tmp_dest):
        db = Database(tmp_path / "t.sqlite3")
        task = _make_task(tmp_dest, task_id="recover00002")
        from ultradownload.engine.parts import PartState
        from ultradownload.engine.ranges import ByteRange
        task.parts = [PartState(range=ByteRange(0, 0, 99), downloaded=80)]
        snap = task.snapshot()
        snap["status"] = "running"
        db.upsert_download(snap)
        # NOTE: no temp files written → recovery must not resume blindly.
        recs = db.load_recoverable()
        assert recs == []
        rec = db.get_download("recover00002")
        assert rec["status"] == "failed"
        db.close()

    def test_no_credentials_stored(self, tmp_path, tmp_dest):
        db = Database(tmp_path / "t.sqlite3")
        task = DownloadTask(
            "http://127.0.0.1:1/f.bin", tmp_dest, task_id="secrets00001",
            part_count=1,
            extra_headers={"Authorization": "Bearer super-secret-token",
                           "Cookie": "session=abc123"})
        db.upsert_download(task.snapshot())
        rec = db.get_download(task.id)
        blob = " ".join(str(v) for v in rec.values())
        assert "super-secret-token" not in blob
        assert "session=abc123" not in blob
        # and nothing in settings either
        db.set_setting("x", {"note": "ok"})
        assert "super-secret-token" not in str(db.all_settings())
        db.close()

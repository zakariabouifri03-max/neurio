import threading
from pathlib import Path
from app.database import Database
from app.download_engine import DownloadEngine
from app.models import CHUNK_SIZE
from .local_range_server import range_server
from .test_pause_resume import wait_until


def paused_engine(make_engine, server, db):
    e = make_engine(server)
    t = threading.Thread(target=e.run)
    t.start()
    wait_until(lambda: db.rows(e.identifier, 0, 1)[0]["status"] == "complete")
    e.pause()
    t.join(10)
    assert not t.is_alive()
    return e


def test_restart_detects_same_size_corruption(make_engine, db, tmp_path):
    with range_server(b"a" * CHUNK_SIZE * 12, delay=0.2, delays={0: 0.01}) as server:
        e = paused_engine(make_engine, server, db)
        part = e.chunks / "00000000.part"
        part.write_bytes(b"b" * CHUNK_SIZE)
        before = server.calls[0]
        fresh = Database(tmp_path / "state.db")
        fresh.interrupted()
        try:
            resumed = DownloadEngine(fresh, e.identifier, e.temp_root, e.settings)
            resumed.run()
            assert fresh.get(e.identifier)["status"] == "completed"
            assert e.destination.read_bytes() == server.data
            assert server.calls[0] == before + 1
        finally:
            fresh.close()


def test_remote_change_never_mixes_versions(make_engine, db):
    with range_server(b"a" * CHUNK_SIZE * 12, delay=0.2, delays={0: 0.01}) as server:
        e = paused_engine(make_engine, server, db)
        server.etag = '"version-2"'
        e2 = DownloadEngine(db, e.identifier, e.temp_root, e.settings)
        e2.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert "changed" in db.get(e.identifier)["error"]
        assert not e.destination.exists()


def test_publication_crash_window(make_engine, db):
    from app.integrity import sha256_file

    with range_server(b"publish me") as server:
        e = make_engine(server)
        e.run()
        digest = sha256_file(e.destination)
        db.update(
            e.identifier, status="publishing", actual_hash="", publish_hash=digest
        )
        db.interrupted()
        recovered = DownloadEngine(db, e.identifier, e.temp_root, e.settings)
        recovered.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert db.get(e.identifier)["actual_hash"] == digest


def test_manifest_tamper_prevents_resume(make_engine, db):
    import json

    with range_server(b"a" * CHUNK_SIZE * 12, delay=0.2, delays={0: 0.01}) as server:
        e = paused_engine(make_engine, server, db)
        manifest = e.folder / "manifest.json"
        data = json.loads(manifest.read_text())
        data["chunk_size"] = 123
        manifest.write_text(json.dumps(data))
        recovered = DownloadEngine(db, e.identifier, e.temp_root, e.settings)
        recovered.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert not e.destination.exists()


def test_actual_forced_process_shutdown(tmp_path, settings):
    import subprocess
    import sys
    import uuid
    from app.http_client import inspect_url

    with range_server(b"x" * CHUNK_SIZE * 18, delay=0.3, delays={0: 0.01}) as server:
        db = Database(tmp_path / "crash.sqlite3")
        identifier = uuid.uuid4().hex
        info = inspect_url(server.url, settings)
        db.create(identifier, info, tmp_path / "output.bin")
        script = """
import sys
from pathlib import Path
from app.database import Database
from app.download_engine import DownloadEngine
from app.settings import Settings
root=Path(sys.argv[1])
e=DownloadEngine(Database(root/'crash.sqlite3'),sys.argv[2],root/'temp',Settings(cleanup_completed=False))
e.run()
"""
        process = subprocess.Popen(
            [sys.executable, "-c", script, str(tmp_path), identifier],
            cwd=Path(__file__).resolve().parents[1],
        )
        try:
            wait_until(lambda: db.rows(identifier, 0, 1)[0]["status"] == "complete")
            process.kill()
            process.wait(timeout=10)
            before = server.calls[0]
            db.interrupted()
            resumed = DownloadEngine(db, identifier, tmp_path / "temp", settings)
            resumed.run()
            assert db.get(identifier)["status"] == "completed"
            assert resumed.destination.read_bytes() == server.data
            assert server.calls[0] == before
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            db.close()


def test_weak_etag_does_not_hide_modified_date():
    from dataclasses import replace
    from app.http_client import compare_remote
    from app.models import RemoteChanged, RemoteInfo
    import pytest

    info = RemoteInfo(
        "http://localhost/file",
        "http://localhost/file",
        "file",
        100,
        True,
        'W/"weak"',
        "old-date",
    )
    with pytest.raises(RemoteChanged):
        compare_remote(info, replace(info, modified="new-date"))


def test_no_validator_restarts_saved_chunks(make_engine, db):
    with range_server(
        b"a" * CHUNK_SIZE * 12, etag="", modified="", delay=0.2, delays={0: 0.01}
    ) as server:
        e = paused_engine(make_engine, server, db)
        before = server.calls[0]
        resumed = DownloadEngine(db, e.identifier, e.temp_root, e.settings)
        resumed.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert server.calls[0] == before + 1
        assert e.destination.read_bytes() == server.data


def test_fresh_plan_avoids_per_chunk_rewrites(make_engine, db, monkeypatch):
    with range_server(b"a" * CHUNK_SIZE * 12) as server:
        e = make_engine(server)

        def unexpected(*args, **kwargs):
            raise AssertionError("New pending rows must not be rewritten one by one")

        monkeypatch.setattr(db, "chunk", unexpected)
        e.recover()
        assert (e.folder / "manifest.json").exists()

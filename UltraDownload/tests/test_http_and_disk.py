import shutil
import pytest
from app.file_utils import safe_filename, validate_url
from app.http_client import inspect_url
from .local_range_server import range_server


@pytest.mark.parametrize("unknown", [True, False])
def test_explicit_single_stream_fallback(make_engine, db, unknown):
    with range_server(
        b"hello" * 300000, ignore_ranges=True, unknown_size=unknown
    ) as server:
        e = make_engine(server)
        assert not e.info.ranges
        assert e.info.reason
        e.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert e.destination.read_bytes() == server.data


def test_head_unsupported(settings):
    with range_server(b"abc", head_supported=False) as server:
        info = inspect_url(server.url, settings)
        assert info.ranges and info.size == 3


def test_wrong_content_range_rejected(make_engine, db):
    with range_server(b"abc", malformed=True) as server:
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert not list(e.chunks.glob("*.part"))


def test_no_overwrite(make_engine, db):
    with range_server(b"abc") as server:
        e = make_engine(server)
        e.destination.parent.mkdir()
        e.destination.write_text("unrelated")
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert e.destination.read_text() == "unrelated"


def test_disk_full(make_engine, db, monkeypatch):
    with range_server(b"abc") as server:
        e = make_engine(server)
        monkeypatch.setattr(
            shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(100, 100, 0)
        )
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert not e.destination.exists()


def test_url_and_filename_safety():
    for url in [
        "file:///secret",
        "ftp://example.com/file",
        "https://user:password@example.com/file",
        "invalid",
    ]:
        with pytest.raises(ValueError):
            validate_url(url)
    assert "/" not in safe_filename("../../bad.exe")
    assert safe_filename("CON.txt") == "_CON.txt"


def test_permission_failure(make_engine, db, monkeypatch):
    from pathlib import Path

    original = Path.open
    with range_server(b"abc") as server:
        e = make_engine(server)

        def denied(path, *args, **kwargs):
            if path.suffix == ".tmp" and path.parent.name == "chunks":
                raise PermissionError("Destination is read-only")
            return original(path, *args, **kwargs)

        monkeypatch.setattr(Path, "open", denied)
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert "read-only" in db.get(e.identifier)["error"]
        assert not e.destination.exists()


def test_range_ignored_after_probe(make_engine, db):
    from app.models import CHUNK_SIZE

    with range_server(b"x" * CHUNK_SIZE) as server:
        e = make_engine(server)
        # Recovery performs another probe; switch behavior only after that probe.
        original = e.recover

        def recover():
            original()
            server.ignore_ranges = True

        e.recover = recover
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert "ignored Range" in db.get(e.identifier)["error"]
        assert not list(e.chunks.glob("*.part"))
        assert not list(e.chunks.glob("*.tmp"))


def test_secret_query_url_not_persisted(make_engine, db):
    with range_server(b"abc") as server:
        server.url += "?token=TOP-SECRET"
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert "TOP-SECRET" not in db.get(e.identifier)["info"]
        assert "TOP-SECRET" not in (e.folder / "manifest.json").read_text()


def test_no_clobber_at_publication_race(tmp_path):
    from app.file_utils import publish_no_replace

    source, destination = tmp_path / "merge.tmp", tmp_path / "final.bin"
    source.write_bytes(b"downloaded")
    destination.write_bytes(b"user data")
    with pytest.raises(FileExistsError):
        publish_no_replace(source, destination)
    assert destination.read_bytes() == b"user data"


def test_retry_after_http_date():
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime
    from app.http_client import retry_after

    date = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=10))
    assert 8 <= retry_after(date) <= 10
    assert retry_after("not-a-date") == 0


def test_unsafe_cleanup_never_deletes_outside(tmp_path):
    from app.file_utils import remove_owned

    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep").write_text("safe")
    with pytest.raises(ValueError):
        remove_owned(tmp_path, "../outside")
    assert (outside / "keep").exists()

import pytest
from app.integrity import validate_checksum
from .local_range_server import range_server


def test_mismatch_prevents_publication(make_engine, db):
    with range_server(b"correct bytes") as s:
        e = make_engine(s, "0" * 64)
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert not e.destination.exists()
        assert "SHA-256 mismatch" in db.get(e.identifier)["error"]


def test_hash_validation():
    with pytest.raises(ValueError):
        validate_checksum("abc")
    assert validate_checksum("A" * 64) == "a" * 64

from pathlib import Path
import pytest
from app.download_engine import DownloadEngine
from app.integrity import validate_checksum, compare_checksum


def test_bad_expected_checksum_never_publishes(server, setup_download):
    db, d, settings = setup_download(server)
    d.expected_sha256 = '0'*64
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    assert 'SHA-256 mismatch' in d.error
    assert not Path(d.destination).exists()


def test_checksum_validation():
    assert validate_checksum('A'*64) == 'a'*64
    with pytest.raises(ValueError):
        validate_checksum('invalid')
    with pytest.raises(ValueError):
        compare_checksum('a'*64, 'b'*64)

import threading
from pathlib import Path
import pytest
from app.assembler import assemble, InvalidChunk
from app.download_engine import DownloadEngine
from app.file_utils import temp_directory
from .local_range_server import serve


def test_empty_file(setup_download):
    with serve(b'') as server:
        db, d, settings = setup_download(server)
        assert d.count == 0
        DownloadEngine(db, d, settings).run()
        assert d.status == 'completed', d.error
        assert Path(d.destination).read_bytes() == b''


def test_assembler_rejects_corruption(server, setup_download):
    db, d, settings = setup_download(server)
    DownloadEngine(db, d, settings).run()
    Path(d.destination).unlink()
    root = temp_directory(d)
    (root / 'chunks' / '000001.part').write_bytes(b'bad')
    with pytest.raises(InvalidChunk):
        assemble(d, db, root, threading.Event())
    assert not Path(d.destination).exists()


def test_never_overwrite_destination(server, setup_download):
    db, d, settings = setup_download(server)
    Path(d.destination).write_bytes(b'existing user file')
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    assert Path(d.destination).read_bytes() == b'existing user file'

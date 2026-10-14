from pathlib import Path
from app.database import Database
from app.download_engine import DownloadEngine
from app.file_utils import temp_directory
from .test_pause_resume import paused_download


def test_restart_recovery_validates_partial_files(server, setup_download, tmp_path):
    db, d, settings = paused_download(server, setup_download)
    d.status = 'downloading'
    db.save(d)
    path = db.conn.execute('PRAGMA database_list').fetchone()[2]
    reopened = Database(path, db.vault)
    reopened.recover()
    recovered = reopened.get(d.id)
    assert recovered.status == 'interrupted'
    DownloadEngine(reopened, recovered, settings).run()
    assert recovered.status == 'completed', recovered.error
    assert Path(d.destination).read_bytes() == server.data
    reopened.close()


def test_remote_change_rejected(server, setup_download):
    db, d, settings = paused_download(server, setup_download)
    server.etag = '"version-2"'
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    assert 'changed' in d.error
    assert not Path(d.destination).exists()


def test_same_size_corrupt_chunk_repaired(server, setup_download):
    db, d, settings = setup_download(server)
    DownloadEngine(db, d, settings).run()
    Path(d.destination).unlink()
    chunk = temp_directory(d) / 'chunks' / '000002.part'
    data = bytearray(chunk.read_bytes())
    data[19] ^= 0xFF
    chunk.write_bytes(data)
    server.events.clear()
    d.status = 'interrupted'
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    starts = [i for event, i, _, _ in server.events if event == 'start']
    assert starts == [2]
    assert Path(d.destination).read_bytes() == server.data


def test_missing_chunk_repaired(server, setup_download):
    db, d, settings = setup_download(server)
    DownloadEngine(db, d, settings).run()
    Path(d.destination).unlink()
    (temp_directory(d) / 'chunks' / '000003.part').unlink()
    server.events.clear()
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed'
    assert [i for event, i, _, _ in server.events if event == 'start'] == [3]


def test_crash_after_atomic_publication(server, setup_download):
    db, d, settings = setup_download(server)
    DownloadEngine(db, d, settings).run()
    d.status = 'assembling'
    db.save(d)
    db.recover()
    server.events.clear()
    recovered = db.get(d.id)
    DownloadEngine(db, recovered, settings).run()
    assert recovered.status == 'completed'
    assert not server.events


def test_new_validator_does_not_validate_old_unversioned_chunks(server, setup_download):
    server.etag = server.modified = ''
    db, d, settings = setup_download(server)
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed'
    Path(d.destination).unlink()
    server.etag = '"new-validator"'
    server.events.clear()
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert len([event for event, *_ in server.events if event == 'start']) == d.count

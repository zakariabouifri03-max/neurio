from pathlib import Path
import threading
from app.download_engine import DownloadEngine


def paused_download(server, setup_download):
    server.block_delay = .012
    db, d, settings = setup_download(server)
    ready = threading.Event()
    engine = DownloadEngine(db, d, settings)
    def progress(snapshot):
        if snapshot['downloaded'] > 256*1024:
            ready.set()
            engine.pause()
    engine.callback = progress
    thread = threading.Thread(target=engine.run)
    thread.start()
    assert ready.wait(5)
    thread.join(10)
    assert not thread.is_alive()
    assert d.status == 'paused', d.error
    return db, d, settings


def test_partial_resume_is_validated(server, setup_download):
    db, d, settings = paused_download(server, setup_download)
    rows = db.chunks(d.id)
    assert any(0 < row['bytes'] < 1048576 for row in rows)
    previous = {r['idx']: r['bytes'] for r in rows if r['status'] == 'complete'}
    server.events.clear()
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert Path(d.destination).read_bytes() == server.data
    assert any(start % 1048576 for event, _, _, start in server.events if event == 'start')
    assert not previous.keys() & {i for event, i, _, _ in server.events if event == 'start'}


def test_cancel_preserves_or_deletes_only_owned_data(server, setup_download, tmp_path):
    from app.file_utils import temp_directory
    for delete in (False, True):
        db, d, settings = setup_download(server)
        engine = DownloadEngine(db, d, settings)
        other = tmp_path / 'unrelated.txt'
        other.write_text('keep me')
        engine.callback = lambda s: engine.cancel(delete) if s['downloaded'] > 0 else None
        engine.run()
        assert d.status == 'cancelled'
        assert other.read_text() == 'keep me'
        assert temp_directory(d).exists() is (not delete)

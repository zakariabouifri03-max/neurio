from pathlib import Path
import pytest
from app.download_engine import DownloadEngine
from app.file_utils import safe_filename, cleanup


@pytest.mark.parametrize('failure', [OSError(28, 'No space'), PermissionError(13, 'Permission denied')])
def test_disk_failures_do_not_publish(server, setup_download, monkeypatch, failure):
    db, d, settings = setup_download(server)
    def fail(*args):
        raise failure
    monkeypatch.setattr('app.download_engine.check_space', fail)
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    assert not Path(d.destination).exists()


@pytest.mark.parametrize('name', ['../../evil.exe', r'..\..\evil.exe', 'CON', 'NUL.txt', 'a:b.exe', '.', ''])
def test_safe_filename(name):
    cleaned = safe_filename(name)
    assert '/' not in cleaned and '\\' not in cleaned and ':' not in cleaned
    assert cleaned not in ('', '.', '..', 'CON', 'NUL.txt')


def test_cleanup_refuses_unowned_directory(server, setup_download, tmp_path):
    db, d, settings = setup_download(server)
    d.id = '../../other'
    with pytest.raises(ValueError):
        cleanup(d)

from pathlib import Path
import pytest
from app.download_engine import DownloadEngine


@pytest.mark.parametrize('code', [429, 500, 502, 503, 504])
def test_transient_retry(server, setup_download, code):
    db, d, settings = setup_download(server)
    server.failures[0] = [code]
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert Path(d.destination).read_bytes() == server.data
    assert db.chunks(d.id, 0, 1)[0]['retries'] == 1
    rejected = next(t for event, i, t, _ in server.events if event == 'reject' and i == 0)
    started = next(t for event, i, t, _ in server.events if event == 'start' and i == 0)
    assert started-rejected >= .045


@pytest.mark.parametrize('code', [401, 403, 404])
def test_permanent_errors_not_retried(server, setup_download, code):
    db, d, settings = setup_download(server)
    server.failures[0] = [code]*10
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    assert len(server.failures[0]) == 9
    assert not Path(d.destination).exists()


def test_truncated_response_continues_safely(server, setup_download):
    db, d, settings = setup_download(server)
    server.truncate.add(0)
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert Path(d.destination).read_bytes() == server.data
    assert db.chunks(d.id, 0, 1)[0]['retries'] == 1


def test_retry_budget_and_manual_retry(server, setup_download):
    db, d, settings = setup_download(server, retries=1)
    server.failures[0] = [503]*2
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    completed = {r['idx'] for r in db.chunks(d.id) if r['status'] == 'complete'}
    server.events.clear()
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert not completed & {i for e, i, _, _ in server.events if e == 'start'}

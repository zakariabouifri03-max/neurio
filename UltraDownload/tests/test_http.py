from pathlib import Path
import pytest
from app.download_engine import DownloadEngine
from app.http_client import HTTPClient, validate_url, ProtocolError
from app.settings import Settings


def test_head_fallback(server):
    server.head_unsupported = True
    client = HTTPClient(Settings())
    try:
        remote = client.inspect(server.url)
        assert remote.ranges and remote.size == len(server.data)
    finally:
        client.close()


@pytest.mark.parametrize('unknown', [True, False])
def test_single_stream(server, setup_download, unknown):
    server.ignore_ranges = True
    server.unknown_length = unknown
    db, d, settings = setup_download(server)
    assert not d.ranges
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert Path(d.destination).read_bytes() == server.data


def test_range_lies_rejected_before_writing(server, setup_download):
    db, d, settings = setup_download(server)
    server.bad_range = True
    DownloadEngine(db, d, settings).run()
    assert d.status == 'failed'
    assert not Path(d.destination).exists()
    assert all(r['bytes'] == 0 for r in db.chunks(d.id))


def test_full_response_not_accepted_as_chunk(server, setup_download):
    db, d, settings = setup_download(server)
    client = HTTPClient(settings)
    remote = client.inspect(server.url)
    server.ignore_ranges = True
    try:
        with client.stream(server.url, remote, 0, 1048575) as response:
            with pytest.raises(ProtocolError):
                client.validate_response(response, remote, 0, 1048575)
    finally:
        client.close()


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'ftp://host/file', 'http://', 'https://u:p@host/x', 'https://host/a b', 'http://host:bad/a'])
def test_url_validation(url):
    with pytest.raises(ValueError):
        validate_url(url)

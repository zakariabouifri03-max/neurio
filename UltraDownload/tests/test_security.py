import sys
import uuid
import pytest
from app.database import URLVault
from app.http_client import retry_after


def test_urls_not_written_to_sqlite(server, setup_download):
    db, d, _ = setup_download(server)
    secret = 'https://example.com/file?access_token=VERY_SECRET'
    db.vault.put(d.id+':original', secret)
    assert secret == db.urls(d.id)[0]
    raw = db.conn.execute('SELECT data FROM downloads').fetchone()[0]
    assert 'access_token' not in raw and server.url not in raw


def test_retry_after_formats():
    assert retry_after('5') == 5
    assert retry_after('not-a-date') == 0
    assert retry_after('Wed, 01 Jan 2020 00:00:00 GMT') == 0


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows Credential Manager integration')
def test_windows_credential_store():
    vault = URLVault()
    key = 'test-'+str(uuid.uuid4())
    try:
        vault.put(key, 'https://example.com/file?token=test-only')
        assert vault.get(key) == 'https://example.com/file?token=test-only'
    finally:
        vault.backend.delete_password('UltraDownload', key)

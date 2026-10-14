import hashlib
import uuid
import pytest
from app.database import Database
from app.http_client import HTTPClient
from app.models import Download, CHUNK_SIZE
from app.settings import Settings
from .local_range_server import serve


class MemoryVault:
    """Test-only credential store. Production uses the OS keyring."""
    def __init__(self):
        self.values = {}
    def put(self, key, value):
        self.values[key] = value
    def get(self, key):
        return self.values[key]


@pytest.fixture
def payload():
    return (bytes(range(256))*((12*CHUNK_SIZE+137)//256+1))[:12*CHUNK_SIZE+137]


@pytest.fixture
def server(payload):
    with serve(payload) as server:
        yield server


@pytest.fixture
def setup_download(tmp_path):
    databases = []
    def make(server, **kwargs):
        settings = Settings(retry_delay=.01, cleanup_completed=False)
        for key, value in kwargs.items():
            setattr(settings, key, value)
        db = Database(tmp_path / f"{uuid.uuid4()}.sqlite3", MemoryVault())
        databases.append(db)
        client = HTTPClient(settings)
        remote = client.inspect(server.url)
        client.close()
        d = Download(str(uuid.uuid4()), "result.bin", str(tmp_path / f"{uuid.uuid4()}.bin"),
                     remote.size, remote.ranges, remote.etag, remote.modified,
                     hashlib.sha256(server.data).hexdigest())
        db.add(d, server.url, remote.url)
        return db, d, settings
    yield make
    for db in databases:
        db.close()

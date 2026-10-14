import uuid
import pytest
from app.database import Database
from app.download_engine import DownloadEngine
from app.http_client import inspect_url
from app.settings import Settings


@pytest.fixture
def settings():
    return Settings(retry_delay=0.01, read_timeout=5, cleanup_completed=False)


@pytest.fixture
def db(tmp_path):
    db = Database(tmp_path / "state.db")
    yield db
    db.close()


@pytest.fixture
def make_engine(tmp_path, db, settings):
    def make(server, checksum="", notify=None, **kwargs):
        info = inspect_url(server.url, settings)
        identifier = uuid.uuid4().hex
        destination = tmp_path / "output" / (identifier + ".bin")
        db.create(identifier, info, destination, checksum)
        return DownloadEngine(
            db, identifier, tmp_path / "temp", settings, info, notify=notify, **kwargs
        )

    return make

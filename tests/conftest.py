"""Shared fixtures for UltraDownload engine tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the project importable without installation.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.range_server import RangeTestServer, pattern_data  # noqa: E402


@pytest.fixture
def tmp_dest(tmp_path):
    d = tmp_path / "downloads"
    d.mkdir()
    return d


@pytest.fixture
def make_server():
    """Factory fixture: start a configured RangeTestServer for one test."""
    servers: list[RangeTestServer] = []

    def _make(size: int = 256 * 1024, data: bytes | None = None, **modes) -> RangeTestServer:
        srv = RangeTestServer(data=data, size=size, **modes)
        srv.start()
        servers.append(srv)
        return srv

    yield _make
    for s in servers:
        s.stop()


@pytest.fixture
def sample_data():
    """Deterministic 256 KiB payload."""
    return pattern_data(256 * 1024)


class CollectListener:
    """Thread-safe listener collecting engine callbacks for assertions."""

    def __init__(self):
        import threading
        self._lock = threading.Lock()
        self.progress_events = []
        self.status_events = []
        self.part_events = []
        self.logs = []

    def on_task_progress(self, task):
        with self._lock:
            self.progress_events.append(task.downloaded_bytes())

    def on_task_status(self, task):
        with self._lock:
            self.status_events.append(task.status.value)

    def on_part_update(self, task, part):
        with self._lock:
            self.part_events.append((part.index, part.downloaded))

    def on_task_log(self, task, message):
        with self._lock:
            self.logs.append(message)


@pytest.fixture
def listener():
    return CollectListener()

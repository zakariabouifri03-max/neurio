"""Shared pytest fixtures: temp workspace + local range-test servers."""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.range_server import RangeTestServer, ServerConfig  # noqa: E402


@pytest.fixture
def workspace(tmp_path):
    """Fresh download destination directory."""
    d = tmp_path / "downloads"
    d.mkdir()
    return str(d)


@pytest.fixture
def server_factory():
    """Factory fixture that starts servers and guarantees teardown."""
    servers = []

    def _make(size: int = 8 * 1024 * 1024, mode: str = "normal", **kw):
        cfg = ServerConfig(size=size, mode=mode, **kw)
        srv = RangeTestServer(cfg).start()
        servers.append(srv)
        return srv

    yield _make
    for s in servers:
        s.stop()

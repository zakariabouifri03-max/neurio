"""URL inspection against the local range test server."""

import pytest
import requests

from ultradownload.engine.errors import (
    InspectError,
    InvalidURLError,
    PermanentHTTPError,
)
from ultradownload.engine.inspector import inspect_url, validate_url


class TestValidateURL:
    def test_valid(self):
        assert validate_url("https://example.com/a.iso") == "https://example.com/a.iso"
        assert validate_url("  http://example.com/x  ") == "http://example.com/x"

    @pytest.mark.parametrize("bad", [
        "", "   ", "ftp://example.com/x", "example.com/x",
        "file:///etc/passwd", "http://", "javascript:alert(1)",
    ])
    def test_invalid(self, bad):
        with pytest.raises(InvalidURLError):
            validate_url(bad)


class TestInspect:
    def test_head_with_ranges(self, make_server):
        srv = make_server(size=123456, filename="game.iso")
        info = inspect_url(srv.url)
        assert info.size == 123456
        assert info.supports_ranges is True
        assert info.filename == "game.iso"
        assert info.etag

    def test_probe_when_head_disabled(self, make_server):
        srv = make_server(size=50000, no_head=True)
        info = inspect_url(srv.url)
        assert info.size == 50000
        assert info.supports_ranges is True  # proven by 206 on the probe

    def test_server_without_ranges(self, make_server):
        srv = make_server(size=4096, no_head=True, mode="ignore_ranges",
                          accept_ranges_header=None)
        info = inspect_url(srv.url)
        assert info.supports_ranges is False
        assert info.size == 4096

    def test_filename_from_url_when_no_disposition(self, make_server):
        srv = make_server(size=100, data=b"x" * 100)
        info = inspect_url(srv.path_url("/downloads/My%20Game%20Setup.zip"))
        assert info.filename == "My Game Setup.zip"

    def test_404(self, make_server):
        srv = make_server(size=100, not_found=("/missing.bin",))
        with pytest.raises(PermanentHTTPError) as ei:
            inspect_url(srv.path_url("/missing.bin"))
        assert ei.value.status_code == 404

    def test_401(self, make_server):
        srv = make_server(size=100, require_token="tok")
        with pytest.raises(PermanentHTTPError) as ei:
            inspect_url(srv.url)
        assert ei.value.status_code == 401

    def test_auth_header_preserved(self, make_server):
        srv = make_server(size=100, require_token="tok")
        info = inspect_url(srv.url, extra_headers={"Authorization": "Bearer tok"})
        assert info.size == 100

    def test_unreachable_host(self):
        with pytest.raises((InspectError, requests.RequestException)):
            inspect_url("http://127.0.0.1:1/nothing", timeout=(0.3, 0.3))

    def test_does_not_download_body(self, make_server):
        srv = make_server(size=8 * 1024 * 1024, no_head=True)
        info = inspect_url(srv.url)
        assert info.size == 8 * 1024 * 1024
        # Only the probe (8 KiB max) should have been transferred.
        served = [r for r in srv.state.requests]
        assert sum(1 for _ in served) <= 2

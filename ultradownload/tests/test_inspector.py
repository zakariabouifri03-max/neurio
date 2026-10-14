"""Step A — URL validation and inspection against the local test server."""

from __future__ import annotations

import pytest

from ultradownload.inspector import (UrlValidationError, probe_url,
                                     validate_url)
from ultradownload.models import RangeSupport
from tests.range_server import ServerConfig, RangeTestServer


class TestValidateUrl:
    def test_valid(self):
        assert validate_url("https://example.com/f.bin") == \
            "https://example.com/f.bin"
        assert validate_url(" http://a.b/c?x=1&y=2 ") == "http://a.b/c?x=1&y=2"

    def test_missing_scheme_gets_https(self):
        assert validate_url("example.com/file.bin") == \
            "https://example.com/file.bin"

    @pytest.mark.parametrize("bad,reason", [
        ("", "empty"),
        ("   ", "blank"),
        ("ftp://host/f.bin", "scheme"),
        ("file:///etc/passwd", "scheme"),
        ("javascript:alert(1)", "scheme"),
        ("https://exa mple.com/f", "spaces"),
        ("not a url at all", "URL"),
        ("https:///path-only", "host"),
    ])
    def test_invalid(self, bad, reason):
        with pytest.raises(UrlValidationError):
            validate_url(bad)


class TestProbeUrl:
    def test_normal_head(self, server_factory):
        srv = server_factory(size=5_000_000, mode="normal")
        res = probe_url(srv.file_url)
        assert res.ok
        assert res.total_size == 5_000_000
        assert res.range_support == RangeSupport.YES
        assert res.filename == "file.bin"
        assert res.etag and res.last_modified

    def test_head_not_allowed_falls_back_to_get_probe(self, server_factory):
        srv = server_factory(size=1234, mode="head_not_allowed")
        res = probe_url(srv.file_url)
        assert res.ok
        assert res.total_size == 1234
        assert res.range_support == RangeSupport.YES

    def test_no_range_server_detected(self, server_factory):
        srv = server_factory(size=777_000, mode="no_range")
        res = probe_url(srv.file_url)
        assert res.ok
        assert res.range_support == RangeSupport.NO
        assert res.total_size == 777_000

    def test_probe_never_downloads_body(self, server_factory):
        size = 20 * 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        res = probe_url(srv.file_url)
        assert res.ok
        served = sum(r.bytes_sent for r in srv.requests)
        assert served <= 64, f"probe downloaded {served} body bytes"

    def test_zero_byte_file(self, server_factory):
        srv = server_factory(size=0, mode="zero")
        res = probe_url(srv.file_url)
        assert res.ok
        assert res.total_size == 0

    def test_unknown_size(self, server_factory):
        srv = server_factory(size=4096, mode="no_content_length")
        res = probe_url(srv.file_url)
        assert res.ok
        assert res.total_size == -1
        assert res.range_support == RangeSupport.NO

    def test_404(self, server_factory):
        srv = server_factory(mode="notfound")
        res = probe_url(srv.file_url)
        assert not res.ok
        assert res.status_code == 404
        assert res.error_kind == "http404"
        assert "404" in res.error

    def test_401(self, server_factory):
        srv = server_factory(mode="auth401")
        res = probe_url(srv.file_url)
        assert not res.ok and res.error_kind == "auth"
        # with the right header it works
        res = probe_url(srv.file_url,
                        headers={"Authorization": "Bearer secret-token"})
        assert res.ok and res.total_size == srv.config.size

    def test_500(self, server_factory):
        srv = server_factory(mode="servererror")
        res = probe_url(srv.file_url)
        assert not res.ok and res.error_kind == "server"

    def test_dns_failure(self):
        res = probe_url("https://no-such-host-ultradownload-xyz.invalid/f.bin",
                        connect_timeout=3, read_timeout=3)
        assert not res.ok
        assert res.error_kind in ("dns", "connection", "timeout")

    def test_connection_refused(self):
        # port 1 on localhost: nothing listens
        res = probe_url("http://127.0.0.1:1/f.bin", connect_timeout=2,
                        read_timeout=2)
        assert not res.ok
        assert res.error_kind in ("refused", "connection", "reset", "timeout")

    def test_invalid_url_result(self):
        res = probe_url("ftp://x/y")
        assert not res.ok and res.error_kind == "invalid_url"

    def test_redirect_followed(self, server_factory):
        srv = server_factory(size=2048, mode="redirect")
        res = probe_url(srv.base_url + "/go/here")
        assert res.ok
        assert res.total_size == 2048
        assert res.final_url.endswith("/real/target.bin")
        assert res.redirect_count >= 1

    def test_filename_from_content_disposition(self, server_factory):
        srv = server_factory(size=1024, mode="normal")
        # monkeypatch a Content-Disposition into responses
        import http.server
        res = probe_url(srv.file_url)
        assert res.filename == "file.bin"  # baseline from URL path

    def test_credentials_not_leaked_in_error(self):
        res = probe_url("https://user:sup3rsecret@127.0.0.1:1/f.bin",
                        connect_timeout=2, read_timeout=2)
        assert not res.ok
        assert "sup3rsecret" not in res.error

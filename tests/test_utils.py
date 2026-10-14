"""Utility helpers: filename sanitization, formatting, redaction."""

from ultradownload.utils import (
    filename_from_headers,
    filename_from_url,
    format_bytes,
    format_eta,
    format_speed,
    redact_headers,
    sanitize_filename,
)


class TestSanitizeFilename:
    def test_plain(self):
        assert sanitize_filename("game.iso") == "game.iso"

    def test_path_traversal(self):
        assert "/" not in sanitize_filename("../../etc/passwd")
        assert "\\" not in sanitize_filename("..\\..\\windows\\system32\\evil.dll")
        assert sanitize_filename("../../etc/passwd") == "passwd"
        assert sanitize_filename("..\\..\\evil.dll") == "evil.dll"

    def test_absolute_paths(self):
        assert sanitize_filename("C:\\Users\\x\\file.zip") == "file.zip"
        assert sanitize_filename("/usr/local/bin/f") == "f"

    def test_invalid_windows_chars(self):
        out = sanitize_filename('a<b>c:d"e|f?g*h.zip')
        assert not any(c in out for c in '<>:"|?*')

    def test_reserved_names(self):
        out = sanitize_filename("CON.txt")
        assert out.upper() != "CON.TXT" and out.endswith(".txt")
        assert sanitize_filename("lpt1.bin").lower() != "lpt1.bin"
        assert sanitize_filename("com9").lower() != "com9"

    def test_trailing_dots_spaces(self):
        assert not sanitize_filename("file.zip. . ").endswith((" ", "."))
        assert sanitize_filename("name   ") == "name"

    def test_empty_and_dots(self):
        assert sanitize_filename("") == "download.bin"
        assert sanitize_filename(".") == "download.bin"
        assert sanitize_filename("..") == "download.bin"
        assert sanitize_filename("...", fallback="x.bin") == "x.bin"

    def test_unicode_preserved(self):
        assert sanitize_filename("باهي-ملف.iso") == "باهي-ملف.iso"

    def test_length_capped(self):
        long_name = "a" * 500 + ".tar.gz"
        out = sanitize_filename(long_name)
        assert len(out) <= 240
        assert out.endswith(".gz")

    def test_null_bytes_removed(self):
        assert "\x00" not in sanitize_filename("evil\x00name.bin")


class TestHeaderFilename:
    def test_rfc5987(self):
        cd = "attachment; filename*=UTF-8''%D8%A8%D8%A7%D9%87%D9%8A.iso"
        assert filename_from_headers(cd) == "باهي.iso"

    def test_quoted(self):
        assert filename_from_headers('attachment; filename="setup.exe"') == "setup.exe"

    def test_unquoted(self):
        assert filename_from_headers("attachment; filename=plain.bin") == "plain.bin"

    def test_hostile(self):
        out = filename_from_headers('attachment; filename="../../x.exe"')
        assert out == "x.exe"

    def test_none(self):
        assert filename_from_headers(None) is None
        assert filename_from_headers("inline") is None


class TestUrlFilename:
    def test_basic(self):
        assert filename_from_url("https://h/a/b/game.iso") == "game.iso"

    def test_encoded(self):
        assert filename_from_url("https://h/My%20Game.zip") == "My Game.zip"

    def test_no_extension(self):
        assert filename_from_url("https://h/download") is None

    def test_root(self):
        assert filename_from_url("https://h/") is None


class TestFormatting:
    def test_bytes(self):
        assert format_bytes(0) == "0 B"
        assert format_bytes(1023) == "1023 B"
        assert format_bytes(1024) == "1.0 KB"
        assert format_bytes(1024 ** 3 * 2.5) == "2.5 GB"
        assert format_bytes(None) == "—"

    def test_speed(self):
        assert format_speed(0) == "0 B/s"
        assert format_speed(5 * 1024 * 1024) == "5.00 MB/s"

    def test_eta(self):
        assert format_eta(30) == "30s"
        assert format_eta(90) == "1m 30s"
        assert format_eta(3700) == "1h 01m"
        assert format_eta(None) == "—"
        assert format_eta(float("inf")) == "—"


class TestRedaction:
    def test_sensitive_headers_hidden(self):
        out = redact_headers({
            "Authorization": "Bearer secret-token",
            "Cookie": "session=abc",
            "User-Agent": "UltraDownload/1.0",
        })
        assert out["Authorization"] == "<redacted>"
        assert out["Cookie"] == "<redacted>"
        assert out["User-Agent"] == "UltraDownload/1.0"

    def test_none(self):
        assert redact_headers(None) == {}

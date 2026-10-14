"""Formatting, sanitisation, checksums, disk helpers."""

from __future__ import annotations

import hashlib
import os

import pytest

from ultradownload.utils import (app_data_dir, compute_checksum, format_bytes,
                                 format_eta, format_speed, free_disk_space,
                                 is_within_directory, redact_headers, redact_url,
                                 sanitize_filename, unique_path)


class TestFormatting:
    def test_bytes(self):
        assert format_bytes(0) == "0 B"
        assert format_bytes(512) == "512 B"
        assert format_bytes(1024) == "1.00 KB"
        assert format_bytes(1536) == "1.50 KB"
        assert format_bytes(1024 ** 2) == "1.00 MB"
        assert format_bytes(40 * 1024 ** 3) == "40.00 GB"
        assert format_bytes(80 * 1024 ** 3) == "80.00 GB"
        assert format_bytes(3 * 1024 ** 4) == "3.00 TB"

    def test_speed(self):
        assert format_speed(2.5 * 1024 ** 2) == "2.50 MB/s"
        assert format_speed(-1) == "-- B/s"

    def test_eta(self):
        assert format_eta(None) == "--"
        assert format_eta(45) == "45s"
        assert format_eta(125) == "2m 05s"
        assert format_eta(3 * 3600 + 25 * 60) == "3h 25m"
        assert format_eta(25 * 3600) == "1d 01h"

    def test_negative_size(self):
        assert format_bytes(-1).startswith("-")


class TestSanitizeFilename:
    def test_plain(self):
        assert sanitize_filename("game.iso") == "game.iso"

    def test_strips_directories(self):
        assert sanitize_filename("/etc/passwd") == "passwd"
        assert sanitize_filename("..\\..\\windows\\system32\\x.dll") == "x.dll"
        assert sanitize_filename("../../escape.bin") == "escape.bin"

    def test_traversal_neutralised(self):
        assert sanitize_filename("..") == "download"
        assert sanitize_filename(".") == "download"

    def test_illegal_chars_replaced(self):
        out = sanitize_filename('a<b>c:d"e|f?g*h\x01.bin')
        assert not any(c in out for c in '<>:"|?*\x01')
        assert out.endswith(".bin")

    def test_windows_reserved_names(self):
        assert sanitize_filename("CON") == "_CON"
        assert sanitize_filename("nul.txt") == "_nul.txt"
        assert sanitize_filename("com1") == "_com1"

    def test_length_cap_keeps_extension(self):
        out = sanitize_filename("x" * 400 + ".iso")
        assert len(out) <= 150
        assert out.endswith(".iso")

    def test_empty(self):
        assert sanitize_filename("") == "download"
        assert sanitize_filename("   ") == "download"

    def test_unicode_kept(self):
        assert sanitize_filename("игра-файл.zip") == "игра-файл.zip"


class TestPathSafety:
    def test_within_directory(self, tmp_path):
        base = str(tmp_path)
        assert is_within_directory(os.path.join(base, "a.bin"), base)
        assert not is_within_directory(os.path.join(base, "..", "evil"), base)

    def test_unique_path(self, tmp_path):
        p = str(tmp_path / "f.bin")
        assert unique_path(str(tmp_path), "f.bin") == p
        open(p, "w").close()
        alt = unique_path(str(tmp_path), "f.bin")
        assert alt.endswith("f (1).bin")


class TestChecksum:
    def test_sha256_and_md5(self, tmp_path):
        p = tmp_path / "data.bin"
        data = os.urandom(3 * 1024 * 1024)
        p.write_bytes(data)
        assert compute_checksum(str(p), "sha256") == \
            hashlib.sha256(data).hexdigest()
        assert compute_checksum(str(p), "md5") == hashlib.md5(data).hexdigest()

    def test_unsupported_algo(self, tmp_path):
        p = tmp_path / "d.bin"
        p.write_bytes(b"x")
        with pytest.raises(ValueError):
            compute_checksum(str(p), "crc32")


class TestDiskHelpers:
    def test_free_disk_space_known(self, tmp_path):
        free = free_disk_space(str(tmp_path))
        assert isinstance(free, int) and free > 0

    def test_free_disk_space_missing_dir_walks_up(self, tmp_path):
        free = free_disk_space(str(tmp_path / "no" / "such" / "dir"))
        assert free is None or free > 0


class TestRedaction:
    def test_redact_headers(self):
        h = {"Authorization": "Bearer abc", "Cookie": "s=1", "Accept": "*/*"}
        out = redact_headers(h)
        assert out["Authorization"] == "***redacted***"
        assert out["Cookie"] == "***redacted***"
        assert out["Accept"] == "*/*"

    def test_redact_url(self):
        assert "***" in redact_url("https://user:pw@host/file.bin")
        assert redact_url("https://host/file.bin") == "https://host/file.bin"


class TestAppDataDir:
    def test_created(self):
        d = app_data_dir("UltraDownload-test")
        assert os.path.isdir(d)

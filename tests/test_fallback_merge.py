"""Fallback when servers ignore Range requests + merge/integrity behavior."""

import hashlib
import os

import pytest

from tests.range_server import pattern_data
from ultradownload.engine import DownloadTask, TaskStatus
from ultradownload.engine.errors import ChecksumMismatchError, MergeError
from ultradownload.engine.merger import assemble_file, verify_checksum


class TestRangeIgnoredFallback:
    def test_falls_back_to_single_stream(self, make_server, tmp_dest):
        """Server returns 200 for every Range request — the engine must not
        write 40 copies of the file; it falls back to one clean stream."""
        size = 300_000
        srv = make_server(size=size, mode="ignore_ranges")
        task = DownloadTask(srv.url, tmp_dest, part_count=40,
                            retry_backoff_base=0.02)
        task.prepare()
        assert task.supports_ranges is True  # HEAD lies with Accept-Ranges
        task.start()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED
        out = tmp_dest / "file.bin"
        assert out.stat().st_size == size
        assert out.read_bytes() == pattern_data(size)
        assert any("single-stream" in n.lower() or "ignores range" in n.lower()
                   for n in task.notes)
        assert task.single_mode is True

    def test_fallback_note_reports_connection_reduction(self, make_server, tmp_dest, listener):
        srv = make_server(size=100_000, mode="ignore_ranges")
        task = DownloadTask(srv.url, tmp_dest, part_count=40,
                            listener=listener, retry_backoff_base=0.02)
        task.prepare()
        task.start()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED
        assert any("connections could not be maintained" in m.lower()
                   for m in listener.logs)

    def test_single_part_200_is_normal(self, make_server, tmp_dest):
        size = 50_000
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=1,
                            retry_backoff_base=0.02)
        task.prepare()
        task.start()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)


class TestMerger:
    def _make_parts(self, tmp_path, data: bytes, n: int = 4):
        chunk = (len(data) + n - 1) // n
        paths, sizes = [], []
        for i in range(0, len(data), chunk):
            p = tmp_path / f"part_{len(paths):05d}.part"
            piece = data[i:i + chunk]
            p.write_bytes(piece)
            paths.append(p)
            sizes.append(len(piece))
        return paths, sizes

    def test_assemble_correct_order(self, tmp_path):
        data = bytes(range(256)) * 1000
        paths, sizes = self._make_parts(tmp_path, data)
        out = tmp_path / "out.bin"
        assemble_file(paths, sizes, out)
        assert out.read_bytes() == data

    def test_missing_part_raises_and_keeps_others(self, tmp_path):
        data = b"abcdefgh" * 100
        paths, sizes = self._make_parts(tmp_path, data)
        paths[1].unlink()
        out = tmp_path / "out.bin"
        with pytest.raises(MergeError, match="Missing temporary part"):
            assemble_file(paths, sizes, out)
        assert not out.exists()
        assert paths[0].exists()

    def test_wrong_part_size_raises(self, tmp_path):
        data = b"x" * 4096
        paths, sizes = self._make_parts(tmp_path, data)
        paths[0].write_bytes(b"x" * 10)  # corrupted
        with pytest.raises(MergeError, match="expected"):
            assemble_file(paths, sizes, tmp_path / "out.bin")

    def test_checksum_ok_and_mismatch(self, tmp_path):
        data = pattern_data(64 * 1024)
        paths, sizes = self._make_parts(tmp_path, data)
        digest = hashlib.sha256(data).hexdigest()
        out = tmp_path / "out.bin"
        assemble_file(paths, sizes, out, checksum=("sha256", digest))
        assert out.exists()
        verify_checksum(out, "sha256", digest)
        with pytest.raises(ChecksumMismatchError):
            verify_checksum(out, "sha256", "00")

    def test_checksum_mismatch_preserves_parts(self, tmp_path):
        data = b"z" * 8192
        paths, sizes = self._make_parts(tmp_path, data)
        with pytest.raises(ChecksumMismatchError):
            assemble_file(paths, sizes, tmp_path / "out.bin",
                          checksum=("sha256", "11" * 32))
        assert not (tmp_path / "out.bin").exists()
        assert all(p.exists() for p in paths)

    def test_atomic_publish(self, tmp_path):
        data = b"q" * 5000
        paths, sizes = self._make_parts(tmp_path, data)
        out = tmp_path / "out.bin"
        out.write_bytes(b"old content")
        assemble_file(paths, sizes, out)
        assert out.read_bytes() == data
        # no temp litter
        assert not list(tmp_path.glob("*.ultratmp"))

    def test_empty_file_assembly(self, tmp_path):
        out = tmp_path / "empty.bin"
        assemble_file([], [], out)
        assert out.exists()
        assert out.stat().st_size == 0

    def test_keep_parts_flag(self, tmp_path):
        data = b"w" * 3000
        paths, sizes = self._make_parts(tmp_path, data)
        assemble_file(paths, sizes, tmp_path / "out.bin", keep_parts=True)
        assert all(p.exists() for p in paths)
        assemble_file(paths, sizes, tmp_path / "out2.bin", keep_parts=False)
        assert not any(p.exists() for p in paths)


class TestDiskAndPermissions:
    def test_insufficient_disk_space(self, make_server, tmp_dest, monkeypatch):
        import shutil as _shutil
        from ultradownload.engine.errors import InsufficientDiskSpaceError

        srv = make_server(size=1024 * 1024)

        class _Usage:
            total = 10
            used = 9
            free = 1

        monkeypatch.setattr(_shutil, "disk_usage", lambda p: _Usage())
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.02)
        with pytest.raises(InsufficientDiskSpaceError):
            task.prepare()

    def test_permission_error_surfaces_as_failure(self, make_server, tmp_dest):
        if os.geteuid() == 0:
            pytest.skip("running as root; permission bits are ignored")
        from ultradownload.engine.errors import PermissionDeniedError
        locked = tmp_dest / "locked"
        locked.mkdir()
        locked.chmod(0o500)
        try:
            srv = make_server(size=10_000)
            task = DownloadTask(srv.url, locked, part_count=2,
                                retry_backoff_base=0.02)
            try:
                task.prepare()
            except PermissionDeniedError:
                return  # surfaced early — also acceptable
            task.start()
            assert task.wait(30)
            assert task.status is TaskStatus.FAILED
        finally:
            locked.chmod(0o700)

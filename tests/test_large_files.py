"""Large-file download (>4 GiB) — opt-in to avoid filling disks in CI.

Enable with:  UD_RUN_LARGE=1 python -m pytest tests/test_large_files.py -q

The test server serves a 4 GiB+ payload lazily from a 1 MiB periodic pattern
block (no 4 GiB allocation).  The test verifies exact size, exact bytes at
every part boundary (the risky spots for 64-bit offset bugs) and sampled
windows across the whole file.
"""

import os
import shutil

import pytest

from tests.range_server import pattern_slice
from ultradownload.engine import DownloadTask, TaskStatus

GIB = 1024 ** 3
LARGE_SIZE = 4 * GIB + 16 * 1024 * 1024  # 4 GiB + 16 MiB exercises 64-bit math

pytestmark = pytest.mark.skipif(
    os.environ.get("UD_RUN_LARGE") != "1",
    reason="set UD_RUN_LARGE=1 to run >4GiB integration tests",
)


@pytest.fixture(autouse=True)
def _need_disk(tmp_dest):
    free = shutil.disk_usage(tmp_dest).free
    if free < 3 * LARGE_SIZE:
        pytest.skip(f"not enough free disk ({free} bytes) for large test")


def verify_large_file(path, size, part_ranges):
    assert path.stat().st_size == size, "assembled size mismatch"
    with open(path, "rb") as fh:
        # exact bytes at part boundaries (offset bugs show up here)
        for r in part_ranges:
            for pos in (r.start, max(r.start, r.end - 63), r.end - 31):
                if pos < 0 or pos + 32 > size:
                    continue
                fh.seek(pos)
                assert fh.read(32) == pattern_slice(pos, 32), \
                    f"corrupt bytes at offset {pos}"
        # random-ish windows across the file
        for i in range(0, 200):
            pos = (i * 123456789) % max(1, size - 8192)
            fh.seek(pos)
            assert fh.read(8192) == pattern_slice(pos, 8192), \
                f"corrupt window at offset {pos}"


class TestLargeFile:
    def test_4gib_parallel_download(self, make_server, tmp_dest):
        srv = make_server(size=LARGE_SIZE)
        task = DownloadTask(srv.url, tmp_dest, part_count=16,
                            retry_backoff_base=0.05)
        task.prepare()
        assert task.total_size == LARGE_SIZE
        assert len(task.parts) == 16
        ranges = list(task.parts)
        task.start()
        assert task.wait(1800), "large download did not finish in time"
        assert task.status is TaskStatus.COMPLETED
        verify_large_file(tmp_dest / "file.bin", LARGE_SIZE,
                          [p.range for p in ranges])
        # temp parts must be cleaned up
        assert not task.tmp_dir.exists()

    def test_4gib_pause_resume_offsets(self, make_server, tmp_dest):
        srv = make_server(size=LARGE_SIZE)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            retry_backoff_base=0.05)
        task.prepare()
        task.start()
        # let ~128 MiB flow, then pause and resume once
        import time
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline and task.downloaded_bytes() < 128 * 1024 * 1024:
            time.sleep(0.05)
        task.pause()
        assert task.status is TaskStatus.PAUSED
        saved = sum(p.downloaded for p in task.parts)
        assert 0 < saved < LARGE_SIZE
        task.resume()
        assert task.wait(1800)
        assert task.status is TaskStatus.COMPLETED
        verify_large_file(tmp_dest / "file.bin", LARGE_SIZE,
                          [p.range for p in task.parts])

"""Files larger than 4 GiB: 64-bit offsets end-to-end.

The pure-math coverage lives in test_ranges.py (runs everywhere).  The
end-to-end download of a >4 GiB file is gated behind
``RUN_LARGE_FILE_TESTS=1`` because it writes several gigabytes of real
data to the destination volume; run it where disk space allows:

    RUN_LARGE_FILE_TESTS=1 pytest tests/test_large_file.py -v
"""

from __future__ import annotations

import os
import random
import time

import pytest

from ultradownload.engine import DownloadEngine, EngineConfig
from ultradownload.models import DownloadStatus, RangeSupport
from ultradownload.ranges import split_byte_ranges, validate_coverage
from tests.range_server import RangeTestServer, ServerConfig, pattern_bytes
from tests.test_engine import FAST_CFG, wait_until

LARGE_SIZE = 5 * 1024 ** 3 + 123_456_789   # ~5.12 GiB, > 2**32
pytestmark = pytest.mark.largefile

#: the multi-GB transfer itself is opt-in (pure math runs everywhere)
needs_large_env = pytest.mark.skipif(
    os.environ.get("RUN_LARGE_FILE_TESTS", "") != "1",
    reason="set RUN_LARGE_FILE_TESTS=1 (needs ~6 GB free disk)")


def verify_file_sampled(path: str, size: int, blocks: int = 24,
                        block: int = 1024 * 1024, seed: int = 7) -> bool:
    """Verify size plus randomly sampled 1 MiB blocks against the pattern."""
    if os.path.getsize(path) != size:
        return False
    rng = random.Random(seed)
    offsets = [0, size - block] + sorted(
        rng.randrange(0, size - block) for _ in range(blocks - 2))
    with open(path, "rb") as fh:
        for off in offsets:
            fh.seek(off)
            data = fh.read(block)
            if data != pattern_bytes(block, off):
                return False
    return True


class TestLargeFileMath:
    def test_5gb_range_plan_exact(self):
        ranges = split_byte_ranges(LARGE_SIZE, 40)
        ok, msg = validate_coverage(ranges, LARGE_SIZE)
        assert ok, msg
        assert ranges[0].header() == f"bytes=0-{ranges[0].end}"
        assert ranges[-1].end == LARGE_SIZE - 1
        assert ranges[-1].end > 2 ** 32

    def test_header_values_are_64bit_safe(self):
        ranges = split_byte_ranges(80 * 1024 ** 3, 40)
        for r in ranges:
            assert r.header().startswith("bytes=")
            assert int(r.header().split("-")[1]) <= 80 * 1024 ** 3 - 1


@needs_large_env
class TestLargeFileDownload:
    def test_download_5gb_with_40_parts(self, workspace):
        srv = RangeTestServer(
            ServerConfig(size=LARGE_SIZE, mode="normal",
                         send_chunk=256 * 1024)).start()
        try:
            import shutil
            free = shutil.disk_usage(workspace).free
            if free < LARGE_SIZE + 512 * 1024 * 1024:
                pytest.skip("not enough free disk space for the large test")
            from ultradownload.models import DownloadTask, PartState
            task = DownloadTask(
                id=42, url=srv.file_url, filename="big.bin",
                dest_dir=workspace, total_size=LARGE_SIZE, part_count=40,
                range_support=RangeSupport.YES, final_url=srv.file_url,
                etag=srv.config.etag)
            cfg = EngineConfig(connect_timeout=15.0, read_timeout=120.0,
                               max_retries=3, backoff_base=0.2,
                               backoff_cap=2.0, monitor_interval=0.2)
            engine = DownloadEngine(task=task, config=cfg)
            t0 = time.monotonic()
            engine.start()
            engine.wait_for_end(timeout=1800)
            elapsed = time.monotonic() - t0
            assert engine.status == DownloadStatus.COMPLETED, task.error
            final = os.path.join(workspace, "big.bin")
            assert verify_file_sampled(final, LARGE_SIZE)
            rate = LARGE_SIZE / max(elapsed, 1e-6) / 1e6
            print(f"\n5.12 GiB downloaded in {elapsed:.1f}s "
                  f"({rate:.0f} MB/s, 40 parts)")
        finally:
            srv.stop()

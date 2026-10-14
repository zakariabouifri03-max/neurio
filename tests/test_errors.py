"""Error handling: bad Content-Range, truncation, retries, rate limits, auth."""

import time

import pytest

from tests.range_server import pattern_data
from ultradownload.engine import DownloadTask, TaskStatus
from ultradownload.engine.parts import PartStatus


def run_task(task, timeout=90.0):
    task.prepare()
    task.start()
    assert task.wait(timeout), "task did not finish in time"


class TestContentRangeValidation:
    def test_invalid_content_range_rejected(self, make_server, tmp_dest):
        srv = make_server(size=200_000, mode="bad_content_range")
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            max_retries=1, retry_backoff_base=0.02)
        run_task(task)
        # Wrong Content-Range must never produce a "successful" corrupt file.
        assert task.status is TaskStatus.FAILED
        assert "Content-Range" in (task.error or "")
        assert not (tmp_dest / "file.bin").exists()

    def test_shifted_start_rejected(self, make_server, tmp_dest):
        srv = make_server(size=100_000, mode="bad_content_range")
        task = DownloadTask(srv.url, tmp_dest, part_count=2,
                            max_retries=0, retry_backoff_base=0.02)
        run_task(task)
        assert task.status is TaskStatus.FAILED
        # Part files may exist but the final file was never published.
        assert not (tmp_dest / "file.bin").exists()


class TestTruncatedResponses:
    def test_permanent_truncation_never_completes(self, make_server, tmp_dest):
        """Server always closes early → the task must FAIL, not fake success."""
        size = 120_000
        srv = make_server(size=size, mode="truncate", truncate_at=10_000)
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            max_retries=4, retry_backoff_base=0.02)
        run_task(task)
        assert task.status is TaskStatus.FAILED
        out = tmp_dest / "file.bin"
        assert not out.exists() or out.stat().st_size != size

    def test_truncated_then_recovery_resumes_part(self, make_server, tmp_dest):
        """First attempt per part is truncated; the retry continues from the
        partial bytes using a Range request and completes the file."""
        size = 100_000
        srv = make_server(size=size, mode="truncate", truncate_at=10_240,
                          truncate_first=1)
        task = DownloadTask(srv.url, tmp_dest, part_count=2,
                            max_retries=4, retry_backoff_base=0.02)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)
        # Every part needed at least one retry after the truncation.
        for p in task.parts:
            assert p.retries >= 1


class TestRetry:
    def test_transient_500_retried_then_success(self, make_server, tmp_dest):
        size = 80_000
        srv = make_server(size=size, fail_first=2)  # 2 failures per part
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            max_retries=5, retry_backoff_base=0.02)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)
        for p in task.parts:
            assert p.retries >= 2

    def test_retries_bounded_on_permanent_failure(self, make_server, tmp_dest):
        srv = make_server(size=80_000, fail_first=999)  # always 500
        task = DownloadTask(srv.url, tmp_dest, part_count=2,
                            max_retries=2, retry_backoff_base=0.01)
        run_task(task)
        assert task.status is TaskStatus.FAILED
        for p in task.parts:
            assert p.retries <= 3  # initial try + max_retries

    def test_429_rate_limit_respected(self, make_server, tmp_dest):
        size = 50_000
        srv = make_server(size=size, rate_limit_first=3)
        task = DownloadTask(srv.url, tmp_dest, part_count=2,
                            max_retries=6, retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)

    def test_retry_after_header_honored(self, make_server, tmp_dest):
        srv = make_server(size=10_000, rate_limit_first=1)
        task = DownloadTask(srv.url, tmp_dest, part_count=1,
                            max_retries=3, retry_backoff_base=0.01)
        t0 = time.monotonic()
        run_task(task)
        elapsed = time.monotonic() - t0
        assert task.status is TaskStatus.COMPLETED
        assert elapsed >= 0.9  # waited ~1s for Retry-After: 1

    def test_failed_part_not_restarted_on_retry(self, make_server, tmp_dest):
        size = 160_000
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            max_retries=0, retry_backoff_base=0.02)
        task.prepare()
        data = pattern_data(size)
        # Simulate: 3 parts complete, 1 fails hard.
        for p in task.parts[:3]:
            p.status = PartStatus.DONE
            p.downloaded = p.length
            path = task.part_path(p.index)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data[p.start:p.end + 1])
        task.parts[3].status = PartStatus.FAILED
        task.parts[3].error = "boom"
        task.status = TaskStatus.FAILED

        task.retry()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED
        # Only the failed part hit the network again.
        ranged = [r for r in srv.state.requests if r["range"] and r["status"] in (200, 206)]
        assert len(ranged) == 1
        assert ranged[0]["start_byte"] == task.parts[3].start
        assert (tmp_dest / "file.bin").read_bytes() == data


class TestPermanentErrors:
    def test_404_fails_immediately(self, make_server, tmp_dest):
        from ultradownload.engine.errors import PermanentHTTPError
        srv = make_server(size=100, not_found=("/gone.bin",))
        task = DownloadTask(srv.path_url("/gone.bin"), tmp_dest, part_count=4,
                            max_retries=3, retry_backoff_base=0.01)
        try:
            task.prepare()
        except PermanentHTTPError as exc:
            assert "not found" in str(exc).lower()
            return
        task.start()
        assert task.wait(30)
        assert task.status is TaskStatus.FAILED
        assert "not found" in (task.error or "").lower() or "404" in (task.error or "")

    def test_401_fails_fast_without_endless_retries(self, make_server, tmp_dest):
        # Auth only enforced on GET so inspection succeeds, then parts hit 401.
        srv = make_server(size=200_000, require_token="tok", auth_mode="get")
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            max_retries=5, retry_backoff_base=0.01)
        task.prepare()
        t0 = time.monotonic()
        task.start()
        assert task.wait(30)
        assert task.status is TaskStatus.FAILED
        assert "Access denied" in (task.error or "")
        assert time.monotonic() - t0 < 10  # no long backoff loops

    def test_valid_auth_header_downloads(self, make_server, tmp_dest):
        size = 40_000
        srv = make_server(size=size, require_token="tok", auth_mode="get")
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            extra_headers={"Authorization": "Bearer tok"},
                            retry_backoff_base=0.02)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)

    def test_auth_error_from_inspection(self, make_server, tmp_dest):
        from ultradownload.engine.errors import PermanentHTTPError
        srv = make_server(size=100, require_token="tok")
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.02)
        with pytest.raises(PermanentHTTPError):
            task.prepare()

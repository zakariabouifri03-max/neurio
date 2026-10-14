"""End-to-end parallel downloads against the local range test server."""

import hashlib

import pytest

from tests.range_server import pattern_data
from ultradownload.engine import (
    DownloadTask,
    TaskStatus,
    compute_ranges,
)


def run_task(task: DownloadTask, timeout: float = 60.0) -> None:
    task.prepare()
    task.start()
    assert task.wait(timeout), "task did not finish in time"


class TestParallelDownload:
    def test_40_parts_download_correct_file(self, make_server, tmp_dest, listener):
        size = 2 * 1024 * 1024 + 7777
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=40,
                            listener=listener, retry_backoff_base=0.05)
        run_task(task)

        assert task.status is TaskStatus.COMPLETED
        out = tmp_dest / "file.bin"
        assert out.exists()
        data = out.read_bytes()
        assert len(data) == size
        assert data == pattern_data(size)

    def test_every_part_requested(self, make_server, tmp_dest):
        size = 1024 * 1024
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=40,
                            retry_backoff_base=0.05)
        run_task(task)

        assert task.status is TaskStatus.COMPLETED
        assert len(task.parts) == 40
        # The server must have seen one ranged GET per part.
        ranged = [r for r in srv.state.requests
                  if r["range"] and r["status"] == 206]
        assert len(ranged) == 40
        starts = sorted(r["start_byte"] for r in ranged)
        expected = sorted(p.start for p in compute_ranges(size, 40))
        assert starts == expected

    def test_progress_is_based_on_real_bytes(self, make_server, tmp_dest, listener):
        size = 512 * 1024
        srv = make_server(size=size, drip_delay=0.005, drip_chunk=8192)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            listener=listener, retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert task.progress() == 100.0
        assert task.downloaded_bytes() == size
        # progress events were real byte counts, monotonically bounded
        assert listener.progress_events
        assert all(0 <= n <= size for n in listener.progress_events)
        assert max(listener.progress_events) == size

    def test_part_states_and_sizes(self, make_server, tmp_dest):
        size = 100_000
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=16,
                            retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert len(task.parts) == 16
        for p in task.parts:
            assert p.downloaded == p.length
            assert p.status.value == "done"
            assert p.progress() == 100.0

    def test_single_part_download(self, make_server, tmp_dest):
        size = 77_777
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=1,
                            retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)

    def test_zero_byte_file(self, make_server, tmp_dest):
        srv = make_server(data=b"")
        task = DownloadTask(srv.url, tmp_dest, part_count=40,
                            retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        out = tmp_dest / "file.bin"
        assert out.exists()
        assert out.stat().st_size == 0

    def test_unknown_size_chunked(self, make_server, tmp_dest):
        size = 300_000
        srv = make_server(size=size, chunked=True, no_head=True,
                          accept_ranges_header=None, mode="ignore_ranges")
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)

    def test_custom_filename_and_subdir(self, make_server, tmp_dest):
        srv = make_server(size=1000)
        task = DownloadTask(srv.url, tmp_dest / "games", filename="My Game.bin",
                            part_count=4, retry_backoff_base=0.05)
        run_task(task)
        assert (tmp_dest / "games" / "My Game.bin").stat().st_size == 1000

    def test_checksum_verification_ok(self, make_server, tmp_dest):
        size = 64 * 1024
        srv = make_server(size=size)
        digest = hashlib.sha256(pattern_data(size)).hexdigest()
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            checksum=("sha256", digest),
                            retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED

    def test_checksum_mismatch_keeps_parts(self, make_server, tmp_dest):
        size = 64 * 1024
        srv = make_server(size=size)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            checksum=("sha256", "0" * 64),
                            retry_backoff_base=0.05)
        task.prepare()
        task.start()
        assert task.wait(60)
        assert task.status is TaskStatus.FAILED
        assert "hecksum" in (task.error or "")
        # parts preserved for repair
        assert task.tmp_dir.exists()
        assert any(task.tmp_dir.glob("part_*.part"))

    def test_overwrite_protection(self, make_server, tmp_dest):
        srv = make_server(size=1000)
        (tmp_dest / "file.bin").write_bytes(b"existing")
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.05)
        with pytest.raises(Exception) as ei:
            task.prepare()
        assert "already exists" in str(ei.value)
        # with permission (overwrite=True) it proceeds
        task2 = DownloadTask(srv.url, tmp_dest, part_count=4,
                             overwrite=True, retry_backoff_base=0.05)
        run_task(task2)
        assert (tmp_dest / "file.bin").stat().st_size == 1000

    def test_tmp_parts_cleaned_after_success(self, make_server, tmp_dest):
        srv = make_server(size=50_000)
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.05)
        run_task(task)
        assert task.status is TaskStatus.COMPLETED
        assert not task.tmp_dir.exists()

    def test_filename_from_content_disposition(self, make_server, tmp_dest):
        srv = make_server(size=2048, filename="setup.exe")
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.05)
        run_task(task)
        assert (tmp_dest / "setup.exe").exists()

    def test_unicode_filename_sanitized(self, make_server, tmp_dest):
        srv = make_server(size=100, data=b"y" * 100,
                          filename="../../evil/..\\con?.zip")
        task = DownloadTask(srv.url, tmp_dest, part_count=1,
                            retry_backoff_base=0.05)
        run_task(task)
        files = list(tmp_dest.iterdir())
        names = [f.name for f in files]
        assert not any(".." in n or "/" in n or "\\" in n for n in names)
        assert any(n.endswith(".zip") for n in names)

    def test_event_callbacks_threadsafe(self, make_server, tmp_dest, listener):
        srv = make_server(size=200_000)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            listener=listener, retry_backoff_base=0.05)
        run_task(task)
        assert "completed" in listener.status_events
        assert listener.status_events[0] == "running"
        assert listener.part_events

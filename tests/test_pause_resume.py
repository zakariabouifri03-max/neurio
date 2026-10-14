"""Pause / resume / cancel semantics with persistent part files."""

import time

from tests.range_server import pattern_data
from ultradownload.engine import DownloadTask, TaskStatus
from ultradownload.engine.parts import PartStatus


def wait_until_downloaded(task, minimum: float, timeout: float = 25.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if task.downloaded_bytes() >= minimum and task.status is TaskStatus.RUNNING:
            return
        if task.status is not TaskStatus.RUNNING:
            break
        time.sleep(0.002)
    assert task.downloaded_bytes() >= minimum, "not enough data flowed before deadline"
    assert task.status is TaskStatus.RUNNING, "task finished before we could pause it"


class TestPauseResume:
    def test_pause_preserves_partial_data(self, make_server, tmp_dest, listener):
        size = 2 * 1024 * 1024
        srv = make_server(size=size, mode="drip", drip_chunk=8192,
                          drip_delay=0.03, barrier_count=8)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            listener=listener, retry_backoff_base=0.02)
        task.prepare()
        task.start()

        wait_until_downloaded(task, 150_000)
        task.pause()

        assert task.status is TaskStatus.PAUSED
        downloaded = task.downloaded_bytes()
        assert 0 < downloaded < size
        # Part files still on disk with the recorded sizes.
        total_on_disk = sum(
            task.part_path(p.index).stat().st_size
            for p in task.parts if task.part_path(p.index).exists())
        assert total_on_disk == downloaded
        assert task.active_connections() == 0

    def test_resume_completes_and_matches(self, make_server, tmp_dest, listener):
        size = 1024 * 1024
        srv = make_server(size=size, mode="drip", drip_chunk=8192,
                          drip_delay=0.03, barrier_count=8)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            listener=listener, retry_backoff_base=0.02)
        task.prepare()
        task.start()
        wait_until_downloaded(task, 150_000)
        task.pause()
        paused_at = task.downloaded_bytes()
        assert 0 < paused_at < size

        # Resume: remaining ranges only.
        srv.state.drip_delay = 0.0  # speed up the remainder
        task.resume()
        assert task.wait(60), "resume did not finish"
        assert task.status is TaskStatus.COMPLETED
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)

        # 8 initial ranged requests + one resume request per unfinished part.
        ranged = [r for r in srv.state.requests if r["range"]]
        assert len(ranged) >= 8
        assert len(ranged) <= 16

    def test_resume_validates_remote_size_change(self, make_server, tmp_dest):
        size = 200_000
        srv = make_server(size=size, mode="drip", drip_chunk=4096,
                          drip_delay=0.03, barrier_count=4)
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.02)
        task.prepare()
        task.start()
        wait_until_downloaded(task, 30_000)
        task.pause()
        assert task.status is TaskStatus.PAUSED

        # The remote file "changes": different content length.
        srv.state.size = 300_000
        srv.state.data = pattern_data(300_000)
        from ultradownload.engine.errors import StateError
        try:
            task.resume()
            assert task.wait(30)
            assert task.status is TaskStatus.FAILED
            assert "changed" in (task.error or "").lower()
        except StateError as exc:
            assert "changed" in str(exc).lower()

    def test_cancel_keeps_parts_when_asked(self, make_server, tmp_dest):
        size = 1024 * 1024
        srv = make_server(size=size, mode="drip", drip_chunk=8192,
                          drip_delay=0.03, barrier_count=8)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            retry_backoff_base=0.02)
        task.prepare()
        task.start()
        wait_until_downloaded(task, 50_000)
        task.cancel(delete_parts=False)
        assert task.status is TaskStatus.CANCELLED
        assert task.tmp_dir.exists()
        assert any(task.tmp_dir.glob("part_*.part"))

    def test_cancel_deletes_parts_when_asked(self, make_server, tmp_dest):
        size = 1024 * 1024
        srv = make_server(size=size, mode="drip", drip_chunk=8192,
                          drip_delay=0.03, barrier_count=8)
        task = DownloadTask(srv.url, tmp_dest, part_count=8,
                            retry_backoff_base=0.02)
        task.prepare()
        task.start()
        wait_until_downloaded(task, 50_000)
        task.cancel(delete_parts=True)
        assert task.status is TaskStatus.CANCELLED
        assert not task.tmp_dir.exists() or not any(task.tmp_dir.glob("part_*.part"))

    def test_pause_is_idempotent(self, make_server, tmp_dest):
        srv = make_server(size=100_000)
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.02)
        task.prepare()
        task.start()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED
        task.pause()  # no-op on completed task
        assert task.status is TaskStatus.COMPLETED

    def test_resume_continues_without_re_downloading(self, make_server, tmp_dest):
        """After pause, the resumed requests must use Range offsets > 0 for
        partially downloaded parts (only remaining bytes requested)."""
        size = 800_000
        srv = make_server(size=size, mode="drip", drip_chunk=4096,
                          drip_delay=0.03, barrier_count=4)
        task = DownloadTask(srv.url, tmp_dest, part_count=4,
                            retry_backoff_base=0.02)
        task.prepare()
        task.start()
        wait_until_downloaded(task, 60_000)
        task.pause()
        saved = {p.index: p.downloaded for p in task.parts}
        unfinished = [p for p in task.parts if p.status is not PartStatus.DONE]
        assert unfinished, "all parts finished before pause — test needs slower data"

        srv.state.drip_delay = 0.0
        n_before = len([r for r in srv.state.requests if r["range"]])
        task.resume()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED

        ranged = [r for r in srv.state.requests if r["range"]]
        assert len(ranged) == n_before + len(unfinished)
        for r in ranged[n_before:]:
            assert r["status"] == 206
            part = next(p for p in task.parts
                        if p.start <= r["start_byte"] <= p.end)
            assert r["start_byte"] == part.start + saved[part.index], \
                "resume must request only the remaining byte range"
        assert (tmp_dest / "file.bin").read_bytes() == pattern_data(size)

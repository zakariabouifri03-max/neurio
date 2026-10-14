"""Prove that all part workers download CONCURRENTLY, not sequentially."""

import time

from ultradownload.engine import DownloadTask, TaskStatus


class TestConcurrency:
    def test_all_parts_in_flight_simultaneously(self, make_server, tmp_dest):
        """The server blocks until every part connection is open (barrier).

        If parts were downloaded sequentially the barrier would time out.
        """
        parts = 16
        size = 1024 * 1024
        srv = make_server(size=size, mode="drip", drip_chunk=16 * 1024,
                          drip_delay=0.01, barrier_count=parts)
        task = DownloadTask(srv.url, tmp_dest, part_count=parts,
                            retry_backoff_base=0.05)
        task.prepare()
        task.start()
        assert task.wait(60), "task did not finish in time"
        assert task.status is TaskStatus.COMPLETED

        # The barrier trips only when `parts` handlers are inside _serve at
        # once — max_in_flight proves simultaneous connections.
        assert srv.state.max_in_flight >= parts

        # Wait briefly for handlers to record their end timestamps.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            reqs_all = [r for r in srv.state.requests if r["range"]]
            if len(reqs_all) == parts and all(r["end"] is not None for r in reqs_all):
                break
            time.sleep(0.01)

        # And their request windows overlap in time: every part began before
        # the first part's request finished.
        reqs = [r for r in srv.state.requests if r["range"] and r["status"] in (200, 206)]
        assert len(reqs) == parts
        first_end = min(r["end"] for r in reqs)
        last_begin = max(r["begin"] for r in reqs)
        assert last_begin < first_end, "requests did not overlap in time"

    def test_pool_starts_all_workers_at_once(self, make_server, tmp_dest):
        """Track begin/end timestamps per part: all N start before any end."""
        parts = 8
        srv = make_server(size=256 * 1024, mode="drip", drip_chunk=4096,
                          drip_delay=0.015, barrier_count=parts)
        task = DownloadTask(srv.url, tmp_dest, part_count=parts,
                            retry_backoff_base=0.05)
        task.prepare()
        task.start()
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED

        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            reqs_all = [r for r in srv.state.requests if r["range"]]
            if len(reqs_all) == parts and all(r["end"] is not None for r in reqs_all):
                break
            time.sleep(0.01)

        reqs = sorted((r for r in srv.state.requests if r["range"]),
                      key=lambda r: r["begin"])
        assert len(reqs) == parts
        # Each request began before the previous earliest request ended.
        running_end = reqs[0]["end"]
        for r in reqs[1:]:
            assert r["begin"] < running_end
            running_end = min(running_end, r["end"])

    def test_progress_aggregates_across_parts(self, make_server, tmp_dest):
        parts = 10
        # Slow enough (and chunked finely enough) that several parts hold
        # partial bytes at the same wall-clock instants.
        srv = make_server(size=512 * 1024, mode="drip", drip_chunk=4096,
                          drip_delay=0.02, barrier_count=parts)
        task = DownloadTask(srv.url, tmp_dest, part_count=parts,
                            retry_backoff_base=0.05)
        task.prepare()
        task.start()
        # While running, multiple parts must register bytes concurrently.
        seen_multi = 0
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and task.status is TaskStatus.RUNNING:
            active = sum(1 for p in task.parts if p.downloaded > 0)
            if active >= 2:
                seen_multi += 1
            time.sleep(0.002)
        assert task.wait(60)
        assert task.status is TaskStatus.COMPLETED
        assert seen_multi > 0, "parts never progressed at the same time"
        assert task.active_connections() == 0  # all finished

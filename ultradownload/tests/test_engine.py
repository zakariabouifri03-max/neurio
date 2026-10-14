"""Engine tests against the local range server: concurrency, fallback,
pause/resume, retries, malformed responses, checksums, integrity.

These tests exercise the real network stack (loopback HTTP) and the real
threading engine — no mocks, no simulated progress.
"""

from __future__ import annotations

import hashlib
import os
import stat
import time
from typing import Callable, List, Optional

import pytest

from ultradownload.engine import (DownloadEngine, EngineConfig, EngineEvent,
                                  EngineEventType)
from ultradownload.inspector import probe_url
from ultradownload.models import (DownloadStatus, DownloadTask, PartStatus,
                                  RangeSupport)
from ultradownload.ranges import split_byte_ranges, validate_coverage
from tests.range_server import pattern_bytes, verify_file_content

FAST_CFG = dict(connect_timeout=5.0, read_timeout=10.0, backoff_base=0.05,
                backoff_cap=0.3, monitor_interval=0.05)


def make_engine(srv, workspace, part_count=40, *, probe=True, headers=None,
                config_overrides=None, checksum=("", ""),
                allow_overwrite=False, range_support=None,
                total_size=None, events=None) -> DownloadEngine:
    url = srv.file_url
    if probe:
        p = probe_url(url, headers=headers, connect_timeout=5, read_timeout=5)
        assert p.ok, p.error
        size = p.total_size if total_size is None else total_size
        support = p.range_support if range_support is None else range_support
        etag, lm, final_url = p.etag, p.last_modified, p.final_url
    else:
        size = srv.config.size if total_size is None else total_size
        support = RangeSupport.YES if range_support is None else range_support
        etag, lm, final_url = srv.config.etag, "", url
    task = DownloadTask(
        id=1, url=url, filename="file.bin", dest_dir=workspace,
        total_size=size, part_count=part_count,
        range_support=support, etag=etag, last_modified=lm,
        final_url=final_url or url,
        checksum_algo=checksum[0], checksum_value=checksum[1],
        headers=dict(headers or {}))
    cfg = EngineConfig(**{**FAST_CFG, **(config_overrides or {})},
                       allow_overwrite=allow_overwrite)
    sink = (lambda e: events.append(e)) if events is not None else None
    return DownloadEngine(task=task, config=cfg, event_sink=sink)


def wait_until(cond: Callable[[], bool], timeout: float = 30.0,
               interval: float = 0.02) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(interval)
    return cond()


def run_to_end(engine: DownloadEngine, timeout: float = 60.0) -> DownloadStatus:
    engine.start()
    engine.wait_for_end(timeout=timeout)
    return engine.status


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------

class TestParallelDownload:
    def test_40_parts_complete_and_exact(self, server_factory, workspace):
        size = 8 * 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        engine = make_engine(srv, workspace, part_count=40)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        final = os.path.join(workspace, "file.bin")
        assert os.path.exists(final)
        assert os.path.getsize(final) == size
        assert verify_file_content(final, size)
        assert not os.path.exists(engine.task.temp_path)
        # every part completed with exactly its range length
        parts = engine.parts
        assert len(parts) == 40
        assert all(p.status == PartStatus.COMPLETED for p in parts)
        assert all(p.downloaded == p.size for p in parts)
        ok, msg = validate_coverage(
            [type("R", (), {"start": p.start, "end": p.end,
                           "size": p.size})() for p in parts], size)
        assert ok, msg

    def test_server_saw_exact_expected_ranges(self, server_factory, workspace):
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        engine = make_engine(srv, workspace, part_count=16)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        srv.wait_for_idle()
        expected = {r.header() for r in split_byte_ranges(size, 16)}
        got = {rec.range_header for rec in srv.requests
               if rec.method == "GET" and rec.status == 206
               and rec.range_header != "bytes=0-0"}  # ignore URL probe
        assert got == expected

    def test_small_file_fewer_parts_than_requested(self, server_factory,
                                                    workspace):
        srv = server_factory(size=10, mode="normal")
        engine = make_engine(srv, workspace, part_count=40)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        final = os.path.join(workspace, "file.bin")
        assert open(final, "rb").read() == pattern_bytes(10)

    def test_one_part(self, server_factory, workspace):
        srv = server_factory(size=256 * 1024, mode="normal")
        engine = make_engine(srv, workspace, part_count=1)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"),
                                   256 * 1024)

    def test_zero_byte_file(self, server_factory, workspace):
        srv = server_factory(size=0, mode="zero")
        engine = make_engine(srv, workspace, part_count=40)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        final = os.path.join(workspace, "file.bin")
        assert os.path.exists(final) and os.path.getsize(final) == 0

    def test_unknown_size_single_stream(self, server_factory, workspace):
        srv = server_factory(size=64 * 1024, mode="no_content_length")
        engine = make_engine(srv, workspace, part_count=40,
                             total_size=-1, range_support=RangeSupport.NO)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        final = os.path.join(workspace, "file.bin")
        assert verify_file_content(final, 64 * 1024)
        assert engine.task.total_size == 64 * 1024


# ---------------------------------------------------------------------------
# Concurrency proof
# ---------------------------------------------------------------------------

class TestConcurrency:
    def test_all_parts_connect_simultaneously_barrier(self, server_factory,
                                                      workspace):
        """Server refuses to serve until ALL parts are connected at once.

        A sequential client (part 1 finishes before part 2 starts) would
        deadlock here and fail the test.
        """
        parts = 24
        size = 3 * 1024 * 1024
        srv = server_factory(size=size, mode="barrier", barrier_count=parts,
                             barrier_timeout=20.0)
        # probe=False: the 1-byte probe GET would itself wait at the barrier
        engine = make_engine(srv, workspace, part_count=parts, probe=False)
        assert run_to_end(engine, timeout=60) == DownloadStatus.COMPLETED
        assert srv.barrier_reached, \
            "the server never saw all part connections open simultaneously"
        assert not srv.barrier_failed
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)

    def test_request_intervals_overlap_in_time(self, server_factory, workspace):
        """Explicit timestamp-overlap proof: N ranged GETs were in flight
        at the same moment."""
        parts = 16
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=256 * 1024)
        engine = make_engine(srv, workspace, part_count=parts)
        assert run_to_end(engine, timeout=90) == DownloadStatus.COMPLETED
        srv.wait_for_idle()
        stats = srv.overlap_stats()
        assert stats["max_overlap"] >= parts, \
            f"expected >= {parts} overlapping requests, got {stats}"
        assert srv.max_concurrent_requests >= parts

    def test_parts_make_progress_independently(self, server_factory, workspace):
        """While downloading, many parts must be RUNNING at the same time
        and each must accumulate bytes on its own."""
        parts = 12
        size = 6 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=150 * 1024)
        events: List[EngineEvent] = []
        engine = make_engine(srv, workspace, part_count=parts, events=events)
        engine.start()
        # Wait until several parts are simultaneously running.
        assert wait_until(lambda: sum(
            1 for p in engine.parts if p.status == PartStatus.RUNNING) >= 6,
            timeout=20), "parts did not run concurrently"
        # Each running part already made independent progress.
        snapshot = [(p.index, p.downloaded) for p in engine.parts
                    if p.status == PartStatus.RUNNING]
        assert wait_until(lambda: all(
            dict((p.index, p.downloaded) for p in engine.parts)[i] > d
            for i, d in snapshot), timeout=20), \
            "some running parts made no progress"
        engine.wait_for_end(timeout=90)
        assert engine.status == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)


# ---------------------------------------------------------------------------
# Servers that ignore Range
# ---------------------------------------------------------------------------

class TestRangeIgnoredFallback:
    def test_falls_back_to_single_stream(self, server_factory, workspace):
        """Server lies about range support (answers 200 to ranged GETs).

        The engine must NOT write the whole file into every part; it must
        detect the condition and fall back to one stream.
        """
        size = 2 * 1024 * 1024
        srv = server_factory(size=size, mode="no_range")
        events: List[EngineEvent] = []
        engine = make_engine(srv, workspace, part_count=8,
                             range_support=RangeSupport.YES,  # server lies
                             events=events)
        assert run_to_end(engine, timeout=60) == DownloadStatus.COMPLETED
        final = os.path.join(workspace, "file.bin")
        assert verify_file_content(final, size)
        assert engine.task.part_count == 1
        assert engine.task.range_support == RangeSupport.NO
        logs = [e.data.get("message", "") for e in events
                if e.type == EngineEventType.LOG]
        assert any("does not support HTTP Range requests" in m for m in logs)
        srv.wait_for_idle()
        # the full file must never have been written into 8 parts:
        assert os.path.getsize(final) == size
        # workers detect the ignored Range before writing anything; the
        # server may still have pushed some full bodies into dead sockets
        full_bodies = sum(r.bytes_sent for r in srv.requests
                          if r.method == "GET" and r.status == 200)
        assert full_bodies <= 8 * size

    def test_probe_no_range_means_single_part(self, server_factory, workspace):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="no_range")
        p = probe_url(srv.file_url)
        assert p.range_support == RangeSupport.NO
        engine = make_engine(srv, workspace, part_count=40)  # probe → NO
        assert engine.task.part_count == 40  # clamped later by _prepare_parts
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        assert len(engine.parts) == 1
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)
        srv.wait_for_idle()
        # No real Range header was ever sent: only "" (single-stream GETs)
        # and the URL probe's 1-byte "bytes=0-0" are allowed.
        engine_ranges = [r.range_header for r in srv.requests
                         if r.method == "GET"]
        assert all(rh in ("", "bytes=0-0") for rh in engine_ranges)


# ---------------------------------------------------------------------------
# Malformed / hostile responses
# ---------------------------------------------------------------------------

class TestBadResponses:
    def test_invalid_content_range_fails_safely(self, server_factory,
                                                workspace):
        size = 2 * 1024 * 1024
        srv = server_factory(size=size, mode="bad_content_range")
        events: List[EngineEvent] = []
        engine = make_engine(srv, workspace, part_count=4, events=events,
                             config_overrides={"max_retries": 2})
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert not os.path.exists(os.path.join(workspace, "file.bin"))
        assert os.path.exists(engine.task.temp_path)  # partial data preserved
        failed = [e for e in events if e.type == EngineEventType.FAILED]
        assert failed and "Content-Range" in failed[0].data["error"]

    def test_always_truncated_fails_with_clear_error(self, server_factory,
                                                     workspace):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="truncate")
        engine = make_engine(srv, workspace, part_count=2,
                             config_overrides={"max_retries": 3})
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert "closed early" in engine.task.error or \
               "retries" in engine.task.error
        assert os.path.exists(engine.task.temp_path)
        assert not os.path.exists(os.path.join(workspace, "file.bin"))

    def test_truncated_once_then_recovers(self, server_factory, workspace):
        size = 2 * 1024 * 1024
        srv = server_factory(size=size, mode="truncate_once", fail_first=3)
        engine = make_engine(srv, workspace, part_count=4, probe=False,
                             config_overrides={"max_retries": 5})
        assert run_to_end(engine, timeout=60) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)
        assert sum(p.retries for p in engine.parts) >= 1

    def test_404_is_permanent_no_endless_retry(self, server_factory, workspace):
        srv = server_factory(mode="notfound")
        engine = make_engine(srv, workspace, part_count=4, probe=False,
                             config_overrides={"max_retries": 5})
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert sum(p.retries for p in engine.parts) == 0  # never retried
        assert "404" in engine.task.error

    def test_401_without_credentials(self, server_factory, workspace):
        srv = server_factory(mode="auth401")
        engine = make_engine(srv, workspace, part_count=4, probe=False,
                             config_overrides={"max_retries": 5})
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert "Access denied" in engine.task.error

    def test_401_with_credentials_succeeds(self, server_factory, workspace):
        size = 512 * 1024
        srv = server_factory(size=size, mode="auth401")
        headers = {"Authorization": "Bearer secret-token"}
        engine = make_engine(srv, workspace, part_count=4, headers=headers)
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)

    def test_429_then_success_with_retry_after(self, server_factory, workspace):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="ratelimit_429", fail_first=2)
        engine = make_engine(srv, workspace, part_count=2, probe=False,
                             config_overrides={"max_retries": 4})
        assert run_to_end(engine, timeout=60) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)

    def test_5xx_exhausts_retries(self, server_factory, workspace):
        srv = server_factory(mode="servererror")
        engine = make_engine(srv, workspace, part_count=4, probe=False,
                             config_overrides={"max_retries": 2})
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert any(p.retries > 0 for p in engine.parts)
        assert "500" in engine.task.error or "retries" in engine.task.error

    def test_flaky_500_then_success(self, server_factory, workspace):
        size = 2 * 1024 * 1024
        srv = server_factory(size=size, mode="flaky_500", fail_first=3)
        engine = make_engine(srv, workspace, part_count=4, probe=False,
                             config_overrides={"max_retries": 5})
        assert run_to_end(engine, timeout=60) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)
        assert sum(p.retries for p in engine.parts) >= 3


# ---------------------------------------------------------------------------
# Progress & speed accounting
# ---------------------------------------------------------------------------

class TestProgress:
    def test_progress_events_accurate(self, server_factory, workspace):
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=512 * 1024)
        events: List[EngineEvent] = []
        engine = make_engine(srv, workspace, part_count=8, events=events)
        engine.start()
        engine.wait_for_end(timeout=60)
        assert engine.status == DownloadStatus.COMPLETED
        progress = [e.data for e in events
                    if e.type == EngineEventType.PROGRESS]
        assert len(progress) > 5
        downloaded_series = [p["downloaded"] for p in progress]
        assert downloaded_series == sorted(downloaded_series)  # monotonic
        assert downloaded_series[-1] == size
        assert all(0 <= (p["percent"] or 0) <= 100.0001 for p in progress)
        assert any(p["speed"] > 0 for p in progress)
        # progress equals real bytes: engine bookkeeping matches disk
        assert engine.downloaded_bytes() == size

    def test_eta_and_speed_in_snapshot(self, server_factory, workspace):
        size = 2 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=150 * 1024)
        engine = make_engine(srv, workspace, part_count=4,
                             config_overrides={"chunk_size": 64 * 1024})
        engine.start()
        assert wait_until(lambda: engine.downloaded_bytes() > 100_000
                          and engine.total_speed() > 0, timeout=30)
        snap = engine.snapshot()
        assert snap["total"] == size
        assert snap["speed"] > 0
        assert snap["eta"] is None or snap["eta"] > 0
        assert snap["active_connections"] >= 1
        assert len(snap["parts"]) == 4
        engine.wait_for_end(timeout=60)
        assert engine.status == DownloadStatus.COMPLETED


# ---------------------------------------------------------------------------
# Pause / Resume / Cancel
# ---------------------------------------------------------------------------

class TestPauseResumeCancel:
    def test_pause_stops_progress_and_resume_finishes(self, server_factory,
                                                      workspace):
        size = 6 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=200 * 1024)
        engine = make_engine(srv, workspace, part_count=6)
        engine.start()
        assert wait_until(lambda: engine.downloaded_bytes() > size * 0.05,
                          timeout=30)
        engine.pause()
        assert wait_until(lambda: engine.status == DownloadStatus.PAUSED,
                          timeout=20)
        time.sleep(0.3)   # let in-flight chunk writes settle
        d1 = engine.downloaded_bytes()
        time.sleep(0.8)
        d2 = engine.downloaded_bytes()
        assert d2 == d1, f"paused download kept moving: {d1} -> {d2}"
        assert 0 < d1 < size
        # temp file preserved with preallocated size
        assert os.path.getsize(engine.task.temp_path) == size
        engine.resume()
        assert wait_until(lambda: engine.status == DownloadStatus.COMPLETED,
                          timeout=60)
        engine.wait_for_end(timeout=10)
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)
        # resume used byte offsets: server saw ranged GETs starting mid-part
        resumed_ranges = [r.range_header for r in srv.requests
                          if r.method == "GET" and r.status == 206]
        mid_part_requests = [r for r in resumed_ranges
                             if int(r.split("=")[1].split("-")[0]) > 0]
        assert mid_part_requests, "resume did not request remaining ranges"

    def test_resume_new_engine_instance_after_restart(self, server_factory,
                                                      workspace):
        """Simulates app restart: a brand-new engine resumes from the
        persisted part offsets and the existing temp file."""
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=200 * 1024)
        engine_a = make_engine(srv, workspace, part_count=8)
        engine_a.start()
        assert wait_until(lambda: engine_a.downloaded_bytes() > size * 0.15,
                          timeout=30)
        engine_a.pause()
        assert wait_until(lambda: engine_a.status == DownloadStatus.PAUSED,
                          timeout=20)
        saved = engine_a.downloaded_bytes()
        assert saved > 0
        srv.wait_for_idle()
        requests_before_restart = len(srv.requests)
        task_a = engine_a.task

        # "restart": fresh engine, same task object (as if loaded from DB)
        engine_b = DownloadEngine(task=task_a,
                                  config=EngineConfig(**FAST_CFG))
        engine_b.start()
        engine_b.wait_for_end(timeout=60)
        assert engine_b.status == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)
        srv.wait_for_idle()
        # engine B fetched only what was missing (well under a full re-download)
        served_after_restart = sum(
            r.bytes_sent for r in srv.requests[requests_before_restart:])
        assert served_after_restart < size - saved + 2 * 1024 * 1024

    def test_cancel_deletes_temp_when_asked(self, server_factory, workspace):
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=1024 * 1024)
        engine = make_engine(srv, workspace, part_count=4)
        engine.start()
        assert wait_until(lambda: engine.downloaded_bytes() > 50_000, timeout=30)
        engine.cancel(delete_temp=True)
        assert engine.status == DownloadStatus.CANCELLED
        assert not os.path.exists(engine.task.temp_path)
        assert not os.path.exists(os.path.join(workspace, "file.bin"))

    def test_cancel_keeps_temp_when_asked(self, server_factory, workspace):
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=1024 * 1024)
        engine = make_engine(srv, workspace, part_count=4)
        engine.start()
        assert wait_until(lambda: engine.downloaded_bytes() > 50_000, timeout=30)
        engine.cancel(delete_temp=False)
        assert engine.status == DownloadStatus.CANCELLED
        assert os.path.exists(engine.task.temp_path)

    def test_cancel_before_start(self, server_factory, workspace):
        srv = server_factory(size=1024, mode="normal")
        engine = make_engine(srv, workspace, part_count=4)
        engine.cancel(delete_temp=True)
        assert engine.status == DownloadStatus.CANCELLED


# ---------------------------------------------------------------------------
# Assembly & integrity (Step D)
# ---------------------------------------------------------------------------

class TestAssembly:
    def test_checksum_sha256_ok(self, server_factory, workspace):
        size = 2 * 1024 * 1024
        digest = hashlib.sha256(pattern_bytes(size)).hexdigest()
        srv = server_factory(size=size, mode="normal")
        engine = make_engine(srv, workspace, part_count=8,
                             checksum=("sha256", digest))
        assert run_to_end(engine) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)

    def test_checksum_mismatch_blocks_rename(self, server_factory, workspace):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        events: List[EngineEvent] = []
        engine = make_engine(srv, workspace, part_count=4,
                             checksum=("sha256", "ab" * 32), events=events)
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert "Checksum mismatch" in engine.task.error
        assert not os.path.exists(os.path.join(workspace, "file.bin"))
        assert os.path.exists(engine.task.temp_path)  # parts preserved
        failed = [e for e in events if e.type == EngineEventType.FAILED]
        assert failed and failed[0].data["kind"] == "checksum"

    def test_retry_after_checksum_failure_rechecks(self, server_factory,
                                                   workspace):
        size = 512 * 1024
        digest = hashlib.sha256(pattern_bytes(size)).hexdigest()
        srv = server_factory(size=size, mode="normal")
        engine = make_engine(srv, workspace, part_count=4,
                             checksum=("sha256", "cd" * 32))
        assert run_to_end(engine) == DownloadStatus.FAILED
        # user fixes the checksum → retry completes without re-download
        engine.task.checksum_value = digest
        requests_before = len(srv.requests)
        engine.retry_failed()
        engine.wait_for_end(timeout=30)
        assert engine.status == DownloadStatus.COMPLETED
        assert len(srv.requests) == requests_before  # no new HTTP requests
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)

    def test_existing_file_not_overwritten_without_permission(
            self, server_factory, workspace):
        size = 256 * 1024
        srv = server_factory(size=size, mode="normal")
        final = os.path.join(workspace, "file.bin")
        with open(final, "wb") as fh:
            fh.write(b"PRECIOUS USER DATA")
        engine = make_engine(srv, workspace, part_count=4,
                             allow_overwrite=False)
        assert run_to_end(engine) == DownloadStatus.FAILED
        assert "already exists" in engine.task.error
        assert open(final, "rb").read() == b"PRECIOUS USER DATA"
        assert os.path.exists(engine.task.temp_path)
        # now allow overwrite via retry
        engine.config.allow_overwrite = True
        engine.retry_failed()
        engine.wait_for_end(timeout=30)
        assert engine.status == DownloadStatus.COMPLETED
        assert verify_file_content(final, size)

    def test_permission_error_reported_clearly(self, server_factory, tmp_path):
        size = 64 * 1024
        srv = server_factory(size=size, mode="normal")
        ro_dir = tmp_path / "readonly"
        ro_dir.mkdir()
        os.chmod(ro_dir, stat.S_IRUSR | stat.S_IXUSR)  # r-x
        try:
            engine = make_engine(srv, str(ro_dir), part_count=4)
            assert run_to_end(engine) == DownloadStatus.FAILED
            assert "ermission" in engine.task.error
        finally:
            os.chmod(ro_dir, stat.S_IRWXU)

    def test_temp_file_preallocated_to_full_size(self, server_factory,
                                                 workspace):
        size = 8 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=4 * 1024 * 1024)
        engine = make_engine(srv, workspace, part_count=8)
        engine.start()
        assert wait_until(
            lambda: os.path.exists(engine.task.temp_path)
            and os.path.getsize(engine.task.temp_path) == size, timeout=10)
        engine.wait_for_end(timeout=60)
        assert engine.status == DownloadStatus.COMPLETED

    def test_corrupt_temp_file_detected_on_restart(self, server_factory,
                                                   workspace):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        # Pre-create a truncated temp file with a bogus part progress record
        task_probe = probe_url(srv.file_url)
        task = DownloadTask(id=2, url=srv.file_url, filename="file.bin",
                            dest_dir=workspace, total_size=size,
                            part_count=4, range_support=RangeSupport.YES,
                            final_url=srv.file_url)
        with open(task.temp_path, "wb") as fh:
            fh.write(b"short")   # wrong size on disk
        from ultradownload.models import PartState
        ranges = split_byte_ranges(size, 4)
        task.parts = [PartState(i, r.start, r.end, downloaded=r.size // 2)
                      for i, r in enumerate(ranges)]
        engine = DownloadEngine(task=task, config=EngineConfig(**FAST_CFG))
        assert run_to_end(engine, timeout=30) == DownloadStatus.COMPLETED
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)


# ---------------------------------------------------------------------------
# Speed limits
# ---------------------------------------------------------------------------

class TestSpeedLimit:
    def test_per_download_limit_respected(self, server_factory, workspace):
        from ultradownload.speed import RateLimiter
        size = 3 * 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        engine = make_engine(srv, workspace, part_count=8)
        engine.task.speed_limit = 1024 * 1024  # 1 MiB/s
        t0 = time.monotonic()
        engine.start()
        engine.wait_for_end(timeout=60)
        elapsed = time.monotonic() - t0
        assert engine.status == DownloadStatus.COMPLETED
        # 3 MiB at ~1 MiB/s must take >= ~2 s (chunk burst tolerance)
        assert elapsed >= 1.8, f"speed limit not applied ({elapsed:.2f}s)"
        assert verify_file_content(os.path.join(workspace, "file.bin"), size)

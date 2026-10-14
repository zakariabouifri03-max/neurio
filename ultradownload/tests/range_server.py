"""Local HTTP test server with byte-range support and failure modes.

Serves a *deterministic* byte pattern generated on the fly (no big files
on disk), so tests can verify downloaded content byte-for-byte without
storing fixtures.

Modes (``mode=``):
  normal             – RFC-7233 ranges, ETag/Last-Modified, HEAD support
  no_range           – ignores Range, always 200 with the full body
  bad_content_range  – answers 206 but with a shifted Content-Range
  truncate           – promises a range, sends half of it, then closes
  truncate_once      – truncates only the first ``fail_first`` ranged GETs,
                       then serves correctly (recovery test)
  flaky_500          – first ``fail_first`` GETs → 500, then normal
  ratelimit_429      – first ``fail_first`` GETs → 429 (Retry-After 1)
  auth401            – 401 unless ``Authorization: Bearer <token>``
  notfound           – always 404
  servererror        – always 500
  barrier            – holds every ranged GET until ``barrier_count``
                       range requests are open *simultaneously*; proves
                       parts download concurrently (a sequential client
                       would deadlock → the test fails)
  slow               – throttled to ``throttle_bps`` bytes/sec
  zero               – zero-byte file
  head_not_allowed   – HEAD → 405 (GET probe must be used)
  no_content_length  – 200, close-delimited body, size unknown
  redirect           – 302 to ``/real/target.bin`` then normal serving
  changed            – after ``flip_after`` requests the file "changes"
                       (new size + ETag) for resume-validation tests
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional

PATTERN_PERIOD = 251
_TILE = bytes(((i * 31 + 7) % PATTERN_PERIOD) for i in range(PATTERN_PERIOD))


def pattern_bytes(size: int, offset: int = 0) -> bytes:
    """Deterministic content: byte i of the file is ``((i*31+7) % 251)``."""
    if size <= 0:
        return b""
    start = offset % PATTERN_PERIOD
    reps = (size + start + PATTERN_PERIOD - 1) // PATTERN_PERIOD
    return (bytes(_TILE * reps))[start:start + size]


def verify_file_content(path: str, size: int, chunk: int = 1 << 20) -> bool:
    """True when ``path`` contains exactly ``size`` pattern bytes."""
    import os
    if os.path.getsize(path) != size:
        return False
    offset = 0
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            if block != pattern_bytes(len(block), offset):
                return False
            offset += len(block)
    return offset == size


@dataclass
class RequestRecord:
    method: str
    path: str
    range_header: str
    status: int
    start: float          # monotonic, when request handling began
    end: float            # monotonic, when body streaming finished
    bytes_sent: int


@dataclass
class ServerConfig:
    size: int = 8 * 1024 * 1024
    mode: str = "normal"
    fail_first: int = 2
    barrier_count: int = 0
    barrier_timeout: float = 15.0
    throttle_bps: int = 0
    auth_token: str = "secret-token"
    etag: str = 'W/"etag-v1"'
    last_modified: str = "Wed, 21 Oct 2025 07:28:00 GMT"
    flip_after: int = 1          # for mode=changed
    changed_size: int = 0        # for mode=changed (0 → size*2)
    redirect_target: str = "/real/target.bin"
    send_chunk: int = 64 * 1024


class RangeTestServer:
    """Threaded HTTP server exposing one file at ``/file.bin``."""

    def __init__(self, config: Optional[ServerConfig] = None,
                 host: str = "127.0.0.1", port: int = 0) -> None:
        self.config = config or ServerConfig()
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self.requests: List[RequestRecord] = []
        self.get_count = 0
        self.barrier_reached = False
        self.barrier_failed = False
        self.barrier_open = False     # latched: once open, stays open
        self._active = 0
        self._max_active = 0
        self._inflight = 0
        self.flipped = False

        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "RangeTest/1.0"

            # --- helpers ---------------------------------------------------
            def log_message(self, fmt, *args):   # silence stderr noise
                pass

            def _cfg(self) -> ServerConfig:
                return outer.config

            def _record(self, rec: RequestRecord) -> None:
                with outer._lock:
                    outer.requests.append(rec)

            def _note_active(self, delta: int) -> None:
                with outer._cond:
                    outer._active += delta
                    if outer._active > outer._max_active:
                        outer._max_active = outer._active
                    outer._cond.notify_all()

            @property
            def max_active(self) -> int:
                return outer._max_active

            def _wait_barrier(self) -> bool:
                cfg = self._cfg()
                deadline = time.monotonic() + cfg.barrier_timeout
                with outer._cond:
                    while not outer.barrier_open:
                        if outer._active >= cfg.barrier_count:
                            outer.barrier_open = True
                            outer.barrier_reached = True
                            break
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            outer.barrier_failed = True
                            return False
                        outer._cond.wait(min(remaining, 0.1))
                    return True

            def _common_headers(self, status: int, length: Optional[int],
                                content_range: Optional[str] = None) -> None:
                cfg = self._cfg()
                self.send_response(status)
                ctype = "application/octet-stream"
                self.send_header("Content-Type", ctype)
                if length is not None:
                    self.send_header("Content-Length", str(length))
                if content_range:
                    self.send_header("Content-Range", content_range)
                if cfg.mode != "no_range":
                    self.send_header("Accept-Ranges", "bytes")
                else:
                    self.send_header("Accept-Ranges", "none")
                etag = cfg.etag
                if outer.flipped:
                    etag = 'W/"etag-v2"'
                self.send_header("ETag", etag)
                self.send_header("Last-Modified", cfg.last_modified)

            def _send_body(self, offset: int, length: int,
                           throttle_bps: int = 0,
                           truncate_after: Optional[int] = None) -> int:
                cfg = self._cfg()
                sent = 0
                chunk = max(1024, cfg.send_chunk)
                try:
                    while sent < length:
                        n = min(chunk, length - sent)
                        if truncate_after is not None and sent >= truncate_after:
                            # Abrupt close mid-body.
                            self.close_connection = True
                            try:
                                self.wfile.flush()
                            except OSError:
                                pass
                            return sent
                        self.wfile.write(pattern_bytes(n, offset + sent))
                        sent += n
                        if throttle_bps > 0:
                            time.sleep(n / throttle_bps)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                return sent

            def _check_auth(self) -> bool:
                cfg = self._cfg()
                if cfg.mode != "auth401":
                    return True
                auth = self.headers.get("Authorization", "")
                if auth == f"Bearer {cfg.auth_token}":
                    return True
                self._common_headers(401, 0)
                self.send_header("WWW-Authenticate", 'Bearer realm="test"')
                self.end_headers()
                return False

            def _bump_get(self) -> int:
                with outer._lock:
                    outer.get_count += 1
                    return outer.get_count

            def _maybe_flip(self) -> None:
                cfg = self._cfg()
                if cfg.mode == "changed" and not outer.flipped \
                        and outer.get_count > cfg.flip_after:
                    outer.flipped = True

            def _current_size(self) -> int:
                cfg = self._cfg()
                if outer.flipped:
                    return cfg.changed_size or cfg.size * 2
                return cfg.size

            # --- verbs ------------------------------------------------------
            def do_HEAD(self):
                with outer._lock:
                    outer._inflight += 1
                try:
                    self._do_HEAD()
                finally:
                    with outer._lock:
                        outer._inflight -= 1

            def do_GET(self):
                with outer._lock:
                    outer._inflight += 1
                try:
                    self._do_GET()
                finally:
                    with outer._lock:
                        outer._inflight -= 1

            def _do_HEAD(self):
                t0 = time.monotonic()
                cfg = self._cfg()
                path = self.path
                if cfg.mode == "redirect" and not path.startswith("/real/"):
                    self.send_response(302)
                    self.send_header("Location", cfg.redirect_target)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._record(RequestRecord("HEAD", path, "", 302,
                                               t0, time.monotonic(), 0))
                    return
                if cfg.mode == "notfound":
                    self._common_headers(404, 0)
                    self.end_headers()
                    self._record(RequestRecord("HEAD", path, "", 404,
                                               t0, time.monotonic(), 0))
                    return
                if cfg.mode == "head_not_allowed":
                    self.send_response(405)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._record(RequestRecord("HEAD", path, "", 405,
                                               t0, time.monotonic(), 0))
                    return
                if not self._check_auth():
                    self._record(RequestRecord("HEAD", path, "", 401,
                                               t0, time.monotonic(), 0))
                    return
                size = self._current_size()
                self._common_headers(200, size)
                self.end_headers()
                self._record(RequestRecord("HEAD", path, "", 200,
                                           t0, time.monotonic(), 0))

            def _do_GET(self):
                t0 = time.monotonic()
                cfg = self._cfg()
                path = self.path
                range_hdr = self.headers.get("Range", "")
                if cfg.mode == "redirect" and not path.startswith("/real/"):
                    self.send_response(302)
                    self.send_header("Location", cfg.redirect_target)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._record(RequestRecord("GET", path, range_hdr, 302,
                                               t0, time.monotonic(), 0))
                    return
                if cfg.mode == "notfound":
                    self._common_headers(404, 13)
                    self.end_headers()
                    self.wfile.write(b"not found\n")
                    self._record(RequestRecord("GET", path, range_hdr, 404,
                                               t0, time.monotonic(), 13))
                    return
                if cfg.mode == "servererror":
                    self._common_headers(500, 0)
                    self.end_headers()
                    self._record(RequestRecord("GET", path, range_hdr, 500,
                                               t0, time.monotonic(), 0))
                    return

                count = self._bump_get()
                self._maybe_flip()

                if cfg.mode == "flaky_500" and count <= cfg.fail_first:
                    self._common_headers(500, 0)
                    self.end_headers()
                    self._record(RequestRecord("GET", path, range_hdr, 500,
                                               t0, time.monotonic(), 0))
                    return
                if cfg.mode == "ratelimit_429" and count <= cfg.fail_first:
                    self.send_response(429)
                    self.send_header("Retry-After", "1")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._record(RequestRecord("GET", path, range_hdr, 429,
                                               t0, time.monotonic(), 0))
                    return
                if not self._check_auth():
                    self._record(RequestRecord("GET", path, range_hdr, 401,
                                               t0, time.monotonic(), 0))
                    return

                size = self._current_size()

                # --- parse Range -------------------------------------------
                m = re.match(r"^bytes=(\d*)-(\d*)$", range_hdr.strip()) \
                    if range_hdr else None
                want_range = m is not None and cfg.mode not in ("no_range",)

                if cfg.mode == "zero" or size == 0:
                    if want_range:
                        self.send_response(416)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        self._record(RequestRecord("GET", path, range_hdr,
                                                   416, t0, time.monotonic(), 0))
                    else:
                        self._common_headers(200, 0)
                        self.end_headers()
                        self._record(RequestRecord("GET", path, range_hdr,
                                                   200, t0, time.monotonic(), 0))
                    return

                if cfg.mode == "no_content_length":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Accept-Ranges", "none")
                    self.send_header("ETag", cfg.etag)
                    self.end_headers()
                    self.close_connection = True
                    sent = self._send_body(0, size)
                    self._record(RequestRecord("GET", path, range_hdr, 200,
                                               t0, time.monotonic(), sent))
                    return

                if not want_range:
                    self._common_headers(200, size)
                    self.end_headers()
                    self._note_active(+1)
                    try:
                        sent = self._send_body(0, size, cfg.throttle_bps)
                    finally:
                        self._note_active(-1)
                    self._record(RequestRecord("GET", path, range_hdr, 200,
                                               t0, time.monotonic(), sent))
                    return

                first_s, last_s = m.group(1), m.group(2)
                if first_s == "":
                    # suffix range bytes=-N → last N bytes
                    suffix = int(last_s)
                    first = max(0, size - suffix)
                    last = size - 1
                else:
                    first = int(first_s)
                    last = int(last_s) if last_s else size - 1
                last = min(last, size - 1)
                if first >= size or first > last:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._record(RequestRecord("GET", path, range_hdr, 416,
                                               t0, time.monotonic(), 0))
                    return

                length = last - first + 1

                # --- barrier gate (concurrency proof) -----------------------
                if cfg.mode == "barrier":
                    self._note_active(+1)
                    ok = self._wait_barrier()
                    if not ok:
                        self._note_active(-1)
                        self._common_headers(500, 0)
                        self.end_headers()
                        self._record(RequestRecord("GET", path, range_hdr,
                                                   500, t0, time.monotonic(), 0))
                        return
                elif cfg.mode == "slow" or cfg.throttle_bps:
                    self._note_active(+1)
                else:
                    self._note_active(+1)

                try:
                    if cfg.mode == "bad_content_range":
                        bad_first = max(0, first - 1)
                        self._common_headers(
                            206, length,
                            f"bytes {bad_first}-{last}/{size}")
                        self.end_headers()
                        sent = self._send_body(first, length)
                    elif cfg.mode == "truncate" or (
                            cfg.mode == "truncate_once"
                            and count <= cfg.fail_first):
                        self._common_headers(
                            206, length, f"bytes {first}-{last}/{size}")
                        self.end_headers()
                        sent = self._send_body(first, length,
                                               truncate_after=length // 2)
                    else:
                        self._common_headers(
                            206, length, f"bytes {first}-{last}/{size}")
                        self.end_headers()
                        sent = self._send_body(first, length, cfg.throttle_bps)
                finally:
                    self._note_active(-1)
                self._record(RequestRecord("GET", path, range_hdr, 206,
                                           t0, time.monotonic(), sent))

        class _Server(ThreadingHTTPServer):
            daemon_threads = True
            request_queue_size = 128   # 40 simultaneous connections in tests

        self._httpd = _Server((host, port), Handler)
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------ API

    @property
    def host(self) -> str:
        return self._httpd.server_address[0]

    @property
    def port(self) -> int:
        return self._httpd.server_address[1]

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def file_url(self) -> str:
        return f"{self.base_url}/file.bin"

    @property
    def max_concurrent_requests(self) -> int:
        """Max simultaneous GET body streams observed by the server."""
        with self._lock:
            return self._max_active

    def overlap_stats(self) -> Dict[str, float]:
        """Interval-overlap analysis of recorded GET requests."""
        with self._lock:
            recs = [r for r in self.requests if r.method == "GET"]
        if not recs:
            return {"max_overlap": 0, "requests": 0}
        events = []
        for r in recs:
            events.append((r.start, +1))
            events.append((r.end, -1))
        events.sort(key=lambda e: (e[0], e[1]))
        cur = best = 0
        for _, delta in events:
            cur += delta
            best = max(best, cur)
        return {"max_overlap": best, "requests": len(recs)}

    def wait_for_idle(self, timeout: float = 15.0) -> bool:
        """Block until every handler finished (incl. request recording)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._lock:
                if self._inflight == 0 and self._active == 0:
                    return True
            time.sleep(0.01)
        return False

    def start(self) -> "RangeTestServer":
        self._thread = threading.Thread(target=self._httpd.serve_forever,
                                        daemon=True, name="range-server")
        self._thread.start()
        return self

    def stop(self) -> None:
        try:
            self._httpd.shutdown()
            self._httpd.server_close()
        except Exception:
            pass
        if self._thread is not None:
            self._thread.join(timeout=3)

    def __enter__(self) -> "RangeTestServer":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

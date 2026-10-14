"""Local HTTP test server with configurable Range behavior.

Used by the automated tests to exercise the download engine without any
external network access.  Supports:

* correct single-range requests (206 + Content-Range)
* mode ``ignore_ranges``  — always answers 200 with the full body
* mode ``bad_content_range`` — 206 with a wrong Content-Range header
* mode ``truncate`` — closes the connection before the range is complete
* mode ``flaky`` — first N requests per part fail with HTTP 500
* mode ``rate_limit`` — first N requests overall answer 429
* mode ``auth`` — requires a Bearer token
* mode ``drip`` — streams slowly in small chunks (keeps connections open)
* mode ``barrier`` — blocks all handlers until `part_count` are in flight,
  proving that workers start concurrently
* per-request timestamp log for concurrency assertions
"""

from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)\s*$")

DEFAULT_TOKEN = "secret-token"

_PATTERN_SIZE = 1 << 20  # 1 MiB periodic pattern block
_PATTERN: bytes | None = None


def pattern_byte(i: int) -> int:
    """Deterministic pseudo-random byte value for absolute offset i."""
    return (i * 2654435761 + 12345) & 0xFF


def pattern_block() -> bytes:
    global _PATTERN
    if _PATTERN is None:
        _PATTERN = bytes(pattern_byte(i) for i in range(_PATTERN_SIZE))
    return _PATTERN


def pattern_slice(start: int, n: int) -> bytes:
    """``n`` pattern bytes beginning at absolute offset ``start`` (fast)."""
    blk = pattern_block()
    out = bytearray()
    pos = start % _PATTERN_SIZE
    while len(out) < n:
        take = min(n - len(out), _PATTERN_SIZE - pos)
        out += blk[pos:pos + take]
        pos = 0
    return bytes(out)


def pattern_data(n: int) -> bytes:
    return pattern_slice(0, n)


class ServerState:
    """Mutable state shared by all handler threads."""

    def __init__(self, data: bytes, **modes) -> None:
        self.data = data
        self.size = len(data)
        self.mode = modes.get("mode", "range_ok")
        self.fail_first = int(modes.get("fail_first", 0))       # per part (by Range start)
        self.rate_limit_first = int(modes.get("rate_limit_first", 0))
        self.truncate_at = int(modes.get("truncate_at", 1024))  # bytes then close
        self.truncate_first = int(modes.get("truncate_first", 0))  # 0 = always
        self.drip_chunk = int(modes.get("drip_chunk", 4096))
        self.drip_delay = float(modes.get("drip_delay", 0.0))
        self.barrier_count = int(modes.get("barrier_count", 0))
        self.require_token = modes.get("require_token")
        self.auth_mode = modes.get("auth_mode", "all")  # "all" | "get"
        self.content_type = modes.get("content_type", "application/octet-stream")
        self.filename = modes.get("filename")
        self.no_head = bool(modes.get("no_head", False))
        self.not_found_paths = set(modes.get("not_found", ()))
        self.accept_ranges_header = modes.get("accept_ranges_header", "bytes")
        self.chunked = bool(modes.get("chunked", False))

        self.lock = threading.Lock()
        self.requests: list[dict] = []          # every request's timeline
        self.in_flight = 0
        self.max_in_flight = 0
        self.requests_per_start: dict[int, int] = defaultdict(int)
        self.total_requests = 0
        self._fail_counts: dict[int, int] = defaultdict(int)
        self._truncate_counts: dict[int, int] = defaultdict(int)
        self._rate_count = 0
        self._barrier = threading.Barrier(self.barrier_count) if self.barrier_count > 1 else None

    def checksum(self, algo: str = "sha256") -> str:
        return hashlib.new(algo, self.data).hexdigest()

    def bytes_at(self, start: int, n: int) -> bytes:
        """Data bytes at absolute offset — works for lazy pattern mode too."""
        if self.data:
            return self.data[start:start + n]
        return pattern_slice(start, n)


class RangeRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "UltraDownloadTestServer/1.0"

    # silence default stderr chatter
    def log_message(self, fmt, *args):
        pass

    @property
    def state(self) -> ServerState:
        return self.server.state  # type: ignore[attr-defined]

    def _parse_range(self, total: int):
        """Return (start, end) inclusive, or None if no/invalid Range header."""
        raw = self.headers.get("Range")
        if not raw:
            return None
        m = RANGE_RE.match(raw.strip())
        if not m:
            return None
        s, e = m.group(1), m.group(2)
        if s == "" and e == "":
            return None
        if s == "":                       # suffix: last N bytes
            n = int(e)
            start = max(0, total - n)
            end = total - 1
        else:
            start = int(s)
            end = int(e) if e != "" else total - 1
        if start >= total and total > 0:
            return "unsatisfiable"
        end = min(end, total - 1)
        return start, end

    def _record(self, range_key, start_byte):
        st = self.state
        with st.lock:
            st.total_requests += 1
            st.in_flight += 1
            st.max_in_flight = max(st.max_in_flight, st.in_flight)
            entry = {
                "range": range_key,
                "start_byte": start_byte,
                "begin": time.monotonic(),
                "end": None,
                "status": None,
            }
            st.requests.append(entry)
            if start_byte is not None:
                st.requests_per_start[start_byte] += 1
        return entry

    def _finish(self, entry, status):
        st = self.state
        with st.lock:
            entry["end"] = time.monotonic()
            entry["status"] = status
            st.in_flight -= 1

    def do_HEAD(self):
        if self.state.no_head:
            self.send_error(405, "HEAD not allowed")
            return
        self._serve(body=False)

    def do_GET(self):
        self._serve(body=True)

    def _serve(self, body: bool):
        st = self.state
        parsed = urlparse(self.path)
        if parsed.path == "/__health":
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            if body:
                self.wfile.write(b"ok")
            return

        # --- auth ---------------------------------------------------------
        if parsed.path in st.not_found_paths:
            self.send_error(404, "Not found")
            return

        if st.require_token and (st.auth_mode == "all" or self.command == "GET"):
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {st.require_token}":
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Bearer realm="test"')
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

        total = st.size
        rng = self._parse_range(total)
        range_key = self.headers.get("Range")
        start_byte = rng[0] if isinstance(rng, tuple) else None
        # The inspector's probe request ("bytes=0-0") must never be failed,
        # rate limited or truncated — those modes target real part downloads.
        is_probe = range_key == "bytes=0-0"

        entry = self._record(range_key, start_byte)
        try:
            # --- barrier mode: prove concurrent starts ---------------------
            if st._barrier is not None and self.command == "GET" and isinstance(rng, tuple) \
                    and not is_probe:
                try:
                    st._barrier.wait(timeout=15)
                except threading.BrokenBarrierError:
                    pass

            # --- rate limiting (part requests only) ------------------------
            if st.rate_limit_first and range_key and not is_probe:
                with st.lock:
                    do_limit = st._rate_count < st.rate_limit_first
                    st._rate_count += 1
                if do_limit:
                    self.send_response(429)
                    self.send_header("Retry-After", "1")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._finish(entry, 429)
                    return

            # --- flaky (per part start) -----------------------------------
            if st.fail_first and isinstance(rng, tuple) and not is_probe:
                with st.lock:
                    key = rng[0]
                    st._fail_counts[key] += 1
                    do_fail = st._fail_counts[key] <= st.fail_first
                if do_fail:
                    self.send_response(500)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    self._finish(entry, 500)
                    return

            # --- mode: ignore ranges --------------------------------------
            if st.mode == "ignore_ranges" and rng is not None:
                rng = None  # behave as if no Range header was sent

            if rng == "unsatisfiable":
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{total}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                self._finish(entry, 416)
                return

            # --- headers ---------------------------------------------------
            if rng is None:
                start, end = 0, total - 1
                status = 200
                length = total
            else:
                start, end = rng
                if st.mode == "bad_content_range":
                    # Deliberately lie about the range.
                    status = 206
                    length = end - start + 1
                else:
                    status = 206
                    length = end - start + 1

            self.send_response(status)
            self.send_header("Content-Type", st.content_type)
            if not st.chunked:
                self.send_header("Content-Length", str(length))
            else:
                self.send_header("Transfer-Encoding", "chunked")
            if st.accept_ranges_header is not None:
                self.send_header("Accept-Ranges", st.accept_ranges_header)
            if status == 206:
                if st.mode == "bad_content_range":
                    bad_start = max(0, start - 1)
                    self.send_header(
                        "Content-Range",
                        f"bytes {bad_start}-{end}/{total}")
                else:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            if st.filename:
                self.send_header(
                    "Content-Disposition",
                    f'attachment; filename="{st.filename}"')
            self.send_header("ETag", f'W/"{st.size:x}-{st.mode}"')
            self.end_headers()

            if not body or self.command == "HEAD":
                self._finish(entry, status)
                return

            # --- body ------------------------------------------------------
            sent = 0
            limit = length
            do_truncate = False
            if st.mode == "truncate" and not is_probe:
                with st.lock:
                    key = start if start is not None else -1
                    st._truncate_counts[key] += 1
                    n_trunc = st._truncate_counts[key]
                do_truncate = (st.truncate_first <= 0
                               or n_trunc <= st.truncate_first)
            if do_truncate:
                limit = min(length, st.truncate_at)

            while sent < limit:
                if st.drip_delay > 0 or st.mode == "drip":
                    n = min(st.drip_chunk, limit - sent)
                    delay = st.drip_delay if st.drip_delay > 0 else 0.02
                else:
                    n = min(64 * 1024, limit - sent)
                    delay = 0.0
                chunk = st.bytes_at(start + sent, n)
                try:
                    if st.chunked:
                        self.wfile.write(f"{n:x}\r\n".encode() + chunk + b"\r\n")
                    else:
                        self.wfile.write(chunk)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    self._finish(entry, "aborted")
                    return
                sent += n
                if delay and sent < limit:
                    time.sleep(delay)

            if do_truncate:
                # Close without completing the promised Content-Length.
                self.close_connection = True
                self._finish(entry, "truncated")
                return

            if st.chunked:
                try:
                    self.wfile.write(b"0\r\n\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    self._finish(entry, "aborted")
                    return
            self._finish(entry, status)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self._finish(entry, "aborted")
            return
        except Exception:
            self._finish(entry, "error")
            raise


class RangeTestServer:
    """Context-manager wrapper around a threading HTTP server."""

    def __init__(self, data: bytes | None = None, size: int | None = None, **modes):
        if data is None:
            n = size if size is not None else 256 * 1024
            # Serve straight from the periodic pattern block (no big copy).
            self._lazy_size = n
            data = b""   # lazy mode
        else:
            self._lazy_size = None
        self.state = ServerState(data, **modes)
        if self._lazy_size is not None:
            self.state.size = self._lazy_size
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), RangeRequestHandler)
        self.httpd.state = self.state  # type: ignore[attr-defined]
        self.httpd.daemon_threads = True
        self._thread = threading.Thread(target=self.httpd.serve_forever,
                                        kwargs={"poll_interval": 0.05},
                                        daemon=True)

    @property
    def port(self) -> int:
        return self.httpd.server_address[1]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/file.bin"

    def path_url(self, path: str = "/file.bin") -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def start(self) -> "RangeTestServer":
        self._thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self._thread.join(timeout=5)

    def __enter__(self) -> "RangeTestServer":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

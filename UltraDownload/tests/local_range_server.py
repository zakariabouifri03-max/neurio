"""Real threaded HTTP server with controllable failures and concurrency telemetry."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import re
import threading
import time
from app.models import CHUNK_SIZE


class RangeServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, data):
        super().__init__(("127.0.0.1", 0), Handler)
        self.data = data
        self.lock = threading.Lock()
        self.active = self.peak = 0
        self.events = []
        self.delay = .03
        self.block_delay = self.slow_first = 0
        self.ignore_ranges = self.head_unsupported = self.unknown_length = self.bad_range = False
        self.etag = '"version-1"'
        self.failures = {}
        self.truncate = set()
        self.limit = 100
        self.url = f"http://127.0.0.1:{self.server_port}/file.bin"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def headers_for(self, code, start=None, end=None, size=None):
        s = self.server
        self.send_response(code)
        self.send_header("ETag", s.etag)
        self.send_header("Last-Modified", "Wed, 01 Jan 2025 00:00:00 GMT")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Disposition", 'attachment; filename="test.bin"')
        if size is not None and not s.unknown_length:
            self.send_header("Content-Length", str(size))
        if start is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(s.data)}")
        self.end_headers()

    def do_HEAD(self):
        self.headers_for(405 if self.server.head_unsupported else 200, size=len(self.server.data))

    def do_GET(self):
        s = self.server
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
        ranged = bool(match) and not s.ignore_ranges
        start, end = (int(match[1]), int(match[2])) if ranged else (0, len(s.data)-1)
        if ranged and start >= len(s.data):
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{len(s.data)}")
            self.end_headers()
            return
        probe = ranged and start == end == 0
        if self.headers.get("If-Match", s.etag) != s.etag:
            self.headers_for(412, size=0)
            return
        index = start // CHUNK_SIZE
        with s.lock:
            if not probe:
                failures = s.failures.get(index, [])
                code = failures.pop(0) if failures else (429 if s.active >= s.limit else 0)
                if code:
                    s.events.append(("reject", index, time.monotonic(), code))
                    self.send_response(code)
                    self.send_header("Retry-After", "0.05")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                s.active += 1
                s.peak = max(s.peak, s.active)
                s.events.append(("start", index, time.monotonic(), start))
        try:
            if not probe:
                time.sleep(s.slow_first if index == 0 and s.slow_first else s.delay)
            self.headers_for(206 if ranged else 200,
                             start+(1 if s.bad_range and not probe else 0) if ranged else None,
                             end if ranged else None, end-start+1)
            if not probe and index in s.truncate:
                with s.lock:
                    s.truncate.discard(index)
                end = start+(end-start)//2
            view = memoryview(s.data)
            for pos in range(start, end+1, 64*1024):
                self.wfile.write(view[pos:min(pos+64*1024, end+1)])
                self.wfile.flush()
                if not probe and s.block_delay:
                    time.sleep(s.block_delay)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            if not probe:
                with s.lock:
                    s.active -= 1
                    s.events.append(("end", index, time.monotonic(), 0))


@contextmanager
def serve(data):
    server = RangeServer(data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

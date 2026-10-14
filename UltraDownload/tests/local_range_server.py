"""Controllable real loopback HTTP server, no mocked transfer implementation."""

import re
import socket
import threading
import time
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from app.models import CHUNK_SIZE


@contextmanager
def range_server(data, **options):
    state = SimpleNamespace(
        data=data,
        etag='"version-1"',
        modified="Wed, 01 Oct 2025 12:00:00 GMT",
        delay=0.04,
        block_delay=0,
        ignore_ranges=False,
        head_supported=True,
        active=0,
        peak=0,
        lock=threading.Lock(),
        calls=Counter(),
        failures={},
        truncations={},
        malformed=False,
        limit=100,
        events=[],
        delays={},
        require_ten=False,
        ten=threading.Event(),
        retry_after="0.1",
        unknown_size=False,
    )
    for key, value in options.items():
        setattr(state, key, value)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def handle(self):
            try:
                super().handle()
            except (ConnectionResetError, BrokenPipeError):
                pass

        def log_message(self, *args):
            pass

        def send_headers(self, status, length=None, content_range=None):
            self.send_response(status)
            self.send_header("ETag", state.etag)
            self.send_header("Last-Modified", state.modified)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header(
                "Content-Disposition", 'attachment; filename="test-file.bin"'
            )
            if length is not None:
                self.send_header("Content-Length", str(length))
            else:
                self.send_header("Connection", "close")
                self.close_connection = True
            if content_range:
                self.send_header("Content-Range", content_range)
            if status == 429:
                self.send_header("Retry-After", state.retry_after)
            self.end_headers()

        def do_HEAD(self):
            if not state.head_supported:
                self.send_headers(405, 0)
            else:
                self.send_headers(200, None if state.unknown_size else len(state.data))

        def do_GET(self):
            match = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
            if not match or state.ignore_ranges:
                self.send_headers(200, None if state.unknown_size else len(state.data))
                try:
                    self.wfile.write(state.data)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            start, end = map(int, match.groups())
            if start >= len(state.data):
                self.send_headers(416, 0, f"bytes */{len(state.data)}")
                return
            end = min(end, len(state.data) - 1)
            probe = start == end == 0
            index = start // CHUNK_SIZE
            if probe:
                self.send_headers(206, 1, f"bytes 0-0/{len(state.data)}")
                self.wfile.write(state.data[:1])
                return
            with state.lock:
                state.active += 1
                state.peak = max(state.peak, state.active)
                state.calls[index] += 1
                attempt = state.calls[index]
                state.events.append(("start", index, time.monotonic()))
                limited = state.active > state.limit
                if state.active >= 10:
                    state.ten.set()
            try:
                if state.require_ten and index < 10:
                    state.ten.wait(5)
                time.sleep(state.delays.get(index, state.delay))
                status = state.failures.get(index, [])
                if limited or attempt <= len(status):
                    self.send_headers(429 if limited else status[attempt - 1], 0)
                    return
                length = end - start + 1
                self.send_headers(
                    206,
                    length,
                    f"bytes {start + (1 if state.malformed else 0)}-{end}/{len(state.data)}",
                )
                if attempt <= state.truncations.get(index, 0):
                    self.wfile.write(state.data[start : start + length // 2])
                    self.wfile.flush()
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                for offset in range(start, end + 1, 64 * 1024):
                    self.wfile.write(
                        state.data[offset : min(offset + 64 * 1024, end + 1)]
                    )
                    self.wfile.flush()
                    if state.block_delay:
                        time.sleep(state.block_delay)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with state.lock:
                    state.active -= 1
                    state.events.append(("end", index, time.monotonic()))

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 128

    server = Server(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    state.url = f"http://127.0.0.1:{server.server_port}/file"
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        worker.join()

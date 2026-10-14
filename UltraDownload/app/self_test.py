"""Packaged executable end-to-end test using a real loopback range server."""

import hashlib
import json
import re
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .database import Database
from .download_engine import DownloadEngine
from .http_client import inspect_url
from .models import CHUNK_SIZE
from .settings import Settings


def run_self_test(report_path):
    data = b"".join(bytes([i * 17]) * CHUNK_SIZE for i in range(12)) + b"last chunk"
    lock = threading.Lock()
    ten = threading.Event()
    stats = dict(active=0, peak=0)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def do_HEAD(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("ETag", '"self-test-v1"')
            self.end_headers()

        def do_GET(self):
            match = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
            if not match:
                self.send_error(400)
                return
            start, end = map(int, match.groups())
            probe = start == end == 0
            if not probe:
                with lock:
                    stats["active"] += 1
                    stats["peak"] = max(stats["peak"], stats["active"])
                    if stats["active"] == 10:
                        ten.set()
                if start // CHUNK_SIZE < 10:
                    ten.wait(10)
                time.sleep(0.05)
            try:
                self.send_response(206)
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                self.send_header("ETag", '"self-test-v1"')
                self.end_headers()
                self.wfile.write(data[start : end + 1])
                self.wfile.flush()
            finally:
                if not probe:
                    with lock:
                        stats["active"] -= 1

    class Server(ThreadingHTTPServer):
        request_queue_size = 128
        daemon_threads = True

    server = Server(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    result = {"passed": False}
    try:
        with tempfile.TemporaryDirectory(prefix="UltraDownload-selftest-") as folder:
            root = Path(folder)
            db = Database(root / "state.sqlite3")
            try:
                settings = Settings(cleanup_completed=False)
                info = inspect_url(
                    f"http://127.0.0.1:{server.server_port}/test.bin", settings
                )
                identifier = uuid.uuid4().hex
                expected = hashlib.sha256(data).hexdigest()
                db.create(identifier, info, root / "output.bin", expected)
                engine = DownloadEngine(db, identifier, root / "temp", settings)
                engine.run()
                record = db.get(identifier)
                if record["status"] != "completed":
                    raise AssertionError(record["error"])
                if engine.destination.read_bytes() != data:
                    raise AssertionError("Output bytes differ")
                if stats["peak"] != 10 or engine.scheduler.max_submitted != 10:
                    raise AssertionError(
                        "Did not observe exactly ten active range requests"
                    )
                result.update(
                    passed=True,
                    bytes=len(data),
                    sha256=record["actual_hash"],
                    peak_requests=stats["peak"],
                    max_submitted=engine.scheduler.max_submitted,
                )
            finally:
                db.close()
    except Exception as exc:
        result["error"] = str(exc)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    Path(report_path).write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0 if result["passed"] else 1

"""Tiny static server for the video preview (binds 0.0.0.0 so the sandbox
proxy can reach it). Serves the project folder with byte-range support so the
<video> element can seek.

  python3 tools/longform/preview.py projects/cute-camera 8000
"""
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
TYPES = {
    ".html": "text/html; charset=utf-8", ".mp4": "video/mp4", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".png": "image/png", ".css": "text/css",
    ".js": "text/javascript", ".wav": "audio/wav", ".md": "text/plain; charset=utf-8",
}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _safe(self):
        p = os.path.normpath(self.path.split("?")[0])
        p = p.lstrip("/") or "index.html"
        full = os.path.abspath(os.path.join(ROOT, p))
        return full if full.startswith(ROOT) else None

    def do_GET(self):
        full = self._safe()
        if not full or not os.path.isfile(full):
            self.send_error(404, "not found")
            return
        size = os.path.getsize(full)
        ext = os.path.splitext(full)[1].lower()
        ctype = TYPES.get(ext, "application/octet-stream")
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        code = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                a, b = m.groups()
                if a:
                    start = int(a)
                if b:
                    end = min(int(b), size - 1)
                elif a:
                    end = size - 1
                code = 206
        length = max(0, end - start + 1)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-cache")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(full, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(262144, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def do_HEAD(self):
        full = self._safe()
        if not full or not os.path.isfile(full):
            self.send_error(404)
            return
        size = os.path.getsize(full)
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(size))
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"serving {ROOT} on 0.0.0.0:{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()

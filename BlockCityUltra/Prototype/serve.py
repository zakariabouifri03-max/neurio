#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Serve the BLOCK CITY ULTRA vertical slice.

    python3 serve.py            # http://0.0.0.0:8000
    python3 serve.py 8080       # custom port

Threaded + HTTP/1.1 + Range support, so the ~13 module files the game loads
all arrive in parallel instead of queueing behind each other (plain
`python3 -m http.server` is single-threaded and can stall here).
Kept as a copy so the Prototype folder is standalone.
"""
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")

MIME = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".ogg": "audio/ogg", ".txt": "text/plain; charset=utf-8",
}

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(BaseHTTPRequestHandler):
    root = ROOT
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    def _resolve(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        path = os.path.normpath(os.path.join(self.root, path.lstrip("/")))
        if not path.startswith(self.root):
            return None
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        return path if os.path.isfile(path) else None

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self._resolve()
        if not path:
            body = b"404 not found"
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        size = os.path.getsize(path)
        ctype = MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        start, end, partial = 0, size - 1, False
        rng = self.headers.get("Range")
        if rng:
            m = RANGE_RE.match(rng.strip())
            if m:
                partial = True
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:
                    start = max(0, size - int(m.group(2) or 0))
                end = min(end, size - 1)

        length = end - start + 1
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        if partial:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        if self.command == "HEAD":
            return

        remaining = length
        with open(path, "rb") as f:
            f.seek(start)
            while remaining > 0:
                chunk = f.read(min(262144, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("BLOCK CITY ULTRA — serving %s" % ROOT)
    print("  local:   http://localhost:%d/" % port)
    print("  network: http://<this-machine-ip>:%d/" % port)
    sys.stdout.flush()
    srv.serve_forever()


if __name__ == "__main__":
    main()

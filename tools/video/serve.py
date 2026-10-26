#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tiny static file server with HTTP Range support — so <video> can play and seek
without downloading the whole file first (python -m http.server cannot do that).

    python3 tools/video/serve.py            # serves the repo root on :8000
    python3 tools/video/serve.py 8080 .     # port, directory
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
    ".apk": "application/vnd.android.package-archive",
}


class Handler(BaseHTTPRequestHandler):
    root = os.getcwd()
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    # -- helpers ---------------------------------------------------------
    def _resolve(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        path = os.path.normpath(os.path.join(self.root, path.lstrip("/")))
        if not path.startswith(self.root):
            return None
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        return path if os.path.isfile(path) else None

    def _send(self, code, extra=None, body=b""):
        self.send_response(code)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    # -- verbs -----------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self._resolve()
        if not path:
            return self._send(404, {"Content-Type": "text/plain"}, b"404 not found")

        size = os.path.getsize(path)
        ctype = MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        partial = False
        if rng:
            m = RANGE_RE.match(rng.strip())
            if m:
                partial = True
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:                                # bytes=-N  (suffix)
                    start = max(0, size - int(m.group(2) or 0))
                end = min(end, size - 1)
                if start > end:
                    return self._send(416, {"Content-Range": "bytes */%d" % size})

        length = end - start + 1
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if partial:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Cache-Control", "no-store")
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
    root = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else ".")
    Handler.root = root
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("serving %s on http://0.0.0.0:%d  (video page: /video/)" % (root, port), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Cupcat — the montage as a PC app.

Starts a tiny local server on 127.0.0.1, opens the app in your browser and plays the
30-second Cupcat montage. Nothing leaves your PC.

    python main.py            # run the app
    python main.py --check    # self-test (used by CI), exits 0 when everything is in place
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import threading
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

MONTAGE_NAME = "cupcat-montage-30s.mp4"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_VIDEO_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "video"))
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")


def base_dir() -> str:
    # PyInstaller one-file builds unpack bundled files into sys._MEIPASS.
    return getattr(sys, "_MEIPASS", HERE)


def find_asset(name: str) -> Optional[str]:
    for folder in (base_dir(), os.path.join(HERE, "assets"), REPO_VIDEO_DIR):
        p = os.path.join(folder, name)
        if os.path.isfile(p):
            return p
    return None


ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/cupcat.png": ("cupcat.png", "image/png"),
    "/montage.mp4": (MONTAGE_NAME, "video/mp4"),
}


def make_handler():
    class Handler(BaseHTTPRequestHandler):
        server_version = "CupcatApp/1.0"

        def log_message(self, fmt, *args):
            if os.environ.get("CUPCAT_DEBUG"):
                super().log_message(fmt, *args)

        def _text(self, code: int, msg: str) -> None:
            body = msg.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _file(self, path: str, ctype: str) -> None:
            size = os.path.getsize(path)
            start, end, status = 0, size - 1, 200
            rng = self.headers.get("Range")
            if rng:  # byte ranges let the browser seek inside the video
                m = RANGE_RE.match(rng.strip())
                if m and (m.group(1) or m.group(2)):
                    if m.group(1):
                        start = int(m.group(1))
                        end = int(m.group(2)) if m.group(2) else size - 1
                    else:  # suffix range: last N bytes
                        start = max(0, size - int(m.group(2)))
                    end = min(end, size - 1)
                    if start > end or start >= size:
                        self.send_response(416)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                    status = 206
            length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                with open(path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                # the browser stopped reading (seek / page closed) — normal for video
                pass

        def do_GET(self):  # noqa: N802
            route = ROUTES.get(self.path.split("?", 1)[0])
            if route is None:
                self._text(404, "not found")
                return
            name, ctype = route
            path = find_asset(name)
            if path is None:
                self._text(500, f"missing file: {name}")
                return
            self._file(path, ctype)

    return Handler


def make_server(port: int = 8766, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    last: Optional[OSError] = None
    for p in range(port, port + 20):
        try:
            return ThreadingHTTPServer((host, p), make_handler())
        except OSError as exc:
            last = exc
    raise OSError(f"no free port between {port} and {port + 19}: {last}")


def check() -> int:
    """Self-test: the app's files exist and the server returns them."""
    problems = []
    for name in ("index.html", "cupcat.png", MONTAGE_NAME):
        if find_asset(name) is None:
            problems.append(f"missing {name}")
    if problems:
        print("FAIL:", "; ".join(problems))
        return 1
    srv = make_server(0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/", timeout=5) as r:
            assert r.status == 200 and b"Cupcat" in r.read()
        req = urllib.request.Request(base + "/montage.mp4", headers={"Range": "bytes=0-99"})
        with urllib.request.urlopen(req, timeout=5) as r:
            assert r.status == 206 and len(r.read()) == 100
        with urllib.request.urlopen(base + "/cupcat.png", timeout=5) as r:
            assert r.status == 200 and r.read(8).startswith(b"\x89PNG")
    except Exception as exc:  # noqa: BLE001
        print("FAIL:", exc)
        return 1
    finally:
        srv.shutdown()
        srv.server_close()
    print("OK: index, cupcat.png, montage.mp4 (range requests) all served")
    return 0


def run_app(port: int, open_browser: bool) -> int:
    srv = make_server(port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print("Cupcat is running.")
    print(f"  Open: {url}")
    print("  Keep this window open while you watch. Press Ctrl+C to quit.")
    if open_browser:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Cupcat montage app")
    p.add_argument("--check", action="store_true", help="self-test and exit")
    p.add_argument("--port", type=int, default=8766)
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)
    if args.check:
        return check()
    return run_app(args.port, not args.no_browser)


if __name__ == "__main__":
    sys.exit(main())

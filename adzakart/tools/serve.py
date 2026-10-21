#!/usr/bin/env python3
"""Development server for the storefront.

    python3 tools/serve.py            # port 8080, all interfaces
    python3 tools/serve.py --port 3000

Why not `python3 -m http.server`? Because that lets browsers keep old copies of
`app.js` / `index.html` in cache, so a change on disk can keep showing the old
store for hours. This server sends `Cache-Control: no-store` for HTML, JS and
CSS, so what you see is always what is on disk. Images are cached normally
because they are content-addressed by design id.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import os
import socketserver

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
NO_STORE = (".html", ".js", ".css", ".json", ".svg")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path.endswith(NO_STORE) or path in ("/", ""):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # keep the log readable: path + status only
        try:
            print(f"  {args[0]} {args[1]}")
        except Exception:
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the storefront with cache disabled.")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bind", default="0.0.0.0")
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=ROOT)
    with Server((args.bind, args.port), handler) as httpd:
        print(f"\n  adzakART store  ->  http://localhost:{args.port}")
        print(f"  serving {ROOT}")
        print("  HTML/JS/CSS are sent with no-store, so reloads always show the latest build.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped\n")


if __name__ == "__main__":
    main()

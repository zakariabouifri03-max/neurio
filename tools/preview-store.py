#!/usr/bin/env python3
"""Serve the storefront on a preview-friendly host with caching disabled."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8001)
args = parser.parse_args()
server = ThreadingHTTPServer(("0.0.0.0", args.port), partial(NoCacheHandler, directory=str(ROOT)))
print(f"Store preview serving {ROOT} on 0.0.0.0:{args.port}", flush=True)
server.serve_forever()

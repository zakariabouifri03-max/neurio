"""Tiny local web UI + JSON API. Binds to 127.0.0.1 only (this PC, not the network)."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

import engine

MAX_BODY = 64 * 1024


def base_dir() -> str:
    # PyInstaller one-file builds unpack bundled data into sys._MEIPASS.
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def make_handler():
    ui_path = os.path.join(base_dir(), "ui.html")

    class Handler(BaseHTTPRequestHandler):
        server_version = "OfflineCoder/1.0"

        def log_message(self, fmt, *args):  # keep the console quiet
            if os.environ.get("CODER_DEBUG"):
                super().log_message(fmt, *args)

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, payload: dict) -> None:
            self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def do_GET(self):  # noqa: N802
            if self.path in ("/", "/index.html"):
                with open(ui_path, "rb") as f:
                    self._send(200, f.read(), "text/html; charset=utf-8")
            elif self.path == "/api/status":
                models = engine.ollama_models()
                self._json(200, {
                    "templates": engine.available_templates(),
                    "ollama": models is not None,
                    "models": models or [],
                })
            else:
                self._json(404, {"ok": False, "message": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/api/generate":
                self._json(404, {"ok": False, "message": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                self._json(413, {"ok": False, "message": "request too large"})
                return
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                self._json(400, {"ok": False, "message": "invalid JSON"})
                return
            result = engine.generate(
                str(data.get("prompt", "")),
                backend=str(data.get("backend", "auto")),
                model=(str(data["model"]) if data.get("model") else None),
            )
            self._json(200, result.to_dict())

    return Handler


def make_server(port: int = 8765, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    """Bind to the first free port starting at `port` (up to 20 tries)."""
    last_err: Optional[OSError] = None
    for p in range(port, port + 20):
        try:
            return ThreadingHTTPServer((host, p), make_handler())
        except OSError as exc:
            last_err = exc
    raise OSError(f"no free port between {port} and {port + 19}: {last_err}")

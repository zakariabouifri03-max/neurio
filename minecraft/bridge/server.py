#!/usr/bin/env python3
"""
bridge/server.py — the "second screen" voice bridge (Windows-friendly, stdlib only)
===================================================================================
  python3 bridge/server.py                -> http://localhost:8787

What it gives you
-----------------
 * a companion web page (open it on your PC or phone on the same network):
     - a big MIC button: you SPEAK (Web Speech API, Moroccan Arabic ar-MA / ar-SA / fr / en)
     - the same villager brain as the game answers on the page, out loud (browser voice
       or a real edge-tts Moroccan voice if you pip-installed edge-tts)
     - a "send to Minecraft" button: it TYPES the transcript into Minecraft for you
       (as `/scriptevent neurio:say ...`) so the IN-GAME villager answers with his own voice
       -> full hands-free conversation: you talk, he talks.
 * optional LLM upgrade: if OPENAI_API_KEY (or OLLAMA) is configured, /api/llm lets the
   companion ask a real model, in the villager's persona.

Everything else (the in-game AI) needs no server at all — this is only for the mic/voice
comfort. Pure standard library; edge-tts is optional.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "addon", "behavior_pack", "scripts")
COMPANION = os.path.join(ROOT, "bridge", "companion")
PORT = int(os.environ.get("NEURIO_PORT", "8787"))
HOST = "0.0.0.0"

LLM_BASE = os.environ.get("NEURIO_LLM_BASE", "http://localhost:11434/v1")  # ollama default
LLM_KEY = os.environ.get("NEURIO_LLM_KEY") or os.environ.get("OPENAI_API_KEY", "")
LLM_MODEL = os.environ.get("NEURIO_LLM_MODEL", "llama3.1")


def have_edge_tts() -> bool:
    try:
        import edge_tts  # noqa: F401
        return True
    except Exception:
        return False


def tts_bytes(text: str, voice: str = "ar-MA-MounaNeural") -> bytes | None:
    if not have_edge_tts():
        return None
    import asyncio
    import edge_tts
    import tempfile

    async def go():
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            path = f.name
        await edge_tts.Communicate(text, voice).save(path)
        with open(path, "rb") as f:
            data = f.read()
        os.remove(path)
        return data

    try:
        return asyncio.run(go())
    except Exception as e:
        print("tts error:", e)
        return None


def llm(prompt: str, persona: str) -> str | None:
    if not LLM_KEY and "localhost" not in LLM_BASE and "127.0.0.1" not in LLM_BASE:
        return None
    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": persona},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.9,
        "max_tokens": 220,
    }).encode()
    req = urllib.request.Request(
        LLM_BASE.rstrip("/") + "/chat/completions", data=body,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {LLM_KEY}"} if LLM_KEY else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            j = json.load(r)
        return j["choices"][0]["message"]["content"]
    except Exception as e:
        print("llm error:", e)
        return None


# --------------------------------------------------------------------------- #
# Windows: type text into the focused window (Minecraft chat) — ctypes only
# --------------------------------------------------------------------------- #
def type_into_focused(text: str) -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        import time

        user32 = ctypes.windll.user32
        PUL = ctypes.POINTER(ctypes.c_ulong)

        class KeyBdInput(ctypes.Structure):
            _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort),
                        ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong),
                        ("dwExtraInfo", PUL)]

        class Input_I(ctypes.Union):
            _fields_ = [("ki", KeyBdInput), ("padding", ctypes.c_ubyte * 24)]

        class Input(ctypes.Structure):
            _fields_ = [("type", ctypes.c_ulong), ("ii", Input_I)]

        KEYEVENTF_UNICODE, KEYEVENTF_KEYUP = 0x0004, 0x0002
        INPUT_KEYBOARD = 1

        def send(ch, up=False):
            ii = Input_I()
            ii.ki = KeyBdInput(0, ord(ch), KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0), 0,
                               ctypes.pointer(ctypes.c_ulong(0)))
            user32.SendInput(1, ctypes.byref(Input(INPUT_KEYBOARD, ii)), ctypes.sizeof(Input))

        for ch in text:
            send(ch)
            send(ch, up=True)
            time.sleep(0.004)
        return True
    except Exception as e:
        print("type error:", e)
        return False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter
        print("[%s] %s" % (self.command, self.path))

    # ---- helpers ----
    def _send(self, code: int, data: bytes, ctype: str, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _read(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    # ---- routes ----
    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p in ("/", "/index.html"):
            with open(os.path.join(COMPANION, "index.html"), "rb") as f:
                return self._send(200, f.read(), "text/html; charset=utf-8")
        if p.startswith("/brain/"):
            name = os.path.basename(p)
            full = os.path.join(SCRIPTS, name)
            if os.path.exists(full) and name.endswith(".js"):
                with open(full, "rb") as f:
                    return self._send(200, f.read(), "text/javascript; charset=utf-8")
            return self._send(404, b"not found", "text/plain")
        if p == "/api/state":
            return self._json({
                "port": PORT, "platform": sys.platform,
                "edge_tts": have_edge_tts(),
                "llm": bool(LLM_KEY or "localhost" in LLM_BASE or "127.0.0.1" in LLM_BASE),
                "can_type": sys.platform == "win32",
            })
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/api/tts":
            body = self._read()
            data = tts_bytes(body.get("text", "")[:400], body.get("voice", "ar-MA-MounaNeural"))
            if data is None:
                return self._json({"error": "edge-tts not installed (pip install edge-tts) — the browser voice will be used"}, 501)
            return self._send(200, data, "audio/mpeg")
        if p == "/api/llm":
            body = self._read()
            out = llm(body.get("text", ""), body.get("persona", "You are a Moroccan villager in Minecraft. Answer in Moroccan Darija, short and warm."))
            return self._json({"text": out} if out else {"error": "no LLM configured"}, 200 if out else 501)
        if p == "/api/type":
            body = self._read()
            ok = type_into_focused(body.get("text", ""))
            return self._json({"ok": ok, "note": "" if ok else "typing is Windows-only; copy the text instead"})
        return self._send(404, b"not found", "text/plain")


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"""
  ⌬ Neurio voice bridge on http://localhost:{PORT}
     companion app      : open the link (same network works on your phone)
     real Darija TTS    : {'yes (edge-tts)' if have_edge_tts() else 'no  -> pip install edge-tts'}
     LLM upgrade        : {'yes' if (LLM_KEY or 'localhost' in LLM_BASE) else 'no  -> set NEURIO_LLM_BASE / OPENAI_API_KEY or run ollama'}
     type into game     : {'yes (Windows SendInput)' if sys.platform == 'win32' else 'no (Windows only)'}
""")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

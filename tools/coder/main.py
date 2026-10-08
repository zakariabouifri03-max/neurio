#!/usr/bin/env python3
"""Offline Coder — make games & apps as single HTML files, no API, no internet.

  python main.py                       # open the local web UI in your browser
  python main.py "snake game" -o snake.html
  python main.py "app dyal to-do" -o todo.html
  python main.py --list                # show what can be built offline

The Windows build (OfflineCoder.exe) does the same thing with no Python needed.
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser

import engine
import server


def cmd_list() -> int:
    print("Offline templates:")
    for t in engine.available_templates():
        print(f"  {t['key']:<12} {t['kind']:<5} {t['title']}")
    models = engine.ollama_models()
    print("\nLocal AI (Ollama): " + ("running — models: " + (", ".join(models) or "none")
                                     if models is not None else "not running (optional)"))
    return 0


def cmd_generate(prompt: str, out: str | None, backend: str, model: str | None) -> int:
    result = engine.generate(prompt, backend=backend, model=model)
    if not result.ok:
        print(result.message, file=sys.stderr)
        return 1
    path = out or f"{result.name}.html"
    with open(path, "w", encoding="utf-8") as f:
        f.write(result.html)
    print(f"{result.message}\nSaved: {os.path.abspath(path)}  (open it in any browser)")
    return 0


def cmd_gui(port: int, open_browser: bool) -> int:
    srv = server.make_server(port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print("Offline Coder is running.")
    print(f"  Open: {url}")
    print("  Keep this window open while you use it. Press Ctrl+C to quit.")
    if open_browser:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Offline Coder — games & apps without an API.")
    p.add_argument("prompt", nargs="*", help='what to build, e.g. "snake game" or "لعبة ثعبان"')
    p.add_argument("-o", "--out", help="output .html file (default: <name>.html)")
    p.add_argument("--backend", choices=["auto", "template", "ollama"], default="auto")
    p.add_argument("--model", help="Ollama model name (default: qwen2.5-coder:7b)")
    p.add_argument("--list", action="store_true", help="list offline templates and exit")
    p.add_argument("--port", type=int, default=8765, help="port for the web UI (default 8765)")
    p.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    args = p.parse_args(argv)

    if args.list:
        return cmd_list()
    if args.prompt:
        return cmd_generate(" ".join(args.prompt), args.out, args.backend, args.model)
    return cmd_gui(args.port, not args.no_browser)


if __name__ == "__main__":
    sys.exit(main())

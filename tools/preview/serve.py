#!/usr/bin/env python3
"""Montaj Pro — tiny static preview server for the single-file editor.

    python3 tools/preview/serve.py [port] [html-file]

Serves the built editor (editor/dist/montaj-pro.html) at / with no-store headers
so a reload always shows the newest build. Useful for a quick look in a real
browser without installing anything.
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
FILE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'editor', 'dist', 'montaj-pro.html')


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _send(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/', '/index.html', '/montaj-pro.html'):
            with open(FILE, 'rb') as fh:
                self._send(fh.read(), 'text/html; charset=utf-8')
        elif self.path == '/ping':
            self._send(b'ok', 'text/plain')
        else:
            self._send(b'not found', 'text/plain', 404)

    do_HEAD = do_GET

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    if not os.path.exists(FILE):
        sys.exit(f'missing {FILE} — run: node tools/editor/build.mjs')
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        print(f'Montaj Pro preview: http://0.0.0.0:{PORT}/  ({os.path.getsize(FILE) // 1024} KB)', flush=True)
        httpd.serve_forever()

#!/usr/bin/env python3
"""Static dev server with caching disabled (so browsers always get the latest JS/models)."""
import http.server, functools, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
H.extensions_map['.wasm'] = 'application/wasm'
os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', 3000))), H).serve_forever()

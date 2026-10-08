#!/usr/bin/env python3
# SOLARA BAY — PC Launcher (Windows/Linux) — opens the voxel open world in a window
import http.server, socketserver, webbrowser, threading, os, sys, pathlib, time, socket

PORT = 0  # 0 = random free port
GAME_DIR = pathlib.Path(__file__).parent
CANDIDATES = [GAME_DIR / "SolaraBay.html", GAME_DIR / "solara-bay" / "index.html", GAME_DIR / "index.html"]

# Find game file
game_file = None
for c in CANDIDATES:
    if c.exists():
        game_file = c
        break
if not game_file:
    print("❌ لم يتم العثور على ملف اللعبة SolaraBay.html")
    sys.exit(1)

# If single HTML, serve its dir
serve_dir = str(game_file.parent if game_file.name=="index.html" else GAME_DIR)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=serve_dir, **kwargs)
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy","same-origin")
        self.send_header("Cross-Origin-Embedder-Policy","credentialless")
        super().end_headers()

# Find free port
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.bind(("",0))
    PORT = s.getsockname()[1]

with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    url = f"http://127.0.0.1:{PORT}/{game_file.name}" if game_file.name.endswith(".html") and serve_dir!=str(game_file.parent) else f"http://127.0.0.1:{PORT}/" + (f"solara-bay/" if (GAME_DIR/"solara-bay").exists() else game_file.name)
    # For single file case, url is directly file
    if game_file.name=="SolaraBay.html":
        url = f"http://127.0.0.1:{PORT}/SolaraBay.html"
    elif game_file.name=="index.html" and "solara-bay" in str(game_file):
        url = f"http://127.0.0.1:{PORT}/solara-bay/"

    print(f"🌴 SOLARA BAY — سولارا باي")
    print(f"   المدينة تعمل على: {url}")
    print(f"   المجلد: {serve_dir}")
    print(f"   اضغط Ctrl+C للإغلاق")

    def open_browser():
        time.sleep(0.8)
        try:
            webbrowser.open(url)
        except: pass

    threading.Thread(target=open_browser, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 تم الإغلاق")

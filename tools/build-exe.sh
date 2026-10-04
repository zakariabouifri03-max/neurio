#!/bin/sh
# Builds StreamerLife2.exe (Windows x64) — NW.js "fusion" single executable.
# Needs the NW.js win-x64 sdk extracted at $NW_WIN (fetch via npm package
# @nwjs-binaries/win-x64, see README). The linux sdk at $NW_LNX is optional
# and used to smoke-test the app on real Chromium before packing.
set -e
cd "$(dirname "$0")/.."
NW_WIN=${NW_WIN:-/tmp/nw/win}
NW_LNX=${NW_LNX:-/tmp/nw/linux}
APP=build/exe-app

rm -rf "$APP" StreamerLife2.exe
mkdir -p "$APP"
cp streamer/index.html streamer/manifest.webmanifest "$APP"/
cp -r streamer/src streamer/vendor streamer/icons "$APP"/

cat > "$APP/package.json" <<'EOF'
{
  "name": "streamer-life-2",
  "main": "index.html",
  "version": "1.0.0",
  "window": {
    "title": "Streamer Life 2 — Cedar Creek",
    "icon": "icons/icon-192.png",
    "width": 1280,
    "height": 720,
    "position": "center"
  },
  "chromium-args": "--enable-unsafe-swiftshader --autoplay-policy=no-user-gesture-required"
}
EOF

# optional linux smoke test
if [ -x "$NW_LNX/nwjs-sdk-v0.87.0-linux-x64/nw" ] && [ "${SKIP_TEST:-0}" != "1" ]; then
  echo "▸ linux chromium smoke test"
  chmod +x "$NW_LNX/nwjs-sdk-v0.87.0-linux-x64/"* 2>/dev/null || true
  timeout 25 "$NW_LNX/nwjs-sdk-v0.87.0-linux-x64/nw" --headless=new --disable-gpu \
    --enable-logging=stderr --v=0 --dump-dom "$APP" > build/exe-dom.html 2> build/exe-log.txt || true
  grep -o 'id="errLog"[^<]*<\|⚠️[^<]*' build/exe-dom.html | head -3 || echo "  (no page errors in DOM)"
fi

echo "▸ packing app.zip"
python3 - "$APP" <<'EOF'
import sys, zipfile, os
app = sys.argv[1]
z = zipfile.ZipFile("build/app.zip", "w", zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(app):
    for f in files:
        p = os.path.join(root, f)
        z.write(p, os.path.relpath(p, app))
z.close()
print("app.zip:", round(os.path.getsize("build/app.zip") / 1e6, 1), "MB")
EOF

echo "▸ assembling Windows dist (sdk + package.nw + StreamerLife2.exe)"
DIST=build/win-dist
rm -rf "$DIST" StreamerLife2-win64.zip
cp -r "$NW_WIN"/nwjs-sdk-*-win-x64 "$DIST"
cp build/app.zip "$DIST/package.nw"
cp "$DIST/nw.exe" "$DIST/StreamerLife2.exe"
python3 - "$DIST" <<'EOF'
import sys, zipfile, os
dist = sys.argv[1]
z = zipfile.ZipFile("StreamerLife2-win64.zip", "w")
for root, _, files in os.walk(dist):
    for f in files:
        p = os.path.join(root, f)
        arc = os.path.relpath(p, dist)
        comp = zipfile.ZIP_DEFLATED if f.endswith((".html", ".js", ".json", ".pak", ".txt")) else zipfile.ZIP_STORED
        z.write(p, arc, comp)
z.close()
print("zip:", round(os.path.getsize("StreamerLife2-win64.zip") / 1e6, 1), "MB")
EOF
ls -la StreamerLife2-win64.zip
echo "✔ StreamerLife2-win64.zip built — extract & double-click StreamerLife2.exe"

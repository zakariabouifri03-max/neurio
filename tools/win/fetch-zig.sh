#!/usr/bin/env bash
# Montaj Pro — fetch a portable zig toolchain (used to cross-compile the Windows exe)
# zig ships as a normal PyPI wheel, which is just a zip: no installer, no root needed.
#   usage:  bash tools/win/fetch-zig.sh [destination]
#           ZIG=/path/to/zig bash tools/win/build-exe.sh
set -euo pipefail

DEST="${1:-/tmp/zig}"
mkdir -p "$DEST"

if [ -x "$DEST/ziglang/zig" ]; then
  echo "✓ zig already present: $DEST/ziglang/zig ($("$DEST/ziglang/zig" version 2>/dev/null || echo '?'))"
  exit 0
fi

echo "▸ resolving the latest ziglang wheel on PyPI"
python3 - "$DEST" <<'PY'
import json, sys, urllib.request, zipfile, io, os, platform

dest = sys.argv[1]
arch = platform.machine()
info = json.load(urllib.request.urlopen('https://pypi.org/pypi/ziglang/json'))
files = info['releases'][info['info']['version']]
pick = None
for f in files:
    name = f['filename']
    if not name.endswith('.whl'):
        continue
    if arch not in ('x86_64', 'AMD64') or 'x86_64' not in name:
        continue
    if 'manylinux' in name or 'linux' in name:
        pick = f
        break
if pick is None:
    sys.exit('no suitable ziglang wheel found (need a linux x86_64 build)')
print(f"  {pick['filename']} ({pick['size'] / 1048576:.0f} MB)")
blob = urllib.request.urlopen(pick['url']).read()
zipfile.ZipFile(io.BytesIO(blob)).extractall(dest)
os.chmod(os.path.join(dest, 'ziglang', 'zig'), 0o755)
PY

echo "✓ zig ready: $DEST/ziglang/zig — build with:"
echo "    ZIG=$DEST/ziglang/zig bash tools/win/build-exe.sh"

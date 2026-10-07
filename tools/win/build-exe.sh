#!/usr/bin/env bash
# Montaj Pro — build MontajPro-Windows.exe (single portable file, no installer)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ZIG="${ZIG:-/tmp/zig/ziglang/zig}"
cd "$ROOT"

echo "▸ bundling the editor"
node tools/editor/build.mjs >/dev/null

echo "▸ embedding app"
node tools/win/embed.mjs

if [ ! -x "$ZIG" ]; then
  echo "✗ zig not found at $ZIG — run tools/win/fetch-zig.sh or set ZIG=/path/to/zig" >&2
  exit 1
fi

echo "▸ compiling with zig ($($ZIG version))"
"$ZIG" rc /fo tools/win/montaj.res tools/win/montaj.rc
"$ZIG" cc -target x86_64-windows-gnu -O2 -o MontajPro-Windows.exe \
  tools/win/launcher.c tools/win/montaj.res \
  -Wl,--subsystem,windows -Wl,-e,mainCRTStartup \
  -lws2_32 -lole32 -lshell32 -luser32 -lgdi32

rm -f MontajPro-Windows.pdb
echo "✅ done: $ROOT/MontajPro-Windows.exe ($(du -h MontajPro-Windows.exe | cut -f1))"

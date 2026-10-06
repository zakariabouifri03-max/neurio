#!/bin/bash
# NEXUS GRAPHICS ENGINE - cross-compile to x86_64 Windows (GUI subsystem).
set -e
cd "$(dirname "$0")"
ZIG=${ZIG:-/home/user/.toolchain/zig/ziglang/zig}
PY=${PY:-/home/user/.toolchain/venv/bin/python3}
TGT=x86_64-windows-gnu
OUT=build
DIST=dist
mkdir -p "$OUT" "$DIST"

echo "== validating HLSL pipeline shaders =="
"$PY" tools/check_shaders.py

CC_OBJS=""
for f in src/json.cpp src/settings.cpp src/text.cpp src/bmp.cpp \
         src/capture.cpp src/engine.cpp src/platform.cpp src/ui.cpp \
         src/app.cpp src/main.cpp; do
    o="$OUT/$(basename "$f" | sed 's/\.[^.]*$/.o/')"
    echo "== compiling $f"
    "$ZIG" c++ -target "$TGT" -O2 -c "$f" -o "$o"
    CC_OBJS="$CC_OBJS $o"
done
echo "== compiling src/crt_gui.c"
"$ZIG" cc -target "$TGT" -O2 -c src/crt_gui.c -o "$OUT/crt_gui.o"

echo "== linking nexus.exe"
"$ZIG" build-exe -target "$TGT" --subsystem windows -O ReleaseFast \
    -femit-bin="$DIST/nexus.exe" \
    $CC_OBJS "$OUT/crt_gui.o" \
    -ld3d11 -ldxgi -lkernel32 -luser32 -lgdi32 -ladvapi32 \
    -ldwmapi -lpsapi -lcomdlg32 -lshlwapi -lsetupapi -lstdc++

echo "== done: $DIST/nexus.exe"

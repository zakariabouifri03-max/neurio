#!/usr/bin/env bash
# NEXUS GRAPHICS ENGINE - Windows exe cross-build (works on Linux via zig/clang+lld)
# Produces: release/NexusGraphicsEngine.exe
set -euo pipefail
cd "$(dirname "$0")"

OUT=release/NexusGraphicsEngine.exe
mkdir -p release

CXX="python3 -m ziglang c++"
TARGET="x86_64-windows-gnu"
FLAGS="-std=c++17 -O2 -municode -target $TARGET \
  -DUNICODE -D_UNICODE -DNOMINMAX -DWIN32_LEAN_AND_MEAN \
  -Isrc -Ithird_party/imgui -Ithird_party/imgui/backends \
  -Wno-nullability-completeness -fno-rtti \
  -s"

SRCS="src/main.cpp src/engine.cpp src/d3d.cpp src/config.cpp src/games.cpp \
 src/hwinfo.cpp src/perfmon.cpp src/overlay.cpp src/ui.cpp src/ui_tabs.cpp \
 src/generated/logo_embed.cpp src/generated/font_embed.cpp \
 third_party/imgui/imgui.cpp third_party/imgui/imgui_draw.cpp \
 third_party/imgui/imgui_tables.cpp third_party/imgui/imgui_widgets.cpp \
 third_party/imgui/backends/imgui_impl_win32.cpp \
 third_party/imgui/backends/imgui_impl_dx11.cpp"

LIBS="-ld3d11 -ldxgi -ld3dcompiler_47 -ldwmapi -lpdh -lgdiplus -limm32 \
 -lshell32 -lshlwapi -lcomdlg32 -lole32 -ladvapi32 -lgdi32 -luser32"

echo "[nexus] compiling..."
$CXX $FLAGS $SRCS -o "$OUT" $LIBS -static
echo "[nexus] built: $OUT"
ls -la "$OUT"

# embed PE resources (icon, manifest, version info)
python3 tools/add_resources.py "$OUT" assets/nexus.ico

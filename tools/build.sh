#!/usr/bin/env bash
# Cross-compile Piano Pro for Windows using Zig's bundled clang/mingw.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/dist"
mkdir -p "$OUT"

ZIG="${ZIG:-}"
if [[ -z "$ZIG" ]]; then
  if command -v zig >/dev/null 2>&1; then
    ZIG="zig"
  elif [[ -x /home/user/.venv-zig/bin/python3 ]]; then
    ZIG="/home/user/.venv-zig/bin/python3 -m ziglang"
  else
    echo "zig not found. Install ziglang (pip install ziglang) or zig."
    exit 1
  fi
fi

CXXFLAGS=(
  -target x86_64-windows-gnu
  -std=c++17
  -O2
  -g0
  -DNDEBUG
  -DUNICODE
  -D_UNICODE
  -ffast-math
  -I "${ROOT}/Source"
)

LIBS=(
  -luser32 -lgdi32 -lwinmm -lole32 -luuid -lcomdlg32 -lcomctl32
  -lshell32 -lshlwapi -ldwmapi -ladvapi32 -loleaut32 -lpropsys
  -static
)

SRCS=(
  "${ROOT}/Source/Main.cpp"
  "${ROOT}/Source/App.cpp"
  "${ROOT}/Source/PianoEngine.cpp"
  "${ROOT}/Source/PianoKeyboard.cpp"
  "${ROOT}/Source/AudioEngine.cpp"
  "${ROOT}/Source/MidiManager.cpp"
  "${ROOT}/Source/RecordingManager.cpp"
  "${ROOT}/Source/SettingsManager.cpp"
  "${ROOT}/Source/Synth.cpp"
)

echo "==> Compiling PianoPro.exe"
# shellcheck disable=SC2086
$ZIG c++ "${CXXFLAGS[@]}" "${SRCS[@]}" -o "${OUT}/PianoPro.exe" "${LIBS[@]}"

echo "==> Compiling PianoPro_Setup.exe"
$ZIG c++ "${CXXFLAGS[@]}" "${ROOT}/installer/Setup.cpp" -o "${OUT}/PianoPro_Setup.exe" \
  -luser32 -lgdi32 -lole32 -luuid -lshell32 -lshlwapi -ladvapi32 -lcomctl32 -loleaut32 -static

echo "==> Copying assets"
mkdir -p "${OUT}/assets/sounds" "${OUT}/assets/icons" "${OUT}/assets/presets"
cp -a "${ROOT}/assets/." "${OUT}/assets/" 2>/dev/null || true
cp -f "${ROOT}/README.md" "${OUT}/README.txt" 2>/dev/null || true

echo "Built:"
ls -lh "${OUT}/PianoPro.exe" "${OUT}/PianoPro_Setup.exe"
echo "Done."

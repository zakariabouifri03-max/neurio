#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT_BIN="$(command -v godot || command -v godot4 || true)"
[ -n "$GODOT_BIN" ] || { echo "Godot 4 is required (https://godotengine.org/download)" >&2; exit 127; }
mkdir -p build/windows
"$GODOT_BIN" --headless --path . --editor --quit
"$GODOT_BIN" --headless --path . --export-release "Windows Desktop" build/windows/ROADFALL.exe
echo "Windows build written to build/windows/ROADFALL.exe"

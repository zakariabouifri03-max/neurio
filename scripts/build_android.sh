#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT_BIN="$(command -v godot || command -v godot4 || true)"
[ -n "$GODOT_BIN" ] || { echo "Godot 4 is required (https://godotengine.org/download)" >&2; exit 127; }
format="${1:-apk}"
case "$format" in
  apk) preset="Android APK"; output="build/android/ROADFALL.apk" ;;
  aab) preset="Android AAB"; output="build/android/ROADFALL.aab" ;;
  *) echo "Usage: $0 [apk|aab]" >&2; exit 2 ;;
esac
mkdir -p build/android
"$GODOT_BIN" --headless --path . --editor --quit
"$GODOT_BIN" --headless --path . --export-release "$preset" "$output"
echo "Android $format written to $output"

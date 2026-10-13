#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/godot"
OUT="$PROJECT/build/BlockStrikeRoyale-debug.apk"

if ! command -v godot >/dev/null 2>&1; then
  echo "Godot 4 is required (not found on PATH)." >&2
  exit 2
fi
mkdir -p "$PROJECT/build"
godot --headless --path "$PROJECT" --editor --quit
godot --headless --path "$PROJECT" --export-debug "Android" "$OUT"
printf 'Wrote %s\n' "$OUT"

#!/usr/bin/env bash
# Neurio launcher — Linux / Mac
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

# Create venv if missing
if [ ! -d "$ROOT/venv" ]; then
  echo "▶ Creating venv..."
  python3 -m venv "$ROOT/venv"
fi

echo "▶ Activating venv..."
source "$ROOT/venv/bin/activate"

echo "▶ Installing deps (if needed)..."
pip install -q -r "$DIR/requirements.txt" || pip install -r "$DIR/requirements.txt" --break-system-packages 2>&1 | head

echo "▶ Launching Neurio Desktop..."
python "$DIR/main.py" "$@"

# Fallback to web if Qt fails
if [ $? -ne 0 ]; then
  echo "⚠ Desktop failed (maybe missing libGL) — launching Web demo at http://localhost:7860"
  python "$DIR/web_app.py"
fi

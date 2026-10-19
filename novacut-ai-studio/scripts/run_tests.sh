#!/usr/bin/env bash
# Headless test runner for Linux/macOS developers.
set -euo pipefail
cd "$(dirname "$0")/.."
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements-dev.txt
fi
exec .venv/bin/python -m pytest tests "$@"

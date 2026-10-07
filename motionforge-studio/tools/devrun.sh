#!/usr/bin/env bash
# Development/CI helper: run anything with the head-less Qt environment.
#
#   tools/devrun.sh tests/test_model.py
#   tools/devrun.sh -m pytest tests -q
#   tools/devrun.sh app/mfs/app.py --selftest
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
export QT_LOGGING_RULES="${QT_LOGGING_RULES:-qt.qpa.*=false}"
if [ -d "$ROOT/.devlibs" ]; then
  export LD_LIBRARY_PATH="$ROOT/.devlibs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export PYTHONPATH="$ROOT/app${PYTHONPATH:+:$PYTHONPATH}"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
exec "$PY" "$@"

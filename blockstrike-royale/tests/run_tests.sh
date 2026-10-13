#!/usr/bin/env bash
# Runs the BlockStrike Royale test suite headlessly.
#
# Usage:  tests/run_tests.sh /path/to/godot
# The Godot binary is not vendored with the project (see docs/BUILD.md); pass its
# path or put a `godot` executable on PATH.
set -euo pipefail
GODOT="${1:-godot}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$GODOT" --headless --path "$PROJECT_DIR" res://tests/tests.tscn

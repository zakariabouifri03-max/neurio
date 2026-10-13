#!/usr/bin/env bash
# Runs the headless Phase 1 test suites.
#
#   GODOT=/path/to/godot-4.7.2 tools/run_tests.sh
#
# Exit status is non-zero if any suite fails. Visual quality, touch feel and
# Android export are NOT covered by these headless tests.
set -uo pipefail
GODOT="${GODOT:-godot}"
cd "$(dirname "$0")/.."

status=0
"$GODOT" --headless --path . --import >/dev/null 2>&1
echo "== Unit and integration tests"
"$GODOT" --headless --path . --scene res://tests/run_tests.tscn || status=1
echo "== End-to-end flow test (title -> training -> pause -> menu)"
"$GODOT" --headless --path . --scene res://tests/run_flow_test.tscn || status=1
exit $status

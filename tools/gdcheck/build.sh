#!/usr/bin/env bash
# Builds ./gdcheck (GDScript syntax validator) against the tree-sitter runtime.
#
# Requires: gcc, and the toolchain prepared by tools/gdcheck/fetch_toolchain.sh
#   $TS_DIR/node_modules/tree-sitter/vendor/tree-sitter/lib  (runtime)
#   $TS_DIR/tree-sitter-gdscript/src/parser.c + scanner.c    (grammar)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_DIR="${TS_DIR:-$HOME/.cache/toolchain}"
RT="$TS_DIR/node_modules/tree-sitter/vendor/tree-sitter/lib"
GR="$TS_DIR/tree-sitter-gdscript/src"
for f in "$RT/src/lib.c" "$RT/include/tree_sitter/api.h" "$GR/parser.c" "$GR/scanner.c"; do
  [ -f "$f" ] || { echo "missing $f — run tools/gdcheck/fetch_toolchain.sh first" >&2; exit 1; }
done
gcc -O2 -std=c11 -w \
  -I"$RT/include" -I"$RT/src" -I"$GR" \
  "$HERE/gdcheck.c" "$RT/src/lib.c" "$GR/parser.c" "$GR/scanner.c" \
  -o "$HERE/gdcheck"
echo "built $HERE/gdcheck"

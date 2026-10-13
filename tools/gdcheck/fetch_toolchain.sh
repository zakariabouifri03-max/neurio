#!/usr/bin/env bash
# Fetches the third-party sources used by gdcheck (not vendored into the repo).
#   - tree-sitter runtime  (MIT, Max Brunsfeld)   via npm package "tree-sitter"
#   - tree-sitter-gdscript (MIT, Preston Knopp)   via git clone
set -euo pipefail
TS_DIR="${TS_DIR:-$HOME/.cache/toolchain}"
mkdir -p "$TS_DIR"
cd "$TS_DIR"
[ -d node_modules/tree-sitter ] || { npm init -y >/dev/null 2>&1 || true; npm i --no-audit --no-fund tree-sitter@0.21.1; }
[ -d tree-sitter-gdscript ] || git clone --depth 1 https://github.com/PrestonKnopp/tree-sitter-gdscript.git
echo "toolchain ready in $TS_DIR"

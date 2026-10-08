#!/usr/bin/env bash
# SwiftLoad — run every check that does not need a Rust toolchain.
#
# Usage:  bash scripts/check_all.sh
#
# 1. TypeScript type-check (tsc --noEmit)
# 2. production frontend build (vite)
# 3. Rust syntax   (tree-sitter, needs python3 -m venv .venv + tree-sitter)
# 4. Rust references (crate paths + associated items)
# 5. Rust <-> TypeScript contract (commands + event names)
#
# On Windows, `cargo test` replaces steps 3-5 with a real compiler, but these
# still run in seconds and catch drift early.

set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
elif [ -x "/tmp/tsenv/bin/python" ]; then
  PYTHON="/tmp/tsenv/bin/python"
fi

step() { printf '\n=== %s\n' "$1"; }

step "TypeScript"
npx tsc --noEmit

step "Frontend build"
npm run build

step "Rust syntax (tree-sitter)"
"$PYTHON" scripts/check_rust_syntax.py

step "Rust references"
"$PYTHON" scripts/check_rust_refs.py

step "Rust <-> TypeScript contract"
"$PYTHON" scripts/check_contracts.py

printf '\nAll checks passed.\n'

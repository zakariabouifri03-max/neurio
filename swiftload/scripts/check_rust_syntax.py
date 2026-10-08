#!/usr/bin/env python3
"""Syntax gate for the SwiftLoad Rust sources.

CI compiles the crate on Windows. This script exists for everything that runs
*before* a compiler is available (review machines, sandboxes without a Rust
toolchain): it parses every `.rs` file with the real `tree-sitter-rust` grammar
and fails on any `ERROR` or missing node, which is where unbalanced braces,
truncated expressions and broken string literals show up.

Usage:
    python3 scripts/check_rust_syntax.py [paths...]

Exit code 0 = every file parsed cleanly.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from tree_sitter import Language, Parser
    import tree_sitter_rust
except ImportError:  # pragma: no cover - developer feedback
    print("This script needs tree-sitter:  pip install tree-sitter tree-sitter-rust", file=sys.stderr)
    raise SystemExit(2)

RUST = Language(tree_sitter_rust.language())


def problem_nodes(root, source: bytes):
    """Yields (kind, start_byte, end_byte) for every broken node."""
    stack = [root]
    while stack:
        node = stack.pop()
        if node.type == "ERROR" or node.is_missing:
            yield node.type, node.start_byte, node.end_byte
        # `has_error` is set on every ancestor of a broken node.
        if node.has_error and not node.children:
            yield node.type, node.start_byte, node.end_byte
        stack.extend(node.children)


def check(path: Path) -> list[str]:
    source = path.read_bytes()
    parser = Parser(RUST)
    tree = parser.parse(source)
    problems = []
    for kind, start, end in problem_nodes(tree.root_node, source):
        line = source[:start].count(b"\n") + 1
        snippet = source[start : min(end, start + 60)].decode("utf8", "replace").replace("\n", "⏎")
        problems.append(f"  {path}:{line}: {kind}: {snippet!r}")
    return problems


def main(argv: list[str]) -> int:
    roots = [Path(arg) for arg in argv[1:]] or [Path("src-tauri/src"), Path("src-tauri/tests")]
    files: list[Path] = []
    for root in roots:
        if root.is_dir():
            files.extend(sorted(root.rglob("*.rs")))
        elif root.suffix == ".rs":
            files.append(root)

    if not files:
        print("no Rust files found", file=sys.stderr)
        return 2

    failures: list[str] = []
    for path in files:
        failures.extend(check(path))

    if failures:
        print(f"FAIL: {len(failures)} syntax problem(s) in {len(files)} file(s)")
        print("\n".join(failures))
        return 1

    print(f"ok: {len(files)} Rust file(s) parsed cleanly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

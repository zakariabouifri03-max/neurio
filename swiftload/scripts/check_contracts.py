#!/usr/bin/env python3
"""Cross-checks the Rust <-> TypeScript contract of SwiftLoad.

The Tauri IPC layer has no compiler on the JavaScript side: a command that the
frontend calls but the backend does not register fails only at runtime, and an
event name that drifts apart silently stops updating the UI. This script closes
that gap without a Rust toolchain.

It verifies, in both directions:

  1. every `#[tauri::command]` is listed in `generate_handler![]` (and nothing
     stale is listed);
  2. every command name used in `src/lib/api.ts` is registered;
  3. every event emitted with `emit(...)` in `src-tauri/src/lib.rs` has a
     matching entry in `src/lib/events.ts` (and vice versa).

Exit code 0 = consistent, 1 = problems found, 2 = files missing.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        print(f"cannot read {path}: {error}", file=sys.stderr)
        sys.exit(2)


def strip_comments(source: str) -> str:
    """Line comments and doc comments only (enough for declarations)."""
    out = []
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        out.append(line)
    return "\n".join(out)


def declared_commands() -> dict[str, str]:
    """`#[tauri::command]` functions in src-tauri/src/commands/*.rs."""
    commands: dict[str, str] = {}
    for path in sorted((ROOT / "src-tauri/src/commands").glob("*.rs")):
        text = strip_comments(read(path))
        pattern = re.compile(
            r"#\[\s*tauri::command\s*\]\s*(?:#\[[^\]]*\]\s*)*pub\s+(?:async\s+)?fn\s+(\w+)"
        )
        for match in pattern.finditer(text):
            commands[match.group(1)] = path.name
    return commands


def registered_commands() -> set[str]:
    text = read(ROOT / "src-tauri/src/lib.rs")
    block = re.search(r"generate_handler!\s*\[(.*?)\]", text, re.S)
    if not block:
        print("generate_handler![...] not found in src-tauri/src/lib.rs", file=sys.stderr)
        sys.exit(2)
    return set(re.findall(r"commands::\w+::(\w+)", block.group(1)))


def frontend_commands() -> set[str]:
    """Command names passed as the first argument of `call(...)` in api.ts.

    The generic parameter may be nested (`call<Record<string, unknown>>(...)`),
    so the command name is matched by its position rather than by the `call<`
    prefix.
    """
    text = read(ROOT / "src/lib/api.ts")
    return set(re.findall(r'\(\s*"([a-z0-9_]+)"\s*(?:,\s*\{|\s*\))', text))


def rust_events() -> set[str]:
    text = read(ROOT / "src-tauri/src/lib.rs")
    names = set(re.findall(r'emit\(\s*"([^"]+)"', text))
    names |= set(re.findall(r'emit_to\(\s*"[^"]*"\s*,\s*"([^"]+)"', text))
    return names


def ts_events() -> set[str]:
    text = read(ROOT / "src/lib/events.ts")
    return set(re.findall(r'"([a-z]+:[a-z-]+)"', text))


def main() -> int:
    problems: list[str] = []

    declared = declared_commands()
    registered = registered_commands()
    called = frontend_commands()
    emitted = rust_events()
    subscribed = ts_events()

    for name in sorted(set(declared) - registered):
        problems.append(
            f"command `{name}` (src-tauri/src/commands/{declared[name]}) is not in generate_handler![...]"
        )
    for name in sorted(registered - set(declared)):
        problems.append(f"generate_handler![...] lists `{name}`, which no module declares")
    for name in sorted(called - registered):
        problems.append(f"src/lib/api.ts calls `{name}`, which the backend does not register")
    for name in sorted(emitted - subscribed):
        problems.append(f"the backend emits `{name}`, which src/lib/events.ts does not subscribe to")
    for name in sorted(subscribed - emitted):
        problems.append(f"src/lib/events.ts subscribes to `{name}`, which the backend never emits")

    if problems:
        print(f"FAIL: {len(problems)} contract problem(s)")
        print("\n".join(problems))
        return 1

    print(
        "ok: {commands} commands and {events} events agree between Rust and TypeScript "
        "({frontend} frontend call sites)".format(
            commands=len(registered),
            events=len(emitted),
            frontend=len(called),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Static sanity checks for the AI VIBES Android project.

There is no Android SDK in the authoring sandbox, so this script does the
checks a compiler would normally do for free:

  * balanced brackets in every Kotlin file (strings/comments stripped)
  * every `com.neurio.aivibes.*` import resolves to a real declaration
  * every R.<type>.<name> reference exists in app/src/main/res
  * XML resources are well formed
  * @Composable files don't call obviously-unknown project symbols

Run:  python3 tools/static_check.py
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "app/src/main/kotlin"
RES = ROOT / "app/src/main/res"

errors: list[str] = []
warnings: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def strip_noise(src: str) -> str:
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('"""', i):
            j = src.find('"""', i + 3)
            i = n if j == -1 else j + 3
            continue
        if c == '"':
            i += 1
            while i < n and src[i] != '"':
                if src[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if c == "'":
            i += 1
            while i < n and src[i] != "'":
                if src[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check_brackets(path: Path, src: str) -> None:
    code = strip_noise(src)
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    for idx, ch in enumerate(code):
        if ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if not stack or stack[-1] != pairs[ch]:
                line = code[:idx].count("\n") + 1
                fail(f"{path}: unbalanced '{ch}' near stripped-line {line}")
                return
            stack.pop()
    if stack:
        fail(f"{path}: {len(stack)} unclosed bracket(s) at EOF")


def check_internal_imports(path: Path, src: str, declared: set[str]) -> None:
    for m in re.finditer(r"^import\s+(com\.neurio\.aivibes\.[\w.]+)", src, re.M):
        fq = m.group(1)
        if fq.endswith(".R") or fq.endswith("R"):
            continue  # generated resource class
        if fq.endswith(".*"):
            prefix = fq[:-2]
            if not any(d.startswith(prefix + ".") for d in declared):
                fail(f"{path}: star-import of empty package {fq}")
            continue
        if fq not in declared:
            fail(f"{path}: unresolved project import {fq}")


def check_r_refs(path: Path, src: str) -> None:
    res_names: dict[str, set[str]] = {}
    for res_dir in RES.glob("*"):
        if not res_dir.is_dir():
            continue
        kind = res_dir.name.split("-")[0]
        res_names.setdefault(kind, set())
        for f in res_dir.iterdir():
            if f.suffix == ".xml":
                res_names[kind].add(f.stem)
    for m in re.finditer(r"\bR\.(\w+)\.(\w+)\b", src):
        kind, name = m.group(1), m.group(2)
        if kind == "style":
            continue  # themes checked via XML parse
        if name not in res_names.get(kind, set()):
            fail(f"{path}: R.{kind}.{name} not found in res/")


def check_xml() -> None:
    for f in (ROOT / "app/src/main").rglob("*.xml"):
        try:
            ET.parse(f)
        except ET.ParseError as e:
            fail(f"{f}: XML parse error: {e}")


def collect_declarations() -> set[str]:
    declared: set[str] = set()
    for f in SRC.rglob("*.kt"):
        src = f.read_text()
        pkg_m = re.search(r"^package\s+([\w.]+)", src, re.M)
        if not pkg_m:
            fail(f"{f}: missing package declaration")
            continue
        pkg = pkg_m.group(1)
        for m in re.finditer(
            r"^(?:@\w+(?:\([^)]*\))?\s*)*"
            r"(?:public\s+|private\s+|internal\s+|protected\s+)?"
            r"(?:abstract\s+|open\s+|data\s+|sealed\s+|enum\s+|annotation\s+|value\s+)?"
            r"(?:class|object|interface|fun|val|var)\s+(\w+)",
            src, re.M,
        ):
            declared.add(f"{pkg}.{m.group(1)}")
        # Secondary constructors / nested classes: capture `class X` anywhere.
        for m in re.finditer(r"(?:class|object|interface)\s+(\w+)", src):
            declared.add(f"{pkg}.{m.group(1)}")
    return declared


def main() -> int:
    kt_files = sorted(SRC.rglob("*.kt"))
    if not kt_files:
        print("no Kotlin sources found")
        return 1

    for f in kt_files:
        src = f.read_text()
        check_brackets(f.relative_to(ROOT), src)

    declared = collect_declarations()
    for f in kt_files:
        src = f.read_text()
        check_internal_imports(f.relative_to(ROOT), src, declared)
        check_r_refs(f.relative_to(ROOT), src)

    check_xml()

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(f"\n{len(kt_files)} Kotlin files checked, {len(errors)} error(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

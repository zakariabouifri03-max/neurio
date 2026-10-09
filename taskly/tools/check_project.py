#!/usr/bin/env python3
"""Static sanity checks for the Taskly Flutter project.

Runs without a Flutter SDK so CI (or this sandbox) can still catch structural
problems: unbalanced braces/parens in Dart sources, forbidden placeholder
markers, missing pubspec assets, unused-looking local imports and a file
inventory. Exit code 0 = all checks passed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "lib"
TEST = ROOT / "test"

FAILURES: list[str] = []
WARNINGS: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        FAILURES.append(message)


def dart_files() -> list[Path]:
    return sorted(list(LIB.rglob("*.dart")) + list(TEST.rglob("*.dart")) +
                  list((ROOT / "integration_test").rglob("*.dart")))


def strip_dart_noise(source: str) -> str:
    """Remove comments and string literals so brace counting is honest."""
    source = re.sub(r"///.*", "", source)
    source = re.sub(r"//.*", "", source)
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    source = re.sub(r"'''(?:.|\n)*?'''", "''", source)
    source = re.sub(r'"""(?:.|\n)*?"""', '""', source)
    source = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", source)
    source = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', source)
    return source


def check_balance() -> None:
    for path in dart_files():
        cleaned = strip_dart_noise(path.read_text(encoding="utf-8"))
        for open_char, close_char in (("{", "}"), ("(", ")"), ("[", "]")):
            if cleaned.count(open_char) != cleaned.count(close_char):
                FAILURES.append(
                    f"{path.relative_to(ROOT)}: unbalanced "
                    f"{open_char}{close_char} "
                    f"({cleaned.count(open_char)} vs {cleaned.count(close_char)})")


def check_no_placeholders() -> None:
    bad = re.compile(r"\b(TODO|FIXME|XXX|placeholder|not implemented|UnimplementedError)\b",
                     re.I)
    for path in dart_files():
        for lineno, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), 1):
            if bad.search(line):
                FAILURES.append(
                    f"{path.relative_to(ROOT)}:{lineno}: placeholder marker: {line.strip()}")


def check_assets_declared() -> None:
    pubspec = (ROOT / "pubspec.yaml").read_text(encoding="utf-8")
    fonts = re.findall(r"asset:\s*(\S+)", pubspec)
    for asset in fonts:
        if not (ROOT / asset).exists():
            FAILURES.append(f"pubspec references missing asset: {asset}")


def check_imports_resolve() -> None:
    """Every relative import must point at an existing file."""
    for path in dart_files():
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"import\s+'([^']+)'", text):
            target = match.group(1)
            if target.startswith("package:") or target.startswith("dart:"):
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.exists():
                FAILURES.append(
                    f"{path.relative_to(ROOT)}: broken import {target}")


def check_package_imports_declared() -> None:
    pubspec = (ROOT / "pubspec.yaml").read_text(encoding="utf-8")
    deps: set[str] = set()
    for section in ("dependencies:", "dev_dependencies:"):
        if section not in pubspec:
            continue
        body = pubspec.split(section, 1)[1]
        # Stop at the next top-level key.
        body = body.split("\nflutter:", 1)[0]
        for line in body.splitlines():
            match = re.match(r"^  ([a-z0-9_]+):", line)
            if match:
                deps.add(match.group(1))
    deps |= {"flutter", "flutter_test", "integration_test"}
    for path in dart_files():
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"import\s+'package:([a-z0-9_]+)/", text):
            package = match.group(1)
            if package != "taskly" and package not in deps:
                FAILURES.append(
                    f"{path.relative_to(ROOT)}: uses undeclared package '{package}'")


def check_required_files() -> None:
    required = [
        "pubspec.yaml",
        "analysis_options.yaml",
        "lib/main.dart",
        "lib/app.dart",
        "android/app/build.gradle",
        "android/app/src/main/AndroidManifest.xml",
        "android/gradle/wrapper/gradle-wrapper.jar",
        "android/gradlew",
        "assets/fonts/Nunito-Regular.ttf",
        "assets/fonts/OFL.txt",
        "assets/branding/play_store_icon_512.png",
        "docs/RELEASE.md",
        "docs/PLAY_STORE_LISTING.md",
        "docs/PRIVACY_POLICY.md",
        "docs/TESTING_REPORT.md",
        "README.md",
    ]
    for relative in required:
        if not (ROOT / relative).exists():
            FAILURES.append(f"missing required file: {relative}")


def check_screens_have_actions() -> None:
    """Every InkWell/TextButton/GestureDetector onTap should reference a
    callback (no empty bodies)."""
    empty = re.compile(r"onTap:\s*\(\)\s*=>\s*\{\s*\},")
    for path in dart_files():
        if empty.search(path.read_text(encoding="utf-8")):
            FAILURES.append(f"{path.relative_to(ROOT)}: empty onTap handler")


def main() -> int:
    if not LIB.exists():
        print("lib/ not found — run from the taskly project root")
        return 1
    check_balance()
    check_no_placeholders()
    check_assets_declared()
    check_imports_resolve()
    check_package_imports_declared()
    check_required_files()
    check_screens_have_actions()

    files = dart_files()
    lines = sum(len(p.read_text(encoding="utf-8").splitlines()) for p in files)
    print(f"Dart files: {len(files)} | lines: {lines}")
    for warning in WARNINGS:
        print(f"warning: {warning}")
    if FAILURES:
        print(f"\n{len(FAILURES)} problem(s):")
        for failure in FAILURES:
            print(" -", failure)
        return 1
    print("All static checks passed ✔")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Static sanity checks for the Neurio Android project.

There is no JDK / Android SDK in this sandbox, so this script does the checks a
compiler would normally do for free:
  * balanced brackets in every Kotlin file
  * every `com.neurio.lanstream.*` import / FQN reference resolves to a real
    declaration in the project
  * every R.<type>.<name> reference exists in res/
  * XML files are well formed
  * Gradle files reference existing plugin / dependency coordinates (eyeball list)
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


# --------------------------------------------------------------------------- #
# 1. Kotlin bracket balance (ignoring strings / chars / comments)
# --------------------------------------------------------------------------- #
def strip_noise(src: str) -> str:
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"' and not (i >= 2 and src[i - 1] == '\\'):
            # raw / normal string
            if src.startswith('"""', i):
                j = src.find('"""', i + 3)
                i = n if j == -1 else j + 3
                continue
            i += 1
            while i < n and src[i] != '"':
                if src[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if c == "'":
            i += 1
            while i < n and src[i] != "'":
                if src[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check_brackets(path: Path, src: str) -> None:
    clean = strip_noise(src)
    pairs = {')': '(', ']': '[', '}': '{'}
    stack: list[tuple[str, int]] = []
    line = 1
    for idx, ch in enumerate(clean):
        if ch == "\n":
            line += 1
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack:
                fail(f"{path.relative_to(ROOT)}:{line}: unmatched closing '{ch}'")
                return
            open_ch, open_line = stack.pop()
            if open_ch != pairs[ch]:
                fail(
                    f"{path.relative_to(ROOT)}:{line}: '{ch}' closes '{open_ch}' "
                    f"opened at line {open_line}"
                )
                return
    if stack:
        ch, line = stack[-1]
        fail(f"{path.relative_to(ROOT)}:{line}: unclosed '{ch}'")


# --------------------------------------------------------------------------- #
# 2. Project symbol table
# --------------------------------------------------------------------------- #
DECL_RE = re.compile(
    r"^\s*(?:(?:public|internal|private|protected|open|final|data|sealed|abstract|inline|value|expect)\s+)*"
    r"(class|object|interface|enum\s+class|fun|val|var|typealias)\s+([^\n{:(=]+)",
    re.MULTILINE,
)


def package_of(src: str) -> str:
    m = re.search(r"^package\s+([\w.]+)", src, re.MULTILINE)
    return m.group(1) if m else ""


def build_symbols() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """package -> declared names, and package -> subpackage names."""
    symbols: dict[str, set[str]] = {}
    packages: dict[str, set[str]] = {}
    for path in SRC.rglob("*.kt"):
        src = path.read_text()
        pkg = package_of(src)
        symbols.setdefault(pkg, set())
        names = symbols[pkg]
        for kind, tail in DECL_RE.findall(src):
            for name in re.findall(r"[A-Za-z_]\w*", tail):
                names.add(name)
        # companion / nested members
        for match in re.finditer(r"^\s+(?:const\s+)?(?:val|var|fun)\s+([^\n{:(=]+)", src, re.MULTILINE):
            for name in re.findall(r"[A-Za-z_]\w*", match.group(1)):
                names.add(name)
        parts = pkg.split(".")
        for i in range(1, len(parts)):
            parent = ".".join(parts[:i])
            packages.setdefault(parent, set()).add(parts[i])
    return symbols, packages


def check_project_references(symbols: dict[str, set[str]], packages: dict[str, set[str]]) -> None:
    project_pkgs = set(symbols)
    for path in SRC.rglob("*.kt"):
        src = path.read_text()
        lines = src.splitlines()
        for no, line in enumerate(lines, start=1):
            for match in re.finditer(r"com\.neurio\.lanstream([\w.]*)", line):
                fqn = match.group(1).strip(".").split(".")
                if not fqn or not fqn[0]:
                    continue
                if fqn[0] in ("R", "BuildConfig"):
                    continue
                # An identifier that starts with a capital letter is a class:
                # everything before it is the package.
                idx = next((i for i, seg in enumerate(fqn) if seg[:1].isupper()), len(fqn))
                pkg = "com.neurio.lanstream" + ("." + ".".join(fqn[:idx]) if idx else "")
                rest = fqn[idx:]
                if pkg not in project_pkgs:
                    # Either a lowercase member (top level extension property) or
                    # an Intent action string like com.neurio.lanstream.host.START.
                    if any(seg.isupper() for seg in fqn[1:]):
                        continue
                    if len(fqn) >= 2:
                        pkg = "com.neurio.lanstream." + ".".join(fqn[:-1])
                        rest = [fqn[-1]]
                if pkg not in project_pkgs:
                    fail(f"{path.relative_to(ROOT)}:{no}: unknown package {pkg}")
                    continue
                if rest:
                    name = rest[0]
                    if name not in symbols.get(pkg, set()) and name not in packages.get(pkg, set()):
                        fail(f"{path.relative_to(ROOT)}:{no}: '{name}' not declared in {pkg}")
                continue



# --------------------------------------------------------------------------- #
# 3. Android resources
# --------------------------------------------------------------------------- #
def collect_resources() -> dict[str, set[str]]:
    res: dict[str, set[str]] = {}
    for path in RES.rglob("*.xml"):
        try:
            tree = ET.parse(path)
        except ET.ParseError as exc:
            fail(f"{path.relative_to(ROOT)}: malformed XML: {exc}")
            continue
        root = tree.getroot()
        for node in root.iter():
            name = node.attrib.get("name")
            if not name:
                continue
            kind = node.tag if root.tag == "resources" else root.tag
            res.setdefault(kind, set()).add(name)
    for path in RES.rglob("*"):
        if path.is_file() and path.suffix in {".png", ".jpg", ".webp", ".xml"}:
            if "drawable" in path.parent.name or "mipmap" in path.parent.name:
                res.setdefault(path.parent.name.split("-")[0], set()).add(path.stem)
    return res


RESOURCE_KIND = {
    "string": "string",
    "drawable": "drawable",
    "mipmap": "mipmap",
    "color": "color",
    "style": "style",
    "dimen": "dimen",
    "xml": "xml",
    "array": "array",
    "plurals": "plurals",
}


def check_resource_references(resources: dict[str, set[str]]) -> None:
    for path in list(SRC.rglob("*.kt")) + [ROOT / "app/src/main/AndroidManifest.xml"]:
        src = path.read_text()
        for match in re.finditer(r"\bR\.(\w+)\.(\w+)", src):
            kind, name = match.group(1), match.group(2)
            if kind == "string" and name == "string":
                continue
            if kind not in resources:
                fail(f"{path.relative_to(ROOT)}: unknown resource type R.{kind}")
                continue
            if name not in resources[kind]:
                fail(f"{path.relative_to(ROOT)}: missing resource R.{kind}.{name}")
    # manifest / xml references
    for path in list((RES).rglob("*.xml")) + [ROOT / "app/src/main/AndroidManifest.xml"]:
        src = path.read_text()
        for match in re.finditer(r"@(android:)?(\w+)/([\w.]+)", src):
            framework, kind, name = match.group(1), match.group(2), match.group(3)
            if framework:
                continue
            if kind in RESOURCE_KIND and kind in resources:
                if name not in resources[kind]:
                    fail(f"{path.relative_to(ROOT)}: missing @{kind}/{name}")


# --------------------------------------------------------------------------- #
# 4. Gradle sanity
# --------------------------------------------------------------------------- #
KNOWN_ARTIFACTS = {
    "androidx.core:core-ktx",
    "androidx.activity:activity-compose",
    "androidx.lifecycle:lifecycle-runtime-ktx",
    "androidx.lifecycle:lifecycle-service",
    "androidx.lifecycle:lifecycle-viewmodel-ktx",
    "androidx.compose.ui:ui",
    "androidx.compose.ui:ui-tooling-preview",
    "androidx.compose.ui:ui-util",
    "androidx.compose.ui:ui-tooling",
    "androidx.compose.material3:material3",
    "androidx.compose.material:material-icons-extended",
    "org.jetbrains.kotlinx:kotlinx-coroutines-core",
    "org.jetbrains.kotlinx:kotlinx-coroutines-android",
    "junit:junit",
}

VERSION_RE = re.compile(r"\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.\-]+)?")


def check_gradle() -> None:
    for name in ("build.gradle.kts", "app/build.gradle.kts", "settings.gradle.kts"):
        path = ROOT / name
        if not path.exists():
            fail(f"missing {name}")
            continue
        src = path.read_text()
        check_brackets(path, src)
        for match in re.finditer(r"([\w.\-]+:[\w.\-]+):([\w.\-+]+)", src):
            artifact = match.group(1)
            version = match.group(2)
            if artifact in KNOWN_ARTIFACTS:
                if not VERSION_RE.fullmatch(version):
                    fail(f"{name}: suspicious version '{version}' for {artifact}")
        for match in re.finditer(r"id\(\"([^\"]+)\"\)\s+version\s+\"([^\"]+)\"", src):
            plugin, version = match.group(1), match.group(2)
            if not VERSION_RE.fullmatch(version):
                fail(f"{name}: suspicious plugin version '{version}' for {plugin}")
        for match in re.finditer(r"([\w.\-]+:[\w.\-]+):([\w.\-+]+)", src):
            if match.group(1) not in KNOWN_ARTIFACTS:
                warn(f"{name}: dependency not in the known-good list: {match.group(1)}")


# --------------------------------------------------------------------------- #
# 5. Manifest sanity
# --------------------------------------------------------------------------- #
def check_manifest() -> None:
    path = ROOT / "app/src/main/AndroidManifest.xml"
    tree = ET.parse(path)
    root = tree.getroot()
    ns = "{http://schemas.android.com/apk/res/android}"
    app = root.find("application")
    if app is None:
        fail("manifest: no <application>")
        return
    activities = [a.get(f"{ns}name") for a in root.iter("activity")]
    services = [s.get(f"{ns}name") for s in app.iter("service")]
    for cls in activities + services:
        if not cls:
            continue
        relative = cls.lstrip(".").replace(".", "/")
        candidates = [
            SRC / f"{relative}.kt",
            SRC / f"com/neurio/lanstream/{relative}.kt",
        ]
        if not any(c.exists() for c in candidates):
            fail(f"manifest: {cls} has no matching Kotlin file")


# --------------------------------------------------------------------------- #
def main() -> int:
    for path in SRC.rglob("*.kt"):
        check_brackets(path, path.read_text())

    symbols, packages = build_symbols()
    check_project_references(symbols, packages)
    resources = collect_resources()
    check_resource_references(resources)
    check_gradle()
    check_manifest()

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(f"\n{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

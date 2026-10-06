#!/usr/bin/env python3
"""Best-effort call-site check: verifies that method calls on project-typed
variables actually exist on the declared type."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "app/src/main/kotlin"

# type -> {method names}
methods: dict[str, set[str]] = {}
# file -> {var name -> type}
locals_by_file: dict[Path, dict[str, str]] = {}

DECL_KIND = re.compile(
    r"^\s*(?:(?:public|internal|private|protected|open|final|data|sealed|abstract|inline|value|expect)\s+)*"
    r"(class|object|interface|enum class)\s+([A-Za-z_]\w*)",
    re.MULTILINE,
)

TYPE_DECL = re.compile(
    r"(?:private|internal|protected|public)?\s*(?:@\w+\s*)?"
    r"(?:val|var|lateinit var)\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.<>?,\s\[\]()]*?)\s*(?:=|$|\{)",
    re.MULTILINE,
)

INIT_DECL = re.compile(
    r"(?:private|internal|protected|public)?\s*(?:val|var)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\(",
    re.MULTILINE,
)

METHOD_RE = re.compile(r"^\s{4}(?:override\s+|suspend\s+|private\s+|internal\s+|protected\s+|open\s+)*fun\s+([A-Za-z_]\w*)", re.MULTILINE)
TOP_METHOD_RE = re.compile(r"^\s{0,4}(?:inline\s+|suspend\s+|private\s+|internal\s+|override\s+)*fun\s+([A-Za-z_]\w*)", re.MULTILINE)

for path in SRC.rglob("*.kt"):
    src = path.read_text()
    # class methods
    for kind, name in DECL_KIND.findall(src):
        methods.setdefault(name, set())
    # attach top-level functions declared anywhere in the file to every class in
    # the file (approximation, but catches typos on our own types)
    top = set(TOP_METHOD_RE.findall(src))
    for kind, name in DECL_KIND.findall(src):
        methods[name].update(top)

# per-class method bodies: any "fun" indented by >= 4 inside the class counts
for path in SRC.rglob("*.kt"):
    src = path.read_text()
    current: list[str] = []
    for line in src.splitlines():
        m = DECL_KIND.match(line)
        if m:
            current.append(m.group(2))
            continue
        m2 = re.match(
            r"^\s{4,}(?:override\s+|suspend\s+|private\s+|internal\s+|protected\s+|open\s+|inline\s+)*"
            r"fun\s+([A-Za-z_]\w*)",
            line,
        )
        if m2 and current:
            methods.setdefault(current[-1], set()).add(m2.group(1))

errors: list[str] = []

for path in SRC.rglob("*.kt"):
    src = path.read_text()
    declared: dict[str, str] = {}
    for name, typ in TYPE_DECL.findall(src):
        base = typ.strip().rstrip("?").split("<")[0].split("(")[0].split(".")[-1].strip()
        declared[name] = base
    for name, typ in INIT_DECL.findall(src):
        declared.setdefault(name, typ)
    # parameter types: "foo: Bar" inside signatures
    for match in re.finditer(r"\(([^)]*)\)", src):
        for part in match.group(1).split(","):
            if ":" in part:
                n, t = part.split(":", 1)
                n = n.strip()
                t = t.strip().rstrip("?").split("<")[0].strip()
                if re.fullmatch(r"[A-Za-z_]\w*", n) and re.fullmatch(r"[A-Za-z_]\w*", t):
                    declared.setdefault(n, t)
    for no, line in enumerate(src.splitlines(), start=1):
        for match in re.finditer(r"\b([a-z]\w*)\.([a-zA-Z_]\w*)\(", line):
            var, method = match.group(1), match.group(2)
            typ = declared.get(var)
            if not typ or typ not in methods:
                continue
            if method in methods[typ]:
                continue
            # allow stdlib-ish / generic names
            if method in {"toString", "hashCode", "equals", "copy", "invoke", "get", "plus"}:
                continue
            errors.append(
                f"{path.relative_to(ROOT)}:{no}: '{var}.{method}()' — {typ} has no such method"
            )

for e in errors:
    print(f"CHECK {e}")
print(f"\n{len(errors)} possible issues (manual review required)")

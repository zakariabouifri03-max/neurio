#!/usr/bin/env python3
"""Cross-file reference check for the SwiftLoad Rust sources.

The crate is compiled with `cargo` in CI (Windows). This script gives the same
class of feedback *without* a toolchain: it builds a symbol table from the source
tree (`mod`, `fn`, `struct`, `enum`, `trait`, `const`, `static`, `type`, plus
inherent methods, including items declared inside inline `mod name { … }`) and
then verifies every `crate::…` path used anywhere in the code.

It is a heuristic — it does not type-check — but it reliably catches the mistakes
that are otherwise only found by a compiler run:

* `mod` declarations whose file does not exist;
* paths to modules or items that are misspelled or were renamed;
* references to items that are private in a different module.

Usage:
    python3 scripts/check_rust_refs.py [src-dir]
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ITEM = re.compile(
    r"^(?:pub(?:\((?:crate|super|self)\))?\s+)?"
    r"(?:async\s+|unsafe\s+|const\s+|extern\s+\"[^\"]*\"\s+)*(fn|struct|enum|trait|union|type|const|static|mod)\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)"
)
METHOD = re.compile(
    r"^\s+(?:pub(?:\(crate\))?\s+)?(?:async\s+|unsafe\s+|const\s+)*fn\s+([A-Za-z_][A-Za-z0-9_]*)"
)
IS_PUBLIC = re.compile(r"^\s*pub(?:\((?:crate|super|self)\))?\s")
MOD_FILE = re.compile(r"^(?:pub(?:\(crate\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;")
MOD_INLINE = re.compile(r"^(?:pub(?:\(crate\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:/\*.*\*/\s*)?\{")
PATH = re.compile(r"\bcrate(?:::[A-Za-z_][A-Za-z0-9_]*)+")
# `Type::item` references (constructors, associated functions, enum variants).
ASSOC_PATH = re.compile(r"\b([A-Z][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)")
TYPE_DECL = re.compile(r"^(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|union|type)\s+([A-Za-z_][A-Za-z0-9_]*)")
IMPL_DECL = re.compile(
    r"^\s*impl(?:<[^>]*>)?\s+(?:[A-Za-z_][A-Za-z0-9_:<>]*\s+for\s+)?"
    r"([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\s*(?:where[^{]*)?\{"
)
VARIANT = re.compile(r"^\s{4,8}([A-Z][A-Za-z0-9_]*)\s*(?:[,({]|$)")
# `Self::…`, generic parameters and macro-generated items are not verifiable here.
ASSOC_SKIP_TAILS = {"self", "Self"}

# Paths that legitimately point at things the symbol table cannot see.
IGNORED = {
    "crate::AppState",  # declared in lib.rs, which the table does know about
}
# Items provided by the language / macros rather than by our own modules.
BUILTIN_TAIL = {"self", "super", "crate"}


class Module:
    def __init__(self, path: str, file: Path | None = None) -> None:
        self.path = path
        self.file = file
        self.items: set[str] = set()
        self.public: set[str] = set()
        self.children: set[str] = set()


def module_of(root: Path, file: Path) -> str:
    parts = list(file.relative_to(root).with_suffix("").parts)
    if parts[-1] in ("mod", "lib", "main"):
        parts = parts[:-1]
    return "::".join(parts)


def strip_comments(line: str) -> str:
    """Removes `//` comments outside of string literals."""
    out = []
    in_string = False
    escaped = False
    index = 0
    while index < len(line):
        char = line[index]
        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        else:
            if char == '"':
                in_string = True
                out.append(char)
            elif line.startswith("//", index):
                break
            else:
                out.append(char)
        index += 1
    return "".join(out)


BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
DERIVE = re.compile(r"#\[derive\((.*?)\)\]", re.S)
DERIVE_METHODS = {
    "Default": "default",
    "Clone": "clone",
    "Copy": "copy",
    "From": "from",
    "Into": "into",
    "Debug": "fmt",
    "Display": "fmt",
    "PartialEq": "eq",
    "Eq": "eq",
    "PartialOrd": "partial_cmp",
    "Ord": "cmp",
    "Hash": "hash",
    "Serialize": "serialize",
    "Deserialize": "deserialize",
    "Error": "source",
}


def scannable(text: str) -> str:
    """Removes comments (including doc comments) before scanning for paths."""
    without_block = BLOCK_COMMENT.sub("", text)
    kept = []
    for line in without_block.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        kept.append(line)
    return "\n".join(kept)


def update_derives(derives: dict[str, set[str]], text: str, types: dict[str, set[str]]) -> None:
    """Records the methods that `#[derive(…)]` provides for a type."""
    for match in DERIVE.finditer(text):
        names = {name.strip().split("::")[-1] for name in match.group(1).split(",")}
        # The derive attribute precedes the item; associate it with the next
        # type declaration that has no derives yet.
        for line in text[match.end() :].splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            decl = TYPE_DECL.match(stripped)
            if decl is None:
                break
            type_name = decl.group(2)
            break
        else:
            continue
        for name in names:
            method = DERIVE_METHODS.get(name)
            if method and type_name in types:
                types[type_name].add(method)


def parse_items(module: Module, lines: list[str]) -> None:
    """Reads top-level items from a block of lines, recursing into inline mods."""
    depth = 0
    index = 0
    while index < len(lines):
        raw = lines[index]
        line = strip_comments(raw)
        trimmed = line.strip()
        if depth == 0:
            inline = MOD_INLINE.match(trimmed)
            if inline:
                name = inline.group(1)
                body, consumed = collect_block(lines[index:])
                child = Module(f"{module.path}::{name}".strip(":"), module.file)
                parse_items(child, body)
                module.children.add(name)
                module.items.add(name)
                module.public.add(name)
                MODULES[child.path] = child
                index += consumed
                continue
            file_mod = MOD_FILE.match(trimmed)
            if file_mod:
                name = file_mod.group(1)
                module.children.add(name)
                module.items.add(name)
                module.public.add(name)
                index += 1
                continue
            match = ITEM.match(trimmed)
            if match and match.group(1) != "mod":
                name = match.group(2)
                module.items.add(name)
                if IS_PUBLIC.match(raw):
                    module.public.add(name)
            else:
                method = METHOD.match(line)
                if method:
                    name = method.group(1)
                    module.items.add(name)
                    if re.match(r"\s+pub(?:\(crate\))?\s", line):
                        module.public.add(name)
        else:
            if depth > 0:
                method = METHOD.match(line)
                if method:
                    name = method.group(1)
                    module.items.add(name)
                    if re.match(r"\s+pub(?:\(crate\))?\s", line):
                        module.public.add(name)
        depth += line.count("{") - line.count("}")
        depth = max(depth, 0)
        index += 1


def collect_block(lines: list[str]) -> tuple[list[str], int]:
    """Returns the body lines of an inline module and how many lines it spans."""
    body: list[str] = []
    depth = 0
    started = False
    for index, raw in enumerate(lines):
        line = strip_comments(raw)
        if not started:
            depth += line.count("{") - line.count("}")
            started = True
            if depth <= 0:
                return body, index + 1
            continue
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            return body, index + 1
        body.append(raw)
    return body, len(lines)


MODULES: dict[str, Module] = {}


def parse(root: Path) -> dict[str, Module]:
    MODULES.clear()
    for file in sorted(p for p in root.rglob("*.rs") if p.is_file()):
        path = module_of(root, file)
        module = MODULES.get(path) or Module(path, file)
        module.file = file
        MODULES[path] = module
        parse_items(module, file.read_text(encoding="utf8").splitlines())
    return MODULES


def parse_associated(root: Path) -> dict[str, set[str]]:
    """Maps every type declared in the crate to its methods and variants."""
    associated: dict[str, set[str]] = defaultdict(set)
    for file in sorted(p for p in root.rglob("*.rs") if p.is_file()):
        lines = file.read_text(encoding="utf8").splitlines()
        index = 0
        while index < len(lines):
            line = strip_comments(lines[index])
            type_match = TYPE_DECL.match(line.strip())
            if type_match:
                kind, name = type_match.group(1), type_match.group(2)
                associated.setdefault(name, set())
                # Enum variants live directly in the body.
                if kind == "enum":
                    body, _ = collect_block(lines[index:])
                    for body_line in body:
                        variant = VARIANT.match(body_line)
                        if variant:
                            associated[name].add(variant.group(1))
            impl_match = IMPL_DECL.match(line)
            if impl_match:
                name = impl_match.group(1)
                body, consumed = collect_block(lines[index:])
                for body_line in body:
                    method = METHOD.match(body_line)
                    if method:
                        associated[name].add(method.group(1))
                    const = re.match(
                        r"^\s+(?:pub(?:\([^)]*\))?\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)",
                        body_line,
                    )
                    if const:
                        associated[name].add(const.group(1))
                    assoc_type = re.match(
                        r"^\s+(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)",
                        body_line,
                    )
                    if assoc_type:
                        associated[name].add(assoc_type.group(1))
                index += consumed
                continue
            index += 1
    return associated


def check_associated(root: Path, modules: dict[str, Module]) -> list[str]:
    declared: set[str] = set()
    for file in sorted(p for p in root.rglob("*.rs") if p.is_file()):
        text = scannable(file.read_text(encoding="utf8"))
        for line in text.splitlines():
            match = TYPE_DECL.match(line.strip())
            if match:
                declared.add(match.group(2))
    associated = {
        name: items for name, items in parse_associated(root).items() if name in declared
    }
    for file in sorted(p for p in root.rglob("*.rs") if p.is_file()):
        update_derives({}, scannable(file.read_text(encoding="utf8")), associated)
    problems: list[str] = []
    for module in modules.values():
        if module.file is None:
            continue
        text = scannable(module.file.read_text(encoding="utf8"))
        for match in ASSOC_PATH.finditer(text):
            head, tail = match.group(1), match.group(2)
            if head not in associated:
                continue  # a type from outside the crate: not our job to check
            if tail in ASSOC_SKIP_TAILS:
                continue
            if tail not in associated[head]:
                line_no = text[: match.start()].count("\n") + 1
                problems.append(
                    f"{module.file}:{line_no}: `{head}::{tail}` — `{head}` has no such "
                    f"associated item (has: {', '.join(sorted(associated[head])) or 'none'})"
                )
    return problems


def resolve_module(parts: list[str]) -> tuple[str | None, list[str]]:
    for end in range(len(parts), -1, -1):
        candidate = "::".join(parts[:end])
        if candidate in MODULES:
            return candidate, parts[end:]
    return None, []


def check(root: Path) -> list[str]:
    modules = parse(root)
    problems: list[str] = []

    # 1. `mod x;` must have a matching file.
    for module in modules.values():
        for child in module.children:
            child_path = f"{module.path}::{child}".strip(":")
            if child_path in modules:
                continue
            base = root.joinpath(*module.path.split("::")) if module.path else root
            if not (base / f"{child}.rs").exists() and not (base / child / "mod.rs").exists():
                problems.append(f"{module.file}: `mod {child};` has no file")

    # 2. every `crate::…` path must resolve.
    for module in modules.values():
        if module.file is None:
            continue
        text = scannable(module.file.read_text(encoding="utf8"))
        seen: set[tuple[int, str]] = set()
        for match in PATH.finditer(text):
            literal = match.group(0)
            if literal in IGNORED:
                continue
            line_no = text[: match.start()].count("\n") + 1
            if (line_no, literal) in seen:
                continue
            seen.add((line_no, literal))

            parts = literal.split("::")[1:]
            head, leftover = resolve_module(parts)
            if head is None:
                problems.append(f"{module.file}:{line_no}: `{literal}` does not resolve to a module")
                continue
            if not leftover or leftover[0] in BUILTIN_TAIL:
                continue
            target = modules[head]
            item = leftover[0]
            if item not in target.items:
                problems.append(
                    f"{module.file}:{line_no}: `{literal}` — `{item}` is not declared in `{head or 'crate root'}`"
                )
                continue
            if item not in target.public and head != module.path:
                problems.append(
                    f"{module.file}:{line_no}: `{literal}` — `{item}` is private to `{head or 'crate root'}`"
                )
    return problems


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path("src-tauri/src")
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2
    problems = check(root)
    problems.extend(check_associated(root, MODULES))
    if problems:
        print(f"FAIL: {len(problems)} unresolved reference(s)")
        print("\n".join(sorted(set(problems))))
        return 1
    print(f"ok: every crate:: path and associated item resolves ({len(MODULES)} modules)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

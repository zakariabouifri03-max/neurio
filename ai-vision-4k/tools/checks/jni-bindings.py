#!/usr/bin/env python3
"""Static pre-flight check for the JNI bindings.

`RegisterNatives` fails the moment a name or a signature in a `JNINativeMethod`
table does not match the Kotlin declaration it is meant to bind, and a failed
`JNI_OnLoad` means `System.loadLibrary` throws: one wrong character takes down
every screen that uses the engine, not just the method that was meant to change.
None of that is visible to the C++ or the Kotlin compiler, because a *string* is
the interface.

So this checks, without a toolchain:

  * every `external fun` in the Kotlin bridges has exactly one entry in the C++
    table, and vice versa (both directions: a method registered for a Kotlin
    function that no longer exists is just as wrong as the reverse);
  * the JNI signature computed from the Kotlin parameter and return types
    (allowed to span several lines) equals the one in the table;
  * the class string handed to `FindClass` equals the package + object name of
    the Kotlin bridge it binds, which is how a bridge ends up in a package the
    native side does not know about.

Usage:  tools/checks/jni-bindings.py [--verbose]
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# The two bridges: Kotlin file, the C++ file holding its table, and the constant
# that names the class to FindClass.
BRIDGES = [
    {
        "kotlin": ROOT / "aiupscaler-sdk/src/main/java/com/aivision4k/sdk/NativeBridge.kt",
        "cpp": ROOT / "aiupscaler-sdk/src/main/cpp/jni/v4k_jni.cpp",
        "macro": "V4K_JNI_METHOD",
        "class_constant": None,          # built from the string literal instead
        "class_regex": r'constexpr const char\* kBridgeClass = "([^"]+)"',
    },
    {
        "kotlin": ROOT / "app/src/main/java/com/aivision4k/app/demo/DemoNativeBridge.kt",
        "cpp": ROOT / "aiupscaler-sdk/src/main/cpp/demo/v4k_demo_jni.cpp",
        "macro": "V4K_DEMO_METHOD",
        "class_constant": None,
        "class_regex": r'constexpr const char\* kDemoBridgeClass = "([^"]+)"',
    },
]

# Kotlin type -> JNI descriptor. Anything not listed is resolved against the
# Kotlin file's own imports (see descriptor_for), so `Surface` becomes
# `Landroid/view/Surface;` rather than being silently wrong.
PRIMITIVES = {
    "Unit": "V",
    "Boolean": "Z",
    "Byte": "B",
    "Char": "C",
    "Short": "S",
    "Int": "I",
    "Long": "J",
    "Float": "F",
    "Double": "D",
    "String": "Ljava/lang/String;",
    "ByteArray": "[B",
    "IntArray": "[I",
    "FloatArray": "[F",
    "DoubleArray": "[D",
    "LongArray": "[J",
    "BooleanArray": "[Z",
    "Any": "Ljava/lang/Object;",
}


def strip_comments(text: str) -> str:
    """Blanks out // and /* */ comments and string bodies, keeping offsets."""
    out = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
        elif ch == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
        elif ch == '"':
            out.append(" ")
            i += 1
            while i < n and text[i] != '"':
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append(" ")
            i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def strip_comments_only(text: str) -> str:
    """Blanks out comments but *keeps* string literals.

    The C++ side of the interface is a table of string literals, so a stripper
    that also removes strings turns every entry into whitespace and the check
    silently finds nothing to compare - which is how this file's first version
    reported every correct binding as missing.
    """
    out = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
        elif ch == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
        elif ch == '"':
            out.append(ch)
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\":
                    out.append(text[i])
                    i += 1
                    if i < n:
                        out.append(text[i])
                        i += 1
                    continue
                out.append(text[i])
                i += 1
            if i < n:
                out.append('"')
                i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def imports_of(text: str) -> dict[str, str]:
    """Symbol -> fully qualified name, from the file's import list."""
    found = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("import "):
            continue
        fqn = line[len("import "):].strip().rstrip(";")
        if fqn.endswith(".*"):
            continue
        if " as " in fqn:
            fqn, alias = [part.strip() for part in fqn.split(" as ", 1)]
            found[alias] = fqn
        else:
            found[fqn.split(".")[-1]] = fqn
    return found


def descriptor_for(kotlin_type: str, imports: dict[str, str]) -> str | None:
    name = kotlin_type.strip().rstrip("?").strip()
    if not name:
        return None
    if name in PRIMITIVES:
        return PRIMITIVES[name]
    if name.endswith("Array") and name[:-5] in PRIMITIVES:
        return "[" + PRIMITIVES[name[:-5]]
    if name == "Surface":
        # Always android.view.Surface here; resolved through the import so a
        # future Surface from another package is not silently accepted.
        pass
    fqn = imports.get(name)
    if fqn is None:
        return None
    return "L" + fqn.replace(".", "/") + ";"


def kotlin_bindings(path: pathlib.Path) -> tuple[dict[str, str], list[str]]:
    """`external fun` declarations -> JNI signature, plus the problems found."""
    text = path.read_text()
    clean = strip_comments(text)
    imports = imports_of(text)
    bindings: dict[str, str] = {}
    problems: list[str] = []

    # `external fun name(` ... matching `)` at depth zero ... optional `: Type`.
    for match in re.finditer(r"\bexternal\s+fun\s+(\w+)\s*\(", clean):
        name = match.group(1)
        depth = 0
        i = match.end() - 1
        while i < len(clean):
            if clean[i] == "(":
                depth += 1
            elif clean[i] == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        params_text = clean[match.end():i]
        tail = clean[i + 1:i + 80].split("\n")[0]
        return_type = "Unit"
        if ":" in tail:
            return_type = tail.split(":", 1)[1].split("=")[0].strip()

        params = []
        for raw in params_text.split(","):
            raw = raw.strip()
            if not raw or ":" not in raw:
                continue
            params.append(raw.split(":", 1)[1].strip())

        descriptors = []
        for param in params:
            descriptor = descriptor_for(param, imports)
            if descriptor is None:
                problems.append(
                    f"{path.name}: cannot resolve the Kotlin type '{param}' of {name}() to a JNI "
                    f"descriptor - add it to PRIMITIVES or import it"
                )
                descriptor = "?"
            descriptors.append(descriptor)
        result = descriptor_for(return_type, imports)
        if result is None:
            problems.append(
                f"{path.name}: cannot resolve the return type '{return_type}' of {name}() to a JNI "
                f"descriptor"
            )
            result = "?"
        bindings[name] = "(" + "".join(descriptors) + ")" + result
    return bindings, problems


def cpp_bindings(path: pathlib.Path, macro: str) -> dict[str, str]:
    clean = strip_comments_only(path.read_text())
    table = {}
    pattern = re.compile(re.escape(macro) + r'\(\s*"(\w+)"\s*,\s*"([^"]+)"')
    for match in pattern.finditer(clean):
        table[match.group(1)] = match.group(2)
    return table


def check_bridge(bridge: dict, verbose: bool) -> list[str]:
    problems: list[str] = []
    kotlin = bridge["kotlin"]
    cpp = bridge["cpp"]
    label = f"{kotlin.name} <-> {cpp.name}"

    if not kotlin.exists() or not cpp.exists():
        return [f"{label}: one side is missing"]

    bindings, parse_problems = kotlin_bindings(kotlin)
    problems.extend(parse_problems)
    table = cpp_bindings(cpp, bridge["macro"])

    for name in sorted(set(bindings) - set(table)):
        problems.append(f"{label}: {name}() is declared in Kotlin but not registered")
    for name in sorted(set(table) - set(bindings)):
        problems.append(f"{label}: {name}() is registered but no Kotlin declaration was found")
    for name in sorted(set(bindings) & set(table)):
        if bindings[name] != table[name]:
            problems.append(
                f"{label}: {name}() signature mismatch - Kotlin {bindings[name]}, "
                f"registered {table[name]}"
            )

    # The class string must name the Kotlin object's package and type.
    match = re.search(bridge["class_regex"], strip_comments_only(cpp.read_text()))
    if match is None:
        problems.append(f"{label}: the class string constant was not found in the C++ bridge")
    else:
        found = match.group(1)
        package = re.search(r"^package\s+([\w.]+)", strip_comments(kotlin.read_text()), re.M)
        declared = re.search(r"\bobject\s+(\w+)", strip_comments(kotlin.read_text()))
        if package is None or declared is None:
            problems.append(f"{label}: could not read the package or object name from the Kotlin bridge")
        else:
            expected = package.group(1).replace(".", "/") + "/" + declared.group(1)
            if found != expected:
                problems.append(
                    f"{label}: FindClass looks for '{found}' but the Kotlin object is '{expected}' "
                    f"- registration would fail and take the whole library with it"
                )
            elif verbose:
                print(f"  {label}: {len(table)} entry points, class {found}")

    if not problems and verbose:
        print(f"  {label}: {len(table)} entry points, all names and signatures match")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    problems: list[str] = []
    for bridge in BRIDGES:
        problems.extend(check_bridge(bridge, args.verbose))

    if problems:
        print("JNI binding check FAILED")
        for problem in problems:
            print(f"  * {problem}")
        return 1
    total = sum(len(cpp_bindings(b["cpp"], b["macro"])) for b in BRIDGES)
    print(f"JNI bindings: {len(BRIDGES)} bridges, {total} entry points, "
          f"every name, signature and class string matches")
    return 0


if __name__ == "__main__":
    sys.exit(main())

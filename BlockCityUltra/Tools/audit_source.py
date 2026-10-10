#!/usr/bin/env python3
"""Static audit of the BLOCK CITY ULTRA C++ source tree.

Unreal Engine is not installed in the authoring environment, so the project
cannot be compiled here. This script catches the classes of mistake that a
compiler would catch, without needing one:

  1. every UCLASS/USTRUCT/UENUM header has a paired .cpp
  2. every UFUNCTION declared in a header has a definition in that .cpp
     (BlueprintNativeEvent / BlueprintImplementableEvent / inline / pure
      getters are exempt, and reported separately)
  3. brace balance per file
  4. every BCU*/FBCU*/EBCU*/ABCUSymbol referenced anywhere is declared somewhere
  5. #include paths resolve to files that exist
  6. no fabricated marketplace URLs or ids in the .uproject

Exit code 1 on any ERROR. Warnings are advisory.
"""

from __future__ import annotations
import re, sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Source" / "BlockCityUltra"
EDITOR = ROOT / "Source" / "BlockCityUltraEditor"
errors, warnings = [], []

headers = sorted(list(SRC.glob("Public/**/*.h")) + list(EDITOR.glob("Public/**/*.h")))
impls = sorted(list(SRC.glob("Private/**/*.cpp")) + list(EDITOR.glob("Private/**/*.cpp")))

def impl_for(h: Path) -> Path | None:
    cand = Path(str(h).replace("/Public/", "/Private/")).with_suffix(".cpp")
    return cand if cand.exists() else None

# ── 1 + 2: header/impl parity and UFUNCTION definitions ──────────────────────
declared_symbols: dict[str, Path] = {}
referenced: dict[str, set[Path]] = {}

UCLASS_RE = re.compile(r"^\s*UCLASS\b", re.M)
FUNC_RE = re.compile(r"^\s*UFUNCTION\s*\(([^)]*)\)\s*\n\s*([\w:<>,\s\*&]+?)\s+(\w+)\s*\(", re.M)
DECL_RE = re.compile(r"\b(?:class|struct|enum\s+class|enum)\s+(?:[A-Z]+_API\s+)?(\w*BCU\w*)", re.M)
SYM_RE = re.compile(r"\b([AFEU]BCU[A-Za-z0-9_]+)\b")

for h in headers:
    text = h.read_text(encoding="utf-8", errors="replace")
    impl = impl_for(h)
    has_uclass = bool(UCLASS_RE.search(text)) or "USTRUCT(" in text or "UENUM(" in text

    if has_uclass and not impl:
        errors.append(f"{h.relative_to(ROOT)}: UCLASS/USTRUCT/UENUM header has no paired .cpp")
        continue

    for m in DECL_RE.finditer(text):
        declared_symbols.setdefault(m.group(1), h)

    if not impl:
        continue

    itext = impl.read_text(encoding="utf-8", errors="replace")

    # Class name(s) declared in this header.
    class_names = re.findall(r"\b(class|struct)\s+(?:BLOCKCITYULTRA_API\s+)?([A-Z]\w*BCU\w*)\s*(?::|final|\{)", text)
    prefixes = {n for _, n in class_names}

    missing = []
    exempt = []
    for meta, ret, name in FUNC_RE.findall(text):
        if "BlueprintImplementableEvent" in meta:
            exempt.append(name); continue
        qualified = any(f"{p}::{name}" in itext for p in prefixes)
        if qualified:
            continue
        # Inline body in the header?
        # Allow parameters inside the parens, and an optional const/override.
        inline = re.search(rf"\b{re.escape(name)}\s*\([^;()]*\)\s*(?:const\s*)?(?:override\s*)?\{{", text)
        if not inline:
            # Definition may span lines in the cpp as `Class::Name(`.
            inline = re.search(rf"::\s*{re.escape(name)}\s*\(", itext)
        if inline:
            exempt.append(name); continue
        if "BlueprintNativeEvent" in meta and f"{name}_Implementation" in itext:
            continue
        missing.append(name)

    if missing:
        errors.append(f"{impl.relative_to(ROOT)}: {len(missing)} UFUNCTION(s) declared but not defined: {', '.join(sorted(set(missing))[:8])}")
    if exempt:
        warnings.append(f"{h.relative_to(ROOT)}: {len(exempt)} inline/BlueprintImplementable UFUNCTION(s) (no cpp definition expected)")

# ── 3: brace balance ─────────────────────────────────────────────────────────
STRIP = re.compile(r'//.*?$|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', re.S | re.M)
for f in headers + impls:
    body = STRIP.sub("", f.read_text(encoding="utf-8", errors="replace"))
    bal = body.count("{") - body.count("}")
    if bal != 0:
        errors.append(f"{f.relative_to(ROOT)}: brace imbalance {bal:+d}")
    par = body.count("(") - body.count(")")
    if abs(par) > 0:
        warnings.append(f"{f.relative_to(ROOT)}: parenthesis imbalance {par:+d}")

# ── 4: referenced BCU symbols are declared ───────────────────────────────────
COMMENT_RE = re.compile(r"//.*?$|/\*.*?\*/", re.S | re.M)
for f in headers + impls:
    code = COMMENT_RE.sub("", f.read_text(encoding="utf-8", errors="replace"))
    for m in SYM_RE.finditer(code):
        referenced.setdefault(m.group(1), set()).add(f)

undeclared = sorted(s for s in referenced if s not in declared_symbols)
if undeclared:
    where = {s: sorted(str(p.relative_to(ROOT)) for p in referenced[s])[:2] for s in undeclared}
    errors.append(f"{len(undeclared)} BCU symbol(s) referenced but never declared: "
                  + "; ".join(f"{s} ({', '.join(where[s])})" for s in undeclared[:10])
                  + (" ..." if len(undeclared) > 10 else ""))

# ── 5: project-internal includes resolve ─────────────────────────────────────
# Engine headers cannot be checked here (Unreal is not installed), so only
# includes that name a BCU symbol are validated. Those are the ones that break
# silently when a header is moved or renamed.
INC = re.compile(r'^\s*#include\s+"([^"]+)"', re.M)
pub_roots = [SRC / "Public", EDITOR / "Public", SRC / "Private", EDITOR / "Private"]
for f in headers + impls:
    for inc in INC.findall(f.read_text(encoding="utf-8", errors="replace")):
        if "BCU" not in inc and "BlockCityUltra" not in inc:
            continue
        # UnrealHeaderTool generates these into Intermediate/ at build time.
        if inc.endswith(".generated.h"):
            continue
        if any((r / inc).exists() for r in pub_roots):
            continue
        if (f.parent / Path(inc).name).exists():
            continue
        errors.append(f"{f.relative_to(ROOT)}: project include \"{inc}\" does not resolve")

# ── 6: uproject sanity ───────────────────────────────────────────────────────
up = ROOT / "BlockCityUltra.uproject"
data = json.loads(up.read_text())
for plug in data.get("Plugins", []):
    if "MarketplaceURL" in plug or "PluginID" in plug:
        errors.append(f"BlockCityUltra.uproject: plugin {plug.get('Name')} carries a MarketplaceURL/PluginID — "
                      "fabricated identifiers must not be committed")
dlss = next((p for p in data.get("Plugins", []) if p.get("Name") == "DLSS"), None)
if dlss and (dlss.get("Enabled") is not False or dlss.get("Optional") is not True):
    errors.append("BlockCityUltra.uproject: DLSS must be Enabled=false and Optional=true (licensing rule, Docs/08 §6)")

bs = (SRC / "BlockCityUltra.Build.cs").read_text()
if re.search(r'"DLSS"', bs):
    errors.append("BlockCityUltra.Build.cs hard-links DLSS — it must stay optional (Docs/08 §6)")

# ── report ───────────────────────────────────────────────────────────────────
print(f"audited {len(headers)} headers, {len(impls)} implementations, "
      f"{len(declared_symbols)} declared BCU symbols, {len(referenced)} referenced")
print()
for w in warnings[:14]:
    print(f"WARN  {w}")
if len(warnings) > 14:
    print(f"WARN  ... and {len(warnings) - 14} more")
print()
for e in errors:
    print(f"ERROR {e}")
print()
print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)

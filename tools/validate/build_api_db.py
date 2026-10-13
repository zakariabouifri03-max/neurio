#!/usr/bin/env python3
"""Builds the Godot API database used by validate_project.py.

Source of truth: the official engine class reference, ``doc/classes/*.xml`` plus
every ``modules/*/doc_classes/*.xml`` of a Godot release checkout
(MIT licensed, https://github.com/godotengine/godot).

The database records, per class, its base class, method signatures (name,
parameter types, return type, static flag), member variable types, signals and
constants.  That is enough for the validator to resolve expressions such as
``get_world_3d().direct_space_state.intersect_ray(q)`` and to prove that every
engine symbol the project uses exists in the target engine version.

Usage:
    python3 tools/validate/build_api_db.py \\
        ~/godot-src/doc/classes \\
        ~/godot-src/modules/enet/doc_classes \\
        ~/godot-src/modules/multiplayer/doc_classes \\
        ~/godot-src/modules/websocket/doc_classes \\
        ~/godot-src/modules/upnp/doc_classes
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "godot_api_db.json")


def norm_type(text):
    if not text:
        return ""
    text = text.strip()
    if text.startswith("Array[") or text.startswith("Dictionary["):
        return text.split("[", 1)[0] + "[...]"
    return text


def parse_class(path):
    root = ET.parse(path).getroot()
    methods, members, signals, constants, enums = {}, {}, {}, [], {}

    for m in root.findall("./methods/method"):
        params = [
            [p.get("name"), norm_type(p.get("type")), p.get("default") or ""]
            for p in m.findall("param")
        ]
        ret = m.find("return")
        methods[m.get("name")] = {
            "ret": norm_type(ret.get("type")) if ret is not None else "void",
            "static": m.get("qualifiers") == "static",
            "vararg": m.get("qualifiers") is not None and "vararg" in (m.get("qualifiers") or ""),
            "params": params,
        }
    for v in root.findall("./members/member"):
        members[v.get("name")] = {"type": norm_type(v.get("type")), "enum": v.get("enum") or ""}
    for s in root.findall("./signals/signal"):
        signals[s.get("name")] = [
            [p.get("name"), norm_type(p.get("type"))] for p in s.findall("param")
        ]
    for c in root.findall("./constants/constant"):
        constants.append(c.get("name"))
        if c.get("enum"):
            enums.setdefault(c.get("enum"), []).append(c.get("name"))
    for e in root.findall("./constants/enum"):
        enums.setdefault(e.get("name"), [])

    return root.get("name"), {
        "inherits": root.get("inherits", ""),
        "instantiable": root.get("is_instantiable", "true") != "false",
        "refcounted": root.get("is_refcounted", "true") == "true",
        "methods": methods,
        "members": members,
        "signals": signals,
        "constants": sorted(set(constants)),
        "enums": {k: sorted(set(v)) for k, v in enums.items()},
    }


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    db = {"engine": "4.4.1-stable", "classes": {}}
    files = []
    for d in argv:
        if os.path.isdir(d):
            files += [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".xml")]
    for path in files:
        try:
            name, entry = parse_class(path)
        except ET.ParseError as exc:  # pragma: no cover
            print(f"skip {path}: {exc}", file=sys.stderr)
            continue
        if name:
            db["classes"][name] = entry
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(db, fh, separators=(",", ":"), sort_keys=True)
    print(f"wrote {OUT}: {len(db['classes'])} classes, {os.path.getsize(OUT)/1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

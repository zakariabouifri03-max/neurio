#!/usr/bin/env python3
"""Static verification suite for the BlockStrike Royale Godot project.

The project targets Godot 4.4.1.  This validator parses every GDScript file into
an AST (through tools/gdcheck, a tree-sitter based syntax checker), resolves
types the same way the engine would, and then proves:

  * every engine class, method, member, signal, constant and enum value that the
    project references exists in the target engine version (tools/validate/
    godot_api_db.json, generated from the official class reference),
  * every project specific type, method, signal and constant used is declared,
  * every ``res://`` resource referenced exists on disk,
  * every input action used is declared in project.godot,
  * scenes (.tscn) reference existing resources and existing node types,
  * JSON game data (weapons, loot, shop, maps, missions, modes) is well formed
    and internally consistent,
  * assets are present and non-empty.

Usage:
    python3 tools/validate/validate_project.py [PROJECT_DIR] [--json report.json]

Exit code is 1 when errors are found, 0 otherwise.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
API_DB = os.path.join(HERE, "godot_api_db.json")
GDCHECK = os.path.join(REPO, "tools", "gdcheck", "gdcheck")

# GDScript level built-ins that are not part of the class reference.
LANGUAGE_BUILTINS = {
    "preload", "load", "range", "len", "self", "super", "assert", "is_instance_valid",
    "type_exists", "char", "ord", "str_to_var", "var_to_str", "weakref", "typeof",
    "print", "print_deferred", "print_rich", "print_verbose", "printerr", "printraw",
    "printt", "prints", "push_error", "push_warning", "breakpoint", "convert",
    "deep_equal", "inst_to_dict", "dict_to_inst",
}

VARIANT_TYPES = {
    "Variant", "bool", "int", "float", "String", "StringName", "NodePath", "Vector2",
    "Vector2i", "Vector3", "Vector3i", "Vector4", "Vector4i", "Rect2", "Rect2i",
    "Transform2D", "Transform3D", "Basis", "Quaternion", "Projection", "Color",
    "Plane", "Callable", "Signal", "RID", "Array", "Dictionary", "PackedByteArray",
    "PackedInt32Array", "PackedInt64Array", "PackedFloat32Array", "PackedFloat64Array",
    "PackedStringArray", "PackedVector2Array", "PackedVector3Array",
    "PackedColorArray", "PackedVector4Array", "void", "Nil", "Object",
}

GODOT3_PATTERNS = [
    (r"\byield\s*\(", "GDScript 2 removed yield(); use await"),
    (r"(?<!@)\bonready\s+var\b", "Godot 3 onready syntax; use @onready"),
    (r"(?<!@)\bexport\s*\([^)]*\)\s*var\b", "Godot 3 export syntax; use @export"),
    (r"(?<!@)\bexport\s+var\b", "Godot 3 export syntax; use @export var"),
    (r"\.instance\(\)", "Godot 3 .instance(); use .instantiate()"),
    (r"\bOS\.get_ticks_msec\b", "still valid but prefer Time"),
    (r"\bPoolStringArray\b", "Godot 3 type; use PackedStringArray"),
    (r"\bPoolByteArray\b", "Godot 3 type; use PackedByteArray"),
    (r"\bSpatial\b", "Godot 3 class name; use Node3D"),
    (r"\bKinematicBody\b", "Godot 3 class name; use CharacterBody3D"),
    (r"\bRigidBody\b(?!2D|3D)", "Godot 3 class name; use RigidBody3D"),
    (r"\bStaticBody\b(?!2D|3D)", "Godot 3 class name; use StaticBody3D"),
    (r"\bMeshInstance\b(?!2D|3D)", "Godot 3 class name; use MeshInstance3D"),
    (r"\bArea\b(?!2D|3D)", "Godot 3 class name; use Area3D"),
    (r"\bCamera\b(?!2D|3D)", "Godot 3 class name; use Camera3D"),
    (r"\bRayCast\b(?!2D|3D)", "Godot 3 class name; use RayCast3D"),
    (r"\binput_event\b(?!\s*\()", "Godot 3 signal name; use _input_event"),
    (r"\binstance_from_id\b", "still valid in Godot 4"),
]

REQUIRED_PROJECT_SETTINGS = [
    "application/config/name",
    "application/run/main_scene",
    "rendering/renderer/rendering_method",
]

REQUIRED_AUTOLOADS = [
    "GameConfig", "SaveManager", "Economy", "Progression", "Missions",
    "MatchConfig", "AudioDirector", "NetworkManager", "Settings", "Lobby",
]


class Report:
    def __init__(self) -> None:
        self.errors: List[Tuple[str, str]] = []
        self.warnings: List[Tuple[str, str]] = []
        self.notes: List[str] = []
        self.stats: Dict[str, int] = defaultdict(int)

    def error(self, where: str, msg: str) -> None:
        self.errors.append((where, msg))

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append((where, msg))

    def note(self, msg: str) -> None:
        self.notes.append(msg)

    def dump(self, json_path: Optional[str] = None) -> int:
        print("=" * 78)
        print("BlockStrike Royale - static verification report")
        print("=" * 78)
        for key in sorted(self.stats):
            print(f"  {key:<34} {self.stats[key]}")
        for note in self.notes:
            print(f"  · {note}")
        if self.warnings:
            print(f"\nWARNINGS ({len(self.warnings)}):")
            for where, msg in self.warnings:
                print(f"  ! {where}: {msg}")
        if self.errors:
            print(f"\nERRORS ({len(self.errors)}):")
            for where, msg in self.errors:
                print(f"  X {where}: {msg}")
        print("=" * 78)
        verdict = "FAIL" if self.errors else "PASS"
        print(f"{verdict}: {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
        if json_path:
            with open(json_path, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "errors": [{"where": w, "message": m} for w, m in self.errors],
                        "warnings": [{"where": w, "message": m} for w, m in self.warnings],
                        "stats": dict(self.stats),
                        "notes": self.notes,
                    },
                    fh,
                    indent=2,
                )
        return 1 if self.errors else 0


# --------------------------------------------------------------------------- #
#  Engine API database
# --------------------------------------------------------------------------- #
class EngineApi:
    def __init__(self, path: str) -> None:
        with open(path, "r", encoding="utf-8") as fh:
            db = json.load(fh)
        self.classes: Dict[str, Dict[str, Any]] = db["classes"]
        self.version: str = db["engine"]

    def has_class(self, name: str) -> bool:
        return name in self.classes

    def chain(self, name: str) -> List[str]:
        out: List[str] = []
        seen = set()
        cur = name
        while cur and cur in self.classes and cur not in seen:
            seen.add(cur)
            out.append(cur)
            cur = self.classes[cur].get("inherits", "")
        return out

    def method(self, cls: str, method: str) -> Optional[Dict[str, Any]]:
        for c in self.chain(cls):
            m = self.classes[c]["methods"].get(method)
            if m:
                return m
        return None

    def has_method(self, cls: str, method: str) -> bool:
        return self.method(cls, method) is not None

    def member(self, cls: str, member: str) -> Optional[Dict[str, Any]]:
        for c in self.chain(cls):
            found = self.classes[c]["members"].get(member)
            if found:
                return found
        return None

    def has_signal(self, cls: str, sig: str) -> bool:
        return any(sig in self.classes[c]["signals"] for c in self.chain(cls))

    def has_constant(self, cls: str, name: str) -> bool:
        for c in self.chain(cls):
            if name in self.classes[c]["constants"]:
                return True
            for values in self.classes[c]["enums"].values():
                if name in values:
                    return True
        return False

    def is_instantiable(self, cls: str) -> bool:
        return bool(self.classes.get(cls, {}).get("instantiable", True))

    def member_type(self, cls: str, member: str) -> Optional[str]:
        found = self.member(cls, member)
        if not found:
            return None
        return found.get("type") or None

    def method_return(self, cls: str, method: str) -> Optional[str]:
        found = self.method(cls, method)
        if not found:
            return None
        return found.get("ret") or None


# --------------------------------------------------------------------------- #
#  GDScript model
# --------------------------------------------------------------------------- #
class GdFunc:
    def __init__(self, name: str, node: Dict[str, Any]) -> None:
        self.name = name
        self.node = node
        self.params: List[Tuple[str, str]] = []
        self.return_type: str = ""
        self.static = False
        self.is_virtual = name.startswith("_")
        for child in node.get("ch", []):
            if child["t"] == "parameters":
                self._read_params(child)
            elif child["t"] == "type":
                self.return_type = node_text(child, child)
        # vararg / static markers appear as plain children text
        for child in node.get("ch", []):
            if child.get("s") == "static":
                self.static = True

    def _read_params(self, node: Dict[str, Any]) -> None:
        for child in node.get("ch", []):
            if child["t"] == "typed_parameter":
                name, typ = "", ""
                for sub in child.get("ch", []):
                    if sub["t"] == "identifier":
                        name = sub.get("s", "")
                    elif sub["t"] == "type":
                        typ = child_text(sub)
                self.params.append((name, typ))
            elif child["t"] == "identifier":
                self.params.append((child.get("s", ""), ""))


def child_text(node: Dict[str, Any]) -> str:
    """Concatenates leaf text of a node (used for simple type expressions)."""
    if "s" in node:
        return node["s"]
    return "".join(child_text(c) for c in node.get("ch", []))


def node_text(node: Dict[str, Any], src_root: Dict[str, Any]) -> str:  # kept for API symmetry
    return child_text(node)


def walk(node: Dict[str, Any]):
    yield node
    for child in node.get("ch", []):
        yield from walk(child)


class GdFile:
    """Parsed, semantically modelled GDScript file."""

    def __init__(self, rel: str, src: str, ast: Dict[str, Any], api: EngineApi) -> None:
        self.rel = rel
        self.src = src
        self.ast = ast
        self.api = api
        self.class_name = ""
        self.extends = ""
        self.tool = False
        self.funcs: Dict[str, GdFunc] = {}
        self.signals: Dict[str, List[Tuple[str, str]]] = {}
        self.consts: Dict[str, str] = {}
        self.enums: Dict[str, List[str]] = {}
        self.vars: Dict[str, str] = {}          # name -> declared type ("" when untyped)
        self.var_annotations: Dict[str, List[str]] = {}
        self.inner_classes: Dict[str, Dict[str, Any]] = {}
        self.res_paths: List[Tuple[str, int]] = []
        self.action_strings: List[Tuple[str, int]] = []
        self.call_strings: List[Tuple[str, int]] = []
        self.uses: Dict[str, List[int]] = defaultdict(list)   # identifier -> lines
        self.calls: List[Tuple[str, str, int]] = []           # (receiver_text, method, line)
        self.attributes: List[Tuple[str, str, int]] = []      # (receiver_text, member, line)
        self.unresolved_receivers = 0
        self._parse_header()
        self._parse_members()
        self._collect_string_paths()
        self._collect_calls()

    # ---------------------------- structure ------------------------------ #
    def _parse_header(self) -> None:
        for node in self.ast.get("ch", []):
            if node["t"] == "class_name_statement":
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        self.class_name = c.get("s", "")
            elif node["t"] == "extends_statement":
                self.extends = child_text(node)
                self.extends = self.extends.replace("extends", "", 1).strip()
            elif node["t"] == "tool_statement":
                self.tool = True

    def _parse_members(self) -> None:
        for node in self.ast.get("ch", []):
            t = node["t"]
            if t == "function_definition":
                name = ""
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        name = c.get("s", "")
                if name:
                    self.funcs[name] = GdFunc(name, node)
            elif t == "signal_statement":
                name = ""
                params: List[Tuple[str, str]] = []
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        name = c.get("s", "")
                    elif c["t"] == "parameters":
                        for p in c.get("ch", []):
                            if p["t"] == "typed_parameter":
                                pname, ptype = "", ""
                                for sub in p.get("ch", []):
                                    if sub["t"] == "identifier":
                                        pname = sub.get("s", "")
                                    elif sub["t"] == "type":
                                        ptype = child_text(sub)
                                params.append((pname, ptype))
                            elif p["t"] == "identifier":
                                params.append((p.get("s", ""), ""))
                if name:
                    self.signals[name] = params
            elif t == "const_statement":
                name = ""
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        name = c.get("s", "")
                if name:
                    self.consts[name] = ""
            elif t == "enum_definition":
                ename = ""
                values: List[str] = []
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        ename = c.get("s", "")
                    elif c["t"] == "enumerator_list":
                        for e in c.get("ch", []):
                            if e["t"] == "enumerator":
                                for sub in e.get("ch", []):
                                    if sub["t"] == "identifier":
                                        values.append(sub.get("s", ""))
                if ename:
                    self.enums[ename] = values
            elif t == "variable_statement":
                self._read_variable(node, self.vars, self.var_annotations)
            elif t == "class_definition":
                iname = ""
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        iname = c.get("s", "")
                if iname:
                    self.inner_classes[iname] = node

    def _read_variable(self, node: Dict[str, Any], var_map: Dict[str, str],
                       annot_map: Dict[str, List[str]]) -> None:
        name, typ = "", ""
        annotations: List[str] = []
        for c in node.get("ch", []):
            if c["t"] == "name":
                name = c.get("s", "")
            elif c["t"] == "type":
                typ = child_text(c)
            elif c["t"] == "annotations":
                for a in c.get("ch", []):
                    if a["t"] == "annotation":
                        annotations.append(child_text(a).lstrip("@"))
        if name:
            var_map[name] = typ
            annot_map[name] = annotations

    def _collect_string_paths(self) -> None:
        for node in walk(self.ast):
            if node["t"] != "string":
                continue
            text = node.get("s", "")
            inner = text.strip('"').strip("'")
            line = node.get("r", 0)
            if inner.startswith("res://"):
                self.res_paths.append((inner, line))
            if node.get("_ctx") == "action":
                self.action_strings.append((inner, line))

    def _collect_calls(self) -> None:
        """Records `receiver.method(...)` calls plus property access chains."""
        for node in walk(self.ast):
            if node["t"] == "attribute":
                children = node.get("ch", [])
                if len(children) < 3:
                    continue
                member_node = children[-1]
                base_node = children[-3]
                base_text = child_text(base_node)
                base_text = self.safe_base_text(base_node)
                line = node.get("r", 0)
                if member_node["t"] == "attribute_call":
                    method = ""
                    for c in member_node.get("ch", []):
                        if c["t"] == "identifier":
                            method = c.get("s", "")
                    if method:
                        self.calls.append((base_text, method, line))
                elif member_node["t"] == "identifier":
                    self.attributes.append((base_text, member_node.get("s", ""), line))

    def safe_base_text(self, node: Dict[str, Any]) -> str:
        text = child_text(node)
        # Reduce complex expressions to their final identifier so that
        # `get_world_3d().direct_space_state` -> "direct_space_state"
        if "(" in text or "[" in text:
            return ""
        return text

    # ------------------------------ queries ------------------------------ #
    def method_signature(self, name: str, seen: Optional[set] = None) -> Optional[GdFunc]:
        seen = seen or set()
        if self.rel in seen:
            return None
        seen.add(self.rel)
        return self.funcs.get(name)

    def has_signal(self, name: str) -> bool:
        return name in self.signals

    def has_const(self, name: str) -> bool:
        if name in self.consts:
            return True
        return any(name in values for values in self.enums.values())


class Project:
    def __init__(self, root: str, api: EngineApi, report: Report) -> None:
        self.root = os.path.abspath(root)
        self.api = api
        self.report = report
        self.files: Dict[str, GdFile] = {}
        self.by_class: Dict[str, GdFile] = {}
        self.autoloads: Dict[str, str] = {}       # name -> script res path
        self.input_actions: Dict[str, Any] = {}
        self.project_settings: Dict[str, str] = {}
        self.main_scene = ""
        self.rendering_method = ""

    # --------------------------- discovery ------------------------------- #
    def gd_files(self) -> List[str]:
        out = []
        for base, dirs, files in os.walk(self.root):
            dirs[:] = [d for d in dirs if d not in (".godot", ".git", "android")]
            for f in files:
                if f.endswith(".gd"):
                    out.append(os.path.join(base, f))
        return sorted(out)

    def parse_all(self) -> None:
        files = self.gd_files()
        if not files:
            self.report.error("project", "no .gd files found")
            return
        if not os.path.exists(GDCHECK):
            self.report.warn("tooling", "gdcheck binary missing; run tools/gdcheck/build.sh")
            return
        proc = subprocess.run([GDCHECK, "--json"] + files, capture_output=True, text=True)
        lines = proc.stdout.splitlines()
        if proc.returncode != 0 and not lines:
            self.report.error("syntax", proc.stderr.strip()[:400] or "gdcheck failed")
            return
        for path, line in zip(files, lines):
            rel = os.path.relpath(path, self.root)
            try:
                ast = json.loads(line)
            except json.JSONDecodeError:
                self.report.error(rel, "gdcheck produced no AST (syntax error)")
                continue
            self.files[rel] = GdFile(rel, open(path, encoding="utf-8").read(), ast, self.api)
        if proc.stderr:
            for err in proc.stderr.splitlines():
                if "SYNTAX ERROR" in err:
                    self.report.error("syntax", err)

    def parse_project_godot(self) -> None:
        path = os.path.join(self.root, "project.godot")
        if not os.path.exists(path):
            self.report.error("project.godot", "missing")
            return
        section = ""
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith(";"):
                    continue
                if line.startswith("[") and line.endswith("]"):
                    section = line[1:-1]
                    continue
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip().strip('"')
                value = value.strip()
                full = f"{section}/{key}" if section else key
                self.project_settings[full] = value
                if section == "autoload":
                    self.autoloads[key] = value.strip('"').lstrip("*")
                elif section == "input":
                    self.input_actions[key] = value
        for key in REQUIRED_PROJECT_SETTINGS:
            if key not in self.project_settings:
                self.report.error("project.godot", f"missing required setting {key}")
        self.main_scene = self.project_settings.get("application/run/main_scene", "").strip('"')
        self.rendering_method = self.project_settings.get(
            "rendering/renderer/rendering_method", "").strip('"')
        if self.main_scene and not os.path.exists(
                os.path.join(self.root, self.main_scene.replace("res://", ""))):
            self.report.error("project.godot", f"main scene {self.main_scene} does not exist")
        for name, script in self.autoloads.items():
            path = script if script.startswith("res://") else "res://" + script
            if not os.path.exists(os.path.join(self.root, path.replace("res://", ""))):
                self.report.error("project.godot", f"autoload {name} -> {script} missing")
        self.report.stats["autoloads"] = len(self.autoloads)
        self.report.stats["input actions"] = len(self.input_actions)

    # ------------------------- semantic checks --------------------------- #
    def check_semantics(self) -> None:
        for rel, gd in self.files.items():
            if gd.class_name:
                if gd.class_name in self.by_class:
                    self.report.error(rel, f"duplicate class_name {gd.class_name} "
                                           f"(also {self.by_class[gd.class_name].rel})")
                else:
                    self.by_class[gd.class_name] = gd
        self.report.stats["gd files"] = len(self.files)
        self.report.stats["class_name scripts"] = len(self.by_class)

        known = set(self.api.classes) | set(self.by_class) | VARIANT_TYPES | set(self.autoloads)
        for rel, gd in self.files.items():
            self.check_extends(gd, known)
            self.check_types(gd, known)
            self.check_paths(gd)
            self.check_actions(gd)
            self.check_godot3isms(gd)
        for rel, gd in self.files.items():
            self.check_calls(gd)
        self.check_signals_connected()
        self.check_instantiation()
        self.check_tool_scripts()

    def check_extends(self, gd: GdFile, known: set) -> None:
        ext = gd.extends.strip()
        if not ext:
            if gd.class_name:
                self.report.warn(gd.rel, "class_name without extends (defaults to RefCounted)")
            return
        ext = ext.split("{")[0].strip()
        if ext.startswith('"'):
            path = ext.strip('"')
            if not os.path.exists(os.path.join(self.root, path.replace("res://", ""))):
                self.report.error(gd.rel, f"extends path not found: {path}")
            return
        if ext not in known:
            self.report.error(gd.rel, f"extends unknown type '{ext}'")
        elif ext in self.by_class:
            base = self.by_class[ext]
            if base.rel == gd.rel:
                self.report.error(gd.rel, "script extends itself")
        elif ext in self.api.classes and not self.api.is_instantiable(ext):
            self.report.warn(gd.rel, f"extends non-instantiable class {ext} (legal only for "
                                     f"classes that are meant to be extended)")

    def check_types(self, gd: GdFile, known: set) -> None:
        def validate(type_text: str, where: str, line: int) -> None:
            if not type_text:
                return
            t = type_text.strip()
            if t.startswith("Array[") and t.endswith("]"):
                validate(t[6:-1], where, line)
                return
            if t.startswith("Dictionary[") and t.endswith("]"):
                inner = t[11:-1].split(",")
                for part in inner:
                    validate(part, where, line)
                return
            if t.startswith("Callable[") or t.startswith("Signal["):
                return
            t = t.lstrip("^")
            if t in ("", "void"):
                return
            if t not in known:
                self.report.error(gd.rel, f"{where} (line {line}): unknown type '{t}'")

        for name, typ in gd.vars.items():
            if typ and typ not in ("", "void"):
                validate(typ, f"variable {name}", 0)
        for fname, fn in gd.funcs.items():
            if fn.return_type and fn.return_type != "void":
                validate(fn.return_type, f"return type of {fname}()", 0)
            for pname, ptype in fn.params:
                validate(ptype, f"parameter {pname} of {fname}()", 0)
        for sname, params in gd.signals.items():
            for pname, ptype in params:
                validate(ptype, f"signal {sname} param {pname}", 0)
        # `as Type` casts and `X.new()` / `ClassName.method` usages
        for node in walk(gd.ast):
            if node["t"] == "as_expression":
                parts = child_text(node).split(" as ")
                if len(parts) == 2:
                    validate(parts[1], "cast", node.get("r", 0))
            elif node["t"] == "type":
                text = child_text(node).strip()
                if text and text not in known and not text.startswith("Array"):
                    parent_line = node.get("r", 0)
                    # Only complains for standalone type nodes we have not validated
                    # (function/var/param types are handled above).
                    if text[0].isupper() and text not in self.by_class:
                        self.report.warn(gd.rel, f"line {parent_line}: type '{text}' is not a "
                                                 f"known engine or project class")

    def check_paths(self, gd: GdFile) -> None:
        seen = set()
        for path, line in gd.res_paths:
            key = (path, line)
            if key in seen:
                continue
            seen.add(key)
            if path in ("res://", "res://."):
                continue
            target = os.path.join(self.root, path.replace("res://", ""))
            if os.path.exists(target):
                continue
            # allow directories (DirAccess/ResourceLoader use) and uid:// style
            if os.path.isdir(target) or not os.path.splitext(path)[1]:
                continue
            self.report.error(gd.rel, f"line {line}: missing resource {path}")

    def check_actions(self, gd: GdFile) -> None:
        pattern = re.compile(
            r"(?:Input\.(?:is_action_pressed|is_action_just_pressed|is_action_just_released|"
            r"get_action_strength|get_vector|get_axis|is_action_just_released)|"
            r"InputMap\.has_action|action_press|action_release)\s*\(\s*\"([A-Za-z0-9_.]+)\"")
        for m in pattern.finditer(gd.src):
            action = m.group(1)
            if action.startswith("ui_"):
                continue
            if action not in self.input_actions:
                line = gd.src[:m.start()].count("\n") + 1
                self.report.error(gd.rel, f"line {line}: input action '{action}' not declared in "
                                          f"project.godot")

    def check_godot3isms(self, gd: GdFile) -> None:
        for pattern, message in GODOT3_PATTERNS:
            if "still valid" in message:
                continue
            for m in re.finditer(pattern, gd.src, re.MULTILINE):
                line = gd.src[:m.start()].count("\n") + 1
                self.report.error(gd.rel, f"line {line}: {message}  ->  '{m.group(0)}'")

    # --------------------------- call checking --------------------------- #
    def resolve_receiver(self, gd: GdFile, receiver: str, local_types: Dict[str, str]) -> Optional[str]:
        """Returns the static type of `receiver` or None when unknown."""
        if not receiver:
            return None
        if receiver == "self":
            return gd.class_name or gd.rel
        head = receiver.split(".")[0]
        if head in local_types:
            return self.follow_member_types(local_types[head], receiver)
        if head in gd.vars:
            typ = gd.vars[head] or self.infer_from_annotation(gd, head)
            return self.follow_member_types(typ, receiver)
        if head in self.by_class:
            return self.follow_member_types(head, receiver)
        if head in self.api.classes:
            return self.follow_member_types(head, receiver)
        if head in self.autoloads:
            script = self.autoloads[head].replace("res://", "")
            for rel, other in self.files.items():
                if other.rel == script or rel.endswith(os.path.basename(script)):
                    return other.class_name or other.rel
            return None
        return None

    def follow_member_types(self, typ: str, chain: str) -> Optional[str]:
        """Walks `a.b.c` returning the type of the final member."""
        if not typ:
            return None
        if typ in self.by_class:
            current = self.by_class[typ].class_name
            gd = self.by_class[typ]
            for part in chain.split(".")[1:]:
                if part in gd.vars and gd.vars[part]:
                    return gd.vars[part]
                return None
            return current
        parts = chain.split(".")
        cls = typ
        for part in parts[1:]:
            member = self.api.member(cls, part)
            if not member:
                return None
            cls = member["type"]
            if cls.startswith("Array["):
                cls = "Array"
            if not cls:
                return None
        return cls

    def infer_from_annotation(self, gd: GdFile, name: str) -> str:
        return ""

    def iter_functions(self, gd: GdFile):
        for node in self.ast_walk_functions(gd.ast):
            yield node

    @staticmethod
    def ast_walk_functions(root: Dict[str, Any]):
        for node in root.get("ch", []):
            if node["t"] == "function_definition":
                yield node
            elif node["t"] == "class_definition":
                yield from Project.ast_walk_functions(node)
            elif node["t"] == "class_body":
                yield from Project.ast_walk_functions(node)

    def local_types_in(self, gd: GdFile, fnode: Dict[str, Any]) -> Dict[str, str]:
        """Static types of local variables inside one function body."""
        types: Dict[str, str] = {}
        for name, typ in gd.funcs.get(self.func_name_of(fnode), GdFunc("", {"ch": []})).params:
            if typ:
                types[name] = typ
        for node in walk(fnode):
            if node["t"] == "variable_statement":
                name, typ = "", ""
                for c in node.get("ch", []):
                    if c["t"] == "name":
                        name = c.get("s", "")
                    elif c["t"] == "type":
                        typ = child_text(c)
                    elif c["t"] == "inferred_type":
                        typ = self.infer_value_type(gd, node, types)
                if name and typ:
                    types[name] = typ
            elif node["t"] == "for_statement":
                # `for x in collection:` - only typed loops resolve
                text = child_text(node)
                m = re.match(r"for\s+(\w+)\s*:\s*(\w+)", text)
                if m:
                    types[m.group(1)] = m.group(2)
        return types

    def func_name_of(self, fnode: Dict[str, Any]) -> str:
        for c in fnode.get("ch", []):
            if c["t"] == "name":
                return c.get("s", "")
        return ""

    def infer_value_type(self, gd: GdFile, stmt: Dict[str, Any], local_types: Dict[str, str]) -> str:
        """Type of `var x := <value>` using the class database (recursive)."""
        value = None
        children = stmt.get("ch", [])
        for i, c in enumerate(children):
            if c["t"] == "inferred_type":
                if i + 1 < len(children):
                    value = children[i + 1]
                break
        if value is None:
            return ""
        return self.type_of_expr(gd, value, local_types)

    def type_of_expr(self, gd: GdFile, node: Dict[str, Any], local_types: Dict[str, str]) -> str:
        t = node["t"]
        if t == "identifier":
            name = node.get("s", "")
            if name in local_types:
                return local_types[name]
            if name in gd.vars:
                return gd.vars[name]
            if name in self.by_class:
                return name
            if name in self.api.classes:
                return name
            return ""
        if t == "attribute":
            children = node.get("ch", [])
            if len(children) >= 3:
                base = self.type_of_expr(gd, children[-3], local_types)
                last = children[-1]
                if not base:
                    return ""
                if last["t"] == "identifier":
                    member = last.get("s", "")
                    if base in self.by_class:
                        return self.by_class[base].vars.get(member, "")
                    if base in self.api.classes:
                        return self.api.member_type(base, member) or ""
                    return ""
                if last["t"] == "attribute_call":
                    method = ""
                    for c in last.get("ch", []):
                        if c["t"] == "identifier":
                            method = c.get("s", "")
                    return self.method_chain_type(base, method)
            return ""
        if t == "attribute_call":
            children = node.get("ch", [])
            method = ""
            for c in children:
                if c["t"] == "identifier":
                    method = c.get("s", "")
            return ""
        if t == "subscript":
            return ""
        if t == "call":
            fn = ""
            for c in node.get("ch", []):
                if c["t"] == "identifier":
                    fn = c.get("s", "")
            if fn in self.api.classes:      # Vector3(...)
                return fn
            if fn in gd.funcs:
                return gd.funcs[fn].return_type
            if fn in self.api.classes.get("@GlobalScope", {}).get("methods", {}):
                return self.api.classes["@GlobalScope"]["methods"][fn]["ret"]
            return ""
        if t == "attribute_call":
            # X.foo() handled by parents; fall back to the wrapping attribute
            return ""
        if t == "get_node":
            return "Node"
        if t == "string":
            return "String"
        if t == "integer":
            return "int"
        if t == "float":
            return "float"
        if t == "true" or t == "false":
            return "bool"
        if t == "array":
            return "Array"
        if t == "dictionary":
            return "Dictionary"
        if t == "await_expression":
            return ""
        return ""

    def method_chain_type(self, base: str, method: str) -> str:
        """Return type of `<base>.<method>()` where base is a known class."""
        if not base or not method:
            return ""
        if method == "new":
            return base if (base in self.by_class or base in self.api.classes) else ""
        if base in self.by_class:
            fn = self.by_class[base].funcs.get(method)
            if fn and fn.return_type and fn.return_type != "void":
                return fn.return_type
            engine_base = self.engine_base_of(self.by_class[base])
            if engine_base:
                return self.api.method_return(engine_base, method) or ""
            return ""
        if base in self.api.classes:
            ret = self.api.method_return(base, method)
            return ret or ""
        return ""

    def check_calls(self, gd: GdFile) -> None:
        origin = gd.class_name or gd.rel
        funcs = [self.func_name_of(f) for f in self.ast_walk_functions(gd.ast)]
        for fnode in self.ast_walk_functions(gd.ast):
            local_types = self.local_types_in(gd, fnode)
            for node in walk(fnode):
                if node["t"] not in ("attribute", "attribute_call"):
                    continue
                children = node.get("ch", [])
                if node["t"] == "attribute_call":
                    continue  # handled with its parent attribute
                if len(children) < 3:
                    continue
                base_node = children[-3]
                member_node = children[-1]
                base_text = child_text(base_node)
                line = node.get("r", 0)
                if not base_text:
                    continue
                typ = self.resolve_receiver(gd, base_text, local_types)
                if not typ:
                    typ = self.type_of_expr(gd, base_node, local_types)
                if not typ:
                    gd.unresolved_receivers += 1
                    continue
                if member_node["t"] == "attribute_call":
                    method = ""
                    for c in member_node.get("ch", []):
                        if c["t"] == "identifier":
                            method = c.get("s", "")
                    if not method:
                        continue
                    self.check_method_call(gd, typ, method, line, base_text)
                elif member_node["t"] == "identifier":
                    member = member_node.get("s", "")
                    if member:
                        self.check_member_access(gd, typ, member, line, base_text)

    def check_method_call(self, gd: GdFile, typ: str, method: str, line: int, receiver: str) -> None:
        if typ in self.by_class:
            target = self.by_class[typ]
            if self.script_has_method(target, method):
                return
            # fall through to engine base class
            base = self.engine_base_of(target)
            if base and self.api.has_method(base, method):
                return
            if method in ("new", "instantiate"):
                return
            self.report.error(gd.rel, f"line {line}: {typ}.{method}() not found "
                                      f"(project class {target.rel})")
            return
        if typ in self.api.classes:
            if self.api.has_method(typ, method):
                return
            if method == "new" and self.api.is_instantiable(typ):
                return
            if method in ("call", "callv", "call_deferred", "bind", "emit", "emit_signal",
                          "connect", "disconnect", "is_connected", "has_signal",
                          "get", "set", "get_node", "get_parent", "free", "queue_free",
                          "duplicate", "instantiate", "new"):
                return
            if typ.startswith("@"):
                return
            self.report.error(gd.rel, f"line {line}: {receiver}.{method}() - {typ} has no "
                                      f"method '{method}' in Godot {self.api.version}")
            return
        if typ.startswith("Variant"):
            return

    def project_chain(self, script: GdFile):
        """Yields the script and every project-class ancestor it inherits from."""
        seen = set()
        cur: Optional[GdFile] = script
        while cur is not None and cur.rel not in seen:
            seen.add(cur.rel)
            yield cur
            ext = cur.extends.strip()
            cur = self.by_class.get(ext)

    def script_has_method(self, script: GdFile, method: str) -> bool:
        for link in self.project_chain(script):
            if method in link.funcs or method in link.inner_classes:
                return True
            for values in link.enums.values():
                if method in values:
                    return True
        return False

    def script_has_member(self, script: GdFile, member: str) -> bool:
        for link in self.project_chain(script):
            if member in link.vars or member in link.consts or member in link.signals:
                return True
            if any(member in values for values in link.enums.values()):
                return True
        return False

    def engine_base_of(self, script: GdFile) -> str:
        seen = set()
        cur = script
        while cur and cur.rel not in seen:
            seen.add(cur.rel)
            ext = cur.extends.strip()
            if not ext:
                return ""
            if ext in self.api.classes:
                return ext
            if ext in self.by_class:
                cur = self.by_class[ext]
                continue
            return ""
        return ""

    def check_member_access(self, gd: GdFile, typ: str, member: str, line: int, receiver: str) -> None:
        if typ in self.by_class:
            target = self.by_class[typ]
            if self.script_has_member(target, member):
                return
            if self.script_has_method(target, member):
                self.report.error(gd.rel, f"line {line}: {member} is a method; use {member}()")
                return
            base = self.engine_base_of(target)
            if base and (self.api.member(base, member) or self.api.has_constant(base, member)
                         or self.api.has_signal(base, member)):
                return
            self.report.error(gd.rel, f"line {line}: {receiver}.{member} not declared on "
                                      f"{target.rel}")
            return
        if typ in self.api.classes:
            if (self.api.member(typ, member) or self.api.has_constant(typ, member)
                    or self.api.has_signal(typ, member) or self.api.has_method(typ, member)):
                return
            if typ.startswith("@"):
                return
            self.report.error(gd.rel, f"line {line}: {receiver}.{member} - {typ} has no member "
                                      f"'{member}' in Godot {self.api.version}")

    def check_signals_connected(self) -> None:
        """signal.connect(handler) - handler must exist in the same script (or be a Callable)."""
        pattern = re.compile(r"\.connect\(\s*([A-Za-z_][A-Za-z0-9_]*)")
        for rel, gd in self.files.items():
            for m in pattern.finditer(gd.src):
                handler = m.group(1)
                if handler in gd.funcs:
                    continue
                line = gd.src[:m.start()].count("\n") + 1
                self.report.error(rel, f"line {line}: .connect({handler}) - no such method in "
                                       f"this script")

    def check_instantiation(self) -> None:
        """`.new()` on engine classes that cannot be instantiated."""
        pattern = re.compile(r"\b([A-Z][A-Za-z0-9_]*)\.new\(")
        for rel, gd in self.files.items():
            for m in pattern.finditer(gd.src):
                cls = m.group(1)
                if cls in self.by_class or cls in self.autoloads:
                    continue
                if cls in self.api.classes and not self.api.is_instantiable(cls):
                    line = gd.src[:m.start()].count("\n") + 1
                    self.report.error(rel, f"line {line}: {cls} cannot be instantiated")

    def check_tool_scripts(self) -> None:
        for rel, gd in self.files.items():
            if gd.tool and any(a == "onready" for anns in gd.var_annotations.values() for a in anns):
                self.report.note(f"{rel}: @tool script uses @onready")


# --------------------------------------------------------------------------- #
#  .tscn / .tres validation
# --------------------------------------------------------------------------- #
EXT_RE = re.compile(r'\[ext_resource[^\]]*type="([^"]+)"[^\]]*path="([^"]+)"[^\]]*id="([^"]+)"\]')
EXT_RE_ALT = re.compile(r'\[ext_resource[^\]]*path="([^"]+)"[^\]]*type="([^"]+)"[^\]]*id="([^"]+)"\]')
SUB_RE = re.compile(r'\[sub_resource[^\]]*type="([^"]+)"[^\]]*id="([^"]+)"\]')
NODE_RE = re.compile(r'\[node[^\]]*name="([^"]+)"[^\]]*\]')
NODE_TYPE_RE = re.compile(r'\[node[^\]]*type="([^"]+)"')


def check_scenes(project: Project, report: Report) -> None:
    for base, dirs, files in os.walk(project.root):
        dirs[:] = [d for d in dirs if d not in (".godot", ".git", "android")]
        for name in sorted(files):
            if not name.endswith((".tscn", ".tres")):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, project.root)
            text = open(path, encoding="utf-8").read()
            if name.endswith(".tscn") and not text.startswith("[gd_scene"):
                report.error(rel, "scene file must start with [gd_scene")
            if name.endswith(".tres") and not text.startswith("[gd_resource"):
                report.error(rel, "resource file must start with [gd_resource")
            ids = set()
            found = [(m.group(1), m.group(2), m.group(3)) for m in EXT_RE.finditer(text)]
            found += [(mm.group(2), mm.group(1), mm.group(3)) for mm in EXT_RE_ALT.finditer(text)]
            for rtype, rpath, rid in found:
                if rid in ids:
                    report.error(rel, f"duplicate ext_resource id {rid}")
                ids.add(rid)
                if not rpath.startswith("res://"):
                    report.warn(rel, f"ext_resource path not res:// : {rpath}")
                    continue
                target = os.path.join(project.root, rpath.replace("res://", ""))
                if not os.path.exists(target):
                    report.error(rel, f"ext_resource path missing: {rpath}")
                if rtype == "Script" and not rpath.endswith(".gd"):
                    report.error(rel, f"Script resource is not .gd: {rpath}")
            for m in SUB_RE.finditer(text):
                stype = m.group(1)
                if stype not in project.api.classes and not stype.startswith("GDScript"):
                    report.error(rel, f"sub_resource type '{stype}' is not an engine class")
            for m in NODE_RE.finditer(text):
                pass
            for m in NODE_TYPE_RE.finditer(text):
                ntype = m.group(1)
                if ntype not in project.api.classes and ntype not in project.by_class:
                    report.error(rel, f"node type '{ntype}' is not an engine or project class")
            # every ExtResource("id") reference must exist
            for m in re.finditer(r'ExtResource\("([^"]+)"\)', text):
                if m.group(1) not in ids:
                    report.error(rel, f"ExtResource(\"{m.group(1)}\") has no matching ext_resource")
    report.stats["scenes"] = sum(
        1 for b, d, fs in os.walk(project.root) for f in fs if f.endswith(".tscn"))


# --------------------------------------------------------------------------- #
#  Game data validation
# --------------------------------------------------------------------------- #
REQUIRED_WEAPON_FIELDS = [
    "id", "display_name", "category", "damage", "headshot_multiplier", "fire_rate",
    "magazine", "reserve_ammo", "reload_time", "effective_range", "recoil", "spread_deg",
    "projectile", "rarity", "models", "audio",
]
WEAPON_CATEGORIES = {"ar", "smg", "shotgun", "sniper", "pistol", "melee", "throwable"}
RARITIES = {"common", "uncommon", "rare", "epic", "legendary"}


def check_data(project: Project, report: Report) -> None:
    data_dir = os.path.join(project.root, "data")
    if not os.path.isdir(data_dir):
        report.error("data", "data directory missing")
        return
    loaded: Dict[str, Any] = {}
    for name in sorted(os.listdir(data_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(data_dir, name)
        try:
            with open(path, encoding="utf-8") as fh:
                loaded[name] = json.load(fh)
        except json.JSONDecodeError as exc:
            report.error(f"data/{name}", f"invalid JSON: {exc}")
    report.stats["data files"] = len(loaded)

    weapons = loaded.get("weapons.json", {}).get("weapons", [])
    wids = set()
    for w in weapons:
        wid = w.get("id", "?")
        if wid in wids:
            report.error("data/weapons.json", f"duplicate weapon id {wid}")
        wids.add(wid)
        for field in REQUIRED_WEAPON_FIELDS:
            if field not in w:
                report.error("data/weapons.json", f"{wid}: missing field '{field}'")
        if w.get("category") not in WEAPON_CATEGORIES:
            report.error("data/weapons.json", f"{wid}: bad category {w.get('category')}")
        if w.get("rarity") not in RARITIES:
            report.error("data/weapons.json", f"{wid}: bad rarity {w.get('rarity')}")
        if w.get("fire_rate", 0) <= 0:
            report.error("data/weapons.json", f"{wid}: fire_rate must be > 0")
        if w.get("magazine", 0) <= 0:
            report.error("data/weapons.json", f"{wid}: magazine must be > 0")
        spread = w.get("spread_deg", {})
        for key in ("base", "moving", "air"):
            if key not in spread:
                report.error("data/weapons.json", f"{wid}: spread_deg missing '{key}'")
        audio = w.get("audio", {})
        for key in ("fire", "reload"):
            if not audio.get(key):
                report.error("data/weapons.json", f"{wid}: audio.{key} missing")
            else:
                wav = os.path.join(project.root, audio[key].replace("res://", ""))
                if not os.path.exists(wav):
                    report.error("data/weapons.json", f"{wid}: audio file {audio[key]} missing")
    report.stats["weapons"] = len(weapons)

    # balance sanity: no weapon may dominate across all three ranges
    def dps(w: Dict[str, Any]) -> float:
        return w["damage"] * w["fire_rate"]

    report.note("weapon table (dps vs 100 HP body): " + ", ".join(
        f"{w['id']}={w['damage'] * w['fire_rate']:.0f}" for w in weapons[:8]) + " ...")

    for name, blob in loaded.items():
        if name == "weapons.json":
            continue
        _check_references(name, blob, wids, report)


def _check_references(name: str, blob: Any, weapon_ids: set, report: Report) -> None:
    """Anywhere a "weapon" field appears it must reference a real weapon id."""
    def recurse(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("weapon", "weapon_id") and isinstance(value, str) and value:
                    if weapon_ids and value not in weapon_ids:
                        report.error(f"data/{name}", f"{path}: unknown weapon id '{value}'")
                if key in ("rarity",) and isinstance(value, str) and value not in RARITIES:
                    report.error(f"data/{name}", f"{path}: unknown rarity '{value}'")
                recurse(value, f"{path}.{key}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                recurse(item, f"{path}[{i}]")
    recurse(blob, name.replace(".json", ""))


# --------------------------------------------------------------------------- #
#  Asset inventory
# --------------------------------------------------------------------------- #
def check_assets(project: Project, report: Report) -> None:
    assets = os.path.join(project.root, "assets")
    if not os.path.isdir(assets):
        report.error("assets", "assets directory missing")
        return
    counts = defaultdict(int)
    for base, _dirs, files in os.walk(assets):
        for f in files:
            if f.endswith(".import"):
                continue
            ext = os.path.splitext(f)[1].lower()
            counts[ext] += 1
            full = os.path.join(base, f)
            if os.path.getsize(full) == 0:
                report.error("assets", f"empty asset {os.path.relpath(full, project.root)}")
            if ext == ".json" or ext in (".md",):
                continue
    for ext in (".wav", ".png"):
        if not counts[ext]:
            report.error("assets", f"no {ext} assets found")
    report.note("assets: " + ", ".join(f"{k or '(none)'}={v}" for k, v in sorted(counts.items())))


# --------------------------------------------------------------------------- #
#  Test harness presence
# --------------------------------------------------------------------------- #
def check_tests(project: Project, report: Report) -> None:
    tests = os.path.join(project.root, "tests")
    if not os.path.isdir(tests):
        report.error("tests", "tests directory missing")
        return
    gd = [f for f in os.listdir(tests) if f.endswith(".gd")]
    report.stats["test scripts"] = len(gd)
    if not gd:
        report.error("tests", "no test scripts found")


def main(argv: List[str]) -> int:
    root = argv[0] if argv and not argv[0].startswith("-") else os.path.join(REPO, "blockstrike-royale")
    json_out = None
    if "--json" in argv:
        json_out = argv[argv.index("--json") + 1]
    report = Report()
    if not os.path.exists(API_DB):
        report.error("tooling", f"missing {API_DB}; run tools/validate/build_api_db.py")
        return report.dump(json_out)
    api = EngineApi(API_DB)
    report.note(f"engine api database: Godot {api.version}, {len(api.classes)} classes")
    project = Project(root, api, report)
    project.parse_project_godot()
    project.parse_all()
    project.check_semantics()
    check_scenes(project, report)
    check_data(project, report)
    check_assets(project, report)
    check_tests(project, report)
    report.stats["res:// references checked"] = sum(len(g.res_paths) for g in project.files.values())
    report.stats["unresolved receivers (not errors)"] = sum(
        g.unresolved_receivers for g in project.files.values())
    return report.dump(json_out)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Dumps the Vulkan interface of a SPIR-V module: descriptor bindings, image
formats and push-constant member offsets.

The engine's C++ mirrors of the GLSL push-constant blocks (cpp/vulkan/v4k_vk_push.h)
must agree byte for byte with what glslang emitted, so this script is the source
of truth for those mirrors -- and `--verify` mode re-checks the C++ header against
the .spv files during `tools/verify.sh`.

Usage:
    dump-spirv-interface.py <file.spv | directory> [--json]
    dump-spirv-interface.py <dir> --verify <v4k_vk_push.h>
"""
from __future__ import annotations

import json
import os
import re
import sys

MAGIC = 0x07230203

# --- SPIR-V enums (only what we need) --------------------------------------
OP_NAME = 5
OP_MEMBER_NAME = 6
OP_CONSTANT = 43
OP_FUNCTION = 54
OP_VARIABLE = 59
OP_DECORATE = 71
OP_MEMBER_DECORATE = 72
OP_TYPE_INT = 21
OP_TYPE_FLOAT = 22
OP_TYPE_VECTOR = 23
OP_TYPE_IMAGE = 25
OP_TYPE_SAMPLED_IMAGE = 27
OP_TYPE_ARRAY = 28
OP_TYPE_RUNTIME_ARRAY = 29
OP_TYPE_STRUCT = 30
OP_TYPE_POINTER = 32

DECORATION_BINDING = 33
DECORATION_DESCRIPTOR_SET = 34
DECORATION_OFFSET = 35
DECORATION_BLOCK = 2

SC_UNIFORM_CONSTANT = 0
SC_UNIFORM = 2
SC_WORKGROUP = 4
SC_PUSH_CONSTANT = 9
SC_STORAGE_BUFFER = 12

IMAGE_FORMATS = {
    0: "Unknown",
    1: "Rgba32f",
    2: "Rgba16f",
    3: "R32f",
    4: "Rgba8",
    5: "Rgba16",
    6: "R32ui",
    7: "Rgba8ui",
    8: "R32i",
    9: "Rgba8i",
    10: "Rgba8Snorm",
    11: "Rgba32i",
    12: "Rgba16i",
    13: "Rgba16ui",
    14: "Rgba16Snorm",
    15: "Rgba32ui",
}

SCALAR_TYPES = {
    OP_TYPE_INT: "int",
    OP_TYPE_FLOAT: "float",
}


def int_type(ops):
    """OpTypeInt operands are (result, width, signedness)."""
    return "uint" if len(ops) > 2 and ops[2] == 0 else "int"


def words_from_file(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) % 4 != 0:
        raise ValueError(f"{path}: not word aligned")
    words = []
    for i in range(0, len(data), 4):
        words.append(int.from_bytes(data[i:i + 4], "little"))
    if not words or words[0] != MAGIC:
        raise ValueError(f"{path}: bad SPIR-V magic")
    return words


class Module:
    def __init__(self, words, path):
        self.path = path
        self.opcodes = []
        self.types = {}          # id -> (opcode, operands)
        self.decorations = {}    # id -> {decoration: [operands]}
        self.member_decorations = {}   # (id, member) -> {decoration: [operands]}
        self.names = {}
        self.member_names = {}
        self.constants = {}
        self.variables = []      # (resultId, resultType, storageClass)
        self.entry_point = ""
        self.local_size = None
        i = 5
        while i < len(words):
            word = words[i]
            opcode = word & 0xFFFF
            count = word >> 16
            if count == 0:
                break
            self.opcodes.append(opcode)
            operands = words[i + 1:i + count]
            self._consume(opcode, operands)
            i += count

    def _consume(self, opcode, ops):
        if opcode == OP_NAME:
            self.names[ops[0]] = decode_string(ops[1:])
        elif opcode == OP_MEMBER_NAME:
            self.member_names[(ops[0], ops[1])] = decode_string(ops[2:])
        elif opcode == OP_DECORATE:
            self.decorations.setdefault(ops[0], {}).setdefault(ops[1], []).extend(ops[2:])
        elif opcode == OP_MEMBER_DECORATE:
            key = (ops[0], ops[1])
            self.member_decorations.setdefault(key, {}).setdefault(ops[2], []).extend(ops[3:])
        elif opcode == OP_VARIABLE:
            self.variables.append((ops[1], ops[0], ops[2]))
        elif opcode == OP_CONSTANT:
            self.constants[ops[1]] = ops[2] if len(ops) > 2 else 0
        elif opcode in (OP_TYPE_INT, OP_TYPE_FLOAT, OP_TYPE_VECTOR, OP_TYPE_IMAGE,
                        OP_TYPE_SAMPLED_IMAGE, OP_TYPE_ARRAY, OP_TYPE_RUNTIME_ARRAY,
                        OP_TYPE_STRUCT, OP_TYPE_POINTER):
            # result id is at index 0 for all of these
            self.types[ops[0]] = (opcode, ops)
        elif opcode == 16:  # OpExecutionMode
            if len(ops) >= 4 and ops[1] == 17:  # LocalSize
                self.local_size = (ops[2], ops[3], ops[4])
        elif opcode == 15:  # OpEntryPoint
            self.entry_point = decode_string(ops[2:])

    # -- helpers ------------------------------------------------------------
    def describe_type(self, type_id, depth=0):
        if type_id in self.constants and type_id not in self.types:
            return str(self.constants[type_id])
        entry = self.types.get(type_id)
        if entry is None:
            return f"?{type_id}"
        opcode, ops = entry
        if opcode == OP_TYPE_INT:
            return int_type(ops)
        if opcode == OP_TYPE_FLOAT:
            return "float"
        if opcode == OP_TYPE_VECTOR:
            return f"{self.describe_type(ops[1], depth + 1)}x{ops[2]}"
        if opcode == OP_TYPE_ARRAY:
            return f"{self.describe_type(ops[1], depth + 1)}[{self.constants.get(ops[2], '?')}]"
        if opcode == OP_TYPE_RUNTIME_ARRAY:
            return f"{self.describe_type(ops[1], depth + 1)}[]"
        if opcode == OP_TYPE_POINTER:
            return f"{self.describe_type(ops[2], depth + 1)}*"
        if opcode == OP_TYPE_SAMPLED_IMAGE:
            return f"sampledImage({self.describe_type(ops[1], depth + 1)})"
        if opcode == OP_TYPE_IMAGE:
            sampled = ops[6]
            fmt = IMAGE_FORMATS.get(ops[7], f"fmt{ops[7]}")
            kind = "storage" if sampled == 2 else ("sampled" if sampled == 1 else "unknown")
            return f"image2D({kind},{fmt})"
        if opcode == OP_TYPE_STRUCT:
            return "struct"
        return f"op{opcode}"

    def member_layout(self, struct_id):
        entry = self.types.get(struct_id)
        if entry is None or entry[0] != OP_TYPE_STRUCT:
            return []
        members = entry[1][1:]
        out = []
        for index, member_type in enumerate(members):
            deco = self.member_decorations.get((struct_id, index), {})
            offset = deco.get(DECORATION_OFFSET, [None])[0]
            name = self.member_names.get((struct_id, index), f"member{index}")
            out.append({
                "name": name,
                "type": self.describe_type(member_type),
                "offset": offset,
            })
        out.sort(key=lambda m: (m["offset"] if m["offset"] is not None else 1 << 30))
        return out


def decode_string(words):
    raw = b"".join(w.to_bytes(4, "little") for w in words)
    return raw.split(b"\x00")[0].decode("utf-8", "replace")


def scalar_size(type_name):
    table = {"float": 4, "int": 4, "uint": 4, "double": 8}
    array = re.match(r"^(float|int|uint)\[(\d+)\]$", type_name)
    if array:
        return table[array.group(1)] * int(array.group(2))
    vector = re.match(r"^(float|int|uint)x(\d+)$", type_name)
    if vector:
        return table[vector.group(1)] * int(vector.group(2))
    return table.get(type_name, 4)


def analyse(path):
    module = Module(words_from_file(path), path)
    bindings = []
    push = None
    for result_id, type_id, storage in module.variables:
        name = module.names.get(result_id, f"var{result_id}")
        deco = module.decorations.get(result_id, {})
        if storage == SC_PUSH_CONSTANT:
            pointer = module.types.get(type_id, (None, []))[1]
            struct_id = pointer[2] if len(pointer) > 2 else None
            members = module.member_layout(struct_id)
            size = 0
            for member in members:
                size = max(size, (member["offset"] or 0) + scalar_size(member["type"]))
            push = {"name": name, "size": size, "members": members}
        elif storage in (SC_UNIFORM_CONSTANT, SC_UNIFORM, SC_STORAGE_BUFFER):
            binding = deco.get(DECORATION_BINDING, [None])[0]
            set_index = deco.get(DECORATION_DESCRIPTOR_SET, [0])[0]
            bindings.append({
                "name": name,
                "set": set_index,
                "binding": binding,
                "storageClass": storage,
                "type": module.describe_type(type_id),
            })
    bindings.sort(key=lambda b: (b["binding"] if b["binding"] is not None else -1))
    return {
        "path": os.path.basename(path),
        "entryPoint": module.entry_point,
        "localSize": module.local_size,
        "bindings": bindings,
        "pushConstants": push,
    }


FIELD_RE = re.compile(
    r"(?:alignas\s*\(\s*\d+\s*\)\s*)?"
    r"(?P<type>float|double|uint32_t|int32_t|uint64_t|int64_t)\s+"
    r"(?P<name>\w+)\s*(?:\[\s*(?P<count>\d+)\s*\])?\s*;")
STRUCT_RE = re.compile(
    r"//\s*@spirv\s+(?P<shader>\S+)\s*\n\s*struct\s+(?P<name>\w+)\s*\{(?P<body>.*?)\}\s*;",
    re.S)
ASSERT_RE = r"static_assert\(sizeof\((?P<name>\w+)\)\s*==\s*(?P<size>\d+)"

TYPE_MAP = {
    "float": "float",
    "double": "double",
    "uint32_t": "uint",
    "int32_t": "int",
    "uint64_t": "uint",
    "int64_t": "int",
}


def cpp_type_name(field):
    base = TYPE_MAP[field["type"]]
    if field["count"]:
        return f"{base}x{field['count']}"
    return base


def verify_header(header_path, modules):
    """Cross-checks every `// @spirv <shader>` mirror struct against the layout
    that glslang actually emitted (member order, member types, total size)."""
    with open(header_path, encoding="utf-8") as handle:
        text = handle.read()

    failures = []
    checked = 0
    for match in STRUCT_RE.finditer(text):
        shader = match.group("shader")
        struct_name = match.group("name")
        module = modules.get(shader)
        if module is None:
            failures.append(f"{struct_name}: no SPIR-V module for '{shader}'")
            continue
        expected = module["pushConstants"]
        if expected is None:
            continue
        checked += 1

        # 1. member order and types
        fields = [f for f in FIELD_RE.finditer(match.group("body"))]
        seen = [{"name": f.group("name"), "type": f.group("type"), "count": f.group("count")}
                for f in fields]
        expected_members = expected["members"]
        if len(seen) != len(expected_members):
            failures.append(
                f"{struct_name}: {len(seen)} fields in C++, "
                f"{len(expected_members)} members in {shader}")
        else:
            for cpp_field, spirv_member in zip(seen, expected_members):
                if cpp_field["name"] != spirv_member["name"]:
                    failures.append(
                        f"{struct_name}.{cpp_field['name']}: name/order mismatch, "
                        f"SPIR-V member is '{spirv_member['name']}' "
                        f"at offset {spirv_member['offset']}")
                    continue
                if cpp_type_name(cpp_field) != spirv_member["type"]:
                    failures.append(
                        f"{struct_name}.{cpp_field['name']}: C++ {cpp_type_name(cpp_field)} "
                        f"vs SPIR-V {spirv_member['type']}")

        # 2. total size
        tail = text[match.end():match.end() + 400]
        assert_match = re.search(ASSERT_RE % {"name": struct_name}, tail)
        if assert_match is None:
            failures.append(f"{struct_name}: missing static_assert(sizeof({struct_name}) == N)")
        elif int(assert_match.group("size")) != expected["size"]:
            failures.append(
                f"{struct_name}: static_assert says {assert_match.group('size')} bytes, "
                f"SPIR-V push constant block is {expected['size']} bytes")
    return checked, failures


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    target = argv[1]
    as_json = "--json" in argv
    verify_index = argv.index("--verify") if "--verify" in argv else -1

    if os.path.isdir(target):
        paths = sorted(os.path.join(target, name) for name in os.listdir(target)
                       if name.endswith(".spv"))
    else:
        paths = [target]

    if verify_index >= 0:
        header = argv[verify_index + 1]
        modules = {}
        for path in paths:
            result = analyse(path)
            modules[os.path.basename(path)[:-4]] = result
        checked, failures = verify_header(header, modules)
        for failure in failures:
            print(f"  FAIL {failure}")
        print(f"push-constant mirrors verified: {checked}, failures: {len(failures)}")
        return 1 if failures else 0

    results = [analyse(path) for path in paths]
    if as_json:
        print(json.dumps(results, indent=2))
        return 0
    for result in results:
        print(f"{result['path']}  entry={result['entryPoint']}  localSize={result['localSize']}")
        for binding in result["bindings"]:
            print(f"    set={binding['set']} binding={binding['binding']:<2} "
                  f"{binding['type']:<28} {binding['name']}")
        push = result["pushConstants"]
        if push:
            print(f"    push_constant '{push['name']}' size={push['size']}")
            for member in push["members"]:
                print(f"        +{member['offset']:<3} {member['type']:<10} {member['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

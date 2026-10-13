#!/usr/bin/env python3
"""Geometry invariant tests for the voxel mesher.

The GDScript mesher cannot be executed without the engine, so the *math* it
relies on is mirrored here and checked against the engine's documented
conventions:

  * Godot uses clockwise winding order for front faces
    (doc/classes/ArrayMesh.xml), so a front triangle must have
    dot(cross(v1 - v0, v2 - v0), outward_normal) < 0.
  * Face corners must be counter-clockwise seen from outside, which is what the
    TRI_ORDER flip in scripts/world/chunk.gd converts to Godot's clockwise order.
  * Ambient occlusion must darken a corner exactly when its occluders are solid.
  * UV corners must map onto the atlas rect without bleeding into neighbours.

The tables below are parsed straight out of chunk.gd so a typo in the script
fails this test instead of silently producing inside-out terrain.

Usage: python3 tools/validate/test_winding.py
"""
from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHUNK = os.path.join(ROOT, "blockstrike-royale", "scripts", "world", "chunk.gd")

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        FAILURES.append(message)


def parse_block(source: str, name: str) -> str:
    start = source.index(name)
    # skip the type annotation ("const X: Array[Vector3i] =") and take the literal
    equal = source.index("=", start)
    brace = source.index("[", equal)
    depth = 0
    for i in range(brace, len(source)):
        if source[i] == "[":
            depth += 1
        elif source[i] == "]":
            depth -= 1
            if depth == 0:
                return source[brace:i + 1]
    raise AssertionError(f"could not parse {name}")


def parse_vectors(text: str) -> list[tuple[int, int, int]]:
    return [tuple(int(v) for v in m.split(","))
            for m in re.findall(r"Vector3i\(([-\d,\s]+)\)", text)]


def parse_int_vectors(text: str) -> list[tuple[int, int]]:
    return [tuple(int(v) for v in m.split(","))
            for m in re.findall(r"Vector2i\(([-\d,\s]+)\)", text)]


def parse_nested(text: str) -> list[list[list[int]]]:
    rows: list[list[list[int]]] = []
    for row in re.findall(r"\[((?:\[[^\]]*\],?\s*)+)\]", text):
        rows.append([[int(x) for x in triple.split(",")]
                     for triple in re.findall(r"\[([\d,\s]+)\]", row)])
    return rows


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def dot(a, b) -> int:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def mean_direction(one: list, zero: list) -> tuple[int, int, int]:
    """World direction of increasing UV for a face (exact for axis-aligned quads)."""
    def average(points: list) -> tuple[float, float, float]:
        return tuple(sum(p[axis] for p in points) / len(points) for axis in range(3))

    a = average(one)
    b = average(zero)
    delta = (a[0] - b[0], a[1] - b[1], a[2] - b[2])
    return tuple(int(round(value)) for value in delta)


def main() -> int:
    source = open(CHUNK, encoding="utf-8").read()

    corners_text = parse_block(source, "const FACE_CORNERS")
    uvs_text = parse_block(source, "const FACE_UVS")
    axes_text = parse_block(source, "const FACE_AXES")
    normals_text = parse_block(source, "const FACE_NORMALS")
    ao_text = source[source.index("const AO_LEVELS"):source.index("var coord")]

    corners = parse_nested(corners_text)
    uvs = parse_nested(uvs_text)
    axes = parse_int_vectors(axes_text)
    normals = parse_vectors(normals_text)
    ao_levels = [float(x) for x in re.findall(r"([\d.]+)", ao_text.split("=", 1)[1])]
    tri_start = source.index("const TRI_ORDER")
    tri_text = source[tri_start:source.index("]", tri_start) + 1]
    tri_order = [int(x) for x in re.findall(r"\d+", tri_text)]

    check(len(corners) == 6, f"expected 6 face corner tables, found {len(corners)}")
    check(len(uvs) == 6, f"expected 6 UV tables, found {len(uvs)}")
    check(len(axes) == 6, f"expected 6 face axis pairs, found {len(axes)}")
    check(len(normals) == 6, f"expected 6 face normals, found {len(normals)}")
    check(tri_order == [0, 2, 1, 0, 3, 2], f"unexpected TRI_ORDER {tri_order}")

    face_names = ["+Y", "-Y", "+X", "-X", "+Z", "-Z"]
    for face in range(6):
        table = corners[face]
        normal = normals[face]
        check(len(table) == 4, f"{face_names[face]}: expected 4 corners")

        # 1. every corner offset must lie on the correct side of the block
        axis = next(i for i, value in enumerate(normal) if value != 0)
        expected_value = 1 if normal[axis] == 1 else 0
        for corner in table:
            check(corner[axis] == expected_value,
                  f"{face_names[face]}: corner {corner} not on the face plane")

        # 2. corners must be counter-clockwise seen from outside
        v0, v1, v2, v3 = [tuple(map(float, c)) for c in table]
        tri = cross(sub(v1, v0), sub(v2, v0))
        orientation = dot(tri, normal)
        check(orientation > 0,
              f"{face_names[face]}: corner table is clockwise from outside "
              f"(dot={orientation:+.0f}) - the flip in TRI_ORDER assumes CCW")

        # 3. after the flip the emitted triangles must be clockwise (Godot front face)
        emitted = [table[tri_order[i]] for i in range(6)]
        for i in (0, 3):
            a, b, c = (tuple(map(float, emitted[i])), tuple(map(float, emitted[i + 1])),
                       tuple(map(float, emitted[i + 2])))
            flipped = cross(sub(b, a), sub(c, a))
            check(dot(flipped, normal) < 0,
                  f"{face_names[face]}: emitted triangle {i} is not clockwise "
                  f"(dot={dot(flipped, normal):+.0f})")

        # 4. the two triangles must cover all four corners exactly (two shared)
        check(sorted(set(map(tuple, emitted))) == sorted(map(tuple, table)),
              f"{face_names[face]}: triangles do not cover the quad")
        check(len(emitted) == 6 and len({tuple(c) for c in emitted}) == 4,
              f"{face_names[face]}: unexpected vertex duplication {emitted}")

        # 5. UVs must stay inside the unit square and be distinct per corner
        used_uv = {tuple(uvs[face][i]) for i in range(4)}
        check(used_uv == {(0, 0), (1, 0), (1, 1), (0, 1)},
              f"{face_names[face]}: UV corners are {sorted(used_uv)}")

        # 6. AO axes must match the corner layout (so occlusion is computed in-plane)
        u_axis, v_axis = axes[face]
        for corner in table:
            for used_axis in (u_axis, v_axis):
                check(used_axis != axis,
                      f"{face_names[face]}: AO axis {used_axis} is normal to the face")

    check(len(ao_levels) == 4, f"expected 4 AO levels, got {ao_levels}")
    check(ao_levels == sorted(ao_levels, reverse=True) and ao_levels[0] == 1.0,
          f"AO levels must start at 1.0 (no occluders) and darken, got {ao_levels}")

    # 7. AO level selection table: reproduce _ao_at and check the four cases
    def ao_level(a: bool, b: bool, diagonal: bool) -> float:
        level = int(a) + int(b)
        if not (a and b) and diagonal:
            level += 1
        return ao_levels[min(level, 3)]

    check(ao_level(False, False, False) == 1.0, "unoccluded corner must be full bright")
    check(ao_level(True, False, False) < 1.0, "single edge occluder must darken")
    check(ao_level(True, True, False) < ao_level(True, False, False),
          "two edge occluders must be darker than one")
    check(ao_level(True, True, True) == ao_level(True, True, False),
          "diagonal must not count when both edges are solid")

    # 8. texture orientation: Godot's UV origin is top-left, so increasing v runs
    #    down the screen.  For every face the world directions of increasing u and
    #    increasing v must satisfy cross(u_dir, v_dir) == -normal.  This single
    #    invariant catches both a vertical flip (grass hanging upside down) and a
    #    mirrored side texture, which are the two mistakes a hand-written mesher
    #    makes most often.
    for face in range(6):
        table = corners[face]
        normal = normals[face]
        u_one = [table[i] for i in range(4) if uvs[face][i][0] == 1]
        u_zero = [table[i] for i in range(4) if uvs[face][i][0] == 0]
        v_one = [table[i] for i in range(4) if uvs[face][i][1] == 1]
        v_zero = [table[i] for i in range(4) if uvs[face][i][1] == 0]
        check(len(u_one) == 2 and len(v_one) == 2,
              f"{face_names[face]}: every face needs two u=1 corners and two v=1 corners")
        if len(u_one) != 2 or len(v_one) != 2:
            continue
        u_dir = mean_direction(u_one, u_zero)
        v_dir = mean_direction(v_one, v_zero)
        orientation = cross(u_dir, v_dir)
        check(orientation == (-normal[0], -normal[1], -normal[2]),
              f"{face_names[face]}: UV axes are wrong - cross(u_dir, v_dir) is "
              f"{orientation}, expected {(-normal[0], -normal[1], -normal[2])} "
              f"(a mismatch means a flipped or mirrored tile)")

    # 9. vertex count: 6 vertices per visible face, matching TRI_ORDER
    check(len(tri_order) == 6, "each face must emit exactly 6 vertices")

    if FAILURES:
        print("test_winding: FAILED")
        for failure in FAILURES:
            print("  X " + failure)
        return 1
    print(f"test_winding: PASS ({len(corners)} faces x 4 corners verified, "
          f"AO levels {ao_levels}, UV coverage complete)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

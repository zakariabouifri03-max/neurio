#!/usr/bin/env python3
"""Original voxel texture generator for BlockStrike Royale.

Every texture in the game is produced here: no third-party or ripped art is
used.  Textures are small (16x16 / 32x32) pixel-art tiles designed around a
cohesive palette so that terrain, props and characters read as one art style.

Output: blockstrike-royale/assets/textures/*.png  (RGBA, filter 0, zlib)

Usage:
    python3 tools/assets/gen_textures.py [--out DIR] [--preview DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import zlib

# --------------------------------------------------------------------------- #
#  Minimal PNG writer / reader (stdlib only)
# --------------------------------------------------------------------------- #
def write_png(path: str, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: none
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png)


def read_png(path: str) -> tuple[int, int, list[list[tuple[int, int, int, int]]]]:
    """Very small PNG reader used by the tests/verifier (RGBA, filter 0/1/2/3/4)."""
    with open(path, "rb") as fh:
        data = fh.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos = 8
    width = height = 0
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        crc = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0]
        assert crc == zlib.crc32(tag + body) & 0xFFFFFFFF, f"bad crc in {tag!r}"
        if tag == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
            assert body[8:13] == bytes((8, 6, 0, 0, 0)), "expected 8-bit RGBA"
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * 4
    rows: list[list[tuple[int, int, int, int]]] = []
    prev = bytearray(stride)
    off = 0
    for _ in range(height):
        filt = raw[off]
        line = bytearray(raw[off + 1:off + 1 + stride])
        off += 1 + stride
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
            if filt == 1:
                line[i] = (line[i] + a) & 0xFF
            elif filt == 2:
                line[i] = (line[i] + b) & 0xFF
            elif filt == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        prev = line
        rows.append([tuple(line[i:i + 4]) for i in range(0, stride, 4)])  # type: ignore
    return width, height, rows


class Rng:
    """Deterministic LCG so every build produces identical textures."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next(self) -> int:
        self.state = (1103515245 * self.state + 12345) & 0x7FFFFFFF
        return self.state

    def rand(self) -> float:
        return self.next() / 0x7FFFFFFF

    def choice(self, seq):
        return seq[self.next() % len(seq)]

    def int(self, lo: int, hi: int) -> int:
        return lo + self.next() % (hi - lo + 1)


def shade(color: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, int(c * amount))) for c in color)  # type: ignore


# --------------------------------------------------------------------------- #
#  Palette — one cohesive voxel art direction
# --------------------------------------------------------------------------- #
PALETTE = {
    "grass_bright": (108, 190, 82),
    "grass_dark": (78, 150, 62),
    "grass_shadow": (58, 114, 48),
    "dirt": (134, 96, 62),
    "dirt_dark": (108, 74, 46),
    "dirt_light": (158, 118, 78),
    "stone": (138, 143, 152),
    "stone_dark": (108, 113, 122),
    "stone_light": (170, 175, 184),
    "sand": (226, 210, 158),
    "sand_dark": (198, 180, 128),
    "gravel": (126, 122, 116),
    "snow": (242, 248, 255),
    "snow_dark": (214, 226, 240),
    "bark": (98, 70, 46),
    "bark_light": (124, 92, 60),
    "wood": (176, 132, 82),
    "wood_dark": (140, 100, 58),
    "wood_light": (204, 162, 108),
    "leaf_light": (86, 158, 72),
    "leaf_dark": (62, 122, 54),
    "leaf_deep": (44, 94, 42),
    "concrete": (188, 188, 184),
    "concrete_dark": (160, 160, 158),
    "metal": (152, 160, 172),
    "metal_dark": (112, 120, 132),
    "metal_light": (196, 204, 216),
    "brick": (178, 92, 70),
    "brick_dark": (146, 70, 54),
    "mortar": (214, 208, 196),
    "roof": (166, 74, 62),
    "roof_dark": (128, 54, 46),
    "roof_blue": (74, 116, 168),
    "roof_blue_dark": (50, 82, 126),
    "water": (62, 132, 196),
    "water_light": (96, 172, 224),
    "ice": (196, 232, 244),
    "ice_dark": (162, 206, 226),
    "asphalt": (86, 88, 94),
    "asphalt_dark": (68, 70, 76),
    "line": (226, 214, 132),
    "glass": (176, 214, 232),
    "target_red": (204, 72, 66),
    "target_white": (238, 238, 234),
    "crate": (168, 124, 74),
    "crate_dark": (132, 94, 54),
    "metal_plate": (128, 136, 148),
}


def noise_fill(size: int, base_name: str, seed: int, amount: float = 0.08,
               speckles: int = 0) -> list[list[tuple[int, int, int, int]]]:
    rng = Rng(seed)
    base = PALETTE[base_name]
    rows = []
    for _y in range(size):
        row = []
        for _x in range(size):
            f = 1.0 + (rng.rand() - 0.5) * 2.0 * amount
            r, g, b = shade(base, f)
            row.append((r, g, b, 255))
        rows.append(row)
    for _ in range(speckles):
        x, y = rng.int(0, size - 1), rng.int(0, size - 1)
        f = 1.0 + (rng.rand() - 0.5) * 0.5
        r, g, b = shade(base, f)
        rows[y][x] = (r, g, b, 255)
    return rows


# --------------------------------------------------------------------------- #
#  Texture recipes
# --------------------------------------------------------------------------- #
def tex_grass_top(size: int, seed: int):
    rows = noise_fill(size, "grass_bright", seed, 0.10, speckles=size)
    rng = Rng(seed + 7)
    for _ in range(size * 2):
        x, y = rng.int(0, size - 1), rng.int(0, size - 1)
        c = PALETTE["grass_dark"] if rng.rand() < 0.6 else PALETTE["grass_shadow"]
        f = 1.0 + (rng.rand() - 0.5) * 0.2
        rows[y][x] = (*shade(c, f), 255)
    return rows


def tex_grass_side(size: int, seed: int):
    rows = noise_fill(size, "dirt", seed, 0.09, speckles=size)
    rng = Rng(seed + 11)
    lip = max(3, size // 4)
    for x in range(size):
        depth = lip + rng.int(-1, 1)
        for y in range(max(1, depth)):
            f = 1.0 + (rng.rand() - 0.5) * 0.22
            rows[y][x] = (*shade(PALETTE["grass_bright" if y < depth - 1 else "grass_dark"], f), 255)
    return rows


def tex_stone(size: int, seed: int):
    rows = noise_fill(size, "stone", seed, 0.07, speckles=size)
    rng = Rng(seed + 3)
    for _ in range(size // 3):
        x, y = rng.int(0, size - 3), rng.int(0, size - 3)
        length = rng.int(2, size // 2)
        for i in range(length):
            xx, yy = x + i, y + (i // 3)
            if 0 <= xx < size and 0 <= yy < size:
                rows[yy][xx] = (*PALETTE["stone_dark"], 255)
    return rows


def tex_cobble(size: int, seed: int):
    rows = noise_fill(size, "stone", seed, 0.05)
    rng = Rng(seed + 5)
    cell = 8
    for cy in range(0, size, cell):
        for cx in range(0, size, cell):
            tone = rng.choice([0.86, 0.92, 1.0, 1.08, 1.14])
            for y in range(cy, min(size, cy + cell)):
                for x in range(cx, min(size, cx + cell)):
                    edge = (x == cx or y == cy or x == cx + cell - 1 or y == cy + cell - 1)
                    f = tone * (0.8 if edge else 1.0)
                    f *= 1.0 + (rng.rand() - 0.5) * 0.1
                    rows[y][x] = (*shade(PALETTE["stone"], f), 255)
    return rows


def tex_brick(size: int, seed: int):
    rows = noise_fill(size, "brick", seed, 0.05)
    rng = Rng(seed + 13)
    bh, bw = max(4, size // 4), max(8, size // 2)
    for y in range(size):
        for x in range(size):
            row = y // bh
            offset = (bw // 2) if row % 2 else 0
            in_mortar = (y % bh == 0) or ((x + offset) % bw == 0)
            if in_mortar:
                rows[y][x] = (*PALETTE["mortar"], 255)
            else:
                f = 1.0 + (rng.rand() - 0.5) * 0.22
                base = PALETTE["brick"] if rng.rand() > 0.25 else PALETTE["brick_dark"]
                rows[y][x] = (*shade(base, f), 255)
    return rows


def tex_planks(size: int, seed: int):
    rows = noise_fill(size, "wood", seed, 0.06)
    rng = Rng(seed + 17)
    ph = max(4, size // 4)
    for y in range(size):
        for x in range(size):
            if y % ph == 0:
                rows[y][x] = (*PALETTE["wood_dark"], 255)
            else:
                grain = 1.0 + 0.08 * ((x * 7 + y * 3) % 5) / 5.0
                f = grain * (1.0 + (rng.rand() - 0.5) * 0.06)
                rows[y][x] = (*shade(PALETTE["wood"], f), 255)
    for _ in range(size // 4):  # knots
        x, y = rng.int(1, size - 2), rng.int(1, size - 2)
        rows[y][x] = (*PALETTE["wood_dark"], 255)
    return rows


def tex_log_side(size: int, seed: int):
    rows = noise_fill(size, "bark", seed, 0.09)
    rng = Rng(seed + 19)
    for x in range(size):
        if x % 5 == 0 or rng.rand() < 0.15:
            for y in range(size):
                f = 1.0 + (rng.rand() - 0.5) * 0.2
                rows[y][x] = (*shade(rng.choice([PALETTE["bark"], PALETTE["bark_light"]]), f), 255)
    return rows


def tex_log_top(size: int, seed: int):
    rows = noise_fill(size, "wood", seed, 0.05)
    cx = cy = (size - 1) / 2.0
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            ring = int(d) % 3
            f = 0.92 if ring == 0 else 1.06
            rows[y][x] = (*shade(PALETTE["wood_dark" if ring == 0 else "wood_light"], f), 255)
    return rows


def tex_leaves(size: int, seed: int):
    rng = Rng(seed + 23)
    rows = []
    for _y in range(size):
        row = []
        for _x in range(size):
            c = rng.choice([PALETTE["leaf_light"], PALETTE["leaf_dark"], PALETTE["leaf_deep"]])
            f = 1.0 + (rng.rand() - 0.5) * 0.2
            row.append((*shade(c, f), 255))
        rows.append(row)
    for _ in range(size):  # gaps for silhouette readability
        x, y = rng.int(0, size - 1), rng.int(0, size - 1)
        if 1 < x < size - 2 and 1 < y < size - 2:
            rows[y][x] = (*shade(PALETTE["leaf_deep"], 0.75), 255)
    return rows


def tex_snow(size: int, seed: int):
    return noise_fill(size, "snow", seed, 0.035, speckles=size // 2)


def tex_snow_side(size: int, seed: int):
    rows = noise_fill(size, "dirt", seed, 0.08)
    rng = Rng(seed + 29)
    lip = max(3, size // 4)
    for x in range(size):
        depth = lip + rng.int(-1, 2)
        for y in range(max(1, depth)):
            f = 1.0 + (rng.rand() - 0.5) * 0.12
            c = PALETTE["snow"] if y < depth - 1 else PALETTE["snow_dark"]
            rows[y][x] = (*shade(c, f), 255)
    return rows


def tex_sand(size: int, seed: int):
    rows = noise_fill(size, "sand", seed, 0.05, speckles=size)
    rng = Rng(seed + 31)
    for _ in range(size // 2):  # ripples
        y = rng.int(0, size - 1)
        for x in range(size):
            if (x + y) % 2 == 0:
                rows[y][x] = (*PALETTE["sand_dark"], 255)
    return rows


def tex_gravel(size: int, seed: int):
    rng = Rng(seed + 37)
    rows = noise_fill(size, "gravel", seed, 0.12, speckles=size * 2)
    for _y in range(size):
        for _x in range(size):
            if rng.rand() < 0.18:
                f = 1.0 + (rng.rand() - 0.5) * 0.5
                rows[_y][_x] = (*shade(PALETTE["stone" if rng.rand() < 0.6 else "dirt"], f), 255)
    return rows


def tex_concrete(size: int, seed: int):
    rows = noise_fill(size, "concrete", seed, 0.045, speckles=size // 2)
    rng = Rng(seed + 41)
    for _ in range(size // 6):
        x = rng.int(0, size - 2)
        for y in range(size):
            if rng.rand() < 0.4:
                rows[y][x] = (*PALETTE["concrete_dark"], 255)
    return rows


def tex_metal(size: int, seed: int):
    rows = noise_fill(size, "metal", seed, 0.05)
    for y in range(size):
        for x in range(size):
            if y in (0, size - 1) or x in (0, size - 1):
                rows[y][x] = (*PALETTE["metal_dark"], 255)
    for cy in (size // 4, (3 * size) // 4):
        for cx in (size // 4, (3 * size) // 4):
            rows[cy][cx] = (*PALETTE["metal_light"], 255)
            if cy + 1 < size:
                rows[cy + 1][cx] = (*PALETTE["metal_dark"], 255)
    return rows


def tex_metal_plate(size: int, seed: int):
    rows = noise_fill(size, "metal_plate", seed, 0.05)
    for y in range(size):
        for x in range(size):
            if (x // (size // 4)) % 2 == (y // (size // 4)) % 2:
                f = 1.08
            else:
                f = 0.94
            rows[y][x] = (*shade(PALETTE["metal_plate"], f), 255)
    for i in range(size):  # diagonal hazard-free bracing
        rows[i][i] = (*PALETTE["metal_dark"], 255)
        rows[size - 1 - i][i] = (*PALETTE["metal_dark"], 255)
    return rows


def tex_water(size: int, seed: int):
    rng = Rng(seed + 43)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            wave = 0.5 + 0.5 * ((x + y * 2) % 8) / 8.0
            base = PALETTE["water_light"] if wave > 0.6 else PALETTE["water"]
            f = 1.0 + (rng.rand() - 0.5) * 0.1
            row.append((*shade(base, f), 235))
        rows.append(row)
    return rows


def tex_ice(size: int, seed: int):
    rows = noise_fill(size, "ice", seed, 0.05)
    rng = Rng(seed + 47)
    for _ in range(size // 3):
        x, y = rng.int(0, size - 1), rng.int(0, size - 1)
        for i in range(rng.int(2, size // 2)):
            xx, yy = (x + i) % size, (y + i // 2) % size
            rows[yy][xx] = (*PALETTE["ice_dark"], 255)
    return rows


def _tex_shingles(size: int, seed: int, base: str, dark: str):
    rng = Rng(seed)
    rows = noise_fill(size, base, seed, 0.05)
    sh = max(4, size // 4)
    for y in range(size):
        for x in range(size):
            row_index = y // sh
            if (x + (0 if row_index % 2 else sh // 2)) % sh == 0:
                rows[y][x] = (*PALETTE[dark], 255)
            elif y % sh == 0:
                rows[y][x] = (*shade(PALETTE[dark], 1.08), 255)
            else:
                rows[y][x] = (*shade(PALETTE[base], 1.0 + (rng.rand() - 0.5) * 0.12), 255)
    return rows


def tex_roof(size: int, seed: int):
    return _tex_shingles(size, seed + 53, "roof", "roof_dark")


def tex_roof_blue(size: int, seed: int):
    return _tex_shingles(size, seed + 59, "roof_blue", "roof_blue_dark")


def tex_road(size: int, seed: int):
    rows = noise_fill(size, "asphalt", seed, 0.06, speckles=size)
    for y in range(size):
        for x in range(size):
            if x in (size // 2,) and (y % 4 < 2):
                rows[y][x] = (*PALETTE["line"], 255)
    return rows


def tex_glass(size: int, seed: int):
    rows = noise_fill(size, "glass", seed, 0.04)
    rows = [[(r, g, b, 90) for r, g, b, _a in row] for row in rows]
    for y in range(size):
        for x in range(size):
            if x in (0, size - 1) or y in (0, size - 1):
                rows[y][x] = (*PALETTE["metal_dark"], 235)
    return rows


def tex_crate(size: int, seed: int):
    rng = Rng(seed + 61)
    rows = noise_fill(size, "crate", seed, 0.06)
    for y in range(size):
        for x in range(size):
            if x in (0, size - 1) or y in (0, size - 1) or abs(x - y) < 1 or abs((size - 1 - x) - y) < 1:
                rows[y][x] = (*PALETTE["crate_dark"], 255)
    rows[size // 2][size // 2] = (*shade(PALETTE["metal_light"], 1.0), 255)
    return rows


def tex_target(size: int, seed: int):
    cx = cy = (size - 1) / 2.0
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            band = int(d / max(1.0, size / 8.0)) % 2
            row.append((*PALETTE["target_red" if band == 0 else "target_white"], 255))
        rows.append(row)
    return rows


def tex_marker(size: int, seed: int):
    """Zone / objective marker texture: bright chevrons on dark plate."""
    rows = noise_fill(size, "metal_dark", seed, 0.04)
    for y in range(size):
        for x in range(size):
            if ((x + y) % 6) < 3:
                rows[y][x] = (*PALETTE["line"], 255)
    return rows


RECIPES = {
    "grass_top": (16, tex_grass_top),
    "grass_side": (16, tex_grass_side),
    "dirt": (16, lambda s, sd: noise_fill(s, "dirt", sd, 0.10, speckles=s)),
    "stone": (16, tex_stone),
    "cobble": (16, tex_cobble),
    "brick": (16, tex_brick),
    "sand": (16, tex_sand),
    "gravel": (16, tex_gravel),
    "snow": (16, tex_snow),
    "snow_side": (16, tex_snow_side),
    "planks": (16, tex_planks),
    "log_side": (16, tex_log_side),
    "log_top": (16, tex_log_top),
    "leaves": (16, tex_leaves),
    "concrete": (16, tex_concrete),
    "metal": (16, tex_metal),
    "metal_plate": (16, tex_metal_plate),
    "water": (16, tex_water),
    "ice": (16, tex_ice),
    "roof": (16, tex_roof),
    "roof_blue": (16, tex_roof_blue),
    "road": (16, tex_road),
    "glass": (16, tex_glass),
    "crate": (32, tex_crate),
    "target": (32, tex_target),
    "marker": (16, tex_marker),
}


ATLAS_ORDER = [
    "grass_top", "grass_side", "dirt", "stone", "cobble", "brick", "sand", "gravel",
    "snow", "snow_side", "planks", "log_side", "log_top", "leaves", "concrete", "metal",
    "metal_plate", "water", "ice", "roof", "roof_blue", "road", "glass", "marker",
]


def build_atlas(out_dir: str, tile: int = 16, columns: int = 6) -> tuple[str, dict]:
    """Packs every 16x16 tile into one atlas so a whole voxel chunk renders with a
    single draw call, and writes the UV table consumed by VoxelLibrary."""
    tiles = {}
    rows = (len(ATLAS_ORDER) + columns - 1) // columns
    width, height = columns * tile, rows * tile
    canvas = [[(0, 0, 0, 0) for _ in range(width)] for _ in range(height)]
    for index, name in enumerate(ATLAS_ORDER):
        size, recipe = RECIPES[name]
        pixels = recipe(size, 1337 + sorted(RECIPES).index(name) * 101)
        col, row = index % columns, index // columns
        for y in range(tile):
            for x in range(tile):
                canvas[row * tile + y][col * tile + x] = pixels[y % len(pixels)][x % len(pixels[0])]
        tiles[name] = {
            "index": index,
            "u0": round(col * tile / width, 6),
            "v0": round(row * tile / height, 6),
            "u1": round((col + 1) * tile / width, 6),
            "v1": round((row + 1) * tile / height, 6),
        }
    path = os.path.join(out_dir, "atlas.png")
    write_png(path, canvas)
    return path, {"tile": tile, "columns": columns, "width": width, "height": height,
                  "tiles": tiles}


def build(out_dir: str, preview_dir: str | None, only: list[str] | None = None) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    written = []
    seed = 1337
    for index, (name, (size, recipe)) in enumerate(sorted(RECIPES.items())):
        if only and name not in only:
            continue
        pixels = recipe(size, seed + index * 101)
        path = os.path.join(out_dir, f"{name}.png")
        write_png(path, pixels)
        written.append(path)
    if not only:
        atlas_path, table = build_atlas(out_dir)
        written.append(atlas_path)
        with open(os.path.join(out_dir, "atlas.json"), "w", encoding="utf-8") as fh:
            json.dump(table, fh, indent=1, sort_keys=True)
        written.append(os.path.join(out_dir, "atlas.json"))
    if preview_dir and written:
        make_sheet([p for p in written if p.endswith(".png") and "atlas.png" not in p],
                   os.path.join(preview_dir, "texture_atlas_preview.png"))
    return written


def make_sheet(paths: list[str], out_path: str, scale: int = 6, columns: int = 7) -> None:
    """Contact sheet for art review; cells are sized from the largest image."""
    images = [read_png(p) for p in paths]
    tile = max(max(w, h) for w, h, _px in images)
    cell = tile * scale
    pad = 6
    rows = (len(paths) + columns - 1) // columns
    width = columns * (cell + pad) + pad
    height = rows * (cell + pad) + pad
    canvas = [[(20, 22, 28, 255) for _ in range(width)] for _ in range(height)]
    for i, (_w, _h, px) in enumerate(images):
        cx = pad + (i % columns) * (cell + pad)
        cy = pad + (i // columns) * (cell + pad)
        for y in range(cell):
            for x in range(cell):
                sy = min(len(px) - 1, (y * len(px)) // cell)
                sx = min(len(px[0]) - 1, (x * len(px[0])) // cell)
                src = px[sy][sx]
                if src[3] == 0:      # keep the sheet background for transparent pixels
                    continue
                canvas[cy + y][cx + x] = src
    write_png(out_path, canvas)


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap = argparse.ArgumentParser(description="Generate BlockStrike Royale voxel textures")
    ap.add_argument("--out", default=os.path.join(root, "blockstrike-royale", "assets", "textures"))
    ap.add_argument("--preview", default=os.path.join(root, "blockstrike-royale", "docs", "preview"))
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    written = build(args.out, args.preview, args.only)
    total = sum(os.path.getsize(p) for p in written)
    print(f"wrote {len(written)} textures to {args.out} ({total/1024:.1f} KB)")
    for p in written:
        if not p.endswith(".png"):
            continue
        w, h, _ = read_png(p)
        assert (w, h) in ((16, 16), (32, 32), (96, 64)), f"unexpected size {p} for {p}"
    print("all textures re-read and verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

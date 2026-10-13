#!/usr/bin/env python3
"""Original app icon generator for BlockStrike Royale.

Draws a voxel "block + crosshair" emblem and writes the Android launcher icon
set (legacy square icon, adaptive foreground, adaptive background and the
512x512 store/master icon).  Everything is drawn from code, no stock art.

Usage:
    python3 tools/assets/gen_icons.py [--out DIR]
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_textures import PALETTE, Rng, read_png, shade, write_png  # noqa: E402


def blend(a, b, k):
    return tuple(int(a[i] * (1 - k) + b[i] * k) for i in range(3)) + (a[3] if len(a) > 3 else 255),


def _mix(a, b, k):
    return tuple(int(a[i] * (1 - k) + b[i] * k) for i in range(3)) + (255,)


def canvas(size: int, top=(32, 44, 74), bottom=(12, 16, 28)):
    """Vertical gradient sky background."""
    px = []
    for y in range(size):
        k = y / (size - 1)
        col = _mix(top, bottom, k)
        px.append([col for _ in range(size)])
    return px


def fill_polygon(px, points, color):
    """Scanline polygon fill - used for the isometric cube faces."""
    height = len(px)
    width = len(px[0])
    ys = [p[1] for p in points]
    y0, y1 = max(0, int(min(ys))), min(height - 1, int(max(ys)))
    for y in range(y0, y1 + 1):
        xs = []
        for i in range(len(points)):
            x_a, y_a = points[i]
            x_b, y_b = points[(i + 1) % len(points)]
            if (y_a <= y < y_b) or (y_b <= y < y_a):
                t = (y - y_a) / (y_b - y_a)
                xs.append(x_a + (x_b - x_a) * t)
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            for x in range(max(0, int(xs[i])), min(width, int(xs[i + 1]) + 1)):
                px[y][x] = color


def voxel_cube(px, cx, cy, radius, outward: int, up: int):
    """Isometric cube: top face light, two side faces shaded."""
    hw = radius
    hh = radius * 0.5
    depth = radius * 0.72
    top = [(cx, cy - hh - depth + outward - up), (cx + hw, cy - depth + outward - up),
           (cx, cy + hh - depth + outward - up), (cx - hw, cy - depth + outward - up)]
    left = [(cx - hw, cy - depth + outward - up), (cx, cy + hh - depth + outward - up),
            (cx, cy + hh + outward - up), (cx - hw, cy + outward - up)]
    right = [(cx + hw, cy - depth + outward - up), (cx, cy + hh - depth + outward - up),
             (cx, cy + hh + outward - up), (cx + hw, cy + outward - up)]
    fill_polygon(px, left, (*shade(PALETTE["grass_bright"], 0.72), 255))
    fill_polygon(px, right, (*shade(PALETTE["grass_bright"], 0.55), 255))
    fill_polygon(px, top, (*shade(PALETTE["grass_bright"], 1.12), 255))
    # block edge seams for a voxel read
    for face in (top, left, right):
        for i in range(len(face)):
            x_a, y_a = face[i]
            x_b, y_b = face[(i + 1) % len(face)]
            steps = int(max(abs(x_b - x_a), abs(y_b - y_a))) + 1
            for s in range(steps):
                t = s / steps
                x = int(x_a + (x_b - x_a) * t)
                y = int(y_a + (y_b - y_a) * t)
                if 0 <= y < len(px) and 0 <= x < len(px[0]):
                    px[y][x] = (*shade(PALETTE["grass_shadow"], 0.9), 255)


def draw_crosshair(px, cx, cy, r, thickness, color):
    gap = int(r * 0.34)
    for i in range(-r, r + 1):
        if abs(i) < gap:
            continue
        for t in range(-thickness, thickness + 1):
            for x, y in ((cx + i, cy + t), (cx + t, cy + i)):
                if 0 <= y < len(px) and 0 <= x < len(px[0]):
                    px[y][x] = color
    for dy in range(-thickness, thickness + 1):
        for dx in range(-thickness, thickness + 1):
            x, y = cx + dx, cy + dy
            if 0 <= y < len(px) and 0 <= x < len(px[0]):
                px[y][x] = color


def draw_ring(px, cx, cy, r, thickness, color):
    steps = max(720, int(2 * math.pi * (r + thickness) * 2))
    for i in range(steps):
        angle = i * 2 * math.pi / steps
        for t in range(thickness):
            x = int(round(cx + math.cos(angle) * (r + t)))
            y = int(round(cy + math.sin(angle) * (r + t)))
            if 0 <= y < len(px) and 0 <= x < len(px[0]):
                px[y][x] = color


def make_icon(size: int, transparent_bg: bool = False):
    px = canvas(size)
    if transparent_bg:
        px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    s = size / 512.0
    cx, cy = size // 2, int(size * 0.56)
    if not transparent_bg:
        rng = Rng(4242)
        for _ in range(size // 6):  # subtle star field behind the emblem
            x, y = rng.int(0, size - 1), rng.int(0, size - 1)
            if y > size * 0.8:
                continue
            f = 0.5 + rng.rand() * 0.5
            px[y][x] = (*shade((150, 190, 255), f), 255)
    voxel_cube(px, cx, cy, int(150 * s), int(30 * s), int(70 * s))
    draw_ring(px, cx, int(size * 0.44), int(196 * s), max(4, int(13 * s)),
              (*shade(PALETTE["line"], 0.95), 255))
    draw_crosshair(px, cx - int(4 * s), int(size * 0.44), int(118 * s), max(3, int(9 * s)),
                   (*PALETTE["target_white"], 255))
    return px


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(root, "blockstrike-royale"))
    args = ap.parse_args()
    icons_dir = os.path.join(args.out, "assets", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    master = make_icon(512)
    write_png(os.path.join(args.out, "icon.png"), master)
    write_png(os.path.join(icons_dir, "icon_192.png"), make_icon(192))
    write_png(os.path.join(icons_dir, "icon_144.png"), make_icon(144))
    write_png(os.path.join(icons_dir, "adaptive_foreground_432.png"),
              make_icon(432, transparent_bg=True))
    bg = [[_mix((28, 38, 66), (10, 14, 26), y / 431.0) for _ in range(432)] for y in range(432)]
    write_png(os.path.join(icons_dir, "adaptive_background_432.png"), bg)

    for name in ("icon.png", "assets/icons/icon_192.png", "assets/icons/adaptive_foreground_432.png"):
        path = os.path.join(args.out, name)
        w, h, _px = read_png(path)
        assert w == h and w in (192, 432, 512), (path, w, h)
    print(f"wrote icons to {args.out} and {icons_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate UltraDownload application icons (PNG + multi-size ICO).

Pure Pillow drawing — no external assets. Run:
    python tools/make_icon.py
Writes assets/icon.png (512×512) and assets/icon.ico (16..256).
"""

from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw

SIZE = 512
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets")


def rounded_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            # subtle diagonal shading
            dx = (x / size - 0.5) * 0.10
            f = 1.0 - dx * dx
            px[x, y] = (min(255, int(r * f)), min(255, int(g * f)),
                        min(255, int(b * f)))
    return img


def draw_arrow(draw: ImageDraw.Draw, s: float) -> None:
    """Download arrow + tray, drawn for a canvas of size s."""
    cx = s / 2
    shaft_w = s * 0.115
    shaft_top = s * 0.16
    shaft_bottom = s * 0.44
    head_half = s * 0.235
    head_bottom = s * 0.645
    # shaft
    draw.rounded_rectangle(
        (cx - shaft_w, shaft_top, cx + shaft_w, shaft_bottom + head_half * 0.4),
        radius=shaft_w * 0.5, fill="white")
    # arrow head (triangle with slightly rounded feel via polygon)
    draw.polygon(
        [(cx - head_half, shaft_bottom),
         (cx + head_half, shaft_bottom),
         (cx, head_bottom)],
        fill="white")
    # tray
    tray_y0 = s * 0.735
    tray_y1 = s * 0.845
    tray_x0 = s * 0.185
    tray_x1 = s * 0.815
    r = (tray_y1 - tray_y0) * 0.5
    draw.rounded_rectangle((tray_x0, tray_y0, tray_x1, tray_y1),
                           radius=r, fill="white")


def build_icon(size: int = SIZE) -> Image.Image:
    radius = size * 0.22
    base = gradient(size, (124, 92, 255), (59, 46, 190))
    # glossy top highlight
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dhl = ImageDraw.Draw(hl)
    dhl.ellipse((-size * 0.3, -size * 0.75, size * 1.3, size * 0.42),
                fill=(255, 255, 255, 46))
    base = Image.alpha_composite(base.convert("RGBA"), hl)
    draw = ImageDraw.Draw(base)
    draw_arrow(draw, size)
    # thin inner border for depth
    dborder = ImageDraw.Draw(base)
    dborder.rounded_rectangle((size * 0.012, size * 0.012,
                               size * 0.988, size * 0.988),
                              radius=radius, outline=(255, 255, 255, 60),
                              width=max(1, size // 256))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), rounded_mask(size, radius))
    return out


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    icon = build_icon(SIZE)
    png_path = os.path.join(OUT_DIR, "icon.png")
    icon.save(png_path)
    ico_path = os.path.join(OUT_DIR, "icon.ico")
    icon.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                               (64, 64), (128, 128), (256, 256)])
    print(f"wrote {png_path} and {ico_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

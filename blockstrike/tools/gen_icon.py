#!/usr/bin/env python3
"""Draws the original BlockStrike Royale app icon (isometric voxel block + crosshair). Requires Pillow."""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def gradient(size, top, bottom):
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        k = y / (size - 1)
        c = tuple(int(top[i] * (1 - k) + bottom[i] * k) for i in range(3)) + (255,)
        d.line([(0, y), (size, y)], fill=c)
    return img


def cube(d, cx, cy, s, top, left, right, outline=(20, 25, 35, 255), w=6):
    t = [(cx, cy - s), (cx + s * 0.87, cy - s * 0.5), (cx, cy), (cx - s * 0.87, cy - s * 0.5)]
    l = [(cx - s * 0.87, cy - s * 0.5), (cx, cy), (cx, cy + s), (cx - s * 0.87, cy + s * 0.5)]
    r = [(cx + s * 0.87, cy - s * 0.5), (cx, cy), (cx, cy + s), (cx + s * 0.87, cy + s * 0.5)]
    d.polygon(l, fill=left)
    d.polygon(r, fill=right)
    d.polygon(t, fill=top)
    for poly in (t, l, r):
        d.line(poly + [poly[0]], fill=outline, width=w)
    # grass overhang pixels on the sides
    for i in range(6):
        k = (i + 0.5) / 6
        x0 = cx - s * 0.87 * (1 - k)
        y0 = cy - s * 0.5 * (1 - k) + (k * s * 0.0)
        d.rectangle([x0 - s * 0.05, y0 + s * 0.02, x0 + s * 0.06, y0 + s * (0.18 if i % 2 else 0.1)], fill=top)
        x1 = cx + s * 0.87 * k
        y1 = cy - s * 0.5 * k
        d.rectangle([x1 - s * 0.06, y1 + s * 0.02, x1 + s * 0.05, y1 + s * (0.1 if i % 2 else 0.18)], fill=top)


def crosshair(d, cx, cy, r, col, w):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=w)
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        d.line([(cx + dx * r * 0.45, cy + dy * r * 0.45), (cx + dx * r * 1.35, cy + dy * r * 1.35)], fill=col, width=w)
    d.ellipse([cx - w, cy - w, cx + w, cy + w], fill=col)


def draw_fg(size, transparent=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0)) if transparent else gradient(size, (30, 70, 150), (12, 18, 40))
    d = ImageDraw.Draw(img)
    s = size * 0.27
    cube(d, size * 0.5, size * 0.52, s, (92, 170, 70, 255), (140, 96, 60, 255), (110, 74, 46, 255), w=max(3, size // 85))
    crosshair(d, size * 0.66, size * 0.36, size * 0.11, (255, 150, 30, 255), max(4, size // 55))
    return img


def main():
    os.makedirs(os.path.join(ROOT, "assets", "icons"), exist_ok=True)
    full = gradient(512, (40, 90, 190), (10, 16, 36))
    full.alpha_composite(draw_fg(512))
    mask = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 511, 511], radius=96, fill=255)
    out = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    out.paste(full, (0, 0), mask)
    out.save(os.path.join(ROOT, "icon.png"))
    out.resize((192, 192), Image.LANCZOS).save(os.path.join(ROOT, "assets", "icons", "icon_192.png"))
    fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    fg.alpha_composite(draw_fg(432).resize((300, 300), Image.LANCZOS), (66, 66))
    fg.save(os.path.join(ROOT, "assets", "icons", "adaptive_fg_432.png"))
    gradient(432, (40, 90, 190), (10, 16, 36)).save(os.path.join(ROOT, "assets", "icons", "adaptive_bg_432.png"))
    mono = fg.convert("LA").split()[1]
    m = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    m.putalpha(mono)
    white = Image.new("RGBA", (432, 432), (255, 255, 255, 255))
    white.putalpha(mono)
    white.save(os.path.join(ROOT, "assets", "icons", "adaptive_mono_432.png"))
    splash = gradient(512, (24, 40, 80), (8, 10, 20))
    splash.alpha_composite(draw_fg(512))
    splash.save(os.path.join(ROOT, "assets", "icons", "splash.png"))
    print("icons written")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate Filebox's launcher icons without any imaging library — a tiny PNG
writer plus a hand-drawn box glyph.

    python3 tools/make-icons.py
Writes web/icons/icon-192.png, icon-512.png, icon-maskable-512.png
"""
import os
import struct
import zlib
import math

OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'icons')


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def make_icon(size, maskable=False):
    # ── palette
    top = (18, 163, 127)      # teal
    bot = (14, 116, 144)      # deep cyan
    box = (240, 248, 255)
    box_dark = (11, 17, 32)
    tape = (34, 211, 165)

    # maskable icons need the glyph inside the central 80% safe zone
    pad = 0.24 if maskable else 0.14
    radius = 0.0 if maskable else size * 0.22

    px = bytearray()
    cx = cy = size / 2

    # box geometry
    bw = size * (1 - 2 * pad)                 # box width
    bx0 = cx - bw / 2
    by0 = cy - bw * 0.36
    lid_h = bw * 0.20

    for y in range(size):
        row = bytearray([0])                  # PNG filter byte
        for x in range(size):
            # rounded-rect background
            inside = True
            if radius > 0:
                dx = max(radius - x, x - (size - 1 - radius), 0)
                dy = max(radius - y, y - (size - 1 - radius), 0)
                inside = (dx * dx + dy * dy) <= radius * radius
            if not inside:
                row += bytes((0, 0, 0, 0))
                continue

            t = y / max(1, size - 1)
            col = lerp(top, bot, t)
            a = 255

            # ── the box
            in_box = bx0 <= x < bx0 + bw and by0 <= y < by0 + bw * 0.86
            in_lid = bx0 - bw * 0.04 <= x < bx0 + bw * 1.04 and by0 - lid_h <= y < by0

            if in_lid:
                col = box
                # lid seam
                if abs(y - (by0 - 1)) < 1.5:
                    col = box_dark
            elif in_box:
                col = box
                # vertical tape stripe
                if abs(x - cx) < bw * 0.055:
                    col = tape
                # bottom shading
                if y > by0 + bw * 0.72:
                    col = lerp(col, (200, 214, 232), 0.55)
                # side seam
                if x < bx0 + bw * 0.03 or x > bx0 + bw * 0.97:
                    col = lerp(col, box_dark, 0.25)
            row += bytes((col[0], col[1], col[2], a))
        px += row

    return bytes(px), size


def write_png(path, raw, size):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)   # 8-bit RGBA
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size, name, maskable in [
        (192, 'icon-192.png', False),
        (512, 'icon-512.png', False),
        (512, 'icon-maskable-512.png', True),
    ]:
        raw, s = make_icon(size, maskable)
        path = os.path.join(OUT, name)
        n = write_png(path, raw, s)
        print(f'{name:24} {s}x{s}  {n/1024:6.1f} KB')


if __name__ == '__main__':
    main()

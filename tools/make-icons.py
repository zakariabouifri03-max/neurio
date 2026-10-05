#!/usr/bin/env python3
"""Tiny stdlib-only Neurio Blocks icon generator (no Pillow required)."""
from pathlib import Path
import struct
import zlib


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def png(pixels, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        start = y * size * 4
        raw.extend(pixels[start:start + size * 4])
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')


class Raster:
    def __init__(self, size):
        self.n = size
        self.p = bytearray(size * size * 4)

    def pixel(self, x, y, color, alpha=255):
        if not (0 <= x < self.n and 0 <= y < self.n):
            return
        i = (y * self.n + x) * 4
        if alpha >= 255:
            self.p[i:i + 4] = bytes((*color, 255))
            return
        a = alpha / 255
        self.p[i] = int(color[0] * a + self.p[i] * (1 - a))
        self.p[i + 1] = int(color[1] * a + self.p[i + 1] * (1 - a))
        self.p[i + 2] = int(color[2] * a + self.p[i + 2] * (1 - a))
        self.p[i + 3] = 255

    def rect(self, x, y, w, h, c):
        for yy in range(max(0, y), min(self.n, y + h)):
            for xx in range(max(0, x), min(self.n, x + w)):
                self.pixel(xx, yy, c)

    def polygon(self, pts, c):
        ymin = max(0, min(y for _, y in pts)); ymax = min(self.n - 1, max(y for _, y in pts))
        for y in range(ymin, ymax + 1):
            scan = y + 0.5; crosses = []
            for i, (x1, y1) in enumerate(pts):
                x2, y2 = pts[(i + 1) % len(pts)]
                if (y1 <= scan < y2) or (y2 <= scan < y1):
                    crosses.append(x1 + (scan - y1) * (x2 - x1) / (y2 - y1))
            crosses.sort()
            for i in range(0, len(crosses) - 1, 2):
                for x in range(max(0, int(crosses[i])), min(self.n, int(crosses[i + 1]) + 1)):
                    self.pixel(x, y, c)

    def line(self, a, b, c, width=1):
        x1, y1 = a; x2, y2 = b
        steps = max(abs(x2 - x1), abs(y2 - y1), 1)
        for i in range(steps + 1):
            t = i / steps; x = round(x1 + (x2 - x1) * t); y = round(y1 + (y2 - y1) * t)
            r = max(0, width // 2)
            for yy in range(y - r, y + r + 1):
                for xx in range(x - r, x + r + 1): self.pixel(xx, yy, c)


def draw(size, maskable=False):
    r = Raster(size); k = size / 512
    def S(v): return round(v * k)
    # Deep forest gradient, with a warm, quiet center glow.
    for y in range(size):
        f = y / max(1, size - 1)
        for x in range(size):
            dx = x / size - .48; dy = f - .43
            glow = max(0, 1 - (dx * dx + dy * dy) ** .5 * 1.5)
            r.pixel(x, y, (int(7 + 15 * glow), int(20 + 28 * glow - 5 * f), int(14 + 16 * glow)))
    # Subtle stepped hills along the bottom edge.
    r.polygon([(0,S(326)),(S(82),S(284)),(S(150),S(326)),(S(236),S(258)),(S(326),S(313)),(S(420),S(270)),(size,S(310)),(size,size),(0,size)], (21,43,28))
    r.polygon([(0,S(394)),(S(106),S(338)),(S(201),S(384)),(S(311),S(324)),(size,S(370)),(size,size),(0,size)], (13,32,20))
    # Pixel-like voxel cube with a thick shadow.
    cube = [(S(256),S(82)),(S(413),S(170)),(S(256),S(260)),(S(99),S(170))]
    left = [cube[3], cube[2], (S(256),S(430)), (S(99),S(338))]
    right = [cube[2], cube[1], (S(413),S(338)), (S(256),S(430))]
    r.polygon([(S(x / k), S(y / k + 15)) for x,y in left], (4,14,9))
    r.polygon([(S(x / k), S(y / k + 15)) for x,y in right], (4,14,9))
    r.polygon([(S(256),S(97)),(S(398),S(177)),(S(256),S(259)),(S(114),S(177))], (177,220,109))
    r.polygon([(S(114),S(177)),(S(256),S(259)),(S(256),S(420)),(S(114),S(337))], (101,157,70))
    r.polygon([(S(256),S(259)),(S(398),S(177)),(S(398),S(337)),(S(256),S(420))], (61,111,54))
    # Clean block edges and face divisions.
    edge = (219,244,166)
    for a,b in [((256,97),(398,177)),((398,177),(256,259)),((256,259),(114,177)),((114,177),(256,97)),((114,177),(114,337)),((114,337),(256,420)),((256,420),(398,337)),((398,337),(398,177)),((256,259),(256,420))]:
        r.line((S(a[0]),S(a[1])),(S(b[0]),S(b[1])),edge,S(4))
    # A few lighter mineral pixels, kept chunky at icon scale.
    for x,y,c in [(180,158,(202,235,140)),(211,176,(202,235,140)),(290,142,(205,238,151)),(335,177,(163,212,103)),(161,218,(129,184,87)),(208,279,(130,186,87)),(291,291,(100,155,74)),(340,263,(87,142,65)),(289,353,(87,142,65))]:
        r.rect(S(x), S(y), S(10), S(8), c)
    return png(r.p, size)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    (root / 'icons').mkdir(exist_ok=True)
    (root / 'icons' / 'icon-192.png').write_bytes(draw(192))
    (root / 'icons' / 'icon-512.png').write_bytes(draw(512))
    (root / 'icons' / 'icon-maskable-512.png').write_bytes(draw(512, True))
    print('Neurio Blocks icons written.')

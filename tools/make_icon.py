#!/usr/bin/env python3
"""Write a compact multi-size 32-bit ICO (piano keys on dark rounded square)."""
import os, struct, zlib

def draw(size):
    px = bytearray(size * size * 4)
    def setp(x, y, r, g, b, a=255):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 4
            px[i:i+4] = bytes((b, g, r, a))  # BGRA
    rad = max(3, size // 6)
    for y in range(size):
        for x in range(size):
            # rounded square mask
            dx = min(x, size - 1 - x)
            dy = min(y, size - 1 - y)
            if dx < rad and dy < rad:
                cx, cy = rad - dx, rad - dy
                if cx * cx + cy * cy > rad * rad:
                    continue
            setp(x, y, 22, 24, 32, 255)
    # keys
    margin = size // 8
    top = size // 3
    bot = size - margin
    whites = 5
    ww = max(2, (size - 2 * margin) // whites)
    for i in range(whites):
        x0 = margin + i * ww
        gold = (i == 2)
        for y in range(top, bot):
            for x in range(x0 + 1, x0 + ww - 1):
                if gold:
                    setp(x, y, 232, 197, 71)
                else:
                    setp(x, y, 244, 241, 234)
    # black keys
    bh = (bot - top) * 5 // 8
    bw = max(2, ww * 6 // 10)
    for i in (0, 1, 3):
        cx = margin + (i + 1) * ww
        for y in range(top, top + bh):
            for x in range(cx - bw // 2, cx + bw // 2):
                setp(x, y, 18, 18, 20)
    return px

def dib(size, bgra):
    # BITMAPINFOHEADER + BGRA bottom-up + AND mask
    row = size * 4
    # ICO DIB is bottom-up
    body = bytearray()
    for y in range(size - 1, -1, -1):
        body += bgra[y * row:(y + 1) * row]
    and_row = ((size + 31) // 32) * 4
    body += b"\x00" * (and_row * size)
    hdr = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(body), 0, 0, 0, 0)
    return hdr + body

def main():
    sizes = [16, 32, 48, 256]
    images = []
    for s in sizes:
        if s == 256:
            # keep 256 modest: draw 256
            images.append((s, dib(s, draw(s))))
        else:
            images.append((s, dib(s, draw(s))))
    count = len(images)
    offset = 6 + 16 * count
    buf = struct.pack("<HHH", 0, 1, count)
    blobs = b""
    for s, data in images:
        w = 0 if s >= 256 else s
        h = 0 if s >= 256 else s
        buf += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    out = os.path.join(os.path.dirname(__file__), "..", "assets", "icons", "pianopro.ico")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(buf + blobs)
    print("wrote", out, "bytes", os.path.getsize(out))

if __name__ == "__main__":
    main()

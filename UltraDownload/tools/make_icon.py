"""Generate the checked-in multi-resolution ICO using only Python's standard library."""
from pathlib import Path
import math
import struct
import zlib


def png(size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            u, v = (x+.5)/size, (y+.5)/size
            # Rounded violet tile with a white download arrow and tray.
            dx, dy = max(abs(u-.5)-.32, 0), max(abs(v-.5)-.32, 0)
            inside = math.hypot(dx, dy) <= .13
            arrow = (.445 <= u <= .555 and .22 <= v <= .52) or (.42 <= v <= .67 and abs(u-.5) <= (.67-v)*.95)
            tray = (.26 <= u <= .74 and .73 <= v <= .79) or (.26 <= u <= .32 or .68 <= u <= .74) and .65 <= v <= .79
            color = (245, 244, 255, 255) if arrow or tray else (int(102+42*(1-v)), int(78+26*(1-v)), 233, 255)
            pixels.extend(color if inside else (0, 0, 0, 0))
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))+chunk(b'IDAT', zlib.compress(pixels))+chunk(b'IEND', b'')


def main():
    sizes = [16, 32, 48, 64, 128, 256]
    images = [png(size) for size in sizes]
    offset = 6+16*len(sizes)
    header = bytearray(struct.pack('<HHH', 0, 1, len(sizes)))
    for size, image in zip(sizes, images):
        header.extend(struct.pack('<BBBBHHII', size%256, size%256, 0, 0, 1, 32, len(image), offset))
        offset += len(image)
    path = Path(__file__).resolve().parents[1] / 'assets' / 'app_icon.ico'
    path.write_bytes(header+b''.join(images))


if __name__ == '__main__':
    main()

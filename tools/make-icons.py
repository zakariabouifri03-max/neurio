#!/usr/bin/env python3
"""Montaj Pro — pure python PNG icon pipeline (decode -> resize -> encode).
No third party deps: generates every launcher / PWA icon size from one source."""
import os, struct, sys, zlib

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos, idat, palette, trns = 8, b'', None, None
    w = h = bd = ct = None
    while pos < len(data):
        ln, typ = struct.unpack_from('>I4s', data, pos); pos += 8
        chunk = data[pos:pos + ln]; pos += ln + 4
        if typ == b'IHDR':
            w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
            assert bd == 8, 'only 8-bit png supported'
            assert inter == 0, 'interlaced png not supported'
        elif typ == b'PLTE': palette = chunk
        elif typ == b'tRNS': trns = chunk
        elif typ == b'IDAT': idat += chunk
        elif typ == b'IEND': break
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * nch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if ft == 1:
            for i in range(nch, stride): line[i] = (line[i] + line[i - nch]) & 255
        elif ft == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                b = prev[i]
                c = prev[i - nch] if i >= nch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    # to RGBA
    rgba = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * nch
            o = (y * w + x) * 4
            if ct == 2: r, g, b, a = out[i], out[i + 1], out[i + 2], 255
            elif ct == 6: r, g, b, a = out[i], out[i + 1], out[i + 2], out[i + 3]
            elif ct == 0: r = g = b = out[i]; a = 255
            elif ct == 4: r = g = b = out[i]; a = out[i + 1]
            else:
                idx = out[i]
                r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
                a = trns[idx] if trns and idx < len(trns) else 255
            rgba[o:o + 4] = bytes((r, g, b, a))
    return w, h, rgba

def write_png(path, w, h, rgba):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * w * 4:(y + 1) * w * 4]
    def chunk(typ, payload):
        return struct.pack('>I', len(payload)) + typ + payload + struct.pack('>I', zlib.crc32(typ + payload) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(png)

def resize(w, h, rgba, nw, nh):
    out = bytearray(nw * nh * 4)
    xr, yr = w / nw, h / nh
    for y in range(nh):
        y0, y1 = int(y * yr), max(int(y * yr) + 1, int((y + 1) * yr))
        for x in range(nw):
            x0, x1 = int(x * xr), max(int(x * xr) + 1, int((x + 1) * xr))
            r = g = b = a = n = 0
            for yy in range(y0, min(y1, h)):
                base = yy * w * 4
                for xx in range(x0, min(x1, w)):
                    i = base + xx * 4
                    r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; n += 1
            o = (y * nw + x) * 4
            out[o] = r // n; out[o + 1] = g // n; out[o + 2] = b // n; out[o + 3] = a // n
    return out

def maskable(w, h, rgba, size=512, pad=0.16):
    # solid background from the corner pixel + centred artwork inside the safe zone
    bg = (rgba[0], rgba[1], rgba[2], 255)
    inner = int(size * (1 - pad * 2))
    small = resize(w, h, rgba, inner, inner)
    out = bytearray(bytes(bg) * (size * size))
    off = int(size * pad)
    for y in range(inner):
        for x in range(inner):
            si = (y * inner + x) * 4
            di = ((y + off) * size + (x + off)) * 4
            out[di:di + 4] = small[si:si + 4]
    return out

def make_ico(out_path, pngs):
    """pngs: list of (size, png_bytes) — ICO with embedded PNG images"""
    import struct
    n = len(pngs)
    header = struct.pack('<HHH', 0, 1, n)
    offset = 6 + 16 * n
    entries, data = b'', b''
    for size, blob in pngs:
        b = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', b, b, 0, 0, 1, 32, len(blob), offset)
        data += blob
        offset += len(blob)
    open(out_path, 'wb').write(header + entries + data)

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '.tools/icon-src.png'
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    w, h, rgba = read_png(src)
    print('source', w, h)
    # PWA / app icons
    for size in (512, 192, 180, 144):
        write_png(os.path.join(root, f'editor/icons/icon-{size}.png'), size, size, resize(w, h, rgba, size, size))
    write_png(os.path.join(root, 'editor/icons/icon-maskable-512.png'), 512, 512, maskable(w, h, rgba))
    write_png(os.path.join(root, 'editor/icons/favicon.png'), 48, 48, resize(w, h, rgba, 48, 48))
    # android launcher icons
    for dens, size in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        write_png(os.path.join(root, f'tools/apk/res/mipmap-{dens}/ic_launcher.png'), size, size, resize(w, h, rgba, size, size))
    # windows .ico (png-compressed entries — supported since Vista)
    ico = []
    for size in (16, 32, 48, 64, 128, 256):
        import io
        tmp = os.path.join(root, '.tools', 'tmp-icon.png')
        write_png(tmp, size, size, resize(w, h, rgba, size, size))
        ico.append((size, open(tmp, 'rb').read()))
        os.remove(tmp)
    make_ico(os.path.join(root, 'tools/win/montaj.ico'), ico)
    print('icons written')

if __name__ == '__main__':
    main()

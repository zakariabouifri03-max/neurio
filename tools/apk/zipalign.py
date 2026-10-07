#!/usr/bin/env python3
"""Montaj Pro — zipalign (pure python, no Android SDK).

Android does not merely *like* aligned APKs, it requires them:
  * classes.dex, resources.arsc and the manifest are mmapped straight out of the
    archive, so their data must start on a word boundary;
  * apps that target API 30+ must keep the dex uncompressed.

aapt2 output and zipfile output satisfy neither, which is a classic "the app
closes right after launch" bug. This rewrites the archive with the right rules:

  AndroidManifest.xml    STORED, 4-byte aligned
  resources.arsc         STORED, 4096-byte aligned
  classes.dex            STORED, 4096-byte aligned
  res/**                 STORED, 4-byte aligned (aapt2 already deflates nothing here)
  everything else        kept as-is (compressed entries need no alignment)

Run BEFORE signing (v2/v3 signatures cover the zip structure):
    python3 tools/apk/zipalign.py in.apk out.apk
"""
import struct
import sys
import zlib

ALIGN_4 = 4
ALIGN_PAGE = 4096


def rules(name):
    """-> (force_stored, alignment)"""
    if name == 'AndroidManifest.xml':
        return True, ALIGN_4
    if name == 'resources.arsc':
        return True, ALIGN_PAGE
    if name.endswith('.dex'):
        return True, ALIGN_PAGE
    if name.startswith('res/') and name.endswith(('.png', '.jpg', '.webp')):
        return True, ALIGN_4
    return False, 0


def read_zip(path):
    raw = open(path, 'rb').read()
    eocd = raw.rfind(b'PK\x05\x06')
    if eocd < 0:
        raise SystemExit('not a zip: ' + path)
    count, cd_size, cd_off = struct.unpack_from('<HII', raw, eocd + 10)
    entries, p = [], cd_off
    for _ in range(count):
        (sig, vm, vn, flags, method, mtime, mdate, crc, csize, usize,
         nlen, elen, clen, disk, iattr, eattr, lho) = struct.unpack_from('<IHHHHHHIIIHHHHHII', raw, p)
        name = raw[p + 46:p + 46 + nlen].decode('utf-8')
        lsig, lvm, lflags, lmethod, lmt, lmd, lcrc, lcsz, lusz, lnlen, lelen = \
            struct.unpack_from('<IHHHHHIIIHH', raw, lho)
        data = raw[lho + 30 + lnlen + lelen: lho + 30 + lnlen + lelen + lcsz]
        if method == 8:
            data = zlib.decompress(data, -15)   # always keep the plain bytes
        entries.append(dict(name=name, method=method, crc=zlib.crc32(data) & 0xffffffff,
                            usize=len(data), data=data, mtime=mtime, mdate=mdate,
                            flags=flags & 0x800))
        p += 46 + nlen + elen + clen
    return entries


def extra_pad(name, data_offset, align):
    """extra field bytes so that the entry data starts on an `align` boundary.

    A zip extra field is a 4-byte header (id + length) plus payload, so the
    padding is either absent or at least 4 bytes long — never 1..3.
    """
    if align <= 1:
        return b''
    nlen = len(name.encode('utf-8'))
    r = (-(data_offset + 30 + nlen)) % align
    if r == 0:
        return b''
    pad = r if r >= 4 else r + align
    return struct.pack('<HH', 0x4341, pad - 4) + b'\x00' * (pad - 4)


def write_zip(entries, out_path):
    out = bytearray()
    central = bytearray()
    for e in entries:
        name = e['name'].encode('utf-8')
        force, align = rules(e['name'])
        plain = e['data']
        if force or e['method'] == 0:
            body, method, csize = plain, 0, len(plain)
        else:
            co = zlib.compressobj(9, zlib.DEFLATED, -15)   # zip stores raw deflate
            body = co.compress(plain) + co.flush()
            method, csize = 8, len(body)
        crc = zlib.crc32(plain) & 0xffffffff
        usize = len(plain)
        extra = extra_pad(e['name'], len(out), align if (force or method == 0) else 0)
        lho = len(out)
        out += struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, e['flags'], method,
                           e['mtime'], e['mdate'], crc, csize, usize,
                           len(name), len(extra))
        out += name + extra + body
        central += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, e['flags'], method,
                               e['mtime'], e['mdate'], crc, csize, usize,
                               len(name), 0, 0, 0, 0, 0, lho)
        central += name
    cd_off = len(out)
    out += central
    out += struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(entries), len(entries),
                       len(central), cd_off, 0)
    open(out_path, 'wb').write(bytes(out))
    return len(entries)


CRITICAL = ('AndroidManifest.xml', 'resources.arsc')


def verify(path):
    """report entries Android will mmap that are compressed or misaligned"""
    raw = open(path, 'rb').read()
    eocd = raw.rfind(b'PK\x05\x06')
    count, cd_size, cd_off = struct.unpack_from('<HII', raw, eocd + 10)
    p, bad = cd_off, []
    for _ in range(count):
        f = struct.unpack_from('<IHHHHHHIIIHHHHHII', raw, p)
        name = raw[p + 46:p + 46 + f[10]].decode()
        method, lho = f[4], f[16]
        lh = struct.unpack_from('<IHHHHHIIIHH', raw, lho)
        doff = lho + 30 + lh[9] + lh[10]
        force, align = rules(name)
        critical = name in CRITICAL or name.endswith('.dex')
        if critical and method != 0:
            bad.append(f'{name}: compressed (method {method}) — must be STORED')
        if critical and doff % 4:
            bad.append(f'{name}: data at {doff} — not 4-byte aligned')
        elif force and doff % 4:
            bad.append(f'{name}: data at {doff} — not 4-byte aligned')
        p += 46 + f[10] + f[11] + f[12]
    return bad


def main():
    args = [a for a in sys.argv[1:]]
    if args and args[0] == '--check':
        bad = verify(args[1])
        if bad:
            print('zipalign check FAILED:')
            for b in bad:
                print('  ✗', b)
            return 1
        print('zipalign check: ✓ manifest/resources/dex stored & aligned')
        return 0
    if len(args) < 2:
        print(__doc__)
        return 2
    src, dst = args[0], args[1]
    entries = read_zip(src)
    order = {n: i for i, n in enumerate(['AndroidManifest.xml', 'resources.arsc', 'classes.dex'])}
    entries.sort(key=lambda e: (order.get(e['name'], 10)))
    n = write_zip(entries, dst)
    bad = verify(dst)
    print(f'zipalign: {n} entries -> {dst}')
    if bad:
        for b in bad:
            print('  ✗', b)
        return 1
    print('  ✓ dex/manifest/arsc stored & aligned')
    return 0


if __name__ == '__main__':
    sys.exit(main())

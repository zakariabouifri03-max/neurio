#!/usr/bin/env python3
"""zipalign (pure python) — portable stand-in for the SDK's C++ `zipalign`.

Android mmap's uncompressed (STORED) zip entries straight from the APK —
`resources.arsc`, assets, *.so — so their data must start on a 4-byte (8 for
64-bit .so) boundary. This rewrites the archive and pads the offending entries
with an alignment extra-field (id 0xd935), the same trick the SDK tool uses
(the padding is written in the local *and* the central directory record so
every reader agrees).

Usage:
    zipalign.py -p 4 in.apk out.apk
"""
import argparse
import binascii
import struct
import sys
import zipfile
import zlib


def _dos(info):
    t = info.date_time
    return ((t[3] << 11) | (t[4] << 5) | (t[5] // 2),
            ((t[0] - 1980) << 9) | (t[1] << 5) | t[2])


def realign(src: str, dst: str, align: int) -> None:
    with zipfile.ZipFile(src) as zin:
        infos = [(i, zin.read(i.filename)) for i in zin.infolist()]

    entries = []
    with open(dst, "wb") as out:
        for info, data in infos:
            name = info.filename.encode("utf-8")
            stored = info.compress_type == zipfile.ZIP_STORED
            if stored:
                payload = data
                comp_type = zipfile.ZIP_STORED
            else:
                comp = zlib.compressobj(9, zlib.DEFLATED, -15)
                payload = comp.compress(data) + comp.flush()
                comp_type = zipfile.ZIP_DEFLATED
            crc = binascii.crc32(data) & 0xFFFFFFFF

            extra = b""
            if stored:
                pad = (-(out.tell() + 30 + len(name))) % align
                while 0 < pad < 4:
                    pad += align
                if pad:
                    extra = struct.pack("<HH", 0xD935, pad - 4) + b"\0" * (pad - 4)

            offset = out.tell()
            dostime, dosdate = _dos(info)
            out.write(struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 0, comp_type,
                                  dostime, dosdate, crc, len(payload), len(data),
                                  len(name), len(extra)))
            out.write(name)
            out.write(extra)
            out.write(payload)
            entries.append((info, name, comp_type, crc, len(payload), len(data), offset, extra))

        cd_start = out.tell()
        for info, name, comp_type, crc, csize, usize, offset, extra in entries:
            dostime, dosdate = _dos(info)
            out.write(struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 0,
                                  comp_type, dostime, dosdate, crc, csize, usize,
                                  len(name), len(extra), 0, 0, 0, 0, offset))
            out.write(name)
            out.write(extra)
        cd_size = out.tell() - cd_start
        out.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(entries), len(entries),
                              cd_size, cd_start, 0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-p", "--pages", type=int, default=4)
    ap.add_argument("src")
    ap.add_argument("dst")
    a = ap.parse_args()
    realign(a.src, a.dst, a.pages)

    bad = []
    with zipfile.ZipFile(a.dst) as z:
        if z.testzip():
            print("zip is corrupt after alignment", file=sys.stderr)
            return 1
        entries = z.infolist()
        for i in entries:
            if i.compress_type != zipfile.ZIP_STORED:
                continue
            data_off = i.header_offset + 30 + len(i.filename.encode("utf-8")) + len(i.extra)
            if data_off % a.pages:
                bad.append(i.filename)
    print(f"[zipalign] {a.dst}: {len(entries)} entries, align={a.pages}, "
          f"misaligned={len(bad)}" + (": " + ", ".join(bad) if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

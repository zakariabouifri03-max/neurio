#!/usr/bin/env python3
"""
Pure-python `zipflinger`: rebuild an APK with Android's packaging rules and
4-byte (or page) alignment.

Rules applied (same as AGP + `zipalign -p 4`):
  * `resources.arsc`  -> STORED and 4-byte aligned (mandatory on Android 11+)
  * `*.so`            -> STORED and 4096-byte page aligned
  * everything else   -> DEFLATE, 4-byte aligned local header data offset
  * the APK signing block leaves 4 bytes of room between the last entry and the
    central directory (required by APK Signature Scheme v2/v3).

Alignment is achieved by growing the *extra field* of the local file header, the
same technique the official zipalign uses.
"""

from __future__ import annotations

import binascii
import struct
import sys
import zlib
from pathlib import Path

ZIP_LOCAL_SIG = 0x04034B50
ZIP_CENTRAL_SIG = 0x02014B50
ZIP_EOCD_SIG = 0x06054B50
STORED, DEFLATED = 0, 8


class Entry:
    __slots__ = ("name", "data", "is_dir", "external_attr", "date_time", "method")

    def __init__(self, name: str, data: bytes, is_dir: bool,
                 external_attr: int, date_time: tuple, method: int):
        self.name = name
        self.data = data
        self.is_dir = is_dir
        self.external_attr = external_attr
        self.date_time = date_time
        self.method = method


def _dos_time(dt: tuple) -> tuple[int, int]:
    year, month, day, hour, minute, second = dt
    if year < 1980:
        return 0, 0
    dtime = (hour << 11) | (minute << 5) | (second // 2)
    ddate = ((year - 1980) << 9) | (month << 5) | day
    return dtime, ddate


def read_entries(apk: Path) -> list[Entry]:
    import zipfile

    entries: list[Entry] = []
    with zipfile.ZipFile(apk) as zf:
        for info in zf.infolist():
            name = info.filename
            is_dir = name.endswith("/")
            data = b"" if is_dir else zf.read(name)
            method = DEFLATED
            if is_dir or info.compress_type == zipfile.ZIP_STORED:
                method = STORED
            entries.append(Entry(name, data, is_dir, info.external_attr,
                                 info.date_time, method))
    return entries


def build_apk(entries: list[Entry], dest: Path, page_align: int = 4) -> Path:
    """Write `entries` as an aligned, unsigned APK."""
    local = bytearray()
    central = bytearray()
    count = 0

    for e in entries:
        raw_name = e.name.encode("utf-8")
        # --- decide compression -------------------------------------------------
        lower = e.name.lower()
        force_stored = e.is_dir or lower == "resources.arsc" or lower.endswith(".so")
        if force_stored:
            method, payload = STORED, e.data
        elif e.method == STORED:
            method, payload = STORED, e.data
        else:
            method = DEFLATED
            # raw DEFLATE stream (no zlib header/checksum) - required by ZIP
            compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
            payload = compressor.compress(e.data) + compressor.flush()

        # --- alignment ---------------------------------------------------------
        align = page_align
        if lower.endswith(".so"):
            align = 4096
        elif lower == "resources.arsc":
            align = 4
        header_len = 30 + len(raw_name)
        offset = len(local)
        pad = (-(offset + header_len)) % align
        extra = b"\x00" * pad if pad else b""
        # extra padding uses the 0xD935 "android alignment" id when >= 4 bytes
        if pad >= 4:
            extra = struct.pack("<HH", 0xD935, pad - 4) + b"\x00" * (pad - 4)

        crc = binascii.crc32(e.data) & 0xFFFFFFFF
        dtime, ddate = _dos_time(e.date_time)
        flags = 0x0800  # UTF-8 names

        local += struct.pack(
            "<IHHHHHIIIHH", ZIP_LOCAL_SIG, 20, flags, method, dtime, ddate,
            crc, len(payload), len(e.data), len(raw_name), len(extra),
        )
        local += raw_name
        local += extra
        local += payload

        central += struct.pack(
            "<IHHHHHHIIIHHHHHII", ZIP_CENTRAL_SIG, 20, 20, flags, method,
            dtime, ddate, crc, len(payload), len(e.data), len(raw_name),
            len(extra), 0, 0, 0, e.external_attr, offset,
        )
        central += raw_name
        central += extra
        count += 1

    central_offset = len(local)
    eocd = struct.pack(
        "<IHHHHIIH", ZIP_EOCD_SIG, 0, 0, count, count,
        len(central), central_offset, 0,
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(local)
        fh.write(central)
        fh.write(eocd)
    return dest


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: zipalign.py <in.apk> <out.apk>", file=sys.stderr)
        raise SystemExit(2)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    entries = read_entries(src)
    build_apk(entries, dst)
    print(f"aligned {len(entries)} entries -> {dst}")


if __name__ == "__main__":
    main()

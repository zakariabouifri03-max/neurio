#!/usr/bin/env python3
"""Read-only signature recovery from a disk-image file (best for unencrypted SD cards)."""
import argparse
import mmap
import os
from pathlib import Path
import struct
import zlib

JPEG_START = b'\xff\xd8\xff'
JPEG_END = b'\xff\xd9'
PNG_START = b'\x89PNG\r\n\x1a\n'
MAX_FILE = 4 * 1024**3
CHUNK = 1024 * 1024


def write_range(mm, start, end, directory, extension, index):
    target = directory / f'recovered_{index:05d}_{start:012x}.{extension}'
    with target.open('xb') as output:
        for pos in range(start, end, CHUNK):
            output.write(mm[pos:min(pos + CHUNK, end)])
    return target


def png_end(mm, start, size):
    pos = start + 8
    if mm[pos:pos + 8] != b'\x00\x00\x00\rIHDR':
        return None
    while pos + 12 <= size:
        length = struct.unpack_from('>I', mm, pos)[0]
        end = pos + 12 + length
        if end > size or end - start > MAX_FILE:
            return None
        kind = mm[pos + 4:pos + 8]
        crc = struct.unpack_from('>I', mm, end - 4)[0]
        if zlib.crc32(mm[pos + 4:end - 4]) != crc:
            return None
        pos = end
        if kind == b'IEND':
            return pos
    return None


def mp4_end(mm, start, size):
    """Recognize contiguous MP4 boxes; refuse files without ftyp and mdat."""
    pos = start
    found_mdat = False
    for _ in range(100000):
        if pos + 8 > size or pos - start > MAX_FILE:
            break
        box_size = struct.unpack_from('>I', mm, pos)[0]
        kind = mm[pos + 4:pos + 8]
        header = 8
        if box_size == 1:
            if pos + 16 > size:
                break
            box_size = struct.unpack_from('>Q', mm, pos + 8)[0]
            header = 16
        if box_size < header or pos + box_size > size or pos + box_size - start > MAX_FILE:
            break
        if pos == start and (kind != b'ftyp' or box_size > 4096):
            return None
        if kind not in (b'ftyp', b'free', b'skip', b'wide', b'mdat', b'moov', b'uuid', b'sidx', b'meta', b'mfra', b'pdin'):
            break
        if kind == b'mdat':
            found_mdat = True
        pos += box_size
    return pos if found_mdat else None


def recover(source, directory):
    count = 0
    with source.open('rb') as stream:
        if os.fstat(stream.fileno()).st_size == 0:
            return 0
        with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            size = len(mm)
            # Find candidate signatures without loading the disk image into RAM.
            position = 0
            while position < size:
                candidates = [(mm.find(JPEG_START, position), 'jpg'),
                              (mm.find(PNG_START, position), 'png'),
                              (mm.find(b'ftyp', position), 'mp4')]
                candidates = [(at, kind) for at, kind in candidates if at >= 0]
                if not candidates:
                    break
                at, kind = min(candidates)
                start = at - 4 if kind == 'mp4' else at
                end = None
                if kind == 'jpg':
                    # Only JPEG streams with a plausible first marker are accepted.
                    if start + 4 < size and mm[start + 3] in (0xe0, 0xe1, 0xe2, 0xe3, 0xe8, 0xdb, 0xc0, 0xc2, 0xfe):
                        eoi = mm.find(JPEG_END, start + 4, min(size, start + MAX_FILE))
                        if eoi >= 0:
                            end = eoi + 2
                elif kind == 'png':
                    end = png_end(mm, start, size)
                elif start >= 0:
                    end = mp4_end(mm, start, size)
                if end is not None:
                    count += 1
                    result = write_range(mm, start, end, directory, kind, count)
                    print(result, flush=True)
                    position = end
                else:
                    position = at + 1
    return count


def main():
    parser = argparse.ArgumentParser(description='Recover intact JPEG, PNG and MP4 files from an unencrypted SD-card image.')
    parser.add_argument('image', type=Path, help='Existing raw disk image file (read only)')
    parser.add_argument('output', type=Path, help='New output folder on a DIFFERENT disk')
    args = parser.parse_args()
    source = args.image.resolve(strict=True)
    if not source.is_file():
        parser.error('Source must be a regular disk-image file, not a mounted device.')
    output = args.output.resolve()
    if output.exists():
        parser.error('Output folder must not already exist.')
    if output == source or source in output.parents:
        parser.error('Output must not be inside the image path.')
    output.mkdir(parents=True)
    print(f'Found {recover(source, output)} candidates. Check each recovered file manually.')


if __name__ == '__main__':
    main()

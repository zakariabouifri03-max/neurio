import hashlib
import os
from pathlib import Path
from .file_utils import publish_no_replace
from .integrity import compare_checksum
from .models import chunk_range
from .http_client import Interrupted


class InvalidChunk(Exception):
    def __init__(self, index):
        super().__init__(f"Chunk {index} is missing or corrupt; retry to repair it")
        self.index = index


def assemble(download, db, root, stop):
    output = root / "assembled.tmp"
    if output.is_symlink():
        raise OSError("Unsafe output path")
    digest = hashlib.sha256()
    total = 0
    with output.open("wb") as out:
        for index in range(download.count):
            if stop.is_set():
                raise Interrupted()
            records = db.chunks(download.id, index, 1)
            path = root / "chunks" / f"{index:06d}.part"
            bounds = chunk_range(download.size, index) if download.ranges else (0, download.size - 1)
            if (not records or records[0]["idx"] != index or records[0]["status"] != "complete"
                    or not path.is_file() or path.is_symlink() or path.stat().st_size != bounds[1]-bounds[0]+1):
                raise InvalidChunk(index)
            chunk_digest = hashlib.sha256()
            with path.open("rb") as source:
                while block := source.read(256 * 1024):
                    if stop.is_set():
                        raise Interrupted()
                    out.write(block)
                    chunk_digest.update(block)
                    digest.update(block)
                    total += len(block)
            if chunk_digest.hexdigest() != records[0]["digest"]:
                raise InvalidChunk(index)
        out.flush()
        os.fsync(out.fileno())
    if total != download.size:
        raise ValueError("Assembled file size does not match expected size")
    actual = digest.hexdigest()
    compare_checksum(actual, download.expected_sha256)
    download.sha256 = actual
    db.save(download)  # Publication intent makes a crash after rename recoverable.
    if stop.is_set():
        raise Interrupted()
    publish_no_replace(output, Path(download.destination))
    return actual

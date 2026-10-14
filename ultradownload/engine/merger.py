"""Reassemble downloaded parts into the final file, safely.

Parts are streamed (never loaded into RAM), the assembled size is verified,
an optional checksum is verified, and the result is published with an atomic
rename.  On any failure the temporary parts are preserved so the download can
be repaired without re-fetching everything.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Callable, Iterable

from .errors import ChecksumMismatchError, MergeError

log = logging.getLogger("ultradownload.merger")

__all__ = ["assemble_file", "verify_checksum", "CHECKSUM_ALGORITHMS"]

CHECKSUM_ALGORITHMS = ("md5", "sha1", "sha256", "sha512")

_COPY_CHUNK = 1024 * 1024


def verify_checksum(path: Path, algo: str, expected: str,
                    progress: Callable[[int], None] | None = None) -> None:
    """Hash *path* with *algo* and compare to *expected* (case-insensitive)."""
    if algo not in CHECKSUM_ALGORITHMS:
        raise MergeError(f"Unsupported checksum algorithm: {algo}")
    h = hashlib.new(algo)
    total = 0
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(_COPY_CHUNK)
            if not chunk:
                break
            h.update(chunk)
            total += len(chunk)
            if progress:
                progress(total)
    actual = h.hexdigest()
    if actual.lower() != expected.strip().lower():
        raise ChecksumMismatchError(
            f"Checksum mismatch ({algo}): expected {expected}, got {actual}")


def assemble_file(
    part_paths: Iterable[Path],
    expected_sizes: Iterable[int],
    final_path: Path,
    checksum: tuple[str, str] | None = None,
    progress: Callable[[int, int], None] | None = None,
    keep_parts: bool = True,
) -> None:
    """Concatenate parts in order into *final_path*.

    1. Every part file must exist with the exact expected size.
    2. Data is streamed into ``final_path`` + ``.ultratmp`` on the same volume.
    3. The assembled size is verified, then the checksum if provided.
    4. The temp file is atomically renamed over *final_path* (``os.replace``).
    5. Part files are deleted only after full success (unless *keep_parts*).

    Raises :class:`MergeError`/:class:`ChecksumMismatchError` on failure; in
    that case the parts are always left on disk.
    """
    parts = list(part_paths)
    sizes = list(expected_sizes)
    if len(parts) != len(sizes):
        raise MergeError("internal error: parts/sizes length mismatch")

    # -- 1. validate parts ---------------------------------------------------
    total = 0
    for p, size in zip(parts, sizes):
        if not p.exists():
            raise MergeError(f"Missing temporary part: {p.name}")
        actual = p.stat().st_size
        if actual != size:
            raise MergeError(
                f"Part {p.name} has {actual} bytes, expected {size} (incomplete)")
        total += size

    final_path = Path(final_path)
    final_path.parent.mkdir(parents=True, exist_ok=True)

    # -- 2. stream into a temp file on the same directory (same volume) ------
    fd, tmp_name = tempfile.mkstemp(
        prefix=final_path.name + ".", suffix=".ultratmp", dir=str(final_path.parent))
    tmp_path = Path(tmp_name)
    written = 0
    hasher = hashlib.new(checksum[0]) if checksum else None
    if checksum and checksum[0] not in CHECKSUM_ALGORITHMS:
        os.close(fd)
        tmp_path.unlink(missing_ok=True)
        raise MergeError(f"Unsupported checksum algorithm: {checksum[0]}")

    try:
        with os.fdopen(fd, "wb") as out:
            for p, size in zip(parts, sizes):
                with open(p, "rb") as src:
                    while True:
                        chunk = src.read(_COPY_CHUNK)
                        if not chunk:
                            break
                        out.write(chunk)
                        written += len(chunk)
                        if hasher is not None:
                            hasher.update(chunk)
                        if progress:
                            progress(written, total)
            out.flush()
            os.fsync(out.fileno())

        # -- 3. verify -------------------------------------------------------
        if written != total:
            raise MergeError(
                f"Assembled {written} bytes but expected {total} (parts corrupted)")
        if hasher is not None:
            actual = hasher.hexdigest()
            if actual.lower() != checksum[1].strip().lower():
                raise ChecksumMismatchError(
                    f"Checksum mismatch ({checksum[0]}): expected {checksum[1]}, got {actual}")

        # -- 4. atomic publish ----------------------------------------------
        os.replace(tmp_path, final_path)
    except BaseException:
        # Preserve parts; drop only the partial assembled temp file.
        tmp_path.unlink(missing_ok=True)
        raise

    # -- 5. clean up parts only after success --------------------------------
    if not keep_parts:
        for p in parts:
            try:
                p.unlink()
            except OSError:
                log.warning("could not remove part %s", p)

    log.info("assembled %s (%d bytes) from %d parts", final_path, written, len(parts))

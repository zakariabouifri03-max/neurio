"""Byte-range mathematics for split downloads (Step B).

All ranges use *inclusive* HTTP endpoints: ``Range: bytes=start-end``.
The functions here guarantee that for a file of size N split into P
parts:

* every byte 0..N-1 belongs to exactly one part,
* parts never overlap,
* no bytes are omitted,
* the remainder (N % P) is distributed one extra byte at a time to the
  first parts,
* all arithmetic is 64-bit safe (Python ints are arbitrary precision).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass(frozen=True)
class Range:
    """Inclusive byte range [start, end]."""

    start: int
    end: int

    def __post_init__(self) -> None:
        if self.start < 0:
            raise ValueError(f"range start must be >= 0, got {self.start}")
        if self.end < self.start:
            raise ValueError(
                f"range end ({self.end}) must be >= start ({self.start})"
            )

    @property
    def size(self) -> int:
        return self.end - self.start + 1

    def header(self) -> str:
        """HTTP Range header value for this range."""
        return f"bytes={self.start}-{self.end}"

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return f"{self.start}-{self.end}"


def split_byte_ranges(total_size: int, num_parts: int) -> List[Range]:
    """Split ``total_size`` bytes into ``num_parts`` contiguous ranges.

    >>> split_byte_ranges(10, 4)
    [Range(start=0, end=2), Range(start=3, end=5),
     Range(start=6, end=8), Range(start=9, end=9)]

    Raises ``ValueError`` for a negative size or a non-positive part
    count.  When ``num_parts > total_size`` the count is clamped so that
    every part contains at least one byte (a zero-byte file produces a
    single empty marker range ``Range(0, -1)``… which is invalid, so
    zero-byte files are handled by the caller — see
    :func:`plan_parts`).
    """
    if total_size < 0:
        raise ValueError(f"total_size must be >= 0, got {total_size}")
    if num_parts <= 0:
        raise ValueError(f"num_parts must be > 0, got {num_parts}")
    if total_size == 0:
        return []
    num_parts = max(1, min(num_parts, total_size))
    base, remainder = divmod(total_size, num_parts)
    ranges: List[Range] = []
    offset = 0
    for i in range(num_parts):
        size = base + (1 if i < remainder else 0)
        ranges.append(Range(offset, offset + size - 1))
        offset += size
    return ranges


def plan_parts(total_size: int, num_parts: int) -> List[Range]:
    """Like :func:`split_byte_ranges` but returns ``[Range(0, -1+…)]``-free
    output for empty files: a zero-byte file yields an empty list (the
    engine completes it immediately without any HTTP part workers)."""
    return split_byte_ranges(total_size, num_parts)


def validate_coverage(ranges: List[Range], total_size: int) -> Tuple[bool, str]:
    """Verify exact, ordered, overlap-free coverage of ``total_size``.

    Returns ``(ok, message)``.
    """
    if total_size == 0:
        if not ranges:
            return True, "empty file needs no ranges"
        return False, "empty file must not have ranges"
    if not ranges:
        return False, "no ranges produced"
    expected_start = 0
    covered = 0
    seen_spans = set()
    for idx, r in enumerate(ranges):
        if r.start != expected_start:
            if r.start < expected_start:
                return False, (
                    f"part {idx}: overlap or out-of-order range "
                    f"({r.start}-{r.end}, expected start {expected_start})"
                )
            return False, (
                f"part {idx}: gap before range ({r.start}-{r.end}, "
                f"expected start {expected_start})"
            )
        key = (r.start, r.end)
        if key in seen_spans:
            return False, f"part {idx}: duplicate range {r}"
        seen_spans.add(key)
        covered += r.size
        expected_start = r.end + 1
    if expected_start != total_size:
        return False, (
            f"coverage ends at byte {expected_start - 1}, "
            f"expected {total_size - 1}"
        )
    if covered != total_size:
        return False, f"covered {covered} bytes, expected {total_size}"
    return True, "exact coverage"


_CONTENT_RANGE_RE = re.compile(
    r"^\s*bytes\s+(?P<first>\d+)-(?P<last>\d+)\s*/\s*(?P<total>\d+|\*)\s*$",
    re.IGNORECASE,
)


def parse_content_range(header: Optional[str]) -> Optional[Tuple[int, int, int]]:
    """Parse ``Content-Range: bytes first-last/total``.

    Returns ``(first, last, total)`` where ``total`` is ``-1`` for ``*``,
    or ``None`` when the header is missing/malformed.
    """
    if not header:
        return None
    m = _CONTENT_RANGE_RE.match(header)
    if not m:
        return None
    first = int(m.group("first"))
    last = int(m.group("last"))
    total_s = m.group("total")
    total = -1 if total_s == "*" else int(total_s)
    if last < first:
        return None
    if total != -1 and last >= total:
        return None
    return first, last, total

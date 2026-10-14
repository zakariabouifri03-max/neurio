"""Byte-range calculation for parallel downloads.

Every byte of a file belongs to exactly one part: ranges are non-overlapping,
contiguous and cover ``[0, total_size)`` completely.  HTTP Range endpoints are
*inclusive*, matching RFC 9110 (``Range: bytes=first-last``).
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["ByteRange", "compute_ranges", "validate_coverage"]


@dataclass(frozen=True)
class ByteRange:
    """One logical part of a file. ``start``/``end`` are inclusive offsets."""

    index: int
    start: int
    end: int

    def __post_init__(self) -> None:
        if self.index < 0:
            raise ValueError("part index must be >= 0")
        if self.start < 0 or self.end < self.start - 1:
            raise ValueError(f"invalid range bounds: {self.start}-{self.end}")

    @property
    def length(self) -> int:
        """Number of bytes covered by this range (0 allowed for empty range)."""
        return self.end - self.start + 1 if self.end >= self.start else 0

    @property
    def http_header(self) -> str:
        """Value for a Range header covering this part entirely."""
        return f"bytes={self.start}-{self.end}"

    def http_header_from(self, offset: int) -> str:
        """Range header covering only the *remaining* bytes of this part.

        ``offset`` is the number of bytes already downloaded *within the part*.
        """
        if not 0 <= offset <= self.length:
            raise ValueError(f"offset {offset} outside part length {self.length}")
        return f"bytes={self.start + offset}-{self.end}"

    def __len__(self) -> int:  # convenience
        return self.length


def compute_ranges(total_size: int, part_count: int) -> list[ByteRange]:
    """Split ``[0, total_size)`` into at most ``part_count`` contiguous parts.

    * Every byte belongs to exactly one part.
    * The remainder of ``total_size // parts`` is distributed one byte at a
      time to the first ``total_size % parts`` parts, so all parts differ in
      size by at most one byte and the final part absorbs no special cases.
    * A zero-byte file yields an empty list (there is nothing to request).
    * When ``part_count > total_size`` the effective part count is reduced to
      ``total_size`` so that no empty HTTP ranges are ever requested.
    """
    if total_size < 0:
        raise ValueError("total_size must be >= 0")
    if part_count < 1:
        raise ValueError("part_count must be >= 1")
    if total_size == 0:
        return []

    effective = min(part_count, total_size)
    base, remainder = divmod(total_size, effective)

    ranges: list[ByteRange] = []
    cursor = 0
    for i in range(effective):
        size = base + (1 if i < remainder else 0)
        start = cursor
        end = cursor + size - 1  # inclusive
        ranges.append(ByteRange(index=i, start=start, end=end))
        cursor += size
    return ranges


def validate_coverage(ranges: list[ByteRange], total_size: int) -> None:
    """Raise ``AssertionError`` unless ``ranges`` exactly tile ``[0, total_size)``."""
    if total_size == 0:
        assert ranges == [], "zero-byte file must have zero ranges"
        return
    assert ranges, "non-empty file must have at least one range"
    assert ranges[0].start == 0, "coverage must start at byte 0"
    cursor = 0
    for i, r in enumerate(ranges):
        assert r.index == i, "part indexes must be sequential"
        assert r.start == cursor, f"gap/overlap before part {i}"
        assert r.length > 0, f"part {i} is empty"
        cursor = r.end + 1
    assert cursor == total_size, f"coverage ends at {cursor}, expected {total_size}"

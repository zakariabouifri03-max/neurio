"""Range mathematics: exact coverage, no overlap, no gaps, 64-bit safety."""

from __future__ import annotations

import pytest

from ultradownload.ranges import (Range, parse_content_range,
                                  split_byte_ranges, validate_coverage)


class TestSplitByteRanges:
    def test_example_from_spec(self):
        # 4 GiB in 40 parts → first part is exactly 0-107374182 (spec-style)
        total = 4 * 1024 ** 3
        parts = split_byte_ranges(total, 40)
        assert len(parts) == 40
        assert parts[0].start == 0
        assert parts[-1].end == total - 1
        ok, msg = validate_coverage(parts, total)
        assert ok, msg

    @pytest.mark.parametrize("total", [1, 2, 3, 7, 10, 39, 40, 41, 100,
                                       999, 1023, 65536, 10 ** 6 + 3])
    @pytest.mark.parametrize("num_parts", [1, 2, 4, 8, 16, 24, 32, 40])
    def test_exact_coverage_many_sizes(self, total, num_parts):
        parts = split_byte_ranges(total, num_parts)
        ok, msg = validate_coverage(parts, total)
        assert ok, msg
        # every byte belongs to exactly one part
        covered = sum(p.size for p in parts)
        assert covered == total
        # inclusive endpoints chain perfectly
        for a, b in zip(parts, parts[1:]):
            assert b.start == a.end + 1

    def test_remainder_goes_to_first_parts(self):
        parts = split_byte_ranges(10, 4)
        assert [p.size for p in parts] == [3, 3, 2, 2]
        parts = split_byte_ranges(43, 40)
        assert [p.size for p in parts] == [2] * 3 + [1] * 37

    def test_more_parts_than_bytes_clamps(self):
        parts = split_byte_ranges(5, 40)
        assert len(parts) == 5
        assert all(p.size == 1 for p in parts)
        ok, _ = validate_coverage(parts, 5)
        assert ok

    def test_zero_byte_file_has_no_ranges(self):
        assert split_byte_ranges(0, 40) == []
        ok, _ = validate_coverage([], 0)
        assert ok

    def test_negative_size_rejected(self):
        with pytest.raises(ValueError):
            split_byte_ranges(-1, 4)

    def test_zero_parts_rejected(self):
        with pytest.raises(ValueError):
            split_byte_ranges(100, 0)

    def test_large_file_80gb_40_parts(self):
        total = 80 * 1024 ** 3       # 85,899,345,920 bytes > 4 GiB
        parts = split_byte_ranges(total, 40)
        assert len(parts) == 40
        ok, msg = validate_coverage(parts, total)
        assert ok, msg
        assert parts[0].size == total // 40
        assert parts[-1].end == total - 1
        # 64-bit-safe: ends exceed 2**32
        assert parts[-1].end > 2 ** 32

    def test_5_3_tb_file(self):
        total = 5 * 1024 ** 4 + 12345  # > 2**42
        parts = split_byte_ranges(total, 40)
        ok, msg = validate_coverage(parts, total)
        assert ok, msg


class TestRangeObject:
    def test_header_format(self):
        assert Range(0, 104857599).header() == "bytes=0-104857599"

    def test_invalid_range_rejected(self):
        with pytest.raises(ValueError):
            Range(10, 5)
        with pytest.raises(ValueError):
            Range(-1, 5)


class TestValidateCoverage:
    def test_overlap_detected(self):
        ranges = [Range(0, 10), Range(5, 15), Range(16, 20)]
        ok, msg = validate_coverage(ranges, 21)
        assert not ok and "overlap" in msg

    def test_gap_detected(self):
        ranges = [Range(0, 10), Range(12, 20)]
        ok, msg = validate_coverage(ranges, 21)
        assert not ok and "gap" in msg

    def test_short_coverage_detected(self):
        ranges = [Range(0, 10), Range(11, 19)]
        ok, msg = validate_coverage(ranges, 21)
        assert not ok

    def test_long_coverage_detected(self):
        ranges = [Range(0, 10), Range(11, 21)]
        ok, msg = validate_coverage(ranges, 21)
        assert not ok


class TestParseContentRange:
    def test_normal(self):
        assert parse_content_range("bytes 0-99/8388608") == (0, 99, 8388608)

    def test_star_total(self):
        assert parse_content_range("bytes 0-99/*") == (0, 99, -1)

    def test_spaces_and_case(self):
        assert parse_content_range("  Bytes 10-20/30 ") == (10, 20, 30)

    @pytest.mark.parametrize("bad", [
        "", None, "bytes", "bytes abc-def/10", "bytes 5-1/10",
        "bytes 0-10/5", "items 0-10/20", "bytes 0-10",
    ])
    def test_invalid(self, bad):
        assert parse_content_range(bad) is None

"""Byte-range calculation: exact coverage, no overlap, remainder handling."""

import pytest

from ultradownload.engine.ranges import ByteRange, compute_ranges, validate_coverage


class TestComputeRanges:
    def test_exact_coverage_no_overlap_40_parts(self):
        size = 80 * 1024 * 1024 + 12345  # awkward remainder
        ranges = compute_ranges(size, 40)
        validate_coverage(ranges, size)
        assert len(ranges) == 40

    def test_every_byte_exactly_once(self):
        size = 1000
        ranges = compute_ranges(size, 7)
        covered = [None] * size
        for r in ranges:
            for i in range(r.start, r.end + 1):
                assert covered[i] is None, f"byte {i} covered twice"
                covered[i] = r.index
        assert all(c is not None for c in covered)

    def test_part_sizes_differ_by_at_most_one(self):
        ranges = compute_ranges(10_003, 16)
        lengths = [r.length for r in ranges]
        assert max(lengths) - min(lengths) <= 1
        assert sum(lengths) == 10_003

    def test_remainder_goes_to_first_parts(self):
        ranges = compute_ranges(10, 3)
        assert [r.length for r in ranges] == [4, 3, 3]
        assert [(r.start, r.end) for r in ranges] == [(0, 3), (4, 6), (7, 9)]

    def test_final_part_covers_last_byte(self):
        size = 123456789
        ranges = compute_ranges(size, 40)
        assert ranges[-1].end == size - 1
        assert ranges[-1].length == size - ranges[-1].start

    def test_inclusive_http_header(self):
        ranges = compute_ranges(1024, 4)
        assert ranges[0].http_header == "bytes=0-255"
        assert ranges[1].http_header == "bytes=256-511"
        assert ranges[3].http_header == "bytes=768-1023"
        # resuming after 10 bytes within part 0:
        assert ranges[0].http_header_from(10) == "bytes=10-255"

    def test_part_count_larger_than_file(self):
        ranges = compute_ranges(3, 40)
        assert len(ranges) == 3
        validate_coverage(ranges, 3)

    def test_single_part(self):
        ranges = compute_ranges(999, 1)
        assert len(ranges) == 1
        assert (ranges[0].start, ranges[0].end) == (0, 998)

    def test_zero_byte_file(self):
        assert compute_ranges(0, 40) == []
        validate_coverage([], 0)

    def test_one_byte_file(self):
        ranges = compute_ranges(1, 40)
        assert len(ranges) == 1
        assert (ranges[0].start, ranges[0].end) == (0, 0)

    def test_size_smaller_than_parts_boundary(self):
        for size in (2, 5, 39, 40, 41):
            ranges = compute_ranges(size, 40)
            validate_coverage(ranges, size)

    def test_large_64bit_offsets(self):
        # >4 GiB arithmetic without allocating anything.
        size = 5 * 1024 ** 3 + 777
        ranges = compute_ranges(size, 40)
        validate_coverage(ranges, size)
        assert ranges[-1].end == size - 1
        assert ranges[0].start == 0

    def test_invalid_arguments(self):
        with pytest.raises(ValueError):
            compute_ranges(-1, 4)
        with pytest.raises(ValueError):
            compute_ranges(100, 0)
        with pytest.raises(ValueError):
            ByteRange(0, 5, 3)  # end < start - 1
        with pytest.raises(ValueError):
            ByteRange(-1, 0, 10)

    def test_offset_validation(self):
        r = ByteRange(0, 0, 99)
        assert r.http_header_from(100) == "bytes=100-99"  # empty remainder edge
        with pytest.raises(ValueError):
            r.http_header_from(101)


class TestValidateCoverage:
    def test_detects_gap(self):
        ranges = [ByteRange(0, 0, 9), ByteRange(1, 20, 29)]
        with pytest.raises(AssertionError):
            validate_coverage(ranges, 30)

    def test_detects_overlap(self):
        ranges = [ByteRange(0, 0, 9), ByteRange(1, 5, 19)]
        with pytest.raises(AssertionError):
            validate_coverage(ranges, 20)

    def test_detects_missing_tail(self):
        ranges = [ByteRange(0, 0, 9)]
        with pytest.raises(AssertionError):
            validate_coverage(ranges, 20)

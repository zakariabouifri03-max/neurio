using System;
using System.Linq;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public sealed class SegmentPlannerTests
    {
        [Fact]
        public void Plan_single_connection_covers_whole_file()
        {
            var ranges = SegmentPlanner.Plan(1000, 1);
            Assert.Equal(1, ranges.Count);
            Assert.Equal(0, ranges[0].Start);
            Assert.Equal(999, ranges[0].End);
        }

        [Fact]
        public void Plan_even_split_tiles_file_exactly()
        {
            var ranges = SegmentPlanner.Plan(1_000_000, 4, minSegmentSize: 100_000);
            Assert.Equal(4, ranges.Count);
            TestHelpers.AssertRangesTileExactlyOnce(
                ranges.Select(r => (r.Start, r.End)).ToList(), 1_000_000);
        }

        [Fact]
        public void Plan_uneven_split_tiles_file_exactly()
        {
            // 1_000_000 / 3 = 333_333 remainder 1 → first range gets one extra byte.
            var ranges = SegmentPlanner.Plan(1_000_000, 3);
            Assert.Equal(3, ranges.Count);
            Assert.Equal(333_334, ranges[0].Length);
            Assert.Equal(333_333, ranges[1].Length);
            Assert.Equal(333_333, ranges[2].Length);
            TestHelpers.AssertRangesTileExactlyOnce(
                ranges.Select(r => (r.Start, r.End)).ToList(), 1_000_000);
        }

        [Fact]
        public void Plan_reduces_connection_count_for_small_files()
        {
            // 1 MB file, 8 requested connections, 256 KB minimum segment → at most 4 connections.
            var ranges = SegmentPlanner.Plan(1024 * 1024, 8, 256 * 1024);
            Assert.Equal(4, ranges.Count);
            TestHelpers.AssertRangesTileExactlyOnce(
                ranges.Select(r => (r.Start, r.End)).ToList(), 1024 * 1024);
        }

        [Fact]
        public void Plan_tiny_file_gets_one_range()
        {
            var ranges = SegmentPlanner.Plan(100, 8);
            Assert.Equal(1, ranges.Count);
            Assert.Equal(0, ranges[0].Start);
            Assert.Equal(99, ranges[0].End);
        }

        [Fact]
        public void Plan_one_byte_file_gets_one_range()
        {
            var ranges = SegmentPlanner.Plan(1, 8);
            Assert.Equal(1, ranges.Count);
            Assert.Equal(0, ranges[0].Start);
            Assert.Equal(0, ranges[0].End);
        }

        [Fact]
        public void Plan_requested_connections_below_one_is_clamped()
        {
            var ranges = SegmentPlanner.Plan(1000, 0);
            Assert.Equal(1, ranges.Count);
        }

        [Fact]
        public void Plan_rejects_zero_or_negative_size()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => SegmentPlanner.Plan(0, 4));
            Assert.Throws<ArgumentOutOfRangeException>(() => SegmentPlanner.Plan(-5, 4));
        }

        [Fact]
        public void PlanUnknownSize_is_open_ended()
        {
            var range = SegmentPlanner.PlanUnknownSize();
            Assert.True(range.IsOpenEnded);
            Assert.Equal(0, range.Start);
            Assert.Equal(-1, range.Length);
        }

        [Fact]
        public void ChooseSplitOffset_splits_remaining_in_half()
        {
            var range = new SegmentRange(1000, 1999); // 1000 bytes
            long? mid = SegmentPlanner.ChooseSplitOffset(range, 1000, 100);
            Assert.NotNull(mid);
            Assert.Equal(1500, mid!.Value);
        }

        [Fact]
        public void ChooseSplitOffset_resumes_from_current_offset()
        {
            var range = new SegmentRange(1000, 1999);
            long? mid = SegmentPlanner.ChooseSplitOffset(range, 1200, 100);
            Assert.NotNull(mid);
            Assert.Equal(1600, mid!.Value); // remaining [1200,1999] split in half
        }

        [Fact]
        public void ChooseSplitOffset_returns_null_when_remaining_too_small()
        {
            var range = new SegmentRange(1000, 1198); // 199 bytes remaining, need 2*100
            Assert.Null(SegmentPlanner.ChooseSplitOffset(range, 1000, 100));
        }

        [Fact]
        public void ChooseSplitOffset_returns_null_for_open_ended_range()
        {
            Assert.Null(SegmentPlanner.ChooseSplitOffset(new SegmentRange(0, long.MaxValue), 0, 100));
        }

        [Fact]
        public void SplitAt_produces_two_contiguous_ranges()
        {
            var parts = SegmentPlanner.SplitAt(new SegmentRange(0, 999), 500);
            Assert.NotNull(parts);
            Assert.Equal(2, parts!.Count);
            Assert.Equal(new SegmentRange(0, 499), parts[0]);
            Assert.Equal(new SegmentRange(500, 999), parts[1]);
        }

        [Fact]
        public void SplitAt_rejects_invalid_offsets()
        {
            Assert.Null(SegmentPlanner.SplitAt(new SegmentRange(0, 999), 0));
            Assert.Null(SegmentPlanner.SplitAt(new SegmentRange(0, 999), 1000));
            Assert.Null(SegmentPlanner.SplitAt(new SegmentRange(0, long.MaxValue), 500));
        }
    }
}

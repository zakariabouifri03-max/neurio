using System;
using System.Collections.Generic;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Pure, deterministic logic that decides how a file is split into byte ranges.
    /// No I/O, no state — fully unit-testable.
    /// </summary>
    public static class SegmentPlanner
    {
        /// <summary>Smallest range we are willing to download over its own connection (256 KB).</summary>
        public const long DefaultMinSegmentSize = 256 * 1024;

        /// <summary>
        /// Splits <c>[0, totalBytes)</c> into at most <paramref name="requestedConnections"/> contiguous,
        /// non-overlapping ranges. The returned ranges always tile the file exactly: no gaps, no overlaps,
        /// and the sum of their lengths equals <paramref name="totalBytes"/>.
        /// The connection count is reduced when the file is too small to give every connection at least
        /// <paramref name="minSegmentSize"/> bytes — opening more connections than that would only add overhead.
        /// </summary>
        public static IReadOnlyList<SegmentRange> Plan(long totalBytes, int requestedConnections, long minSegmentSize = DefaultMinSegmentSize)
        {
            if (totalBytes < 1)
                throw new ArgumentOutOfRangeException(nameof(totalBytes), "totalBytes must be >= 1");
            if (requestedConnections < 1)
                requestedConnections = 1;
            if (minSegmentSize < 1)
                minSegmentSize = 1;

            long maxBySize = Math.Max(1, totalBytes / minSegmentSize);
            int count = (int)Math.Min(requestedConnections, maxBySize);

            if (count == 1)
                return new[] { new SegmentRange(0, totalBytes - 1) };

            long baseLength = totalBytes / count;
            int remainder = (int)(totalBytes % count);

            var ranges = new List<SegmentRange>(count);
            long position = 0;
            for (int i = 0; i < count; i++)
            {
                long length = baseLength + (i < remainder ? 1 : 0);
                ranges.Add(new SegmentRange(position, position + length - 1));
                position += length;
            }
            return ranges;
        }

        /// <summary>
        /// The range used when the total size is unknown: everything from byte 0 to the end of the stream.
        /// </summary>
        public static SegmentRange PlanUnknownSize() => new SegmentRange(0, long.MaxValue);

        /// <summary>
        /// Chooses the offset at which the remaining part of <paramref name="range"/> should be split in two,
        /// given that <paramref name="currentOffset"/> has already been downloaded. Returns null when the
        /// remaining part is too small to be worth splitting (each half must keep at least
        /// <paramref name="minPartSize"/> bytes).
        /// </summary>
        public static long? ChooseSplitOffset(SegmentRange range, long currentOffset, long minPartSize)
        {
            if (range.IsOpenEnded)
                return null;
            if (minPartSize < 1)
                minPartSize = 1;

            long remaining = range.End - currentOffset + 1;
            if (remaining < 2 * minPartSize)
                return null;

            long mid = currentOffset + remaining / 2;
            if (mid <= currentOffset || mid > range.End)
                return null;
            return mid;
        }

        /// <summary>
        /// Splits <paramref name="range"/> at <paramref name="splitOffset"/> into two contiguous ranges.
        /// The first range keeps <c>[Start, splitOffset-1]</c>, the second gets <c>[splitOffset, End]</c>.
        /// </summary>
        public static IReadOnlyList<SegmentRange>? SplitAt(SegmentRange range, long splitOffset)
        {
            if (range.IsOpenEnded)
                return null;
            if (splitOffset <= range.Start || splitOffset > range.End)
                return null;
            return new[]
            {
                new SegmentRange(range.Start, splitOffset - 1),
                new SegmentRange(splitOffset, range.End),
            };
        }
    }
}

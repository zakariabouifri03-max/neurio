using TurboLoadPro.Core.Models;

namespace TurboLoadPro.Core.Engine;

public static class DownloadPlanner
{
    private const long MiB = 1024L * 1024L;
    private const long GiB = 1024L * MiB;

    public static int ChooseConnections(long? totalBytes, int configuredConnections, TimeSpan probeLatency)
    {
        if (configuredConnections is 1 or 8 or 16 or 32) return configuredConnections;
        if (totalBytes is null || totalBytes < 16 * MiB) return 1;

        // Larger objects can amortize more HTTP requests. High-latency links benefit from
        // more independent ranges, but only when the object is large enough to justify them.
        if (totalBytes >= 2 * GiB) return 32;
        if (totalBytes >= 512 * MiB && probeLatency >= TimeSpan.FromMilliseconds(180)) return 32;
        if (totalBytes >= 256 * MiB) return 16;
        return 8;
    }

    public static List<DownloadSegment> CreateSegments(long totalBytes, int requestedCount)
    {
        if (totalBytes < 0) throw new ArgumentOutOfRangeException(nameof(totalBytes));
        if (totalBytes == 0) return [];
        var count = Math.Clamp(requestedCount, 1, 32);
        count = (int)Math.Min(count, totalBytes);
        var baseLength = totalBytes / count;
        var remainder = totalBytes % count;
        var result = new List<DownloadSegment>(count);
        long nextStart = 0;

        for (var index = 0; index < count; index++)
        {
            var length = baseLength + (index < remainder ? 1 : 0);
            result.Add(new DownloadSegment
            {
                Index = index,
                Start = nextStart,
                End = checked(nextStart + length - 1),
                BytesReceived = 0
            });
            nextStart += length;
        }

        return result;
    }

    public static bool SegmentsMatch(IReadOnlyList<DownloadSegment> existing, IReadOnlyList<DownloadSegment> planned)
    {
        if (existing.Count != planned.Count) return false;
        for (var index = 0; index < existing.Count; index++)
        {
            var oldSegment = existing[index];
            var newSegment = planned[index];
            if (oldSegment.Index != newSegment.Index || oldSegment.Start != newSegment.Start ||
                oldSegment.End != newSegment.End || oldSegment.BytesReceived < 0 ||
                oldSegment.BytesReceived > oldSegment.Length)
                return false;
        }
        return true;
    }
}

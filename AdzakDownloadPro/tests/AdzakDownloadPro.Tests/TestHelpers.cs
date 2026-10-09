using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;
using AdzakDownloadPro.Tests.TestServer;

namespace AdzakDownloadPro.Tests
{
    public static class TestHelpers
    {
        /// <summary>Creates a fresh temporary directory for a test.</summary>
        public static string NewTempDir()
        {
            var dir = Path.Combine(Path.GetTempPath(), "adzak-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            return dir;
        }

        /// <summary>Engine options tuned for fast, deterministic tests.</summary>
        public static DownloadEngineOptions FastOptions()
        {
            return new DownloadEngineOptions
            {
                MaxRetries = 3,
                ResponseTimeoutSeconds = 10,
                IdleTimeoutSeconds = 15,
                ProgressThrottleMilliseconds = 20,
                MetaSaveIntervalSeconds = 1,
                AdaptiveCheckIntervalSeconds = 1,
                AdaptiveMinSplitIntervalSeconds = 2,
                BufferSizeBytes = 16 * 1024,
                MinSegmentSizeBytes = 256 * 1024,
            };
        }

        /// <summary>Waits until the item reaches the given status.</summary>
        public static async Task<DownloadItem> WaitForStatusAsync(DownloadItem item, DownloadStatus status, int timeoutMs = 60000)
        {
            var tcs = new TaskCompletionSource<DownloadItem>(TaskCreationOptions.RunContinuationsAsynchronously);
            void Check(object? sender, EventArgs _)
            {
                if (item.Status == status)
                    tcs.TrySetResult(item);
            }
            item.StatusChanged += Check;
            try
            {
                Check(item, EventArgs.Empty);
                return await WithTimeout(tcs.Task, timeoutMs, "status " + status);
            }
            finally
            {
                item.StatusChanged -= Check;
            }
        }

        /// <summary>Waits until the item reaches a terminal state (Completed / Failed / Canceled).</summary>
        public static async Task<DownloadItem> WaitForTerminalAsync(DownloadItem item, int timeoutMs = 60000)
        {
            var tcs = new TaskCompletionSource<DownloadItem>(TaskCreationOptions.RunContinuationsAsynchronously);
            void Check(object? sender, EventArgs _)
            {
                if (item.Status == DownloadStatus.Completed
                    || item.Status == DownloadStatus.Failed
                    || item.Status == DownloadStatus.Canceled)
                    tcs.TrySetResult(item);
            }
            item.StatusChanged += Check;
            try
            {
                Check(item, EventArgs.Empty);
                return await WithTimeout(tcs.Task, timeoutMs, "a terminal state").ConfigureAwait(false);
            }
            finally
            {
                item.StatusChanged -= Check;
            }
        }

        /// <summary>Waits until the item has downloaded at least <paramref name="minBytes"/> bytes.</summary>
        public static async Task WaitForBytesAsync(DownloadItem item, long minBytes, int timeoutMs = 60000)
        {
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            void Check(object? sender, DownloadProgress _)
            {
                if (item.DownloadedBytes >= minBytes)
                    tcs.TrySetResult(true);
            }
            item.Progress += Check;
            try
            {
                if (item.DownloadedBytes >= minBytes)
                    tcs.TrySetResult(true);
                await WithTimeout(tcs.Task, timeoutMs, minBytes + " downloaded bytes");
            }
            finally
            {
                item.Progress -= Check;
            }
        }

        private static async Task<T> WithTimeout<T>(Task<T> task, int timeoutMs, string what)
        {
            var delay = Task.Delay(timeoutMs);
            var completed = await Task.WhenAny(task, delay).ConfigureAwait(false);
            if (completed == delay)
                throw new TimeoutException($"Timed out after {timeoutMs} ms waiting for {what}.");
            return await task.ConfigureAwait(false);
        }

        /// <summary>
        /// Parses the recorded Range headers of a server into (start, end) intervals.
        /// The engine's probe request is exactly "bytes=0-0"; pass <paramref name="excludeProbe"/>
        /// to filter it out (it overlaps the first segment's range by design).
        /// </summary>
        public static List<(long Start, long End)> GetRequestedRanges(ScriptableHttpServer server, string path, bool excludeProbe = true)
        {
            var result = new List<(long, long)>();
            foreach (var request in server.Requests)
            {
                if (request.Path != path || request.RangeHeader == null)
                    continue;
                if (!request.RangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
                    continue;
                var value = request.RangeHeader.Substring("bytes=".Length);
                int dash = value.IndexOf('-');
                if (dash <= 0)
                    continue;
                if (!long.TryParse(value.Substring(0, dash), out long start))
                    continue;
                if (!long.TryParse(value.Substring(dash + 1), out long end))
                    continue;
                if (excludeProbe && start == 0 && end == 0)
                    continue; // the engine's 1-byte probe
                result.Add((start, end));
            }
            return result;
        }

        /// <summary>
        /// Asserts that the requested ranges tile <c>[0, size)</c> exactly: sorted, contiguous,
        /// non-overlapping, full coverage. This proves every byte range was requested exactly once.
        /// </summary>
        public static void AssertRangesTileExactlyOnce(List<(long Start, long End)> ranges, long size)
        {
            var sorted = ranges.OrderBy(r => r.Start).ToList();
            Assert.True(sorted.Count > 0, "Expected at least one range request.");
            long position = 0;
            foreach (var range in sorted)
            {
                Assert.Equal(position, range.Start,
                    $"Ranges must be contiguous and non-overlapping (gap/overlap at byte {position}, got start {range.Start}).");
                position = range.End + 1;
            }
            Assert.Equal(size, position, "Requested ranges must cover the whole file exactly.");
        }

        /// <summary>
        /// Asserts that the requested ranges (possibly overlapping, e.g. after retries) together
        /// cover <c>[0, size)</c> completely.
        /// </summary>
        public static void AssertRangesCoverFile(List<(long Start, long End)> ranges, long size)
        {
            Assert.True(ranges.Count > 0, "Expected at least one range request.");
            var sorted = ranges.OrderBy(r => r.Start).ToList();
            long covered = 0;
            foreach (var range in sorted)
            {
                if (range.End < covered)
                    continue; // fully inside already-covered area
                Assert.True(range.Start <= covered,
                    $"Ranges leave a gap before byte {range.Start} (covered up to {covered}).");
                covered = Math.Max(covered, range.End + 1);
            }
            Assert.True(covered >= size, $"Ranges cover {covered} bytes but the file is {size} bytes.");
        }

        public static string Sha256OfFile(string path) => Checksum.ComputeSha256Hex(path);

        public static string Sha256OfBytes(byte[] data) => Checksum.ComputeSha256Hex(data);
    }
}

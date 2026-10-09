using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;
using AdzakDownloadPro.Tests.TestServer;

namespace AdzakDownloadPro.Tests
{
    /// <summary>Segmented downloading: multi-range transfers, merge correctness, checksum verification,
    /// resume across restarts, adaptive concurrency and range-integrity guarantees.</summary>
    public sealed class SegmentedDownloadTests
    {
        private static ScriptableHttpServer ServerWithPayload(int size, int seed = 1234)
        {
            var server = new ScriptableHttpServer();
            server.Payload = ScriptableHttpServer.MakePayload(size, seed);
            return server;
        }

        [Fact]
        public async Task Pro_mode_splits_into_ranges_and_merges_byte_identical()
        {
            const int size = 4 * 1024 * 1024;
            using var server = ServerWithPayload(size);
            // A light throttle makes the 8 parallel transfers overlap measurably, so the
            // server can actually observe the concurrency (loopback is otherwise too fast).
            server.ThrottleBytesPerSecond = 4 * 1024 * 1024;
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 8;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(size, item.TotalBytes);
            Assert.Equal(size, item.DownloadedBytes);
            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            // 8 segments were planned.
            Assert.Equal(8, item.Segments.Count);

            // The server saw exactly the planned ranges, tiling the file once, with no overlaps.
            var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
            Assert.Equal(8, ranges.Count);
            TestHelpers.AssertRangesTileExactlyOnce(ranges, size);

            // Parallelism actually happened, within the configured bound.
            Assert.True(server.MaxConcurrentRequests >= 4,
                $"Expected parallel connections, server saw max {server.MaxConcurrentRequests}.");
            Assert.True(server.MaxConcurrentRequests <= 9,
                $"Connection count exceeded the configured limit: {server.MaxConcurrentRequests}.");
        }

        [Fact]
        public async Task Medium_mode_uses_multiple_connections()
        {
            const int size = 2 * 1024 * 1024;
            using var server = ServerWithPayload(size);
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.MediumConnections = 4;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Medium);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
            Assert.Equal(4, ranges.Count);
            TestHelpers.AssertRangesTileExactlyOnce(ranges, size);
        }

        [Fact]
        public async Task Low_mode_uses_exactly_one_connection()
        {
            const int size = 1024 * 1024;
            using var server = ServerWithPayload(size);
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
            Assert.Equal(1, ranges.Count);
            Assert.Equal(0, ranges[0].Start);
            Assert.Equal(size - 1, ranges[0].End);
        }

        [Fact]
        public async Task Checksum_header_verification_passes_for_correct_file()
        {
            using var server = ServerWithPayload(512 * 1024);
            server.SendCorrectChecksumHeader = true;
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.NotNull(item.ExpectedSha256);
            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload), item.ExpectedSha256);
            Assert.True(File.Exists(Path.Combine(dir, "file.bin")));
        }

        [Fact]
        public async Task Checksum_mismatch_fails_and_removes_corrupted_file()
        {
            using var server = ServerWithPayload(512 * 1024);
            server.SendWrongChecksumHeader = true; // advertises a hash of different data
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Failed);

            Assert.Equal(DownloadStatus.Failed, item.Status);
            Assert.NotNull(item.ErrorMessage);
            Assert.Contains("SHA-256", item.ErrorMessage!);
            Assert.False(File.Exists(Path.Combine(dir, "file.bin")),
                "A file that fails checksum verification must be removed, not reported as successful.");
        }

        [Fact]
        public async Task Resume_after_restart_continues_from_offsets_without_redownloading()
        {
            const int size = 2 * 1024 * 1024;
            using var server = ServerWithPayload(size);
            server.ThrottleBytesPerSecond = 400 * 1024;
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 4;

            // --- first "application run": download partially, then stop gracefully ---
            DownloadItem item1;
            using (var engine1 = new DownloadEngine(options))
            {
                item1 = engine1.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
                await TestHelpers.WaitForBytesAsync(item1, 200 * 1024);
                await engine1.PauseAsync(item1); // saves resume metadata, keeps part files
                Assert.Equal(DownloadStatus.Paused, item1.Status);
            }

            long bytesSentBefore = server.TotalBodyBytesSent;
            server.ClearRecordedRequests();

            // --- second "application run": a brand-new engine resumes from disk ---
            using (var engine2 = new DownloadEngine(options))
            {
                var item2 = engine2.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
                await TestHelpers.WaitForStatusAsync(item2, DownloadStatus.Completed, timeoutMs: 120000);

                Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                    TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

                await Task.Delay(500); // let the server finish writing its last chunks

                // Resume must not re-download the bytes that were already on disk.
                long phase2Bytes = server.TotalBodyBytesSent - bytesSentBefore;
                Assert.True(phase2Bytes < size - 100 * 1024,
                    $"Resume re-downloaded too much ({phase2Bytes} of {size} bytes) — partial data was not reused.");

                // And the resumed requests continue from non-zero offsets.
                var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
                Assert.True(ranges.Count > 0, "Resume must issue range requests.");
                Assert.True(ranges.Any(r => r.Start > 0),
                    "Resume must continue from previously downloaded offsets.");
            }
        }

        [Fact]
        public async Task Changed_etag_after_restart_starts_fresh()
        {
            const int size = 1024 * 1024;
            using var server = ServerWithPayload(size);
            server.ThrottleBytesPerSecond = 400 * 1024;
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 4;

            using (var engine1 = new DownloadEngine(options))
            {
                var item1 = engine1.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
                await TestHelpers.WaitForBytesAsync(item1, 150 * 1024);
                await engine1.PauseAsync(item1);
            }

            // The file "changes" on the server: new ETag.
            server.ETag = "\"v2-changed\"";
            long bytesBefore = server.TotalBodyBytesSent;
            server.ClearRecordedRequests();

            using (var engine2 = new DownloadEngine(options))
            {
                var item2 = engine2.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
                await TestHelpers.WaitForStatusAsync(item2, DownloadStatus.Completed, timeoutMs: 120000);

                Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                    TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

                await Task.Delay(500); // let the server finish writing its last chunks

                // A changed file must be re-downloaded from scratch.
                long phase2Bytes = server.TotalBodyBytesSent - bytesBefore;
                Assert.True(phase2Bytes > size * 0.9,
                    $"Changed file should be re-downloaded fully, but only {phase2Bytes} bytes were sent.");

                var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
                Assert.True(ranges.Any(r => r.Start == 0), "A fresh download must request from byte 0.");
            }
        }

        [Fact]
        public async Task Adaptive_controller_splits_stalled_segment_and_still_completes()
        {
            const int size = 8 * 1024 * 1024;
            const int segmentSize = size / 4; // 4 connections × 2 MB
            using var server = ServerWithPayload(size);
            server.ThrottleBytesPerSecond = 1024 * 1024; // 1 MB/s for normal ranges
            // The range starting at 4 MB has a slow start: first 128 KB at 20 KB/s.
            server.StalledRangeStarts.Add(4L * 1024 * 1024);
            server.StalledRangeThrottleBytesPerSecond = 20 * 1024;
            server.StalledRangeSlowBytes = 128 * 1024;

            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 4;
            options.MaxConnections = 8;
            options.AdaptiveCheckIntervalSeconds = 1;
            options.AdaptiveMinSplitIntervalSeconds = 2;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed, timeoutMs: 120000);

            // Correctness first: the merged file must be byte-identical.
            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            // Evidence that the adaptive controller split the stalled segment: some requested
            // range starts at an offset that is not one of the original 2 MB boundaries.
            var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
            bool sawSplit = ranges.Any(r => r.Start % segmentSize != 0);
            Assert.True(sawSplit,
                "The stalled segment should have been split (expected a range request off the 2 MB boundaries).");

            // The split must have added a connection, but never beyond the configured maximum.
            Assert.True(server.MaxConcurrentRequests >= 5,
                $"Expected the split to add a connection (max concurrent was {server.MaxConcurrentRequests}).");
            Assert.True(server.MaxConcurrentRequests <= 8,
                $"Concurrency exceeded the configured maximum: {server.MaxConcurrentRequests}.");

            // The parent range of a split and its two children all appear in the request log,
            // so assert full coverage (each byte was fetched at least once); the children resume
            // from the parent's offset, so no byte is ever stored twice.
            TestHelpers.AssertRangesCoverFile(ranges, size);
        }

        [Fact]
        public async Task Progress_reports_monotonic_bytes_and_real_speeds()
        {
            using var server = ServerWithPayload(1024 * 1024);
            server.ThrottleBytesPerSecond = 500 * 1024;
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            long lastBytes = -1;
            bool sawSpeed = false;
            bool sawEta = false;
            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            item.Progress += (s, p) =>
            {
                Assert.True(p.DownloadedBytes >= lastBytes, "Downloaded bytes must be monotonic.");
                lastBytes = p.DownloadedBytes;
                if (p.SpeedBytesPerSecond > 0)
                    sawSpeed = true;
                if (p.EtaSeconds != null && p.EtaSeconds > 0)
                    sawEta = true;
                Assert.True(p.SpeedBytesPerSecond >= 0, "Speed can never be negative.");
                Assert.True(p.AverageSpeedBytesPerSecond >= 0, "Average speed can never be negative.");
            };

            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.True(sawSpeed, "Progress must report a measured speed while downloading.");
            Assert.True(sawEta, "Progress must report an ETA while the size is known.");
            Assert.Equal(item.TotalBytes, item.DownloadedBytes);
        }
    }
}

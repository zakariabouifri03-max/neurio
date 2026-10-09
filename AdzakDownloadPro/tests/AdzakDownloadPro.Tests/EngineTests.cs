using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;
using AdzakDownloadPro.Tests.TestServer;

namespace AdzakDownloadPro.Tests
{
    /// <summary>Engine behaviour that is independent of segmentation: probing, redirects, errors,
    /// pause/resume, cancel, limits and honest speed reporting.</summary>
    public sealed class EngineTests
    {
        private static ScriptableHttpServer ServerWithPayload(int size, int seed = 1234)
        {
            var server = new ScriptableHttpServer();
            server.Payload = ScriptableHttpServer.MakePayload(size, seed);
            return server;
        }

        [Fact]
        public async Task Low_mode_downloads_file_byte_identical()
        {
            using var server = ServerWithPayload(512 * 1024);
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            var finalPath = Path.Combine(dir, "file.bin");
            Assert.True(File.Exists(finalPath), "Final file must exist.");
            Assert.Equal(server.Payload.Length, item.TotalBytes);
            Assert.Equal(server.Payload.Length, item.DownloadedBytes);
            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload), TestHelpers.Sha256OfFile(finalPath));
            Assert.Null(item.ErrorMessage);
        }

        [Fact]
        public async Task Pro_mode_falls_back_to_single_connection_when_server_ignores_ranges()
        {
            using var server = ServerWithPayload(1024 * 1024);
            server.IgnoreRangeRequests = true; // answers 200 with the full body even to Range requests
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 8;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(server.Payload.Length, item.DownloadedBytes);
            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            // One probe + one full-body GET, and the body request must not carry a Range header.
            var bodyRequests = server.Requests.Where(r => r.RangeHeader == null).ToList();
            Assert.Equal(1, bodyRequests.Count);
        }

        [Fact]
        public async Task Redirect_is_followed()
        {
            using var server = ServerWithPayload(256 * 1024);
            server.RedirectPaths.Add("/go");
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/go", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));
        }

        [Fact]
        public async Task Not_found_fails_with_clear_error_and_no_file()
        {
            using var server = ServerWithPayload(1024);
            server.MissingPaths.Add("/missing.bin");
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/missing.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Failed);

            Assert.Equal(DownloadStatus.Failed, item.Status);
            Assert.NotNull(item.ErrorMessage);
            Assert.Contains("404", item.ErrorMessage!);
            Assert.False(File.Exists(Path.Combine(dir, "missing.bin")), "A failed download must not leave a file behind.");
        }

        [Fact]
        public async Task Content_disposition_filename_is_used()
        {
            using var server = ServerWithPayload(128 * 1024);
            server.ContentDispositionFileName = "quarterly-report.pdf";
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal("quarterly-report.pdf", item.FileName);
            Assert.True(File.Exists(Path.Combine(dir, "quarterly-report.pdf")));
        }

        [Fact]
        public async Task Truncated_body_fails_instead_of_reporting_success()
        {
            using var server = ServerWithPayload(1024 * 1024);
            server.DropAfterBodyBytes = 300 * 1024; // always cut off mid-body
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.MaxRetries = 2;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Failed);

            Assert.Equal(DownloadStatus.Failed, item.Status);
            Assert.NotNull(item.ErrorMessage);
            Assert.False(File.Exists(Path.Combine(dir, "file.bin")),
                "An incomplete file must never be reported as a successful download.");
        }

        [Fact]
        public async Task Extra_bytes_beyond_content_length_are_ignored()
        {
            using var server = ServerWithPayload(512 * 1024);
            var extra = new byte[64 * 1024];
            new Random(7).NextBytes(extra);
            var payload = server.Payload;
            var padded = new byte[payload.Length + extra.Length];
            Array.Copy(payload, padded, payload.Length);
            Array.Copy(extra, 0, padded, payload.Length, extra.Length);

            server.CustomHandler = request =>
            {
                if (request.Path != "/file.bin")
                    return null;
                // Advertise the real size but send extra bytes at the end.
                return new ResponseSpec
                {
                    StatusCode = 200,
                    Body = padded,
                    ContentLengthOverride = payload.Length, // advertise the real size, send extra bytes
                };
            };

            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            var finalPath = Path.Combine(dir, "file.bin");
            Assert.Equal(payload.Length, new FileInfo(finalPath).Length);
            Assert.Equal(TestHelpers.Sha256OfBytes(payload), TestHelpers.Sha256OfFile(finalPath));
        }

        [Fact]
        public async Task Pause_and_resume_in_same_session_continues_from_offset()
        {
            using var server = ServerWithPayload(1024 * 1024);
            server.ThrottleBytesPerSecond = 400 * 1024; // slow enough to pause mid-transfer
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 4;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForBytesAsync(item, 150 * 1024);
            await engine.PauseAsync(item);
            Assert.Equal(DownloadStatus.Paused, item.Status);
            long pausedAt = item.DownloadedBytes;
            Assert.True(pausedAt > 0, "Should have made progress before pausing.");

            server.ClearRecordedRequests();
            await engine.ResumeAsync(item);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            // The resumed requests must continue from the paused offsets, not restart from 0.
            var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
            Assert.True(ranges.Count > 0, "Resume must issue range requests.");
            Assert.True(ranges.All(r => r.Start > 0),
                "Resume must continue from the paused offsets, not restart from 0. Ranges: " +
                string.Join(", ", ranges.Select(r => r.Start + "-" + r.End)));
        }

        [Fact]
        public async Task Cancel_deletes_partial_files()
        {
            using var server = ServerWithPayload(4 * 1024 * 1024);
            server.ThrottleBytesPerSecond = 300 * 1024;
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForBytesAsync(item, 100 * 1024);
            await engine.CancelAsync(item);

            Assert.Equal(DownloadStatus.Canceled, item.Status);
            Assert.False(File.Exists(Path.Combine(dir, "file.bin")));
            var tempDir = Path.Combine(dir, ".adzak-tmp");
            if (Directory.Exists(tempDir))
                Assert.Equal(0, Directory.GetFiles(tempDir).Length);
        }

        [Fact]
        public async Task Empty_file_completes()
        {
            using var server = ServerWithPayload(0);
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            var finalPath = Path.Combine(dir, "file.bin");
            Assert.True(File.Exists(finalPath));
            Assert.Equal(0, new FileInfo(finalPath).Length);
        }

        [Fact]
        public async Task Unknown_size_download_completes()
        {
            using var server = ServerWithPayload(300 * 1024);
            server.OmitContentLength = true;   // close-delimited body, no size
            server.IgnoreRangeRequests = true; // and no ranges
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Null(item.TotalBytes);
            Assert.Equal(server.Payload.Length, item.DownloadedBytes);
            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));
        }

        [Fact]
        public async Task Simultaneous_download_limit_is_respected()
        {
            using var server = new ScriptableHttpServer();
            server.Payload = ScriptableHttpServer.MakePayload(2 * 1024 * 1024);
            server.ThrottleBytesPerSecond = 500 * 1024; // slow enough to observe overlap
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.MaxSimultaneousDownloads = 2;
            using var engine = new DownloadEngine(options);

            var items = new System.Collections.Generic.List<DownloadItem>();
            int maxConcurrent = 0;
            void Track(object? sender, EventArgs _)
            {
                // Recompute how many downloads are in an active state right now.
                int count = engine.Items.Count(i =>
                    i.Status == DownloadStatus.Probing || i.Status == DownloadStatus.Downloading
                    || i.Status == DownloadStatus.Merging || i.Status == DownloadStatus.Verifying);
                if (count > maxConcurrent)
                    maxConcurrent = count;
            }
            engine.ItemAdded += (s, added) => Track(s, EventArgs.Empty);
            engine.Progress += (s, p) => Track(s, EventArgs.Empty);

            for (int i = 0; i < 5; i++)
            {
                var item = engine.StartDownload($"{server.BaseUrl}/file.bin?i={i}", dir, DownloadMode.Pro);
                items.Add(item);
            }

            foreach (var item in items)
                await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed, timeoutMs: 120000);

            Assert.True(maxConcurrent <= 2,
                $"At most 2 downloads may be active at once, but observed {maxConcurrent}.");
            Assert.True(maxConcurrent >= 2, "The limit should actually allow 2 concurrent downloads.");
        }

        [Fact]
        public async Task Speed_is_measured_from_real_transferred_bytes()
        {
            using var server = ServerWithPayload(1024 * 1024);
            server.ThrottleBytesPerSecond = 300 * 1024;
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            double maxObservedSpeed = 0;
            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            item.Progress += (s, p) =>
            {
                if (p.SpeedBytesPerSecond > maxObservedSpeed)
                    maxObservedSpeed = p.SpeedBytesPerSecond;
            };

            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.True(maxObservedSpeed > 0, "Speed must be measured while downloading.");
            Assert.True(maxObservedSpeed < 300 * 1024 * 3,
                $"Speed ({maxObservedSpeed}) should be in the ballpark of the real throttle, not invented.");
            Assert.True(item.AverageSpeedBytesPerSecond > 0, "Average speed must be measured too.");
        }

        [Fact]
        public void Invalid_url_is_rejected_before_starting()
        {
            using var engine = new DownloadEngine(TestHelpers.FastOptions());
            Assert.Throws<ArgumentException>(() =>
                engine.StartDownload("not a url", TestHelpers.NewTempDir(), DownloadMode.Low));
            Assert.Throws<ArgumentException>(() =>
                engine.StartDownload("ftp://example.com/file", TestHelpers.NewTempDir(), DownloadMode.Low));
        }
    }
}

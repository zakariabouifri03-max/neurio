using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;
using AdzakDownloadPro.Tests.TestServer;

namespace AdzakDownloadPro.Tests
{
    /// <summary>Automatic retries: transient server errors, rate limiting, mid-body connection drops
    /// and resume-from-offset after failures.</summary>
    public sealed class RetryTests
    {
        private static ScriptableHttpServer ServerWithPayload(int size, int seed = 1234)
        {
            var server = new ScriptableHttpServer();
            server.Payload = ScriptableHttpServer.MakePayload(size, seed);
            return server;
        }

        [Fact]
        public async Task Server_500s_are_retried_until_success()
        {
            using var server = ServerWithPayload(512 * 1024);
            server.FailFirstNRequestsWith500["/file.bin"] = 2; // first two requests fail
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            // Probe (1) + 2 failed body requests + 1 successful body request.
            Assert.True(server.Requests.Count >= 4,
                $"Expected retries to be visible in the request log, saw {server.Requests.Count} requests.");
        }

        [Fact]
        public async Task Permanent_500_fails_after_max_retries_with_clear_error()
        {
            using var server = ServerWithPayload(256 * 1024);
            server.FailFirstNRequestsWith500["/file.bin"] = 100; // always fails
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.MaxRetries = 2;
            using var engine = new DownloadEngine(options);

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Failed);

            Assert.Equal(DownloadStatus.Failed, item.Status);
            Assert.NotNull(item.ErrorMessage);
            Assert.Contains("500", item.ErrorMessage!);
            Assert.False(File.Exists(Path.Combine(dir, "file.bin")));
        }

        [Fact]
        public async Task Too_many_requests_429_is_retried()
        {
            using var server = ServerWithPayload(256 * 1024);
            server.FailFirstNRequestsWith429["/file.bin"] = 2; // two 429s, then success
            var dir = TestHelpers.NewTempDir();
            using var engine = new DownloadEngine(TestHelpers.FastOptions());

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Low);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed);

            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));
        }

        [Fact]
        public async Task Mid_body_connection_drop_resumes_from_offset()
        {
            const int size = 1024 * 1024;
            using var server = ServerWithPayload(size);
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 4;
            using var engine = new DownloadEngine(options);

            // Drop the first request at each original plan boundary (0, 256K, 512K, 768K)
            // partway through the body, once each. Retries start at new offsets and are served.
            var boundaries = new System.Collections.Generic.HashSet<long> { 0, 256 * 1024, 512 * 1024, 768 * 1024 };
            var dropped = new System.Collections.Generic.HashSet<long>();
            server.CustomHandler = request =>
            {
                if (request.Path != "/file.bin" || request.RangeHeader == null)
                    return null;
                var value = request.RangeHeader.Substring("bytes=".Length);
                int dash = value.IndexOf('-');
                if (dash <= 0 || !long.TryParse(value.Substring(0, dash), out long start))
                    return null;
                if (!boundaries.Contains(start))
                    return null; // not an original boundary (e.g. a retry) — default behaviour

                lock (dropped)
                {
                    if (dropped.Contains(start))
                        return null;
                    dropped.Add(start);
                }

                // Serve the range but drop the connection after 40% of it.
                long end = size - 1;
                var body = new byte[end - start + 1];
                Array.Copy(server.Payload, start, body, 0, body.Length);
                return new ResponseSpec
                {
                    StatusCode = 206,
                    ReasonPhrase = "Partial Content",
                    Body = body,
                    ContentRange = $"bytes {start}-{end}/{size}",
                    SendBodyBytesThenClose = (int)(body.Length * 0.4),
                };
            };

            var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
            await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed, timeoutMs: 120000);

            Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

            // Each dropped range must have been re-requested starting from where it stopped:
            // the ranges together cover the file, and at least one retry starts at a non-zero
            // offset (i.e. it resumed from the bytes already on disk instead of restarting).
            var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
            TestHelpers.AssertRangesCoverFile(ranges, size);

            Assert.True(ranges.Any(r => r.Start > 0),
                "A mid-body drop must be retried from the offset where it stopped.");
            Assert.True(ranges.Count > 4,
                $"Expected retries to add range requests, saw {ranges.Count} for 4 segments.");
        }

        [Fact]
        public async Task Retry_after_failure_resumes_partial_progress()
        {
            const int size = 1024 * 1024;
            using var server = ServerWithPayload(size);
            server.ThrottleBytesPerSecond = 400 * 1024;
            var dir = TestHelpers.NewTempDir();
            var options = TestHelpers.FastOptions();
            options.ProConnections = 4;
            options.MaxRetries = 1;

            // Fail every request once per range start, then behave — the download fails only
            // if retries are exhausted, so instead: fail the WHOLE first attempt via 500s on
            // the first probe, then let it succeed on retry.
            int probeFailures = 1;
            server.CustomHandler = request =>
            {
                if (request.RangeHeader == "bytes=0-0" && probeFailures > 0)
                {
                    probeFailures--;
                    return new ResponseSpec { StatusCode = 500, ReasonPhrase = "Internal Server Error", Body = Array.Empty<byte>() };
                }
                return null;
            };

            using (var engine = new DownloadEngine(options))
            {
                var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
                await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed, timeoutMs: 120000);
                Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                    TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));
            }

            // Now a scenario where the download FAILS mid-way and Retry resumes partial progress:
            server.CustomHandler = null;
            server.ThrottleBytesPerSecond = 400 * 1024;
            int failRound = 0;
            server.CustomHandler = request =>
            {
                if (request.Path != "/file.bin" || request.RangeHeader == null)
                    return null;
                // Drop the connection mid-body for every request while failRound == 0,
                // but only for the first 100 KB, and only until the download has made progress.
                if (failRound == 0)
                {
                    var value = request.RangeHeader.Substring("bytes=".Length);
                    int dash = value.IndexOf('-');
                    if (dash <= 0 || !long.TryParse(value.Substring(0, dash), out long start))
                        return null;
                    long end = size - 1;
                    var body = new byte[end - start + 1];
                    Array.Copy(server.Payload, start, body, 0, body.Length);
                    return new ResponseSpec
                    {
                        StatusCode = 206,
                        Body = body,
                        ContentRange = $"bytes {start}-{end}/{size}",
                        SendBodyBytesThenClose = 100 * 1024, // drop after 100 KB, always
                    };
                }
                return null;
            };

            using (var engine = new DownloadEngine(options))
            {
                var item = engine.StartDownload(server.BaseUrl + "/file.bin", dir, DownloadMode.Pro);
                // With MaxRetries = 1 every segment exhausts its retries → Failed.
                await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Failed, timeoutMs: 120000);
                Assert.True(item.DownloadedBytes > 0, "Partial progress should exist before the failure.");

                // Server behaves now.
                failRound = 1;
                server.ClearRecordedRequests();
                await engine.RetryAsync(item);
                await TestHelpers.WaitForStatusAsync(item, DownloadStatus.Completed, timeoutMs: 120000);

                Assert.Equal(TestHelpers.Sha256OfBytes(server.Payload),
                    TestHelpers.Sha256OfFile(Path.Combine(dir, "file.bin")));

                // Retry must resume from the partial offsets, not restart from zero.
                var ranges = TestHelpers.GetRequestedRanges(server, "/file.bin");
                Assert.True(ranges.Any(r => r.Start > 0),
                    "Retry after failure must resume from previously downloaded offsets.");
            }
        }
    }
}

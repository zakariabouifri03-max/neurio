using System;
using System.IO;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public sealed class HttpUtilsTests
    {
        [Fact]
        public void TryParseContentRange_valid()
        {
            Assert.True(HttpUtils.TryParseContentRange("bytes 0-1023/5000", out long start, out long end, out long total));
            Assert.Equal(0, start);
            Assert.Equal(1023, end);
            Assert.Equal(5000, total);
        }

        [Fact]
        public void TryParseContentRange_unknown_total()
        {
            Assert.True(HttpUtils.TryParseContentRange("bytes 10-99/*", out long start, out long end, out long total));
            Assert.Equal(10, start);
            Assert.Equal(99, end);
            Assert.Equal(-1, total);
        }

        [Fact]
        public void TryParseContentRange_total_only()
        {
            Assert.True(HttpUtils.TryParseContentRange("bytes */5000", out _, out _, out long total));
            Assert.Equal(5000, total);
        }

        [Fact]
        public void TryParseContentRange_rejects_garbage()
        {
            Assert.False(HttpUtils.TryParseContentRange(null, out _, out _, out _));
            Assert.False(HttpUtils.TryParseContentRange("", out _, out _, out _));
            Assert.False(HttpUtils.TryParseContentRange("bytes", out _, out _, out _));
            Assert.False(HttpUtils.TryParseContentRange("items 0-10/100", out _, out _, out _));
            Assert.False(HttpUtils.TryParseContentRange("bytes abc-def/100", out _, out _, out _));
            Assert.False(HttpUtils.TryParseContentRange("bytes 100-50/1000", out _, out _, out _)); // end < start
        }

        [Fact]
        public void IsRetryableStatusCode_classification()
        {
            Assert.True(HttpUtils.IsRetryableStatusCode(408));
            Assert.True(HttpUtils.IsRetryableStatusCode(425));
            Assert.True(HttpUtils.IsRetryableStatusCode(429));
            Assert.True(HttpUtils.IsRetryableStatusCode(500));
            Assert.True(HttpUtils.IsRetryableStatusCode(503));
            Assert.False(HttpUtils.IsRetryableStatusCode(200));
            Assert.False(HttpUtils.IsRetryableStatusCode(404));
            Assert.False(HttpUtils.IsRetryableStatusCode(403));
        }

        [Fact]
        public void GetFileNameFromContentDisposition_quoted()
        {
            Assert.Equal("report.pdf",
                HttpUtils.GetFileNameFromContentDisposition("attachment; filename=\"report.pdf\""));
        }

        [Fact]
        public void GetFileNameFromContentDisposition_unquoted()
        {
            Assert.Equal("file.zip",
                HttpUtils.GetFileNameFromContentDisposition("attachment; filename=file.zip"));
        }

        [Fact]
        public void GetFileNameFromContentDisposition_rfc5987()
        {
            Assert.Equal("€.txt",
                HttpUtils.GetFileNameFromContentDisposition("attachment; filename*=UTF-8''%E2%82%AC.txt"));
        }

        [Fact]
        public void GetFileNameFromContentDisposition_absent()
        {
            Assert.Null(HttpUtils.GetFileNameFromContentDisposition("attachment"));
            Assert.Null(HttpUtils.GetFileNameFromContentDisposition(null));
        }

        [Fact]
        public void GetFileNameFromUrl_works()
        {
            Assert.Equal("setup.exe", HttpUtils.GetFileNameFromUrl(new Uri("https://example.com/downloads/setup.exe")));
            Assert.Equal("archive.tar.gz", HttpUtils.GetFileNameFromUrl(new Uri("https://example.com/a/b/archive.tar.gz?x=1")));
            Assert.Equal("download", HttpUtils.GetFileNameFromUrl(new Uri("https://example.com/")));
        }

        [Fact]
        public void SanitizeFileName_replaces_invalid_chars()
        {
            var sanitized = HttpUtils.SanitizeFileName("a<b>c:d\"e/f\\g|h?i*j.txt");
            Assert.False(sanitized.Contains("<"));
            Assert.False(sanitized.Contains(">"));
            Assert.False(sanitized.Contains("\""));
            Assert.False(sanitized.Contains("/"));
            Assert.False(sanitized.Contains("\\"));
            Assert.False(sanitized.Contains("|"));
            Assert.False(sanitized.Contains("?"));
            Assert.False(sanitized.Contains("*"));
            Assert.True(sanitized.EndsWith(".txt", StringComparison.Ordinal));
        }

        [Fact]
        public void SanitizeFileName_defaults()
        {
            Assert.Equal("download", HttpUtils.SanitizeFileName(null));
            Assert.Equal("download", HttpUtils.SanitizeFileName("   "));
            Assert.Equal("download", HttpUtils.SanitizeFileName("..."));
        }

        [Fact]
        public void GetUniqueFilePath_appends_counter()
        {
            var dir = TestHelpers.NewTempDir();
            File.WriteAllText(Path.Combine(dir, "a.txt"), "x");
            File.WriteAllText(Path.Combine(dir, "a (1).txt"), "x");

            var path = HttpUtils.GetUniqueFilePath(dir, "a.txt");
            Assert.Equal(Path.Combine(dir, "a (2).txt"), path);

            var free = HttpUtils.GetUniqueFilePath(dir, "b.txt");
            Assert.Equal(Path.Combine(dir, "b.txt"), free);
        }
    }
}

using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public sealed class ByteFormatterTests
    {
        [Fact]
        public void FormatSize_bytes()
        {
            Assert.Equal("0 B", ByteFormatter.FormatSize(0));
            Assert.Equal("512 B", ByteFormatter.FormatSize(512));
            Assert.Equal("1023 B", ByteFormatter.FormatSize(1023));
        }

        [Fact]
        public void FormatSize_kilobytes_and_up()
        {
            Assert.Equal("1.00 KB", ByteFormatter.FormatSize(1024));
            Assert.Equal("1.50 KB", ByteFormatter.FormatSize(1536));
            Assert.Equal("83.4 KB", ByteFormatter.FormatSize(83.4 * 1024));
            Assert.Equal("12.0 MB", ByteFormatter.FormatSize(12 * 1024 * 1024));
            Assert.Equal("1.00 GB", ByteFormatter.FormatSize(1024.0 * 1024 * 1024));
        }

        [Fact]
        public void FormatSpeed_appends_per_second()
        {
            Assert.Equal("512 B/s", ByteFormatter.FormatSpeed(512));
            Assert.Equal("1.50 KB/s", ByteFormatter.FormatSpeed(1536));
            Assert.Equal("12.0 MB/s", ByteFormatter.FormatSpeed(12 * 1024 * 1024));
        }

        [Fact]
        public void FormatEta_various_ranges()
        {
            Assert.Equal("42s", ByteFormatter.FormatEta(42));
            Assert.Equal("3m 12s", ByteFormatter.FormatEta(192));
            Assert.Equal("1h 05m", ByteFormatter.FormatEta(3900));
            Assert.Equal("--:--", ByteFormatter.FormatEta(null));
            Assert.Equal("--:--", ByteFormatter.FormatEta(-1));
        }

        [Fact]
        public void FormatPercent_works()
        {
            Assert.Equal("0%", ByteFormatter.FormatPercent(0));
            Assert.Equal("50%", ByteFormatter.FormatPercent(0.5));
            Assert.Equal("99.9%", ByteFormatter.FormatPercent(0.999));
            Assert.Equal("--", ByteFormatter.FormatPercent(null));
        }
    }
}

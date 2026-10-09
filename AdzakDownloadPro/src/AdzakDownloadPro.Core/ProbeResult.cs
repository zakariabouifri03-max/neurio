using System;

namespace AdzakDownloadPro.Core
{
    /// <summary>Outcome of the initial server probe (a single ranged GET, headers only).</summary>
    public sealed class ProbeResult
    {
        public bool Success { get; set; }
        public int StatusCode { get; set; }

        /// <summary>True when the server answered a <c>Range: bytes=0-0</c> request with 206 and a valid Content-Range.</summary>
        public bool SupportsRanges { get; set; }

        /// <summary>Total file size in bytes, when known.</summary>
        public long? TotalBytes { get; set; }

        public string? ETag { get; set; }
        public string? LastModified { get; set; }

        /// <summary>File name suggested by the server (Content-Disposition), if any.</summary>
        public string? SuggestedFileName { get; set; }

        /// <summary>Final URL after redirects.</summary>
        public Uri? FinalUrl { get; set; }

        /// <summary>SHA-256 advertised by the server (Digest / X-Checksum-Sha256 headers), if any.</summary>
        public string? ExpectedSha256 { get; set; }

        public string? ErrorMessage { get; set; }
    }
}

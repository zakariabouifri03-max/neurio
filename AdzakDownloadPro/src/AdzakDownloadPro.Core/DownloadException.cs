using System;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Thrown when a download cannot be completed. Carries the HTTP status code (when the failure
    /// came from the server) and whether retrying could plausibly help.
    /// </summary>
    public sealed class DownloadException : Exception
    {
        public DownloadException(string message)
            : base(message)
        {
        }

        public DownloadException(string message, Exception innerException)
            : base(message, innerException)
        {
        }

        public DownloadException(string message, int? statusCode, bool retryable)
            : base(message)
        {
            StatusCode = statusCode;
            IsRetryable = retryable;
        }

        /// <summary>HTTP status code returned by the server, if the failure was a server response.</summary>
        public int? StatusCode { get; }

        /// <summary>True when the failure is transient (5xx, 429, network reset, timeout) and a retry may succeed.</summary>
        public bool IsRetryable { get; }

        /// <summary>Server-provided retry delay (Retry-After header), when present.</summary>
        public TimeSpan? RetryAfter { get; set; }
    }
}

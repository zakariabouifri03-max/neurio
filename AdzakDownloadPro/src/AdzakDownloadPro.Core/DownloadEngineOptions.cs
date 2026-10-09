using System;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// All tunable knobs of the download engine. Values are clamped to safe ranges by
    /// <see cref="ValidateAndClamp"/>. The engine reads this object live, so the UI can change
    /// settings while downloads are running.
    /// </summary>
    public sealed class DownloadEngineOptions
    {
        /// <summary>Connections used in LOW mode. Default 1 — a single connection is the most stable option.</summary>
        public int LowConnections { get; set; } = 1;

        /// <summary>Connections used in MEDIUM mode when the server supports ranges. Default 4.</summary>
        public int MediumConnections { get; set; } = 4;

        /// <summary>Connections used in PRO mode when the server supports ranges. Default 8.</summary>
        public int ProConnections { get; set; } = 8;

        /// <summary>Hard upper bound for concurrent connections to one server. Default 16.</summary>
        public int MaxConnections { get; set; } = 16;

        /// <summary>How many downloads may transfer at the same time. Default 3.</summary>
        public int MaxSimultaneousDownloads { get; set; } = 3;

        /// <summary>Per-segment retry attempts for transient failures. Default 5.</summary>
        public int MaxRetries { get; set; } = 5;

        /// <summary>Per-read/write disk buffer size in bytes. Default 64 KB.</summary>
        public int BufferSizeBytes { get; set; } = 64 * 1024;

        /// <summary>Abort a transfer that has moved no bytes for this long. Default 30 s.</summary>
        public int IdleTimeoutSeconds { get; set; } = 30;

        /// <summary>Timeout for receiving response headers. Default 15 s.</summary>
        public int ResponseTimeoutSeconds { get; set; } = 15;

        /// <summary>Smallest byte range worth its own connection. Default 256 KB.</summary>
        public long MinSegmentSizeBytes { get; set; } = SegmentPlanner.DefaultMinSegmentSize;

        /// <summary>Verify the final file against the server-advertised SHA-256 when available. Default true.</summary>
        public bool VerifyChecksums { get; set; } = true;

        /// <summary>Minimum delay between progress events. Default 100 ms.</summary>
        public int ProgressThrottleMilliseconds { get; set; } = 100;

        /// <summary>How often resume metadata is written to disk. Default 5 s.</summary>
        public int MetaSaveIntervalSeconds { get; set; } = 5;

        /// <summary>How often the adaptive (PRO) controller evaluates segment speeds. Default 2 s.</summary>
        public int AdaptiveCheckIntervalSeconds { get; set; } = 2;

        /// <summary>A segment is considered stalled when its windowed speed is below this fraction of the fastest segment. Default 0.2.</summary>
        public double AdaptiveStallRatio { get; set; } = 0.2;

        /// <summary>Minimum time between two splits of the same segment. Default 10 s.</summary>
        public int AdaptiveMinSplitIntervalSeconds { get; set; } = 10;

        /// <summary>Clamps every value into a safe range.</summary>
        public void ValidateAndClamp()
        {
            LowConnections = Clamp(LowConnections, 1, 64);
            MediumConnections = Clamp(MediumConnections, 1, 64);
            ProConnections = Clamp(ProConnections, 1, 64);
            MaxConnections = Clamp(MaxConnections, 1, 64);
            MaxSimultaneousDownloads = Clamp(MaxSimultaneousDownloads, 1, 32);
            MaxRetries = Clamp(MaxRetries, 0, 20);
            BufferSizeBytes = Clamp(BufferSizeBytes, 4 * 1024, 4 * 1024 * 1024);
            IdleTimeoutSeconds = Clamp(IdleTimeoutSeconds, 5, 600);
            ResponseTimeoutSeconds = Clamp(ResponseTimeoutSeconds, 3, 300);
            MinSegmentSizeBytes = Clamp(MinSegmentSizeBytes, 16 * 1024, 64L * 1024 * 1024);
            ProgressThrottleMilliseconds = Clamp(ProgressThrottleMilliseconds, 20, 5000);
            MetaSaveIntervalSeconds = Clamp(MetaSaveIntervalSeconds, 1, 300);
            AdaptiveCheckIntervalSeconds = Clamp(AdaptiveCheckIntervalSeconds, 1, 60);
            AdaptiveStallRatio = Math.Min(0.95, Math.Max(0.01, AdaptiveStallRatio));
            AdaptiveMinSplitIntervalSeconds = Clamp(AdaptiveMinSplitIntervalSeconds, 2, 600);

            // Per-mode connection counts may not exceed the global cap.
            if (LowConnections > MaxConnections) LowConnections = MaxConnections;
            if (MediumConnections > MaxConnections) MediumConnections = MaxConnections;
            if (ProConnections > MaxConnections) ProConnections = MaxConnections;
        }

        private static int Clamp(int value, int min, int max) => value < min ? min : (value > max ? max : value);
        private static long Clamp(long value, long min, long max) => value < min ? min : (value > max ? max : value);
    }
}

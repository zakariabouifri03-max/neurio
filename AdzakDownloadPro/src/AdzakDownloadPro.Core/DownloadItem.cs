using System;
using System.Collections.Generic;
using System.Threading;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// One download: identity, user choices, live state and the segment list.
    /// The engine mutates this object; the UI observes it through <see cref="Progress"/> and
    /// <see cref="StatusChanged"/> events and reads snapshots with <see cref="CreateSnapshot"/>.
    /// </summary>
    public sealed class DownloadItem
    {
        private long _downloadedBytes;
        private long? _totalBytes;
        private int _activeConnections;
        private double _speedBytesPerSecond;
        private double _averageSpeedBytesPerSecond;
        private double? _etaSeconds;
        private volatile DownloadStatus _status;
        private string? _errorMessage;

        internal DownloadItem(string url, string destinationDirectory, DownloadMode mode, string? fileName, string? expectedSha256)
        {
            Url = url;
            DestinationDirectory = destinationDirectory;
            Mode = mode;
            FileName = fileName ?? string.Empty;
            ExpectedSha256 = expectedSha256;
        }

        public Guid Id { get; internal set; } = Guid.NewGuid();

        /// <summary>Original URL as entered by the user.</summary>
        public string Url { get; }

        /// <summary>Resolved file name (set after probing).</summary>
        public string FileName { get; internal set; }

        public string DestinationDirectory { get; }

        /// <summary>Full path of the final file once known.</summary>
        public string FinalFilePath { get; internal set; } = string.Empty;

        /// <summary>Directory holding partial segment files and resume metadata.</summary>
        public string TempDirectory { get; internal set; } = string.Empty;

        public string MetaFilePath { get; internal set; } = string.Empty;

        public DownloadMode Mode { get; internal set; }

        public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;

        public DateTimeOffset? StartedAt { get; internal set; }

        public DateTimeOffset? CompletedAt { get; internal set; }

        /// <summary>SHA-256 to verify the final file against (user-provided or advertised by the server).</summary>
        public string? ExpectedSha256 { get; internal set; }

        public string? ETag { get; internal set; }

        /// <summary>Total size in bytes, or null when the server did not disclose it.</summary>
        public long? TotalBytes
        {
            get => _totalBytes;
            internal set => _totalBytes = value;
        }

        /// <summary>Bytes stored on disk so far (all segments).</summary>
        public long DownloadedBytes
        {
            get => Interlocked.Read(ref _downloadedBytes);
            internal set => Interlocked.Exchange(ref _downloadedBytes, value);
        }

        public DownloadStatus Status
        {
            get => _status;
            internal set => _status = value;
        }

        public string? ErrorMessage
        {
            get => _errorMessage;
            internal set => _errorMessage = value;
        }

        /// <summary>Currently transferring connections.</summary>
        public int ActiveConnections
        {
            get => _activeConnections;
            internal set => _activeConnections = value;
        }

        /// <summary>Measured current throughput in bytes per second (sliding window).</summary>
        public double SpeedBytesPerSecond
        {
            get => _speedBytesPerSecond;
            internal set => _speedBytesPerSecond = value;
        }

        /// <summary>Measured average throughput in bytes per second (active time only).</summary>
        public double AverageSpeedBytesPerSecond
        {
            get => _averageSpeedBytesPerSecond;
            internal set => _averageSpeedBytesPerSecond = value;
        }

        /// <summary>Estimated remaining time in seconds, or null when it cannot be computed honestly.</summary>
        public double? EtaSeconds
        {
            get => _etaSeconds;
            internal set => _etaSeconds = value;
        }

        /// <summary>Segment list. Mutated by the engine under its segment lock; use
        /// <see cref="GetSegmentsSnapshot"/> for a stable copy.</summary>
        public List<SegmentState> Segments { get; } = new List<SegmentState>();

        /// <summary>Real measured throughput (sliding-window current speed + active-time average).</summary>
        public SpeedMeter SpeedMeter { get; } = new SpeedMeter();

        /// <summary>True when the engine should send Range headers (server supports ranges and the file is segmentable).</summary>
        internal bool UseRangeHeaders { get; set; }

        /// <summary>Raised (on a thread-pool thread) with a fresh snapshot, throttled by the engine.</summary>
        public event EventHandler<DownloadProgress>? Progress;

        /// <summary>Raised whenever <see cref="Status"/> changes.</summary>
        public event EventHandler? StatusChanged;

        public TimeSpan Elapsed => (CompletedAt ?? DateTimeOffset.UtcNow) - (StartedAt ?? CreatedAt);

        public double? Percent => TotalBytes is > 0 ? Math.Min(1.0, DownloadedBytes / (double)TotalBytes.Value) : null;

        internal void AddDownloadedBytes(long bytes) => Interlocked.Add(ref _downloadedBytes, bytes);

        public IReadOnlyList<SegmentState> GetSegmentsSnapshot()
        {
            lock (Segments)
                return Segments.ToArray();
        }

        public DownloadProgress CreateSnapshot()
        {
            int total;
            int completed;
            lock (Segments)
            {
                total = Segments.Count;
                completed = 0;
                foreach (var s in Segments)
                    if (s.IsComplete)
                        completed++;
            }

            return new DownloadProgress(
                Id,
                Status,
                DownloadedBytes,
                TotalBytes,
                SpeedBytesPerSecond,
                AverageSpeedBytesPerSecond,
                EtaSeconds,
                ActiveConnections,
                total,
                completed,
                ErrorMessage);
        }

        internal void RaiseProgress(DownloadProgress snapshot) => Progress?.Invoke(this, snapshot);

        internal void RaiseStatusChanged() => StatusChanged?.Invoke(this, EventArgs.Empty);

        // ---- runtime-only handles used by the engine ----
        internal CancellationTokenSource? PauseCts;
        internal CancellationTokenSource? CancelCts;
        internal System.Threading.Tasks.Task? RunTask;
        internal long ProgressReportTicks;
        internal long LastMetaSaveTicks;
    }
}

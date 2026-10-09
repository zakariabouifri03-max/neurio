using System;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Immutable point-in-time snapshot of a download, raised by the engine roughly every
    /// <see cref="DownloadEngineOptions.ProgressThrottleMilliseconds"/> while transferring.
    /// All speeds are real measured values (bytes per second).
    /// </summary>
    public sealed class DownloadProgress
    {
        public DownloadProgress(
            Guid id,
            DownloadStatus status,
            long downloadedBytes,
            long? totalBytes,
            double speedBytesPerSecond,
            double averageSpeedBytesPerSecond,
            double? etaSeconds,
            int activeConnections,
            int segmentsTotal,
            int segmentsCompleted,
            string? errorMessage)
        {
            Id = id;
            Status = status;
            DownloadedBytes = downloadedBytes;
            TotalBytes = totalBytes;
            SpeedBytesPerSecond = speedBytesPerSecond;
            AverageSpeedBytesPerSecond = averageSpeedBytesPerSecond;
            EtaSeconds = etaSeconds;
            ActiveConnections = activeConnections;
            SegmentsTotal = segmentsTotal;
            SegmentsCompleted = segmentsCompleted;
            ErrorMessage = errorMessage;
        }

        public Guid Id { get; }
        public DownloadStatus Status { get; }
        public long DownloadedBytes { get; }
        public long? TotalBytes { get; }
        public double SpeedBytesPerSecond { get; }
        public double AverageSpeedBytesPerSecond { get; }
        public double? EtaSeconds { get; }
        public int ActiveConnections { get; }
        public int SegmentsTotal { get; }
        public int SegmentsCompleted { get; }
        public string? ErrorMessage { get; }

        /// <summary>0..1 completion fraction, or null when the total size is unknown.</summary>
        public double? Percent => TotalBytes is > 0 ? Math.Min(1.0, DownloadedBytes / (double)TotalBytes.Value) : null;

        public string SpeedText => ByteFormatter.FormatSpeed(SpeedBytesPerSecond);
        public string AverageSpeedText => ByteFormatter.FormatSpeed(AverageSpeedBytesPerSecond);
        public string SizeText => TotalBytes == null
            ? ByteFormatter.FormatSize(DownloadedBytes) + " / ?"
            : $"{ByteFormatter.FormatSize(DownloadedBytes)} / {ByteFormatter.FormatSize(TotalBytes.Value)}";
        public string EtaText => ByteFormatter.FormatEta(EtaSeconds);
        public string PercentText => ByteFormatter.FormatPercent(Percent);
    }
}

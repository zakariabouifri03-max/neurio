namespace TurboLoadPro.Core.Models;

/// <summary>
/// Persisted transfer state. URL is kept locally so a queued or interrupted direct link can be resumed;
/// it is never included in diagnostic logs or surfaced in the download list.
/// </summary>
public sealed class DownloadRecord
{
    internal object SyncRoot { get; } = new();

    public Guid Id { get; set; } = Guid.NewGuid();
    public string Url { get; set; } = string.Empty;
    public string FileName { get; set; } = "download";
    public string DestinationPath { get; set; } = string.Empty;
    public DownloadStatus Status { get; set; } = DownloadStatus.Queued;
    public DownloadPriority Priority { get; set; } = DownloadPriority.Normal;
    public long? TotalBytes { get; set; }
    public long DownloadedBytes { get; set; }
    public double SpeedBytesPerSecond { get; set; }
    public int Connections { get; set; } = 1;
    public bool? SupportsRanges { get; set; }
    public string? EntityTag { get; set; }
    public DateTimeOffset? LastModified { get; set; }
    public string? Sha256 { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedUtc { get; set; } = DateTimeOffset.UtcNow;
    public List<DownloadSegment> Segments { get; set; } = [];

    public DownloadRecord Snapshot()
    {
        lock (SyncRoot)
        {
            return new DownloadRecord
            {
                Id = Id,
                Url = Url,
                FileName = FileName,
                DestinationPath = DestinationPath,
                Status = Status,
                Priority = Priority,
                TotalBytes = TotalBytes,
                DownloadedBytes = DownloadedBytes,
                SpeedBytesPerSecond = SpeedBytesPerSecond,
                Connections = Connections,
                SupportsRanges = SupportsRanges,
                EntityTag = EntityTag,
                LastModified = LastModified,
                Sha256 = Sha256,
                Error = Error,
                CreatedUtc = CreatedUtc,
                UpdatedUtc = UpdatedUtc,
                Segments = Segments.Select(segment => segment.Clone()).ToList()
            };
        }
    }
}

using System.Text.Json.Serialization;

namespace AdzakDownloadPro.Core;

public enum DownloadStatus
{
    Queued,
    Downloading,
    InternetDisconnected,
    WaitingForInternet,
    Reconnecting,
    ResumingDownload,
    Paused,
    Completed,
    Failed,
    Cancelled
}

public enum TransferMode
{
    Undecided,
    Ranged,
    FullRestart
}

/// <summary>A checksummed, contiguous HTTP byte range stored in its own temporary segment file.</summary>
public sealed record VerifiedRange(long Start, long Length, string Path, string Sha256);

/// <summary>
/// A not-yet-complete range. BytesReceived and Sha256 are durably checkpointed together;
/// bytes beyond BytesReceived are truncated before the next request.
/// </summary>
public sealed record PartialRange(
    long Start,
    long ExpectedLength,
    long BytesReceived,
    string Path,
    string Sha256);

/// <summary>A non-resumable full-response attempt. Every retry gets a new file, preserving old data.</summary>
public sealed record FullTransfer(
    string Path,
    long BytesReceived,
    long? ExpectedLength,
    string Sha256,
    bool IsComplete);

/// <summary>
/// Persisted job state. Ranged jobs contain checksummed contiguous segments beginning at byte zero.
/// Runtime-only display properties are deliberately excluded from the durable queue.
/// </summary>
public sealed record DownloadJobRecord
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Url { get; init; } = "";
    public string DestinationPath { get; init; } = "";
    public string WorkDirectory { get; init; } = "";
    public bool OverwriteExisting { get; init; }

    public DownloadStatus Status { get; init; } = DownloadStatus.Queued;
    public TransferMode Mode { get; init; } = TransferMode.Undecided;
    public bool? RangeSupportKnown { get; init; }
    public long? TotalBytes { get; init; }
    public string? EntityTag { get; init; }
    public DateTimeOffset? LastModifiedUtc { get; init; }
    public List<VerifiedRange> VerifiedRanges { get; init; } = [];
    public PartialRange? PartialRange { get; init; }
    public FullTransfer? FullTransfer { get; init; }
    public List<string> TemporaryFiles { get; init; } = [];

    public int RetryCount { get; init; }
    public string? LastError { get; init; }
    public DateTimeOffset? NextRetryAtUtc { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAtUtc { get; init; } = DateTimeOffset.UtcNow;
    public string? FinalSha256 { get; init; }
    public bool UserConfirmedResume { get; init; }

    [JsonIgnore]
    public long VerifiedBytes => Mode == TransferMode.FullRestart
        ? FullTransfer?.BytesReceived ?? 0
        : VerifiedRanges.Sum(range => range.Length) + (PartialRange?.BytesReceived ?? 0);

    [JsonIgnore]
    public double ProgressPercent => TotalBytes is > 0
        ? Math.Clamp(100d * VerifiedBytes / TotalBytes.Value, 0d, 100d)
        : 0d;

    [JsonIgnore]
    public long CurrentSpeedBytesPerSecond { get; init; }

    [JsonIgnore]
    public string StatusText => Status switch
    {
        DownloadStatus.Queued => "QUEUED",
        DownloadStatus.Downloading => "DOWNLOADING",
        DownloadStatus.InternetDisconnected => "INTERNET DISCONNECTED — WAITING FOR CONNECTION",
        DownloadStatus.WaitingForInternet => "WAITING FOR INTERNET",
        DownloadStatus.Reconnecting => "RECONNECTING",
        DownloadStatus.ResumingDownload => "RESUMING DOWNLOAD",
        DownloadStatus.Paused => "PAUSED",
        DownloadStatus.Completed => "DOWNLOAD COMPLETED",
        DownloadStatus.Failed => "DOWNLOAD FAILED",
        DownloadStatus.Cancelled => "CANCELLED",
        _ => Status.ToString().ToUpperInvariant()
    };
}

public sealed record DownloadEngineOptions
{
    public int MaxConcurrentDownloads { get; init; } = 3;
    public int SegmentSizeBytes { get; init; } = 8 * 1024 * 1024;
    public int CheckpointSizeBytes { get; init; } = 1024 * 1024;
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(30);
    public TimeSpan ConnectivityPollInterval { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan[] RetryDelays { get; init; } =
    [
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(4),
        TimeSpan.FromSeconds(8),
        TimeSpan.FromSeconds(16),
        TimeSpan.FromSeconds(30),
        TimeSpan.FromSeconds(60)
    ];
}

public sealed class DownloadProgressEventArgs(DownloadJobRecord job) : EventArgs
{
    public DownloadJobRecord Job { get; } = job;
}

public interface IClock
{
    DateTimeOffset UtcNow { get; }
    Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken);
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) =>
        Task.Delay(delay, cancellationToken);
}

public interface INetworkMonitor : IAsyncDisposable
{
    bool IsNetworkAvailable { get; }
    event EventHandler? NetworkChanged;
    Task<bool> IsInternetReachableAsync(Uri downloadUri, CancellationToken cancellationToken);
    Task WaitForChangeAsync(TimeSpan fallbackInterval, CancellationToken cancellationToken);
}

public sealed class DownloadException(string message, bool isTransient = false, TimeSpan? retryAfter = null)
    : Exception(message)
{
    public bool IsTransient { get; } = isTransient;
    public TimeSpan? RetryAfter { get; } = retryAfter;
}

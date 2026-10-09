namespace TurboLoadPro.Core.Networking;

public sealed record RangeProbeResult(
    bool SupportsRanges,
    long? TotalBytes,
    string? EntityTag,
    DateTimeOffset? LastModified,
    string? SuggestedFileName,
    TimeSpan Latency);

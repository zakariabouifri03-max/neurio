namespace TurboLoadPro.Core.Models;

public readonly record struct DownloadProgress(long DownloadedBytes, long? TotalBytes, double BytesPerSecond);

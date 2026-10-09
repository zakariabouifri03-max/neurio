namespace TurboLoadPro.Core.Models;

public enum DownloadStatus
{
    Queued = 0,
    Probing = 1,
    Downloading = 2,
    Paused = 3,
    Completed = 4,
    Failed = 5,
    Cancelled = 6
}

public enum DownloadPriority
{
    Low = 0,
    Normal = 1,
    High = 2
}

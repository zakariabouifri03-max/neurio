namespace TurboLoadPro.Core.Models;

public sealed class DownloadSettings
{
    public string DownloadDirectory { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "TurboLoad Pro");
    public int MaxSimultaneousDownloads { get; set; } = 3;
    /// <summary>0 selects 8/16/32 automatically; otherwise 1, 8, 16, or 32.</summary>
    public int ConnectionsPerDownload { get; set; } = 0;
    /// <summary>Zero means unlimited; otherwise bytes per second across the whole app.</summary>
    public long GlobalSpeedLimitBytesPerSecond { get; set; }
    public int BufferSizeKiB { get; set; } = 256;
    public bool MonitorClipboard { get; set; }
    public bool NotifyOnCompletion { get; set; } = true;
    public bool AutoResumeInterrupted { get; set; } = true;
    public bool StartWithWindows { get; set; }
    public bool CalculateSha256 { get; set; }
    public string Theme { get; set; } = "Dark";

    public DownloadSettings Normalize()
    {
        MaxSimultaneousDownloads = Math.Clamp(MaxSimultaneousDownloads, 1, 10);
        ConnectionsPerDownload = ConnectionsPerDownload is 1 or 8 or 16 or 32 ? ConnectionsPerDownload : 0;
        GlobalSpeedLimitBytesPerSecond = Math.Clamp(GlobalSpeedLimitBytesPerSecond, 0, 1_000_000_000_000L);
        BufferSizeKiB = Math.Clamp(BufferSizeKiB, 64, 1024);
        if (string.IsNullOrWhiteSpace(DownloadDirectory))
            DownloadDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "TurboLoad Pro");
        try { DownloadDirectory = Path.GetFullPath(DownloadDirectory); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            DownloadDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "TurboLoad Pro");
        }
        Theme = string.Equals(Theme, "Light", StringComparison.OrdinalIgnoreCase) ? "Light" : "Dark";
        return this;
    }

    public DownloadSettings Clone() => new()
    {
        DownloadDirectory = DownloadDirectory,
        MaxSimultaneousDownloads = MaxSimultaneousDownloads,
        ConnectionsPerDownload = ConnectionsPerDownload,
        GlobalSpeedLimitBytesPerSecond = GlobalSpeedLimitBytesPerSecond,
        BufferSizeKiB = BufferSizeKiB,
        MonitorClipboard = MonitorClipboard,
        NotifyOnCompletion = NotifyOnCompletion,
        AutoResumeInterrupted = AutoResumeInterrupted,
        StartWithWindows = StartWithWindows,
        CalculateSha256 = CalculateSha256,
        Theme = Theme
    };
}

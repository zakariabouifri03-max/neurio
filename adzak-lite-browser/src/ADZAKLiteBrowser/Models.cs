namespace AdzakLiteBrowser;

/// <summary>User settings, persisted as JSON in %AppData%\ADZAK Lite Browser\settings.json.</summary>
public sealed class AppSettings
{
    public string HomePage { get; set; } = "";                 // "" = built-in start page
    public string SearchEngine { get; set; } = "duckduckgo";   // duckduckgo | google | bing
    public string DownloadFolder { get; set; } = "";           // "" = %UserProfile%\Downloads
    public bool AskWhereToSave { get; set; } = false;

    // Data saver
    public bool DataSaverEnabled { get; set; } = true;         // master switch (toolbar shield)
    public bool BlockAdsTrackers { get; set; } = true;
    public bool BlockImages { get; set; } = false;             // optional, off by default (compat)
    public bool PreventAutoplay { get; set; } = true;

    // Performance
    public bool HardwareAcceleration { get; set; } = true;     // GPU; applies after restart
    public int AutoSuspendMinutes { get; set; } = 5;           // suspend inactive tabs after N min (0 = never)
    public int DiskCacheCapMB { get; set; } = 200;             // --disk-cache-size cap
    public bool DevToolsEnabled { get; set; } = false;

    // Lifetime stats (honest counters: requests, not invented "MB saved")
    public long TotalBlockedRequests { get; set; } = 0;
    public long TotalImagesBlocked { get; set; } = 0;

    public string SearchTemplate() => SearchEngine switch
    {
        "google" => "https://www.google.com/search?q={0}",
        "bing" => "https://www.bing.com/search?q={0}",
        _ => "https://duckduckgo.com/?q={0}"
    };
}

public sealed class BookmarkItem
{
    public string Title { get; set; } = "";
    public string Url { get; set; } = "";
    public DateTime AddedUtc { get; set; } = DateTime.UtcNow;
}

public sealed class HistoryItem
{
    public string Title { get; set; } = "";
    public string Url { get; set; } = "";
    public DateTime VisitedUtc { get; set; } = DateTime.UtcNow;
}

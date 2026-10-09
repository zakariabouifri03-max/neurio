using System.ComponentModel;
using System.Runtime.CompilerServices;
using TurboLoadPro.Core.Models;

namespace TurboLoadPro.ViewModels;

public sealed class DownloadRowViewModel : INotifyPropertyChanged
{
    private readonly Action<Guid, DownloadPriority> _priorityChanged;
    private DownloadRecord _record;
    private DownloadPriority _priority;
    private IReadOnlyList<SegmentViewModel> _segments = [];

    public event PropertyChangedEventHandler? PropertyChanged;

    public DownloadRowViewModel(DownloadRecord record, Action<Guid, DownloadPriority> priorityChanged)
    {
        _record = record;
        _priorityChanged = priorityChanged;
        _priority = record.Priority;
        UpdateSegments();
    }

    public Guid Id => _record.Id;
    public DateTimeOffset CreatedUtc => _record.CreatedUtc;
    public DownloadStatus Status => _record.Status;
    public bool IsQueued => _record.Status == DownloadStatus.Queued;
    public string FileName => _record.FileName;
    public string FolderPath => Path.GetDirectoryName(_record.DestinationPath) ?? string.Empty;
    public string StatusText => _record.Status switch
    {
        DownloadStatus.Queued => "Queued",
        DownloadStatus.Probing => "Checking source",
        DownloadStatus.Downloading => "Downloading",
        DownloadStatus.Paused => "Paused",
        DownloadStatus.Completed => "Completed",
        DownloadStatus.Failed => "Failed",
        DownloadStatus.Cancelled => "Cancelled",
        _ => "Unknown"
    };
    public string SecondaryText => !string.IsNullOrWhiteSpace(_record.Error)
        ? _record.Error
        : _record.Sha256 is not null ? $"SHA-256  {_record.Sha256}" : FolderPath;
    public string ProgressText => _record.TotalBytes.HasValue
        ? $"{FormatBytes(_record.DownloadedBytes)} / {FormatBytes(_record.TotalBytes.Value)}"
        : $"{FormatBytes(_record.DownloadedBytes)} downloaded";
    public string PercentText => _record.TotalBytes is > 0
        ? $"{ProgressPercent:0.0}%"
        : _record.Status == DownloadStatus.Completed ? "100%" : "—";
    public double ProgressPercent => _record.TotalBytes is > 0
        ? Math.Clamp(_record.DownloadedBytes * 100d / _record.TotalBytes.Value, 0, 100)
        : 0;
    public string SpeedText => _record.Status == DownloadStatus.Downloading && _record.SpeedBytesPerSecond > 0
        ? $"{FormatBytes((long)_record.SpeedBytesPerSecond)}/s"
        : "—";
    public string EtaText
    {
        get
        {
            if (_record.Status != DownloadStatus.Downloading || _record.TotalBytes is not > 0 || _record.SpeedBytesPerSecond <= 0)
                return "—";
            var remainingSeconds = Math.Max(0, (_record.TotalBytes.Value - _record.DownloadedBytes) / _record.SpeedBytesPerSecond);
            if (remainingSeconds > TimeSpan.FromDays(99).TotalSeconds) return "99d+";
            var eta = TimeSpan.FromSeconds(remainingSeconds);
            return eta.TotalHours >= 1 ? $"{(int)eta.TotalHours}:{eta.Minutes:00}:{eta.Seconds:00}" : $"{eta.Minutes:00}:{eta.Seconds:00}";
        }
    }
    public string ConnectionsText => _record.Status == DownloadStatus.Downloading && _record.SupportsRanges == true
        ? $"{_record.Connections} connections" : _record.Status == DownloadStatus.Downloading ? "Single stream" : string.Empty;
    public IReadOnlyList<SegmentViewModel> Segments => _segments;
    public bool HasSegments => _record.Status == DownloadStatus.Downloading && _segments.Count > 1;
    public bool CanToggle => _record.Status is DownloadStatus.Downloading or DownloadStatus.Probing or DownloadStatus.Paused;
    public string ToggleText => _record.Status is DownloadStatus.Downloading or DownloadStatus.Probing ? "Pause" : "Resume";
    public string ToggleGlyph => _record.Status == DownloadStatus.Paused ? "▶" : "Ⅱ";
    public bool CanRetry => _record.Status is DownloadStatus.Failed or DownloadStatus.Cancelled;
    public bool CanCancel => _record.Status is not (DownloadStatus.Completed or DownloadStatus.Cancelled);
    public bool CanRestart => _record.Status is not (DownloadStatus.Probing or DownloadStatus.Downloading);
    public bool CanOpen => _record.Status == DownloadStatus.Completed && File.Exists(_record.DestinationPath);
    public bool IsIndeterminate => _record.Status == DownloadStatus.Probing || !_record.TotalBytes.HasValue;

    public DownloadPriority Priority
    {
        get => _priority;
        set
        {
            if (_priority == value) return;
            _priority = value;
            OnPropertyChanged();
            if (_record.Status == DownloadStatus.Queued)
                _priorityChanged(Id, value);
        }
    }

    public void Update(DownloadRecord record)
    {
        _record = record;
        _priority = record.Priority;
        UpdateSegments();
        OnPropertyChanged(string.Empty);
    }

    private void UpdateSegments()
    {
        if (_record.Segments.Count > 1)
        {
            _segments = _record.Segments.Select(segment => new SegmentViewModel(
                segment.Length <= 0 ? 0 : Math.Clamp(segment.BytesReceived * 100d / segment.Length, 0, 100))).ToArray();
        }
        else
        {
            _segments = [];
        }
    }

    public static string FormatBytes(long bytes)
    {
        if (bytes < 0) return "—";
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double size = bytes;
        var unit = 0;
        while (size >= 1024 && unit < units.Length - 1)
        {
            size /= 1024;
            unit++;
        }
        return unit == 0 ? $"{bytes:N0} B" : $"{size:0.##} {units[unit]}";
    }

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

public sealed record SegmentViewModel(double Value);

public sealed record PriorityOption(string Name, DownloadPriority Value);

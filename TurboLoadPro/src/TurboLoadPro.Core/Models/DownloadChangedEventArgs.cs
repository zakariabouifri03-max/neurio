namespace TurboLoadPro.Core.Models;

public sealed class DownloadChangedEventArgs(DownloadRecord record) : EventArgs
{
    public DownloadRecord Record { get; } = record;
}

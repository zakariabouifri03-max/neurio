using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace AdzakLiteBrowser;

/// <summary>One in-progress or finished download, wrapping the WebView2 operation.</summary>
public sealed class DownloadEntry
{
    public CoreWebView2DownloadOperation Operation { get; }
    public string TargetPath { get; }
    public DateTime StartedUtc { get; } = DateTime.UtcNow;

    public DownloadEntry(CoreWebView2DownloadOperation operation, string targetPath)
    {
        Operation = operation;
        TargetPath = targetPath;
    }

    public string FileName => Path.GetFileName(TargetPath);

    // WebView2 reports these as 64-bit values whose exact CLR types vary by
    // SDK vintage; Convert.*(object) keeps this robust either way.
    private long ReceivedBytes
    {
        get { try { return Convert.ToInt64(Operation.BytesReceived); } catch { return 0; } }
    }

    private long TotalBytes
    {
        get { try { return Convert.ToInt64(Operation.TotalBytesToReceive); } catch { return 0; } }
    }

    public int Percent
    {
        get
        {
            var total = TotalBytes;
            if (total <= 0) return 0;
            return (int)Math.Min(100, ReceivedBytes * 100 / total);
        }
    }

    public string SizeText
    {
        get
        {
            var total = TotalBytes;
            return total > 0
                ? $"{FormatBytes(ReceivedBytes)} / {FormatBytes(total)}"
                : FormatBytes(ReceivedBytes);
        }
    }

    public string StateText
    {
        get
        {
            try
            {
                return Operation.State switch
                {
                    CoreWebView2DownloadState.Completed => "Completed",
                    CoreWebView2DownloadState.Interrupted => $"Interrupted ({Operation.InterruptReason})",
                    _ => $"Downloading… {Percent}%"
                };
            }
            catch { return ""; }
        }
    }

    public static string FormatBytes(long bytes)
    {
        if (bytes >= 1_073_741_824) return $"{bytes / 1073741824.0:0.00} GB";
        if (bytes >= 1_048_576) return $"{bytes / 1048576.0:0.0} MB";
        if (bytes >= 1024) return $"{bytes / 1024.0:0} KB";
        return $"{bytes} B";
    }
}

/// <summary>Modeless downloads window. Polls operation state on a timer, so it
/// never holds stale event subscriptions on disposed WebViews.</summary>
public sealed class DownloadsForm : Form
{
    private readonly List<DownloadEntry> _downloads;
    private readonly ListView _list = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 400 };

    public DownloadsForm(List<DownloadEntry> downloads)
    {
        _downloads = downloads;
        Text = "Downloads — ADZAK Lite Browser";
        Width = 640;
        Height = 380;
        _list.Dock = DockStyle.Fill;
        _list.View = View.Details;
        _list.FullRowSelect = true;
        _list.Columns.Add("File", 240);
        _list.Columns.Add("Progress", 90);
        _list.Columns.Add("Size", 150);
        _list.Columns.Add("Status", 140);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42, Padding = new Padding(6) };
        var open = new Button { Text = "Open", Width = 80 };
        open.Click += (_, _) => { if (Selected() is { } e && File.Exists(e.TargetPath)) Process.Start(new ProcessStartInfo(e.TargetPath) { UseShellExecute = true }); };
        var folder = new Button { Text = "Folder", Width = 80 };
        folder.Click += (_, _) => { if (Selected() is { } e) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{e.TargetPath}\"") { UseShellExecute = true }); };
        var pauseResume = new Button { Text = "Pause/Resume", Width = 120 };
        pauseResume.Click += (_, _) =>
        {
            if (Selected() is not { } e) return;
            try
            {
                if (e.Operation.State == CoreWebView2DownloadState.InProgress) e.Operation.Pause();
                else if (e.Operation.CanResume) e.Operation.Resume();
            }
            catch { }
            RefreshList();
        };
        var remove = new Button { Text = "Remove from list", Width = 140 };
        remove.Click += (_, _) => { if (Selected() is { } e) { _downloads.Remove(e); RefreshList(); } };
        var clear = new Button { Text = "Clear finished", Width = 120 };
        clear.Click += (_, _) =>
        {
            _downloads.RemoveAll(d => { try { return d.Operation.State != CoreWebView2DownloadState.InProgress; } catch { return true; } });
            RefreshList();
        };
        buttons.Controls.AddRange(new Control[] { open, folder, pauseResume, remove, clear });

        Controls.Add(_list);
        Controls.Add(buttons);
        _timer.Tick += (_, _) => RefreshList();
        Shown += (_, _) => { _timer.Start(); RefreshList(); };
        FormClosed += (_, _) => _timer.Stop();
    }

    private DownloadEntry? Selected() =>
        _list.SelectedItems.Count > 0 ? _list.SelectedItems[0].Tag as DownloadEntry : null;

    public void RefreshList()
    {
        if (IsDisposed) return;
        var selectedPath = Selected()?.TargetPath;
        _list.BeginUpdate();
        _list.Items.Clear();
        foreach (var d in _downloads)
        {
            var item = new ListViewItem(d.FileName) { Tag = d };
            item.SubItems.Add(d.Percent + "%");
            item.SubItems.Add(d.SizeText);
            item.SubItems.Add(d.StateText);
            _list.Items.Add(item);
            if (d.TargetPath == selectedPath) item.Selected = true;
        }
        _list.EndUpdate();
        (Owner as MainForm)?.UpdateDownloadsButton();
    }
}

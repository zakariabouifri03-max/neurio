using System.Diagnostics;
using AdzakDownloadPro.Core;

namespace AdzakDownloadPro.WinForms;

internal sealed class MainForm : Form
{
    private readonly DownloadCoordinator _coordinator;
    private readonly TextBox _urlBox = new();
    private readonly TextBox _destinationBox = new();
    private readonly DataGridView _grid = new();
    private readonly Button _addButton;
    private readonly Button _pauseButton;
    private readonly Button _retryButton;
    private readonly Button _cancelButton;
    private readonly Button _openButton;
    private readonly Label _queueSummary = new();
    private readonly Dictionary<Guid, DataGridViewRow> _rows = new();
    private bool _closeApproved;
    private bool _startupPromptShown;

    public MainForm(DownloadCoordinator coordinator)
    {
        _coordinator = coordinator;
        Text = "Adzak Download Pro";
        MinimumSize = new Size(1000, 660);
        Size = new Size(1450, 860);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 19, 32);
        ForeColor = Color.FromArgb(236, 241, 250);
        Font = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
        AutoScaleMode = AutoScaleMode.Dpi;
        _addButton = MakeButton("Add download", Color.FromArgb(42, 157, 123));
        _addButton.Width = 140;

        var page = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            Padding = new Padding(20, 18, 20, 12),
            BackColor = BackColor
        };
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 185));
        page.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        Controls.Add(page);

        var header = BuildHeader();
        page.Controls.Add(header, 0, 0);

        ConfigureGrid();
        page.Controls.Add(_grid, 0, 1);

        var footer = new Panel { Dock = DockStyle.Fill, BackColor = BackColor, Padding = new Padding(0, 12, 0, 0) };
        _pauseButton = MakeButton("Pause", Color.FromArgb(39, 105, 179));
        _retryButton = MakeButton("Retry now", Color.FromArgb(44, 127, 100));
        _cancelButton = MakeButton("Cancel download", Color.FromArgb(145, 58, 67));
        _openButton = MakeButton("Open folder", Color.FromArgb(48, 59, 79));
        _queueSummary.AutoSize = true;
        _queueSummary.ForeColor = Color.FromArgb(162, 177, 199);
        _queueSummary.Anchor = AnchorStyles.Left | AnchorStyles.Top;
        _queueSummary.Location = new Point(0, 46);
        footer.Controls.Add(_queueSummary);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 38,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = BackColor
        };
        foreach (var button in new[] { _pauseButton, _retryButton, _cancelButton, _openButton })
        {
            button.Margin = new Padding(0, 0, 10, 0);
            actions.Controls.Add(button);
        }
        footer.Controls.Add(actions);
        page.Controls.Add(footer, 0, 2);

        _pauseButton.Click += async (_, _) => await TogglePauseResumeAsync();
        _retryButton.Click += async (_, _) => await RetrySelectedAsync();
        _cancelButton.Click += async (_, _) => await CancelSelectedAsync();
        _openButton.Click += (_, _) => OpenSelectedFolder();
        _addButton.Click += async (_, _) => await AddDownloadAsync();
        _grid.SelectionChanged += (_, _) => UpdateActionButtons();
        _grid.CellDoubleClick += (_, _) => OpenSelectedFolder();
        FormClosing += OnFormClosing;
        Shown += OnShown;

        _coordinator.JobChanged += OnJobChanged;
        foreach (var job in _coordinator.Snapshot)
            UpsertRow(job);
        UpdateSummary();
        UpdateActionButtons();
    }

    private Control BuildHeader()
    {
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = BackColor,
            ColumnCount = 1,
            RowCount = 4
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var title = new Label
        {
            Text = "ADZAK DOWNLOAD PRO",
            Font = new Font("Segoe UI Semibold", 22, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Dock = DockStyle.Fill,
            Margin = Padding.Empty
        };
        panel.Controls.Add(title, 0, 0);

        var subtitle = new Label
        {
            Text = "Persistent downloads that reconnect, validate HTTP ranges and continue automatically.",
            ForeColor = Color.FromArgb(157, 173, 198),
            AutoSize = true,
            Dock = DockStyle.Fill,
            Margin = Padding.Empty
        };
        panel.Controls.Add(subtitle, 0, 1);

        var inputs = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Margin = Padding.Empty,
            ColumnCount = 4,
            RowCount = 2,
            BackColor = BackColor
        };
        inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48));
        inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52));
        inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));
        inputs.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145));
        inputs.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        inputs.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        StyleTextBox(_urlBox);
        _urlBox.Dock = DockStyle.Fill;
        StyleTextBox(_destinationBox);
        _destinationBox.Dock = DockStyle.Fill;
        var urlLabel = MakeFieldLabel("Download URL");
        var destinationLabel = MakeFieldLabel("Save to");
        urlLabel.Dock = DockStyle.Fill;
        destinationLabel.Dock = DockStyle.Fill;
        inputs.Controls.Add(urlLabel, 0, 0);
        inputs.Controls.Add(destinationLabel, 1, 0);
        inputs.Controls.Add(_urlBox, 0, 1);
        inputs.Controls.Add(_destinationBox, 1, 1);

        var browse = MakeButton("Browse…", Color.FromArgb(48, 59, 79));
        browse.Dock = DockStyle.Fill;
        browse.Margin = new Padding(8, 0, 8, 0);
        browse.Click += (_, _) => BrowseForDestination();
        inputs.Controls.Add(browse, 2, 1);
        _addButton.Dock = DockStyle.Fill;
        _addButton.Margin = new Padding(0);
        inputs.Controls.Add(_addButton, 3, 1);
        panel.Controls.Add(inputs, 0, 2);

        var localNote = new Label
        {
            Text = "The queue is autosaved locally. Signed URLs and their query tokens are stored in your Windows user profile.",
            ForeColor = Color.FromArgb(127, 145, 171),
            AutoSize = true,
            Dock = DockStyle.Fill,
            Margin = Padding.Empty
        };
        panel.Controls.Add(localNote, 0, 3);
        return panel;
    }

    private void ConfigureGrid()
    {
        _grid.Dock = DockStyle.Fill;
        _grid.BackgroundColor = Color.FromArgb(17, 25, 41);
        _grid.BorderStyle = BorderStyle.FixedSingle;
        _grid.GridColor = Color.FromArgb(37, 48, 68);
        _grid.ForeColor = Color.FromArgb(231, 237, 248);
        _grid.EnableHeadersVisualStyles = false;
        _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(24, 34, 53);
        _grid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(185, 200, 222);
        _grid.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI Semibold", 9, FontStyle.Bold);
        _grid.ColumnHeadersHeight = 40;
        _grid.DefaultCellStyle.BackColor = Color.FromArgb(17, 25, 41);
        _grid.DefaultCellStyle.ForeColor = Color.FromArgb(229, 235, 245);
        _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(39, 69, 105);
        _grid.DefaultCellStyle.SelectionForeColor = Color.White;
        _grid.AlternatingRowsDefaultCellStyle.BackColor = Color.FromArgb(20, 29, 47);
        _grid.RowTemplate.Height = 38;
        _grid.AllowUserToAddRows = false;
        _grid.AllowUserToDeleteRows = false;
        _grid.AllowUserToResizeRows = false;
        _grid.MultiSelect = false;
        _grid.ReadOnly = true;
        _grid.RowHeadersVisible = false;
        _grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None;
        _grid.ScrollBars = ScrollBars.Both;

        AddTextColumn("file", "File", 170);
        AddTextColumn("destination", "Destination", 260);
        AddTextColumn("state", "Status", 300);
        AddTextColumn("progress", "Progress", 88);
        AddTextColumn("bytes", "Verified / total", 160);
        AddTextColumn("speed", "Speed", 115);
        AddTextColumn("retries", "Retries", 65);
        AddTextColumn("error", "Last error", 310, fill: true);
        AddTextColumn("retryAt", "Next retry", 150);
    }

    private void AddTextColumn(string name, string title, int width, bool fill = false)
    {
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = name,
            HeaderText = title,
            Width = width,
            MinimumWidth = Math.Min(width, 55),
            AutoSizeMode = fill ? DataGridViewAutoSizeColumnMode.Fill : DataGridViewAutoSizeColumnMode.None,
            SortMode = DataGridViewColumnSortMode.NotSortable,
            DefaultCellStyle = new DataGridViewCellStyle { Padding = new Padding(7, 0, 7, 0) }
        });
    }

    private void BrowseForDestination()
    {
        using var dialog = new SaveFileDialog
        {
            Title = "Choose a download destination",
            FileName = SuggestedFileName(_urlBox.Text),
            OverwritePrompt = false,
            AddExtension = false,
            RestoreDirectory = true
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
            _destinationBox.Text = dialog.FileName;
    }

    private async Task AddDownloadAsync()
    {
        var url = _urlBox.Text.Trim();
        var destination = _destinationBox.Text.Trim();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            MessageBox.Show(this, "Enter a valid HTTP or HTTPS URL.", "Invalid URL", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            _urlBox.Focus();
            return;
        }
        if (destination.Length == 0)
        {
            MessageBox.Show(this, "Choose where the file should be saved.", "Destination required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var overwrite = false;
        if (File.Exists(destination))
        {
            var answer = MessageBox.Show(this,
                "The destination already exists. Replace it only after the new download is fully verified?",
                "Confirm replacement", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes)
                return;
            overwrite = true;
        }

        _addButton.Enabled = false;
        try
        {
            await _coordinator.AddAsync(url, destination, overwrite);
            _urlBox.Clear();
            _destinationBox.Clear();
            _urlBox.Focus();
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "Could not add download", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _addButton.Enabled = true;
        }
    }

    private async Task TogglePauseResumeAsync()
    {
        if (SelectedJob() is not { } job)
            return;
        try
        {
            if (job.Status == DownloadStatus.Paused)
                await _coordinator.ResumeAsync(job.Id);
            else
                await _coordinator.PauseAsync(job.Id);
        }
        catch (Exception exception)
        {
            ShowActionError(exception);
        }
    }

    private async Task RetrySelectedAsync()
    {
        if (SelectedJob() is not { } job)
            return;
        try { await _coordinator.RetryNowAsync(job.Id); }
        catch (Exception exception) { ShowActionError(exception); }
    }

    private async Task CancelSelectedAsync()
    {
        if (SelectedJob() is not { } job)
            return;
        var answer = MessageBox.Show(this,
            "Cancel this job and remove its temporary segment files? The destination file will not be removed.",
            "Cancel download", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (answer != DialogResult.Yes)
            return;
        try { await _coordinator.CancelAsync(job.Id); }
        catch (Exception exception) { ShowActionError(exception); }
    }

    private void OpenSelectedFolder()
    {
        if (SelectedJob() is not { } job)
            return;
        var folder = Path.GetDirectoryName(job.DestinationPath);
        if (folder is null || !Directory.Exists(folder))
            return;

        try
        {
            if (File.Exists(job.DestinationPath))
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{job.DestinationPath}\"") { UseShellExecute = true });
            else
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
        }
        catch (Exception exception) { ShowActionError(exception); }
    }

    private void OnJobChanged(object? sender, DownloadProgressEventArgs e)
    {
        if (IsDisposed || Disposing)
            return;
        if (InvokeRequired)
        {
            try { BeginInvoke(new Action(() => UpsertRow(e.Job))); }
            catch (InvalidOperationException) { }
            return;
        }
        UpsertRow(e.Job);
    }

    private void UpsertRow(DownloadJobRecord job)
    {
        if (IsDisposed)
            return;
        if (!_rows.TryGetValue(job.Id, out var row) || row.DataGridView is null)
        {
            var index = _grid.Rows.Add();
            row = _grid.Rows[index];
            row.Tag = job.Id;
            _rows[job.Id] = row;
        }

        row.Cells["file"].Value = Path.GetFileName(job.DestinationPath);
        row.Cells["destination"].Value = job.DestinationPath;
        row.Cells["state"].Value = job.StatusText;
        row.Cells["progress"].Value = job.TotalBytes is 0 ? "100%" : $"{job.ProgressPercent:0.0}%";
        row.Cells["bytes"].Value = job.TotalBytes is { } total
            ? $"{FormatBytes(job.VerifiedBytes)} / {FormatBytes(total)}"
            : $"{FormatBytes(job.VerifiedBytes)} / unknown";
        row.Cells["speed"].Value = job.Status == DownloadStatus.Downloading || job.Status == DownloadStatus.ResumingDownload
            ? FormatBytes(job.CurrentSpeedBytesPerSecond) + "/s"
            : "—";
        row.Cells["retries"].Value = job.RetryCount.ToString();
        row.Cells["error"].Value = job.LastError ?? "—";
        row.Cells["error"].ToolTipText = job.LastError ?? "";
        row.Cells["retryAt"].Value = job.NextRetryAtUtc is { } at
            ? at.ToLocalTime().ToString("HH:mm:ss")
            : "—";
        row.DefaultCellStyle.ForeColor = job.Status switch
        {
            DownloadStatus.Completed => Color.FromArgb(119, 222, 172),
            DownloadStatus.Failed => Color.FromArgb(255, 145, 145),
            DownloadStatus.InternetDisconnected => Color.FromArgb(255, 195, 116),
            _ => Color.FromArgb(229, 235, 245)
        };
        row.Cells["state"].ToolTipText = job.StatusText;
        UpdateSummary();
        UpdateActionButtons();
    }

    private void UpdateSummary()
    {
        var jobs = _coordinator.Snapshot;
        var active = jobs.Count(job => job.Status is DownloadStatus.Downloading or DownloadStatus.ResumingDownload);
        var waiting = jobs.Count(job => job.Status is DownloadStatus.InternetDisconnected or DownloadStatus.WaitingForInternet or DownloadStatus.Reconnecting);
        var done = jobs.Count(job => job.Status == DownloadStatus.Completed);
        _queueSummary.Text = $"{jobs.Count} jobs     {active} active     {waiting} waiting for network     {done} completed";
    }

    private void UpdateActionButtons()
    {
        var job = SelectedJob();
        var exists = job is not null;
        _pauseButton.Enabled = exists && job!.Status is not (DownloadStatus.Completed or DownloadStatus.Failed or DownloadStatus.Cancelled);
        _pauseButton.Text = job?.Status == DownloadStatus.Paused ? "Resume" : "Pause";
        _retryButton.Enabled = exists && job!.Status is not (DownloadStatus.Completed or DownloadStatus.Cancelled);
        _cancelButton.Enabled = exists && job!.Status is not (DownloadStatus.Completed or DownloadStatus.Cancelled);
        _openButton.Enabled = exists;
    }

    private DownloadJobRecord? SelectedJob()
    {
        if (_grid.SelectedRows.Count == 0 || _grid.SelectedRows[0].Tag is not Guid id)
            return null;
        return _coordinator.Snapshot.FirstOrDefault(job => job.Id == id);
    }

    private async void OnShown(object? sender, EventArgs e)
    {
        if (_startupPromptShown)
            return;
        _startupPromptShown = true;
        var pending = _coordinator.Snapshot
            .Where(job => job.Status is not (DownloadStatus.Completed or DownloadStatus.Cancelled))
            .ToArray();
        if (pending.Length == 0)
            return;

        var answer = MessageBox.Show(this,
            $"{pending.Length} download(s) were saved from the previous session. Resume them automatically now?\r\n\r\nSaved URLs may contain signed access tokens.",
            "Resume saved downloads", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer == DialogResult.Yes)
        {
            try { await _coordinator.ResumePendingAsync(pending.Select(job => job.Id)); }
            catch (Exception exception) { ShowActionError(exception); }
        }
    }

    private async void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_closeApproved)
            return;
        e.Cancel = true;
        Enabled = false;
        Text = "Adzak Download Pro — saving queue…";
        try { await _coordinator.StopAsync(); }
        catch (Exception exception) { Debug.WriteLine(exception); }
        _closeApproved = true;
        Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            _coordinator.JobChanged -= OnJobChanged;
        base.Dispose(disposing);
    }

    private static string SuggestedFileName(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            var name = Path.GetFileName(Uri.UnescapeDataString(uri.AbsolutePath));
            if (!string.IsNullOrWhiteSpace(name))
                return name;
        }
        return "download.bin";
    }

    private static Label MakeFieldLabel(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = Color.FromArgb(194, 207, 226),
        Font = new Font("Segoe UI Semibold", 9, FontStyle.Bold)
    };

    private static Button MakeButton(string text, Color background) => new()
    {
        Text = text,
        Height = 36,
        AutoSize = false,
        FlatStyle = FlatStyle.Flat,
        BackColor = background,
        ForeColor = Color.White,
        Font = new Font("Segoe UI Semibold", 9, FontStyle.Bold),
        Cursor = Cursors.Hand,
        FlatAppearance = { BorderSize = 0, MouseOverBackColor = ControlPaint.Light(background, 0.12f) }
    };

    private static void StyleTextBox(TextBox textBox)
    {
        textBox.BorderStyle = BorderStyle.FixedSingle;
        textBox.BackColor = Color.FromArgb(22, 31, 49);
        textBox.ForeColor = Color.FromArgb(238, 243, 251);
        textBox.Font = new Font("Segoe UI", 10);
        textBox.Margin = new Padding(0);
    }

    private static string FormatBytes(long value)
    {
        if (value < 0) value = 0;
        string[] units = ["B", "KiB", "MiB", "GiB", "TiB"];
        double scaled = value;
        var unit = 0;
        while (scaled >= 1024d && unit < units.Length - 1)
        {
            scaled /= 1024d;
            unit++;
        }
        return unit == 0 ? $"{(long)scaled} {units[unit]}" : $"{scaled:0.##} {units[unit]}";
    }

    private void ShowActionError(Exception exception) =>
        MessageBox.Show(this, exception.Message, "Action failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
}

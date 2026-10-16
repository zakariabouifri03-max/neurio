using System.Text.Json;

namespace AdzakLiteBrowser;

/// <summary>History viewer: search, reopen, delete entries, clear all.</summary>
public sealed class HistoryForm : Form
{
    private readonly MainForm _main;
    private readonly ListView _list = new();
    private readonly TextBox _search = new();
    private List<HistoryItem> _items = new();

    public HistoryForm(MainForm main)
    {
        _main = main;
        Text = "History — ADZAK Lite Browser";
        Width = 720;
        Height = 440;

        _search.Dock = DockStyle.Top;
        _search.PlaceholderText = "Search history…";
        _search.TextChanged += (_, _) => Render();

        _list.Dock = DockStyle.Fill;
        _list.View = View.Details;
        _list.FullRowSelect = true;
        _list.MultiSelect = true;
        _list.Columns.Add("Title", 240);
        _list.Columns.Add("Address", 320);
        _list.Columns.Add("Visited", 130);
        _list.DoubleClick += (_, _) => OpenSelected();

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42, Padding = new Padding(6) };
        var open = new Button { Text = "Open", Width = 80 };
        open.Click += (_, _) => OpenSelected();
        var delete = new Button { Text = "Delete", Width = 80 };
        delete.Click += (_, _) =>
        {
            var doomed = _list.SelectedItems.Cast<ListViewItem>().Select(i => (HistoryItem)i.Tag).ToList();
            _main.DeleteHistoryItems(doomed);
            _items = _main.HistorySnapshot();
            Render();
        };
        var clear = new Button { Text = "Clear all history", Width = 140 };
        clear.Click += (_, _) =>
        {
            if (MessageBox.Show(this, "Delete all browsing history?", "History",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            {
                _main.ClearHistory();
                _items = _main.HistorySnapshot();
                Render();
            }
        };
        buttons.Controls.AddRange(new Control[] { open, delete, clear });

        Controls.Add(_list);
        Controls.Add(buttons);
        Controls.Add(_search);
        _items = _main.HistorySnapshot();
        Render();
    }

    private void Render()
    {
        var q = _search.Text.Trim();
        _list.BeginUpdate();
        _list.Items.Clear();
        foreach (var h in _items.Where(h => q.Length == 0 ||
                     h.Title.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                     h.Url.Contains(q, StringComparison.OrdinalIgnoreCase)))
        {
            var item = new ListViewItem(string.IsNullOrWhiteSpace(h.Title) ? h.Url : h.Title) { Tag = h };
            item.SubItems.Add(h.Url);
            item.SubItems.Add(h.VisitedUtc.ToLocalTime().ToString("g"));
            _list.Items.Add(item);
        }
        _list.EndUpdate();
    }

    private async void OpenSelected()
    {
        if (_list.SelectedItems.Count == 0) return;
        var item = (HistoryItem)_list.SelectedItems[0].Tag;
        Close();
        await _main.CreateTabAsync(item.Url);
    }
}

/// <summary>Bookmark manager: open, delete, add the current page.</summary>
public sealed class BookmarksForm : Form
{
    private readonly MainForm _main;
    private readonly ListView _list = new();
    private List<BookmarkItem> _items = new();

    public BookmarksForm(MainForm main)
    {
        _main = main;
        Text = "Bookmarks — ADZAK Lite Browser";
        Width = 680;
        Height = 420;
        _list.Dock = DockStyle.Fill;
        _list.View = View.Details;
        _list.FullRowSelect = true;
        _list.MultiSelect = true;
        _list.Columns.Add("Title", 260);
        _list.Columns.Add("Address", 380);
        _list.DoubleClick += (_, _) => OpenSelected();

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42, Padding = new Padding(6) };
        var open = new Button { Text = "Open", Width = 80 };
        open.Click += (_, _) => OpenSelected();
        var add = new Button { Text = "Add current page", Width = 140 };
        add.Click += (_, _) =>
        {
            if (_main.ActiveTab is { } tab && !string.IsNullOrWhiteSpace(tab.CurrentUrl) &&
                !_items.Any(b => b.Url == tab.CurrentUrl))
            {
                _items.Insert(0, new BookmarkItem { Title = tab.Title, Url = tab.CurrentUrl, AddedUtc = DateTime.UtcNow });
                Commit();
                Render();
            }
        };
        var delete = new Button { Text = "Delete", Width = 80 };
        delete.Click += (_, _) =>
        {
            foreach (ListViewItem i in _list.SelectedItems) _items.Remove((BookmarkItem)i.Tag);
            Commit();
            Render();
        };
        buttons.Controls.AddRange(new Control[] { open, add, delete });

        Controls.Add(_list);
        Controls.Add(buttons);
        _items = _main.BookmarksSnapshot();
        Render();
    }

    private void Commit() => _main.SetBookmarks(_items.ToList());

    private void Render()
    {
        _list.BeginUpdate();
        _list.Items.Clear();
        foreach (var b in _items)
        {
            var item = new ListViewItem(string.IsNullOrWhiteSpace(b.Title) ? b.Url : b.Title) { Tag = b };
            item.SubItems.Add(b.Url);
            _list.Items.Add(item);
        }
        _list.EndUpdate();
    }

    private async void OpenSelected()
    {
        if (_list.SelectedItems.Count == 0) return;
        var item = (BookmarkItem)_list.SelectedItems[0].Tag;
        Close();
        await _main.CreateTabAsync(item.Url);
    }
}

/// <summary>Settings editor. Edits a clone; the real settings only change on OK.</summary>
public sealed class SettingsForm : Form
{
    private readonly MainForm _main;
    private readonly AppSettings _working;
    private readonly TextBox _homePage = new(), _downloadFolder = new();
    private readonly ComboBox _searchEngine = new();
    private readonly CheckBox _askSave = new(), _dataSaver = new(), _blockAds = new(),
        _blockImages = new(), _autoplay = new(), _hardwareAccel = new(), _devTools = new();
    private readonly NumericUpDown _suspendMinutes = new(), _cacheMB = new();
    private readonly Label _cacheSize = new(), _stats = new();

    public SettingsForm(MainForm main, AppSettings settings)
    {
        _main = main;
        _working = JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(settings)) ?? new AppSettings();

        Text = "Settings — ADZAK Lite Browser";
        Width = 560;
        Height = 620;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;

        var y = 14;
        Label AddLabel(string text)
        {
            var l = new Label { Text = text, Location = new Point(16, y), AutoSize = true };
            Controls.Add(l);
            y += 22;
            return l;
        }

        AddLabel("Home page (blank = ADZAK start page):");
        _homePage.SetBounds(16, y, 510, 24);
        _homePage.Text = _working.HomePage;
        Controls.Add(_homePage);
        y += 34;

        AddLabel("Search engine:");
        _searchEngine.SetBounds(16, y, 240, 24);
        _searchEngine.DropDownStyle = ComboBoxStyle.DropDownList;
        _searchEngine.Items.AddRange(new object[] { "duckduckgo", "google", "bing" });
        _searchEngine.SelectedItem = _working.SearchEngine;
        Controls.Add(_searchEngine);
        y += 36;

        AddLabel("Downloads folder (blank = your Downloads folder):");
        _downloadFolder.SetBounds(16, y, 420, 24);
        _downloadFolder.Text = _working.DownloadFolder;
        Controls.Add(_downloadFolder);
        var browse = new Button { Text = "Browse…", Location = new Point(444, y), Size = new Size(82, 24) };
        browse.Click += (_, _) =>
        {
            using var dlg = new FolderBrowserDialog();
            if (dlg.ShowDialog(this) == DialogResult.OK) _downloadFolder.Text = dlg.SelectedPath;
        };
        Controls.Add(browse);
        y += 32;

        void AddCheck(CheckBox box, string text, bool value)
        {
            box.Text = text;
            box.Checked = value;
            box.Location = new Point(16, y);
            box.AutoSize = true;
            Controls.Add(box);
            y += 26;
        }
        AddCheck(_askSave, "Ask where to save each download", _working.AskWhereToSave);
        AddLabel("Data saver:");
        AddCheck(_dataSaver, "Enable Data Saver", _working.DataSaverEnabled);
        AddCheck(_blockAds, "Block ads && trackers (curated list)", _working.BlockAdsTrackers);
        AddCheck(_blockImages, "Block images (biggest data saving; some pages look bare)", _working.BlockImages);
        AddCheck(_autoplay, "Prevent media autoplay", _working.PreventAutoplay);
        AddLabel("Performance (for 8 GB RAM PCs):");
        AddCheck(_hardwareAccel, "Hardware acceleration (GPU rendering) — recommended ON; restart applies", _working.HardwareAcceleration);
        AddCheck(_devTools, "Enable developer tools (F12)", _working.DevToolsEnabled);

        AddLabel("Suspend inactive tabs after (minutes, 0 = never):");
        _suspendMinutes.SetBounds(16, y, 90, 24);
        _suspendMinutes.Minimum = 0;
        _suspendMinutes.Maximum = 240;
        _suspendMinutes.Value = Math.Clamp(_working.AutoSuspendMinutes, 0, 240);
        Controls.Add(_suspendMinutes);
        y += 34;

        AddLabel("Disk cache cap (MB, 0 = Chromium default):");
        _cacheMB.SetBounds(16, y, 90, 24);
        _cacheMB.Minimum = 0;
        _cacheMB.Maximum = 4000;
        _cacheMB.Value = Math.Clamp(_working.DiskCacheCapMB, 0, 4000);
        Controls.Add(_cacheMB);
        y += 34;

        _cacheSize.Location = new Point(16, y);
        _cacheSize.AutoSize = true;
        Controls.Add(_cacheSize);
        y += 22;
        _stats.Location = new Point(16, y);
        _stats.AutoSize = true;
        _stats.Text = $"Data Saver so far: {settings.TotalBlockedRequests} ad/tracker requests and {settings.TotalImagesBlocked} images blocked (requests counted, not invented bytes).";
        Controls.Add(_stats);
        y += 30;

        var gpu = new Button { Text = "GPU status…", Location = new Point(16, y), Size = new Size(130, 28) };
        gpu.Click += async (_, _) => await _main.ShowGpuStatusAsync();
        Controls.Add(gpu);
        var clear = new Button { Text = "Clear browsing data…", Location = new Point(156, y), Size = new Size(170, 28) };
        clear.Click += async (_, _) => await _main.ClearBrowsingDataAsync();
        Controls.Add(clear);
        y += 40;

        var ok = new Button { Text = "Save", Location = new Point(336, y), Size = new Size(90, 30), DialogResult = DialogResult.OK };
        ok.Click += (_, _) => ApplyTo(settings);
        var cancel = new Button { Text = "Cancel", Location = new Point(436, y), Size = new Size(90, 30), DialogResult = DialogResult.Cancel };
        Controls.Add(ok);
        Controls.Add(cancel);
        AcceptButton = ok;
        CancelButton = cancel;

        _ = UpdateCacheSizeAsync();
    }

    private async Task UpdateCacheSizeAsync()
    {
        try
        {
            var size = await Task.Run(() =>
            {
                long total = 0;
                var dir = new DirectoryInfo(DataStore.UserDataFolder);
                if (dir.Exists)
                    foreach (var f in dir.EnumerateFiles("*", SearchOption.AllDirectories))
                    {
                        try { total += f.Length; } catch { }
                    }
                return total;
            });
            if (!IsDisposed) _cacheSize.Text = $"Browser profile/cache on disk: {DownloadEntry.FormatBytes(size)}";
        }
        catch { }
    }

    private void ApplyTo(AppSettings target)
    {
        _working.HomePage = _homePage.Text.Trim();
        _working.SearchEngine = _searchEngine.SelectedItem?.ToString() ?? "duckduckgo";
        _working.DownloadFolder = _downloadFolder.Text.Trim();
        _working.AskWhereToSave = _askSave.Checked;
        _working.DataSaverEnabled = _dataSaver.Checked;
        _working.BlockAdsTrackers = _blockAds.Checked;
        _working.BlockImages = _blockImages.Checked;
        _working.PreventAutoplay = _autoplay.Checked;
        _working.HardwareAcceleration = _hardwareAccel.Checked;
        _working.DevToolsEnabled = _devTools.Checked;
        _working.AutoSuspendMinutes = (int)_suspendMinutes.Value;
        _working.DiskCacheCapMB = (int)_cacheMB.Value;

        target.HomePage = _working.HomePage;
        target.SearchEngine = _working.SearchEngine;
        target.DownloadFolder = _working.DownloadFolder;
        target.AskWhereToSave = _working.AskWhereToSave;
        target.DataSaverEnabled = _working.DataSaverEnabled;
        target.BlockAdsTrackers = _working.BlockAdsTrackers;
        target.BlockImages = _working.BlockImages;
        target.PreventAutoplay = _working.PreventAutoplay;
        target.HardwareAcceleration = _working.HardwareAcceleration;
        target.DevToolsEnabled = _working.DevToolsEnabled;
        target.AutoSuspendMinutes = _working.AutoSuspendMinutes;
        target.DiskCacheCapMB = _working.DiskCacheCapMB;
    }
}

public static class AboutDialog
{
    public static void Show(IWin32Window owner)
    {
        MessageBox.Show(owner,
            "ADZAK Lite Browser 1.0\n" +
            "Chromium engine: Microsoft Edge WebView2 (evergreen runtime)\n\n" +
            "A light browser for 8 GB RAM PCs: one shared engine process, tab suspension,\n" +
            "a capped cache, Data Saver ad/tracker blocking, optional image blocking,\n" +
            "autoplay prevention, bookmarks, history and a downloads manager.\n\n" +
            "Honest promises only: this app cannot boost your Wi-Fi signal, cannot make\n" +
            "your connection faster than your ISP plan, and does not add RAM. It simply\n" +
            "downloads less junk and uses the RAM you have more carefully.\n\n" +
            "Your data stays on this PC (%AppData%\\ADZAK Lite Browser). No telemetry.",
            "About ADZAK Lite Browser", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}

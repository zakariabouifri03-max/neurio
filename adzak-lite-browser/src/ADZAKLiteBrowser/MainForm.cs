using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace AdzakLiteBrowser;

/// <summary>
/// ADZAK Lite Browser main window.
///
/// Memory strategy for 8 GB PCs (honest, measurable — no magic "boosters"):
///   1. ONE shared CoreWebView2Environment/browser process for all tabs.
///   2. Inactive tabs are suspended (CoreWebView2.SuspendAsync) after a
///      configurable idle time, and can be suspended on demand.
///   3. Disk cache is capped; the start page is local; no background services,
///      no telemetry, no updater processes.
/// GPU: Chromium/WebView2 hardware acceleration is left ON by default
/// (we never pass --disable-gpu unless the user disables it in Settings).
/// </summary>
public sealed class MainForm : Form
{
    public AppSettings Settings { get; }
    private readonly List<BookmarkItem> _bookmarks;
    private readonly List<HistoryItem> _history;
    private readonly List<DownloadEntry> _downloads = new();

    private Task<CoreWebView2Environment>? _envTask;
    private CoreWebView2Environment? _env;

    private readonly TabControl _tabs = new();
    private readonly ImageList _tabImages = new() { ImageSize = new Size(16, 16), ColorDepth = ColorDepth.Depth32Bit };
    private readonly ToolStrip _toolbar = new();
    private readonly ToolStripTextBox _address = new();
    private readonly ToolStripButton _backBtn, _fwdBtn, _reloadBtn, _starBtn, _shieldBtn, _downloadsBtn;
    private readonly ToolStrip _bookmarksBar = new();
    private readonly Panel _findPanel = new();
    private readonly TextBox _findBox = new();
    private readonly StatusStrip _status = new();
    private readonly ToolStripStatusLabel _statusMain = new(), _statusMem = new(), _statusBlock = new();
    private readonly System.Windows.Forms.Timer _statusTimer = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer _suspendTimer = new() { Interval = 30000 };

    private long _sessionBlocked;
    private long _sessionImagesBlocked;
    private bool _statsDirty;
    private DateTime _lastStatusBlockUpdate = DateTime.MinValue;
    private DownloadsForm? _downloadsForm;
    private FormWindowState _preFullscreenState;
    private FormBorderStyle _preFullscreenBorder;

    public MainForm()
    {
        Settings = DataStore.Load<AppSettings>("settings.json");
        _bookmarks = DataStore.Load<List<BookmarkItem>>("bookmarks.json");
        _history = DataStore.Load<List<HistoryItem>>("history.json");

        Text = "ADZAK Lite Browser";
        Width = 1180;
        Height = 760;
        MinimumSize = new Size(720, 480);
        KeyPreview = true;

        // ---------- toolbar ----------
        _backBtn = new ToolStripButton("←") { ToolTipText = "Back", AutoSize = false, Size = new Size(34, 28) };
        _fwdBtn = new ToolStripButton("→") { ToolTipText = "Forward", AutoSize = false, Size = new Size(34, 28) };
        _reloadBtn = new ToolStripButton("⟳") { ToolTipText = "Reload (F5)", AutoSize = false, Size = new Size(34, 28) };
        var homeBtn = new ToolStripButton("⌂") { ToolTipText = "Home", AutoSize = false, Size = new Size(34, 28) };
        _address.ToolTipText = "Search or enter an address";
        _address.BorderStyle = BorderStyle.FixedSingle;
        _starBtn = new ToolStripButton("☆") { ToolTipText = "Bookmark this page", AutoSize = false, Size = new Size(34, 28) };
        _shieldBtn = new ToolStripButton("🛡") { ToolTipText = "Data Saver (ad/tracker blocking)", AutoSize = false, Size = new Size(40, 28), CheckOnClick = true, Checked = Settings.DataSaverEnabled };
        _downloadsBtn = new ToolStripButton("⬇") { ToolTipText = "Downloads", AutoSize = false, Size = new Size(34, 28) };
        var newTabBtn = new ToolStripButton("＋") { ToolTipText = "New tab (Ctrl+T)", AutoSize = false, Size = new Size(34, 28) };
        var menuBtn = new ToolStripDropDownButton("☰") { ToolTipText = "Menu", AutoSize = false, Size = new Size(40, 28), ShowDropDownArrow = false };
        menuBtn.DropDownItems.AddRange(BuildMenu(menuBtn));

        _backBtn.Click += (_, _) => ActiveTab?.Core?.GoBack();
        _fwdBtn.Click += (_, _) => ActiveTab?.Core?.GoForward();
        _reloadBtn.Click += (_, _) => ActiveTab?.Core?.Reload();
        homeBtn.Click += (_, _) => GoHome(ActiveTab);
        newTabBtn.Click += async (_, _) => await CreateTabAsync(null);
        _starBtn.Click += (_, _) => ToggleBookmarkForActive();
        _shieldBtn.Click += (_, _) => { Settings.DataSaverEnabled = _shieldBtn.Checked; SaveSettings(); SetStatus(_shieldBtn.Checked ? "Data Saver ON — ads/trackers blocked" : "Data Saver OFF"); };
        _downloadsBtn.Click += (_, _) => ShowDownloads();
        _address.KeyDown += Address_KeyDown;

        _toolbar.Items.AddRange(new ToolStripItem[]
        {
            _backBtn, _fwdBtn, _reloadBtn, homeBtn, new ToolStripSeparator(),
            _address, _starBtn, _shieldBtn, _downloadsBtn, newTabBtn, menuBtn
        });
        _toolbar.GripStyle = ToolStripGripStyle.Hidden;
        _toolbar.RenderMode = ToolStripRenderMode.System;

        // ---------- bookmarks bar / find panel / tabs / status ----------
        _bookmarksBar.GripStyle = ToolStripGripStyle.Hidden;
        _bookmarksBar.RenderMode = ToolStripRenderMode.System;

        BuildFindPanel();

        _tabs.Dock = DockStyle.Fill;
        _tabs.ImageList = _tabImages;
        _tabs.DrawMode = TabDrawMode.OwnerDrawFixed;
        _tabs.SizeMode = TabSizeMode.Fixed;
        _tabs.ItemSize = new Size(200, 26);
        _tabs.Padding = new Point(14, 3);
        _tabs.DrawItem += Tabs_DrawItem;
        _tabs.MouseDown += Tabs_MouseDown;
        _tabs.SelectedIndexChanged += Tabs_SelectedIndexChanged;

        _status.Items.AddRange(new ToolStripItem[] { _statusMain, _statusMem, _statusBlock });
        _statusMain.Spring = true;
        _statusMain.TextAlign = ContentAlignment.MiddleLeft;
        SetStatus("Ready");

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(_toolbar, 0, 0);
        layout.Controls.Add(_bookmarksBar, 0, 1);
        layout.Controls.Add(_findPanel, 0, 2);
        layout.Controls.Add(_tabs, 0, 3);
        layout.Controls.Add(_status, 0, 4);
        Controls.Add(layout);

        _statusTimer.Tick += StatusTimer_Tick;
        _suspendTimer.Tick += SuspendTimer_Tick;
        SizeChanged += (_, _) => FitAddressBar();
        FitAddressBar();

        RebuildBookmarksBar();
        Shown += MainForm_Shown;
        FormClosing += MainForm_FormClosing;
        KeyDown += MainForm_KeyDown;
    }

    /// <summary>Stretch the address bar across the free toolbar width
    /// (spring-textbox effect, sized manually on window resize).</summary>
    private void FitAddressBar()
    {
        try { _address.Size = new Size(Math.Max(200, _toolbar.Width - 400), 24); }
        catch { }
    }

    // ============================================================ lifecycle

    private async void MainForm_Shown(object? sender, EventArgs e)
    {
        _statusTimer.Start();
        _suspendTimer.Start();
        await CreateTabAsync(null);
    }

    private void MainForm_FormClosing(object? sender, FormClosingEventArgs e)
    {
        SaveSettings();
        DataStore.Save("bookmarks.json", _bookmarks);
        DataStore.Save("history.json", _history.Take(1000).ToList());
        foreach (TabPage page in _tabs.TabPages)
            (page.Tag as BrowserTab)?.Dispose();
    }

    internal void SaveSettings()
    {
        Settings.TotalBlockedRequests += 0; // totals updated in memory; persisted here
        DataStore.Save("settings.json", Settings);
        _statsDirty = false;
    }

    // ============================================================ environment

    /// <summary>
    /// The single shared Chromium environment. Browser arguments are chosen
    /// for compatibility + memory honesty:
    ///  • autoplay policy (Data Saver), disk-cache cap,
    ///  • --disable-gpu ONLY if the user disabled hardware acceleration.
    /// We deliberately do NOT use --process-per-site / renderer limits:
    /// weakening site isolation to save RAM would be a security regression.
    /// </summary>
    private Task<CoreWebView2Environment> GetEnvironmentAsync()
    {
        if (_envTask is not null) return _envTask;
        _envTask = CreateEnvironmentAsync();
        return _envTask;
    }

    private async Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        Directory.CreateDirectory(DataStore.UserDataFolder);
        var args = new List<string>();
        if (Settings.PreventAutoplay)
            args.Add("--autoplay-policy=document-user-activation-required");
        if (Settings.DiskCacheCapMB > 0)
            args.Add($"--disk-cache-size={Settings.DiskCacheCapMB * 1024L * 1024L}");
        if (!Settings.HardwareAcceleration)
            args.Add("--disable-gpu"); // explicit user choice; default keeps GPU ON
        var options = new CoreWebView2EnvironmentOptions
        {
            AdditionalBrowserArguments = string.Join(" ", args),
            Language = System.Globalization.CultureInfo.CurrentUICulture.Name
        };
        _env = await CoreWebView2Environment.CreateAsync(null, DataStore.UserDataFolder, options);
        return _env;
    }

    // ============================================================ tabs

    public BrowserTab? ActiveTab =>
        _tabs.SelectedTab?.Tag as BrowserTab;

    public async Task<BrowserTab> CreateTabAsync(string? url, bool activate = true)
    {
        var tab = new BrowserTab(this);
        _tabs.TabPages.Add(tab.Page);
        if (activate) _tabs.SelectedTab = tab.Page;
        var env = await GetEnvironmentAsync();
        await tab.InitializeAsync(env);
        await tab.Ready;
        if (tab.Core is not null)
        {
            if (string.IsNullOrEmpty(url)) GoHome(tab);
            else tab.Navigate(url);
        }
        return tab;
    }

    private void CloseTab(BrowserTab tab)
    {
        if (_tabs.TabPages.Count <= 1)
        {
            GoHome(tab); // never leave the window with zero tabs
            return;
        }
        _tabs.TabPages.Remove(tab.Page);
        tab.Dispose();
    }

    private async void Tabs_SelectedIndexChanged(object? sender, EventArgs e)
    {
        var tab = ActiveTab;
        if (tab is null) return;
        tab.LastActiveUtc = DateTime.UtcNow;
        tab.ResumeIfSuspended();
        await tab.ApplyAutoplayScriptAsync();
        SyncChromeToTab(tab);
    }

    private void SyncChromeToTab(BrowserTab tab)
    {
        if (!_address.Focused) _address.Text = tab.CurrentUrl == "about:blank" ? "" : tab.CurrentUrl;
        _backBtn.Enabled = tab.Core?.CanGoBack == true;
        _fwdBtn.Enabled = tab.Core?.CanGoForward == true;
        Text = string.IsNullOrWhiteSpace(tab.Title) ? "ADZAK Lite Browser" : $"{tab.Title} — ADZAK Lite Browser";
        UpdateStar(tab);
    }

    internal void RefreshTabText(BrowserTab tab)
    {
        if (tab.Page.IsDisposed) return;
        var title = string.IsNullOrWhiteSpace(tab.Title) ? "New Tab" : tab.Title;
        if (title.Length > 42) title = title[..42] + "…";
        tab.Page.Text = (tab.IsSuspended ? "💤 " : tab.IsLoading ? "⏳ " : "") + title;
        tab.Page.ToolTipText = tab.CurrentUrl;
    }

    private void Tabs_DrawItem(object? sender, DrawItemEventArgs e)
    {
        if (e.Index < 0 || e.Index >= _tabs.TabPages.Count) return;
        var page = _tabs.TabPages[e.Index];
        var tab = page.Tag as BrowserTab;
        e.Graphics.FillRectangle(e.State.HasFlag(DrawItemState.Selected) ? SystemBrushes.Window : SystemBrushes.Control, e.Bounds);
        var textRect = e.Bounds;
        var x = e.Bounds.X + 6;
        if (tab is { FaviconIndex: >= 0 } && tab.FaviconIndex < _tabImages.Images.Count)
        {
            _tabImages.Draw(e.Graphics, x, e.Bounds.Y + 5, tab.FaviconIndex);
            x += 20;
        }
        TextRenderer.DrawText(e.Graphics, page.Text, Font,
            new Rectangle(x, e.Bounds.Y, e.Bounds.Width - (x - e.Bounds.X) - 20, e.Bounds.Height),
            SystemColors.ControlText, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        // close glyph
        TextRenderer.DrawText(e.Graphics, "✕", Font,
            new Rectangle(e.Bounds.Right - 20, e.Bounds.Y, 18, e.Bounds.Height),
            SystemColors.ControlText, TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter);
    }

    private void Tabs_MouseDown(object? sender, MouseEventArgs e)
    {
        for (var i = 0; i < _tabs.TabPages.Count; i++)
        {
            var rect = _tabs.GetTabRect(i);
            var closeRect = new Rectangle(rect.Right - 20, rect.Y, 20, rect.Height);
            if (closeRect.Contains(e.Location) || e.Button == MouseButtons.Middle && rect.Contains(e.Location))
            {
                if (_tabs.TabPages[i].Tag is BrowserTab tab) CloseTab(tab);
                return;
            }
        }
    }

    internal void OnTabInitFailed(BrowserTab tab, Exception ex)
    {
        tab.Page.Text = "⚠ Error";
        SetStatus("WebView2 failed to start: " + ex.Message);
        MessageBox.Show(this,
            "The Microsoft Edge WebView2 Runtime could not be started.\n\n" +
            ex.Message + "\n\nInstall or repair the free WebView2 Runtime from:\n" +
            "https://developer.microsoft.com/microsoft-edge/webview2/",
            "ADZAK Lite Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    // ============================================================ core events

    internal void WireCoreEvents(BrowserTab tab)
    {
        var core = tab.Core!;
        core.NavigationStarting += (_, e) => Core_NavigationStarting(tab, e);
        core.SourceChanged += (_, _) =>
        {
            tab.CurrentUrl = core.Source;
            if (tab == ActiveTab) SyncChromeToTab(tab);
            RefreshTabText(tab);
        };
        core.HistoryChanged += (_, _) => { if (tab == ActiveTab) SyncChromeToTab(tab); };
        core.DocumentTitleChanged += (_, _) =>
        {
            tab.Title = string.IsNullOrWhiteSpace(core.DocumentTitle) ? HostOf(tab.CurrentUrl) : core.DocumentTitle;
            RefreshTabText(tab);
            if (tab == ActiveTab) SyncChromeToTab(tab);
        };
        core.NavigationCompleted += (_, e) => Core_NavigationCompleted(tab, e);
        core.WebResourceRequested += (_, e) => Core_WebResourceRequested(tab, e);
        core.DownloadStarting += (_, e) => HandleDownload(tab, e);
        core.NewWindowRequested += (_, e) => Core_NewWindowRequested(e);
        core.PermissionRequested += (_, e) => Core_PermissionRequested(e);
        core.ServerCertificateErrorDetected += (_, e) =>
        {
            // Never silently accept bad certificates.
            e.Action = CoreWebView2ServerCertificateErrorAction.Cancel;
            SetStatus($"Blocked a page with a certificate problem ({e.ErrorStatus}): {e.RequestUri}");
        };
        core.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)
                SetStatus("A tab process stopped and was restored. Reload the page if it looks blank.");
            else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
                MessageBox.Show(this, "The browser engine stopped unexpectedly. Please restart ADZAK Lite Browser.",
                    "ADZAK Lite Browser", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        };
        core.FaviconChanged += async (_, _) => await UpdateFaviconAsync(tab);
        core.WebMessageReceived += (_, e) => Core_WebMessageReceived(e);
        core.ContainsFullScreenElementChanged += (_, _) => ToggleFullscreen(core.ContainsFullScreenElement);
    }

    private void Core_NavigationStarting(BrowserTab tab, CoreWebView2NavigationStartingEventArgs e)
    {
        // Security/compat: web pages may only navigate the top frame to web schemes.
        if (!IsWebUrl(e.Uri))
        {
            e.Cancel = true;
            SetStatus("Blocked navigation to a non-web address: " + e.Uri);
            return;
        }
        tab.IsLoading = true;
        RefreshTabText(tab);
    }

    private void Core_NavigationCompleted(BrowserTab tab, CoreWebView2NavigationCompletedEventArgs e)
    {
        tab.IsLoading = false;
        tab.LastActiveUtc = DateTime.UtcNow;
        RefreshTabText(tab);
        if (tab == ActiveTab) SyncChromeToTab(tab);
        if (e.IsSuccess && Uri.TryCreate(tab.CurrentUrl, UriKind.Absolute, out var uri) &&
            (uri.Scheme == "http" || uri.Scheme == "https"))
        {
            RecordHistory(string.IsNullOrWhiteSpace(tab.Title) ? uri.Host : tab.Title, tab.CurrentUrl);
        }
        else if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.Unknown)
        {
            SetStatus($"Page failed to load ({e.WebErrorStatus}). Check your connection and try again.");
        }
    }

    /// <summary>Data Saver request gate. Runs synchronously with a HashSet lookup —
    /// fast enough to keep on the UI thread without deferrals.</summary>
    private void Core_WebResourceRequested(BrowserTab tab, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!Settings.DataSaverEnabled || _env is null) return;
        try
        {
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
            if (uri.Scheme != "http" && uri.Scheme != "https") return;

            if (Settings.BlockImages && e.ResourceContext == CoreWebView2WebResourceContext.Image)
            {
                BlockRequest(e);
                _sessionImagesBlocked++;
                Settings.TotalImagesBlocked++;
                NoteBlocked();
                return;
            }
            if (Settings.BlockAdsTrackers && Blocklist.IsBlocked(uri))
            {
                BlockRequest(e);
                _sessionBlocked++;
                Settings.TotalBlockedRequests++;
                NoteBlocked();
            }
        }
        catch
        {
            // Never let the data saver break page loads.
        }
    }

    private void BlockRequest(CoreWebView2WebResourceRequestedEventArgs e)
    {
        e.Response = _env!.CreateWebResourceResponse(
            new MemoryStream(), 403, "Blocked by ADZAK Data Saver",
            "Content-Type: text/plain\r\nCache-Control: no-store");
    }

    private void NoteBlocked()
    {
        _statsDirty = true;
        var now = DateTime.UtcNow;
        if ((now - _lastStatusBlockUpdate).TotalMilliseconds > 500)
        {
            _lastStatusBlockUpdate = now;
            UpdateBlockStatus();
        }
    }

    private void UpdateBlockStatus()
    {
        _statusBlock.Text = $"🛡 {_sessionBlocked + _sessionImagesBlocked} blocked";
    }

    private async void Core_NewWindowRequested(CoreWebView2NewWindowRequestedEventArgs e)
    {
        // target=_blank / window.open → new tab, never stray top-level windows.
        e.Handled = true;
        var deferral = e.GetDeferral();
        try
        {
            var tab = await CreateTabAsync(null, activate: true);
            if (tab.Core is not null) e.NewWindow = tab.Core;
            else if (tab.Core is null && Uri.TryCreate(e.Uri, UriKind.Absolute, out _)) { /* init failed; error already shown */ }
        }
        catch { /* tab creation failure already surfaced */ }
        finally { deferral.Complete(); }
    }

    private void Core_PermissionRequested(CoreWebView2PermissionRequestedEventArgs e)
    {
        try
        {
            e.Handled = true;
            switch (e.PermissionKind)
            {
                case CoreWebView2PermissionKind.Camera:
                case CoreWebView2PermissionKind.Microphone:
                    var what = e.PermissionKind == CoreWebView2PermissionKind.Camera ? "camera" : "microphone";
                    var answer = MessageBox.Show(this,
                        $"{HostOf(e.Uri)} wants to use your {what}. Allow?",
                        "ADZAK Lite Browser — permission", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                    e.State = answer == DialogResult.Yes
                        ? CoreWebView2PermissionState.Allow
                        : CoreWebView2PermissionState.Deny;
                    break;
                default:
                    // Notifications, geolocation, clipboard-read etc: denied by default (privacy).
                    e.State = CoreWebView2PermissionState.Deny;
                    break;
            }
        }
        catch
        {
            try { e.State = CoreWebView2PermissionState.Deny; } catch { }
        }
    }

    private void Core_WebMessageReceived(CoreWebView2WebMessageReceivedEventArgs e)
    {
        string msg;
        try { msg = e.TryGetWebMessageAsString(); } catch { return; }
        if (!msg.StartsWith("adzak:shortcut:", StringComparison.Ordinal)) return;
        var key = msg["adzak:shortcut:".Length..];
        BeginInvoke(async () =>
        {
            switch (key)
            {
                case "t": await CreateTabAsync(null); break;
                case "w": if (ActiveTab is { } t) CloseTab(t); break;
                case "l": _address.Focus(); _address.SelectAll(); break;
                case "f": ShowFind(true); break;
            }
        });
    }

    private async Task UpdateFaviconAsync(BrowserTab tab)
    {
        try
        {
            if (tab.Core is null || tab.Page.IsDisposed) return;
            await using var stream = await tab.Core.GetFaviconAsync(CoreWebView2FaviconImageFormat.Png);
            if (stream is null) return;
            using var img = Image.FromStream(stream);
            var copy = new Bitmap(img);
            if (tab.FaviconIndex >= 0 && tab.FaviconIndex < _tabImages.Images.Count)
                _tabImages.Images[tab.FaviconIndex] = copy;
            else
            {
                _tabImages.Images.Add(copy);
                tab.FaviconIndex = _tabImages.Images.Count - 1;
            }
            _tabs.Invalidate();
        }
        catch
        {
            // Favicons are decoration; failures are silent.
        }
    }

    private void ToggleFullscreen(bool fullscreen)
    {
        if (fullscreen && FormBorderStyle != FormBorderStyle.None)
        {
            _preFullscreenBorder = FormBorderStyle;
            _preFullscreenState = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
        }
        else if (!fullscreen && FormBorderStyle == FormBorderStyle.None)
        {
            FormBorderStyle = _preFullscreenBorder;
            WindowState = _preFullscreenState;
        }
    }

    // ============================================================ downloads

    private void HandleDownload(BrowserTab tab, CoreWebView2DownloadStartingEventArgs e)
    {
        var op = e.DownloadOperation;
        var suggestedName = "download";
        try
        {
            suggestedName = Path.GetFileName(op.ResultFilePath);
            if (string.IsNullOrWhiteSpace(suggestedName)) suggestedName = "download";
        }
        catch { }

        string target;
        if (Settings.AskWhereToSave)
        {
            using var dlg = new SaveFileDialog { FileName = suggestedName, Title = "Save download" };
            if (dlg.ShowDialog(this) != DialogResult.OK)
            {
                e.Cancel = true;
                e.Handled = true;
                return;
            }
            target = dlg.FileName;
        }
        else
        {
            var folder = string.IsNullOrWhiteSpace(Settings.DownloadFolder)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")
                : Settings.DownloadFolder;
            Directory.CreateDirectory(folder);
            target = UniquePath(folder, suggestedName);
        }

        e.ResultFilePath = target;
        e.Handled = true; // our downloads window replaces the built-in flyout

        var entry = new DownloadEntry(op, target);
        _downloads.Add(entry);
        op.StateChanged += (_, _) =>
        {
            if (op.State == CoreWebView2DownloadState.Completed)
                SetStatus("Download complete: " + Path.GetFileName(target));
            else if (op.State == CoreWebView2DownloadState.Interrupted)
                SetStatus($"Download interrupted ({op.InterruptReason}): " + Path.GetFileName(target));
            _downloadsForm?.RefreshList();
        };
        UpdateDownloadsButton();
        SetStatus("Downloading " + Path.GetFileName(target) + " …");
    }

    private static string UniquePath(string folder, string fileName)
    {
        var candidate = Path.Combine(folder, fileName);
        if (!File.Exists(candidate)) return candidate;
        var name = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);
        for (var i = 1; i < 1000; i++)
        {
            candidate = Path.Combine(folder, $"{name} ({i}){ext}");
            if (!File.Exists(candidate)) return candidate;
        }
        return candidate;
    }

    private void ShowDownloads()
    {
        if (_downloadsForm is null || _downloadsForm.IsDisposed)
        {
            _downloadsForm = new DownloadsForm(_downloads);
            _downloadsForm.FormClosed += (_, _) => _downloadsForm = null;
            _downloadsForm.Show(this);
        }
        else
        {
            _downloadsForm.Activate();
            _downloadsForm.RefreshList();
        }
    }

    internal void UpdateDownloadsButton()
    {
        var active = _downloads.Count(d => d.Operation.State == CoreWebView2DownloadState.InProgress);
        _downloadsBtn.Text = active > 0 ? $"⬇{active}" : "⬇";
    }

    // ============================================================ bookmarks & history

    private bool IsBookmarked(string url) => _bookmarks.Any(b => b.Url == url);

    private void UpdateStar(BrowserTab tab)
    {
        _starBtn.Text = IsBookmarked(tab.CurrentUrl) ? "★" : "☆";
    }

    private void ToggleBookmarkForActive()
    {
        var tab = ActiveTab;
        if (tab is null || !IsWebUrl(tab.CurrentUrl)) return;
        var existing = _bookmarks.FirstOrDefault(b => b.Url == tab.CurrentUrl);
        if (existing is not null)
        {
            _bookmarks.Remove(existing);
            SetStatus("Bookmark removed");
        }
        else
        {
            _bookmarks.Insert(0, new BookmarkItem
            {
                Title = string.IsNullOrWhiteSpace(tab.Title) ? tab.CurrentUrl : tab.Title,
                Url = tab.CurrentUrl,
                AddedUtc = DateTime.UtcNow
            });
            SetStatus("Bookmarked ⭐");
        }
        DataStore.Save("bookmarks.json", _bookmarks);
        RebuildBookmarksBar();
        UpdateStar(tab);
    }

    private void RebuildBookmarksBar()
    {
        _bookmarksBar.Items.Clear();
        foreach (var b in _bookmarks.Take(12))
        {
            var item = new ToolStripButton(Truncate(b.Title, 22))
            {
                ToolTipText = b.Url,
                Tag = b.Url
            };
            item.Click += async (_, _) =>
            {
                if (ActiveTab is { } tab) tab.Navigate(b.Url);
                else await CreateTabAsync(b.Url);
            };
            _bookmarksBar.Items.Add(item);
        }
        _bookmarksBar.Visible = _bookmarks.Count > 0;
    }

    private void RecordHistory(string title, string url)
    {
        var last = _history.FirstOrDefault();
        if (last is not null && last.Url == url) { last.Title = title; last.VisitedUtc = DateTime.UtcNow; }
        else _history.Insert(0, new HistoryItem { Title = title, Url = url, VisitedUtc = DateTime.UtcNow });
        if (_history.Count > 1000) _history.RemoveRange(1000, _history.Count - 1000);
        DataStore.Save("history.json", _history);
    }

    internal List<HistoryItem> HistorySnapshot() => _history.ToList();
    internal List<BookmarkItem> BookmarksSnapshot() => _bookmarks.ToList();

    internal void ClearHistory()
    {
        _history.Clear();
        DataStore.Save("history.json", _history);
    }

    internal void DeleteHistoryItems(List<HistoryItem> items)
    {
        foreach (var i in items) _history.Remove(i);
        DataStore.Save("history.json", _history);
    }

    internal void SetBookmarks(List<BookmarkItem> items)
    {
        _bookmarks.Clear();
        _bookmarks.AddRange(items);
        DataStore.Save("bookmarks.json", _bookmarks);
        RebuildBookmarksBar();
        if (ActiveTab is { } t) UpdateStar(t);
    }

    // ============================================================ navigation helpers

    private void GoHome(BrowserTab? tab)
    {
        if (tab is null) return;
        if (!string.IsNullOrWhiteSpace(Settings.HomePage))
            tab.Navigate(NormalizeAddressInput(Settings.HomePage));
        else if (tab.Core is not null)
        {
            tab.CurrentUrl = "";
            tab.Title = "New Tab";
            RefreshTabText(tab);
            tab.Core.NavigateToString(BuildStartPage());
            if (tab == ActiveTab) { _address.Text = ""; Text = "ADZAK Lite Browser"; }
        }
        else
        {
            tab.CurrentUrl = ""; // start page applied after init via CreateTabAsync → GoHome again
            _ = tab.Ready.ContinueWith(_ => BeginInvoke(() => GoHome(tab)),
                TaskContinuationOptions.OnlyOnRanToCompletion);
        }
    }

    private string BuildStartPage()
    {
        string Chip(string title, string url) =>
            $"<a class='chip' href='{System.Net.WebUtility.HtmlEncode(url)}'>🌐 {System.Net.WebUtility.HtmlEncode(Truncate(title, 34))}</a>";
        var bookmarks = string.Concat(_bookmarks.Take(8).Select(b => Chip(b.Title, b.Url)));
        var recent = string.Concat(_history.Take(6).Select(h => Chip(h.Title, h.Url)));
        var engine = Settings.SearchEngine;
        var action = engine switch { "google" => "https://www.google.com/search", "bing" => "https://www.bing.com/search", _ => "https://duckduckgo.com/" };
        return $$"""
            <!doctype html><meta charset="utf-8"><title>New Tab</title>
            <style>body{font-family:'Segoe UI',sans-serif;background:#071c16;color:#eafff5;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
            .box{max-width:640px;width:90%;text-align:center}h1{font-size:34px;margin:0 0 4px}.sub{color:#9fd8bf;margin-bottom:22px}
            form{display:flex;gap:8px}input{flex:1;padding:13px 16px;border-radius:99px;border:1px solid #1d4a38;background:#0d2b21;color:#eafff5;font-size:15px}
            button{padding:13px 20px;border:0;border-radius:99px;background:linear-gradient(135deg,#22c55e,#2dd4bf);font-weight:700;cursor:pointer}
            .chips{margin-top:26px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}.chip{color:#a7f3c9;background:#0d2b21;border:1px solid #1d4a38;padding:8px 14px;border-radius:99px;text-decoration:none;font-size:13px}
            h3{color:#9fd8bf;font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin:26px 0 4px}</style>
            <div class="box"><h1>🪶 ADZAK Lite</h1><div class="sub">Light on RAM. Honest on speed. No Wi-Fi miracles promised — just less junk slowing you down.</div>
            <form action="{{action}}" method="get"><input name="q" placeholder="Search the web…" autofocus><button>Search</button></form>
            {{(bookmarks.Length > 0 ? "<h3>Bookmarks</h3><div class='chips'>" + bookmarks + "</div>" : "")}}
            {{(recent.Length > 0 ? "<h3>Recent</h3><div class='chips'>" + recent + "</div>" : "")}}
            </div>
            """;
    }

    public static string NormalizeAddressInput(string input)
    {
        input = (input ?? "").Trim();
        if (input.Length == 0) return "about:blank";
        if (input.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            input.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
            input.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
            return input;
        var looksLikeHost = !input.Contains(' ') &&
            (input.Contains('.') || input.StartsWith("localhost", StringComparison.OrdinalIgnoreCase));
        if (looksLikeHost)
        {
            var scheme = input.StartsWith("localhost", StringComparison.OrdinalIgnoreCase) ||
                         input.StartsWith("127.", StringComparison.OrdinalIgnoreCase) ? "http://" : "https://";
            return scheme + input;
        }
        return input; // caller turns it into a search below (needs Settings); handled in NavigateFromAddress
    }

    private void NavigateFromAddress()
    {
        var input = _address.Text.Trim();
        if (input.Length == 0) return;
        string url;
        var normalized = NormalizeAddressInput(input);
        if (normalized == input && !normalized.StartsWith("http", StringComparison.OrdinalIgnoreCase) &&
            !normalized.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
        {
            // plain search terms
            url = string.Format(Settings.SearchTemplate(), Uri.EscapeDataString(input));
        }
        else url = normalized;
        ActiveTab?.Navigate(url);
    }

    private void Address_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Enter)
        {
            e.SuppressKeyPress = true;
            NavigateFromAddress();
            ActiveTab?.View.Focus();
        }
    }

    private static bool IsWebUrl(string? url) =>
        url is not null &&
        (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
         url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
         url.StartsWith("about:blank", StringComparison.OrdinalIgnoreCase));

    private static string HostOf(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : url;

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? "" : s.Length <= max ? s : s[..max] + "…";

    // ============================================================ menu / find / keys

    private ToolStripItem[] BuildMenu(ToolStripDropDownButton owner)
    {
        ToolStripMenuItem Item(string text, EventHandler onClick, string? shortcut = null)
        {
            var m = new ToolStripMenuItem(text) { ShortcutKeyDisplayString = shortcut ?? "" };
            m.Click += onClick;
            return m;
        }
        var dataSaver = new ToolStripMenuItem("Data Saver (block ads & trackers)") { CheckOnClick = true, Checked = Settings.DataSaverEnabled };
        dataSaver.Click += (_, _) => { Settings.DataSaverEnabled = dataSaver.Checked; _shieldBtn.Checked = dataSaver.Checked; SaveSettings(); };
        var blockImages = new ToolStripMenuItem("Block images (saves the most data)") { CheckOnClick = true, Checked = Settings.BlockImages };
        blockImages.Click += (_, _) => { Settings.BlockImages = blockImages.Checked; SaveSettings(); SetStatus(blockImages.Checked ? "Images will be blocked on new page loads" : "Images allowed"); };
        var zoomLabel = new ToolStripMenuItem("Zoom: 100%") { Enabled = false };
        owner.DropDownOpening += (_, _) => { if (ActiveTab is { } t) zoomLabel.Text = $"Zoom: {t.View.ZoomFactor * 100:0}%"; };

        return new ToolStripItem[]
        {
            Item("New Tab", async (_, _) => await CreateTabAsync(null), "Ctrl+T"),
            new ToolStripSeparator(),
            Item("History…", (_, _) => new HistoryForm(this).ShowDialog(this)),
            Item("Bookmarks…", (_, _) => new BookmarksForm(this).ShowDialog(this)),
            Item("Downloads…", (_, _) => ShowDownloads(), "Ctrl+J"),
            new ToolStripSeparator(),
            Item("Zoom In", (_, _) => ZoomBy(0.1), "Ctrl++"),
            Item("Zoom Out", (_, _) => ZoomBy(-0.1), "Ctrl+-"),
            Item("Reset Zoom", (_, _) => { if (ActiveTab is { } t) t.View.ZoomFactor = 1.0; }, "Ctrl+0"),
            zoomLabel,
            Item("Find in Page…", (_, _) => ShowFind(true), "Ctrl+F"),
            new ToolStripSeparator(),
            dataSaver,
            blockImages,
            new ToolStripSeparator(),
            Item("Suspend Inactive Tabs Now (free RAM)", async (_, _) => await SuspendInactiveTabsAsync(force: true)),
            Item("GPU Status…", async (_, _) => await ShowGpuStatusAsync()),
            Item("Clear Browsing Data…", async (_, _) => await ClearBrowsingDataAsync()),
            Item("Settings…", (_, _) => OpenSettings()),
            new ToolStripSeparator(),
            Item("About ADZAK Lite Browser", (_, _) => AboutDialog.Show(this)),
        };
    }

    private void ZoomBy(double delta)
    {
        if (ActiveTab is not { } t) return;
        t.View.ZoomFactor = Math.Clamp(t.View.ZoomFactor + delta, 0.25, 3.0);
    }

    private void BuildFindPanel()
    {
        _findPanel.Height = 34;
        _findPanel.Visible = false;
        _findPanel.BackColor = SystemColors.Control;
        var lbl = new Label { Text = "Find:", AutoSize = true, Location = new Point(8, 9) };
        _findBox.Location = new Point(48, 6);
        _findBox.Width = 240;
        _findBox.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; await FindInPageAsync(backwards: e.Shift); }
            else if (e.KeyCode == Keys.Escape) ShowFind(false);
        };
        var next = new Button { Text = "Next", Location = new Point(296, 5), Size = new Size(64, 24) };
        next.Click += async (_, _) => await FindInPageAsync(false);
        var prev = new Button { Text = "Prev", Location = new Point(366, 5), Size = new Size(64, 24) };
        prev.Click += async (_, _) => await FindInPageAsync(true);
        var close = new Button { Text = "✕", Location = new Point(436, 5), Size = new Size(30, 24) };
        close.Click += (_, _) => ShowFind(false);
        _findPanel.Controls.AddRange(new Control[] { lbl, _findBox, next, prev, close });
    }

    private void ShowFind(bool show)
    {
        _findPanel.Visible = show;
        if (show) { _findBox.Focus(); _findBox.SelectAll(); }
        else ActiveTab?.View.Focus();
    }

    private async Task FindInPageAsync(bool backwards)
    {
        if (ActiveTab?.Core is not { } core || _findBox.Text.Length == 0) return;
        var text = System.Text.Json.JsonSerializer.Serialize(_findBox.Text);
        var found = await core.ExecuteScriptAsync($"window.find({text}, false, {(backwards ? "true" : "false")}, true)");
        if (found == "false") SetStatus("Not found: " + _findBox.Text);
    }

    private void MainForm_KeyDown(object? sender, KeyEventArgs e)
    {
        if (!e.Control) return;
        switch (e.KeyCode)
        {
            case Keys.T: e.SuppressKeyPress = true; _ = CreateTabAsync(null); break;
            case Keys.W: e.SuppressKeyPress = true; if (ActiveTab is { } t) CloseTab(t); break;
            case Keys.L: e.SuppressKeyPress = true; _address.Focus(); _address.SelectAll(); break;
            case Keys.F: e.SuppressKeyPress = true; ShowFind(true); break;
            case Keys.J: e.SuppressKeyPress = true; ShowDownloads(); break;
        }
    }

    // ============================================================ performance actions

    private async void SuspendTimer_Tick(object? sender, EventArgs e)
    {
        if (_statsDirty) SaveSettings();
        UpdateDownloadsButton();
        await SuspendInactiveTabsAsync(force: false);
    }

    private async Task SuspendInactiveTabsAsync(bool force)
    {
        var minutes = Settings.AutoSuspendMinutes;
        var suspended = 0;
        foreach (TabPage page in _tabs.TabPages)
        {
            if (page.Tag is not BrowserTab tab || tab == ActiveTab || tab.Core is null || tab.IsSuspended) continue;
            if (force || (minutes > 0 && (DateTime.UtcNow - tab.LastActiveUtc).TotalMinutes >= minutes))
            {
                await tab.SuspendAsync();
                if (tab.IsSuspended) suspended++;
            }
        }
        if (suspended > 0) SetStatus($"Suspended {suspended} inactive tab(s) to free RAM. They reload instantly when selected.");
        else if (force) SetStatus("No inactive tabs to suspend.");
    }

    internal async Task ClearBrowsingDataAsync()
    {
        if (ActiveTab?.Core is not { } core) return;
        if (MessageBox.Show(this,
                "Clear cache, cookies, site storage and download history for all sites?\nYou will be signed out of websites.",
                "Clear browsing data", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return;
        try
        {
            await core.Profile.ClearBrowsingDataAsync(
                CoreWebView2BrowsingDataKinds.DiskCache |
                CoreWebView2BrowsingDataKinds.AllSite |
                CoreWebView2BrowsingDataKinds.DownloadHistory);
            SetStatus("Browsing data cleared.");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not clear all data: " + ex.Message, "ADZAK Lite Browser",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    /// <summary>Real GPU detection: asks the page's WebGL context which renderer
    /// Chromium is using. "SwiftShader"/"llvmpipe" = software (no GPU).</summary>
    public async Task ShowGpuStatusAsync()
    {
        var mode = Settings.HardwareAcceleration ? "enabled in Settings" : "DISABLED in Settings (applies after restart)";
        string renderer = "no page loaded yet";
        if (ActiveTab?.Core is { } core)
        {
            try
            {
                const string js = """
                    (() => { try {
                      const c = document.createElement('canvas');
                      const gl = c.getContext('webgl2') || c.getContext('webgl');
                      if (!gl) return 'WebGL unavailable';
                      const d = gl.getExtension('WEBGL_debug_renderer_info');
                      return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
                    } catch (e) { return 'unknown'; } })()
                    """;
                var raw = await core.ExecuteScriptAsync(js);
                renderer = System.Text.Json.JsonSerializer.Deserialize<string>(raw) ?? "unknown";
            }
            catch { renderer = "unknown"; }
        }
        var software = renderer.Contains("SwiftShader", StringComparison.OrdinalIgnoreCase) ||
                       renderer.Contains("llvmpipe", StringComparison.OrdinalIgnoreCase) ||
                       renderer.Contains("Software", StringComparison.OrdinalIgnoreCase);
        MessageBox.Show(this,
            $"Hardware acceleration: {mode}\nWebGL renderer: {renderer}\n\n" +
            (software
                ? "Pages are currently rendered by the CPU (software). If your PC has a GPU, check that Hardware Acceleration is enabled and restart the browser."
                : "Pages are rendered by your GPU. That is the fast path — no extra 'boost' is applied or needed."),
            "GPU status", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void OpenSettings()
    {
        using var form = new SettingsForm(this, Settings);
        if (form.ShowDialog(this) == DialogResult.OK)
        {
            SaveSettings();
            _shieldBtn.Checked = Settings.DataSaverEnabled;
            foreach (TabPage page in _tabs.TabPages)
            {
                if (page.Tag is BrowserTab tab && tab.Core is not null)
                {
                    tab.Core.Settings.AreDevToolsEnabled = Settings.DevToolsEnabled;
                    _ = tab.ApplyAutoplayScriptAsync();
                }
            }
            SetStatus("Settings saved. Hardware-acceleration and cache-size changes apply after restart.");
        }
    }

    // ============================================================ status

    private void SetStatus(string text) => _statusMain.Text = text;

    private void StatusTimer_Tick(object? sender, EventArgs e)
    {
        try
        {
            using var proc = Process.GetCurrentProcess();
            var hostMB = proc.WorkingSet64 / 1048576.0;
            var (totalGB, usedPct) = NativeMemory.GetSystemMemory();
            var suspended = 0;
            foreach (TabPage p in _tabs.TabPages)
                if (p.Tag is BrowserTab t && t.IsSuspended) suspended++;
            _statusMem.Text = totalGB > 0
                ? $"Host RAM: {hostMB:0} MB · PC RAM: {usedPct}% of {totalGB:0} GB · Tabs: {_tabs.TabPages.Count} ({suspended} suspended)"
                : $"Host RAM: {hostMB:0} MB · Tabs: {_tabs.TabPages.Count} ({suspended} suspended)";
            UpdateBlockStatus();
        }
        catch
        {
            // Status readouts must never crash the browser.
        }
    }
}

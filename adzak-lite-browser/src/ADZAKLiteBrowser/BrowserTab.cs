using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AdzakLiteBrowser;

/// <summary>
/// One tab: a TabPage hosting a single WebView2. All tabs share ONE
/// CoreWebView2Environment (created by MainForm) — that is the single biggest
/// memory saver compared to naive per-tab environments.
///
/// Heavy event wiring (navigation, downloads, blocking…) lives in MainForm;
/// this class owns tab lifecycle: init, suspend/resume, autoplay script,
/// favicon/loading state.
/// </summary>
public sealed class BrowserTab : IDisposable
{
    private readonly MainForm _host;
    private readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private string? _autoplayScriptId;
    private bool _disposed;

    public TabPage Page { get; }
    public WebView2 View { get; }
    public CoreWebView2? Core => View.CoreWebView2;
    public string CurrentUrl { get; set; } = "";
    public string Title { get; set; } = "New Tab";
    public bool IsLoading { get; set; }
    public bool IsSuspended { get; private set; }
    public DateTime LastActiveUtc { get; set; } = DateTime.UtcNow;
    public int FaviconIndex { get; set; } = -1;
    public Task Ready => _ready.Task;

    public BrowserTab(MainForm host)
    {
        _host = host;
        View = new WebView2 { Dock = DockStyle.Fill };
        Page = new TabPage("New Tab") { ToolTipText = "" };
        Page.Controls.Add(View);
        Page.Tag = this;
    }

    public async Task InitializeAsync(CoreWebView2Environment env)
    {
        try
        {
            await View.EnsureCoreWebView2Async(env);
            var core = Core!;
            var s = core.Settings;
            s.IsStatusBarEnabled = false;                 // we draw our own status bar
            s.AreDevToolsEnabled = _host.Settings.DevToolsEnabled;
            s.IsBuiltInErrorPageEnabled = true;           // clear browser error pages (compat)
            s.AreDefaultContextMenusEnabled = true;
            s.IsGeneralAutofillEnabled = true;
            s.IsPasswordAutosaveEnabled = true;           // user convenience; stored by Chromium profile encryption

            // Ask Chromium to use GPU rendering unless the user turned it off
            // (handled via environment browser arguments in MainForm) — nothing
            // here ever passes --disable-gpu behind the user's back.

            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            await ApplyAutoplayScriptAsync();
            await InstallShortcutScriptAsync();
            _host.WireCoreEvents(this);
            _ready.TrySetResult(true);
        }
        catch (Exception ex)
        {
            _ready.TrySetResult(false);
            _host.OnTabInitFailed(this, ex);
        }
    }

    /// <summary>Keyboard shortcuts from inside web content (Ctrl+T/W/L/F),
    /// because WebView2 consumes most keys before WinForms can see them.</summary>
    private async Task InstallShortcutScriptAsync()
    {
        if (Core is null) return;
        const string js = """
            document.addEventListener('keydown', function (e) {
              if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
              var k = (e.key || '').toLowerCase();
              if (k === 't' || k === 'w' || k === 'l' || k === 'f') {
                e.preventDefault();
                try { chrome.webview.postMessage('adzak:shortcut:' + k); } catch (_) {}
              }
            }, true);
            """;
        await Core.AddScriptToExecuteOnDocumentCreatedAsync(js);
    }

    /// <summary>
    /// Autoplay prevention, applied live (no restart): strips the autoplay
    /// attribute/property from media elements as they appear. Media the user
    /// explicitly plays is untouched. A Chromium policy flag is also set at
    /// environment level (see MainForm.CreateEnvironmentAsync).
    /// </summary>
    public async Task ApplyAutoplayScriptAsync()
    {
        if (Core is null) return;
        try
        {
            if (_host.Settings.PreventAutoplay && _autoplayScriptId is null)
            {
                const string js = """
                    (function () {
                      function tame(root) {
                        try {
                          root.querySelectorAll('video[autoplay],audio[autoplay],video,audio').forEach(function (m) {
                            if (m.autoplay || m.hasAttribute('autoplay')) {
                              m.autoplay = false;
                              m.removeAttribute('autoplay');
                              try { m.pause(); } catch (_) {}
                            }
                          });
                        } catch (_) {}
                      }
                      tame(document);
                      new MutationObserver(function () { tame(document); })
                        .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['autoplay'] });
                    })();
                    """;
                _autoplayScriptId = await Core.AddScriptToExecuteOnDocumentCreatedAsync(js);
            }
            else if (!_host.Settings.PreventAutoplay && _autoplayScriptId is not null)
            {
                Core.RemoveScriptToExecuteOnDocumentCreated(_autoplayScriptId);
                _autoplayScriptId = null;
            }
        }
        catch
        {
            // Script injection can fail on internal pages; autoplay stays best-effort.
        }
    }

    public void Navigate(string url)
    {
        LastActiveUtc = DateTime.UtcNow;
        if (Core is null)
        {
            CurrentUrl = url; // queued; MainForm navigates once Ready completes
            return;
        }
        ResumeIfSuspended();
        Core.Navigate(url);
    }

    /// <summary>Free most of this tab's renderer memory while keeping it restorable.</summary>
    public async Task SuspendAsync()
    {
        if (Core is null || IsSuspended || _disposed) return;
        try
        {
            try { Core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low; }
            catch { /* older runtimes: suspension alone still helps */ }
            IsSuspended = await Core.TrySuspendAsync();
            if (IsSuspended) _host.RefreshTabText(this);
        }
        catch
        {
            // SuspendAsync throws if the view is visible or has dialogs open; skip then.
        }
    }

    public void ResumeIfSuspended()
    {
        if (Core is null || !IsSuspended) return;
        try
        {
            Core.Resume();
            try { Core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal; }
            catch { }
            IsSuspended = false;
            _host.RefreshTabText(this);
        }
        catch
        {
            IsSuspended = false;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { View.Dispose(); } catch { }
        try { Page.Dispose(); } catch { }
    }
}

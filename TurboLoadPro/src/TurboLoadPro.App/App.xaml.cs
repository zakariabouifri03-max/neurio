using System.Net;
using System.Windows;
using System.Windows.Threading;
using Forms = System.Windows.Forms;
using TurboLoadPro.Core.Engine;
using TurboLoadPro.Core.Models;
using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Services;
using TurboLoadPro.Core.Storage;
using TurboLoadPro.Infrastructure;

namespace TurboLoadPro;

public partial class App : Application
{
    private DownloadManager? _manager;
    private SafeHttpClient? _http;
    private RollingFileTransferLogger? _logger;
    private Forms.NotifyIcon? _notifyIcon;
    private System.Drawing.Icon? _appIcon;
    private DownloadSettings? _settings;
    private JsonSettingsStore? _settingsStore;
    private readonly HashSet<Guid> _notifiedDownloads = [];

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            var dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TurboLoadPro");
            Directory.CreateDirectory(dataDirectory);
            _settingsStore = new JsonSettingsStore(Path.Combine(dataDirectory, "settings.json"));
            _settings = await _settingsStore.LoadAsync();
            _logger = new RollingFileTransferLogger(Path.Combine(dataDirectory, "logs", "turboload.log"));
            ThemeManager.Apply(this, _settings.Theme == "Dark");
            try { StartupRegistry.Apply(_settings.StartWithWindows); }
            catch (Exception exception) { _logger.Write("startup_registration_failed", exception: exception); }

            var store = new SqliteDownloadStore(Path.Combine(dataDirectory, "history.sqlite3"));
            _http = new SafeHttpClient();
            var limiter = new BandwidthLimiter(_settings.GlobalSpeedLimitBytesPerSecond);
            var engine = new DownloadEngine(_http, limiter);
            _manager = new DownloadManager(store, engine, limiter, _settings, _logger);
            await _manager.InitializeAsync(_settings.AutoResumeInterrupted);

            _manager.DownloadChanged += OnDownloadChanged;
            CreateNotificationIcon();

            var window = new MainWindow(_manager, _settingsStore, _settings, _logger);
            MainWindow = window;
            window.Show();
            string? url = null;
            try { url = GetStartupUrl(e.Args); }
            catch (ArgumentException exception) { _logger.Write("startup_link_rejected", exception: exception); }
            if (url is not null)
                await window.ImportUrlAsync(url);
        }
        catch (Exception exception)
        {
            _logger?.Write("application_start_failed", exception: exception);
            MessageBox.Show("TurboLoad Pro could not initialize its local download database or settings. No download was started. Check the app data folder and try again.",
                "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(-1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { _manager?.ShutdownAsync().GetAwaiter().GetResult(); }
        catch (Exception exception) { _logger?.Write("shutdown_failed", exception: exception); }
        if (_manager is not null) _manager.DownloadChanged -= OnDownloadChanged;
        if (_notifyIcon is not null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
        }
        _appIcon?.Dispose();
        _http?.Dispose();
        base.OnExit(e);
    }

    private void CreateNotificationIcon()
    {
        try
        {
            var processPath = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(processPath)) _appIcon = System.Drawing.Icon.ExtractAssociatedIcon(processPath);
            _notifyIcon = new Forms.NotifyIcon
            {
                Icon = _appIcon ?? System.Drawing.SystemIcons.Application,
                Text = "TurboLoad Pro — downloads",
                Visible = true
            };
            _notifyIcon.DoubleClick += (_, _) =>
            {
                if (MainWindow is null) return;
                MainWindow.Show();
                MainWindow.WindowState = WindowState.Normal;
                MainWindow.Activate();
            };
        }
        catch (Exception exception)
        {
            _logger?.Write("notification_icon_unavailable", exception: exception);
        }
    }

    private void OnDownloadChanged(object? sender, DownloadChangedEventArgs e)
    {
        var record = e.Record;
        if (record.Status != DownloadStatus.Completed || _manager?.CurrentSettings.NotifyOnCompletion != true) return;
        lock (_notifiedDownloads)
        {
            if (!_notifiedDownloads.Add(record.Id)) return;
        }
        try
        {
            _notifyIcon?.ShowBalloonTip(3500, "Download complete", record.FileName, Forms.ToolTipIcon.Info);
        }
        catch (Exception exception)
        {
            _logger?.Write("completion_notification_failed", record.Id, exception);
        }
    }

    private static string? GetStartupUrl(IReadOnlyList<string> args)
    {
        for (var index = 0; index < args.Count; index++)
        {
            var argument = args[index];
            if ((argument.Equals("--url", StringComparison.OrdinalIgnoreCase) ||
                 argument.Equals("--import-url", StringComparison.OrdinalIgnoreCase)) && index + 1 < args.Count)
                return UrlPolicy.Validate(args[index + 1]).AbsoluteUri;
            if (argument.Equals("--protocol", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Count)
            {
                var protocol = args[index + 1];
                if (!Uri.TryCreate(protocol, UriKind.Absolute, out var protocolUri) ||
                    !protocolUri.Scheme.Equals("turbload", StringComparison.OrdinalIgnoreCase) ||
                    !protocolUri.Host.Equals("add", StringComparison.OrdinalIgnoreCase))
                    return null;
                foreach (var part in protocolUri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
                {
                    var pair = part.Split('=', 2);
                    if (pair.Length == 2 && pair[0].Equals("url", StringComparison.OrdinalIgnoreCase))
                        return UrlPolicy.Validate(WebUtility.UrlDecode(pair[1])).AbsoluteUri;
                }
            }
        }
        return null;
    }
}

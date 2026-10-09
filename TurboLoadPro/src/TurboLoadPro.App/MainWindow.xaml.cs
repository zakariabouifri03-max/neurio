using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Threading;
using TurboLoadPro.Core.Models;
using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Services;
using TurboLoadPro.Infrastructure;
using TurboLoadPro.ViewModels;
using FormsClipboard = System.Windows.Clipboard;

namespace TurboLoadPro;

public partial class MainWindow : Window, INotifyPropertyChanged
{
    private readonly DownloadManager _manager;
    private readonly JsonSettingsStore _settingsStore;
    private readonly ITransferLogger _logger;
    private readonly ICollectionView _downloadsView;
    private readonly DispatcherTimer _summaryTimer;
    private readonly DispatcherTimer _clipboardTimer;
    private DownloadSettings _settings;
    private string _filter = "All";
    private string _searchText = string.Empty;
    private string _globalSpeedText = "0 B/s";
    private int _activeCount;
    private int _queuedCount;
    private int _completedCount;
    private string _downloadDirectoryLabel = string.Empty;
    private string? _lastClipboardUrl;
    private string? _pendingClipboardUrl;

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<DownloadRowViewModel> Downloads { get; } = [];
    public ICollectionView FilteredDownloads => _downloadsView;
    public IReadOnlyList<PriorityOption> PriorityOptions { get; } =
    [
        new PriorityOption("Low", DownloadPriority.Low),
        new PriorityOption("Normal", DownloadPriority.Normal),
        new PriorityOption("High", DownloadPriority.High)
    ];

    public string GlobalSpeedText { get => _globalSpeedText; private set => SetField(ref _globalSpeedText, value); }
    public int ActiveCount { get => _activeCount; private set => SetField(ref _activeCount, value); }
    public int QueuedCount { get => _queuedCount; private set => SetField(ref _queuedCount, value); }
    public int CompletedCount { get => _completedCount; private set => SetField(ref _completedCount, value); }
    public string DownloadDirectoryLabel { get => _downloadDirectoryLabel; private set => SetField(ref _downloadDirectoryLabel, value); }

    public MainWindow(DownloadManager manager, JsonSettingsStore settingsStore, DownloadSettings settings, ITransferLogger logger)
    {
        InitializeComponent();
        _manager = manager;
        _settingsStore = settingsStore;
        _settings = settings.Clone().Normalize();
        _logger = logger;
        _downloadDirectoryLabel = _settings.DownloadDirectory;
        _downloadsView = CollectionViewSource.GetDefaultView(Downloads);
        _downloadsView.Filter = MatchesFilter;
        DataContext = this;
        foreach (var record in _manager.GetSnapshot()) Upsert(record);
        ApplySort(0);
        _manager.DownloadChanged += OnDownloadChanged;

        _summaryTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _summaryTimer.Tick += (_, _) => RefreshSummary();
        _summaryTimer.Start();

        _clipboardTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1200) };
        _clipboardTimer.Tick += ClipboardTimer_Tick;
        ConfigureClipboardMonitor();
        RefreshSummary();
    }

    public async Task ImportUrlAsync(string url)
    {
        UrlBox.Text = url;
        await AddDownloadAsync(url);
    }

    private async Task AddDownloadAsync(string url)
    {
        try
        {
            UrlPolicy.Validate(url);
            await _manager.AddDownloadAsync(url, _settings.DownloadDirectory);
            UrlBox.Clear();
        }
        catch (ArgumentException exception)
        {
            MessageBox.Show(this, exception.Message, "Invalid download link", MessageBoxButton.OK, MessageBoxImage.Warning);
            UrlBox.Focus();
        }
        catch (Exception exception)
        {
            _logger.Write("add_download_failed", exception: exception);
            MessageBox.Show(this, "The download could not be added. Check the destination folder and try again.",
                "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void OnDownloadChanged(object? sender, DownloadChangedEventArgs e)
    {
        var record = e.Record;
        _ = Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() =>
        {
            Upsert(record);
            _downloadsView.Refresh();
            RefreshSummary();
        }));
    }

    private void Upsert(DownloadRecord record)
    {
        var existing = Downloads.FirstOrDefault(row => row.Id == record.Id);
        if (existing is null)
        {
            Downloads.Add(new DownloadRowViewModel(record, PriorityChanged));
        }
        else
        {
            existing.Update(record);
        }
    }

    private void RefreshSummary()
    {
        var rows = _manager.GetSnapshot();
        ActiveCount = rows.Count(record => record.Status is DownloadStatus.Probing or DownloadStatus.Downloading);
        QueuedCount = rows.Count(record => record.Status == DownloadStatus.Queued);
        CompletedCount = rows.Count(record => record.Status == DownloadStatus.Completed);
        var speed = rows.Where(record => record.Status == DownloadStatus.Downloading).Sum(record => record.SpeedBytesPerSecond);
        GlobalSpeedText = Formatters.FormatRate(speed);
        foreach (var record in rows)
        {
            var row = Downloads.FirstOrDefault(candidate => candidate.Id == record.Id);
            row?.Update(record);
        }
    }

    private bool MatchesFilter(object item)
    {
        if (item is not DownloadRowViewModel row) return false;
        var statusMatches = _filter switch
        {
            "Active" => row.Status is DownloadStatus.Probing or DownloadStatus.Downloading or DownloadStatus.Paused,
            "Queued" => row.Status == DownloadStatus.Queued,
            "Completed" => row.Status == DownloadStatus.Completed,
            "Failed" => row.Status is DownloadStatus.Failed or DownloadStatus.Cancelled,
            _ => true
        };
        if (!statusMatches) return false;
        if (string.IsNullOrWhiteSpace(_searchText)) return true;
        return row.FileName.Contains(_searchText, StringComparison.OrdinalIgnoreCase) ||
               row.FolderPath.Contains(_searchText, StringComparison.OrdinalIgnoreCase);
    }

    private void ApplySort(int index)
    {
        _downloadsView.SortDescriptions.Clear();
        switch (index)
        {
            case 1:
                _downloadsView.SortDescriptions.Add(new SortDescription(nameof(DownloadRowViewModel.CreatedUtc), ListSortDirection.Ascending));
                break;
            case 2:
                _downloadsView.SortDescriptions.Add(new SortDescription(nameof(DownloadRowViewModel.FileName), ListSortDirection.Ascending));
                break;
            case 3:
                _downloadsView.SortDescriptions.Add(new SortDescription(nameof(DownloadRowViewModel.ProgressPercent), ListSortDirection.Descending));
                break;
            default:
                _downloadsView.SortDescriptions.Add(new SortDescription(nameof(DownloadRowViewModel.CreatedUtc), ListSortDirection.Descending));
                break;
        }
        _downloadsView.Refresh();
    }

    private async void AddDownload_Click(object sender, RoutedEventArgs e) => await AddDownloadAsync(UrlBox.Text.Trim());

    private void FocusUrl_Click(object sender, RoutedEventArgs e)
    {
        UrlBox.Focus();
        Keyboard.Focus(UrlBox);
    }

    private void UrlBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        _ = AddDownloadAsync(UrlBox.Text.Trim());
    }

    private void Paste_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (FormsClipboard.ContainsText()) UrlBox.Text = FormsClipboard.GetText().Trim();
            UrlBox.Focus();
            UrlBox.CaretIndex = UrlBox.Text.Length;
        }
        catch (Exception exception) when (exception is ExternalException or InvalidOperationException)
        {
            MessageBox.Show(this, "The clipboard is currently unavailable.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private void Filter_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string filter }) return;
        _filter = filter;
        _downloadsView.Refresh();
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _searchText = SearchBox.Text.Trim();
        if (_downloadsView is not null) _downloadsView.Refresh();
    }

    private void Sort_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_downloadsView is not null && sender is ComboBox combo && combo.SelectedIndex >= 0)
            ApplySort(combo.SelectedIndex);
    }

    private async void Toggle_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetId(sender, out var id)) return;
        var record = _manager.GetSnapshot().FirstOrDefault(item => item.Id == id);
        if (record is null) return;
        if (record.Status is DownloadStatus.Probing or DownloadStatus.Downloading)
            await RunActionAsync(() => _manager.PauseAsync(id));
        else if (record.Status == DownloadStatus.Paused)
            await RunActionAsync(() => _manager.ResumeAsync(id));
    }

    private async void Retry_Click(object sender, RoutedEventArgs e)
    {
        if (TryGetId(sender, out var id)) await RunActionAsync(() => _manager.RetryAsync(id));
    }

    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetId(sender, out var id)) return;
        var answer = MessageBox.Show(this, "Restart this download from byte zero? The completed file, if any, will be kept and a new filename will be chosen.",
            "Restart download", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (answer == MessageBoxResult.Yes) await RunActionAsync(() => _manager.RestartAsync(id));
    }

    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetId(sender, out var id)) return;
        var row = _manager.GetSnapshot().FirstOrDefault(item => item.Id == id);
        if (row is null) return;
        if (row.DownloadedBytes > 0 && MessageBox.Show(this, "Cancel and discard the partial download?",
                "Cancel download", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        await RunActionAsync(() => _manager.CancelAsync(id));
    }

    private void OpenFile_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetId(sender, out var id)) return;
        var record = _manager.GetSnapshot().FirstOrDefault(item => item.Id == id);
        if (record is null || record.Status != DownloadStatus.Completed || !File.Exists(record.DestinationPath)) return;
        try { Process.Start(new ProcessStartInfo(record.DestinationPath) { UseShellExecute = true }); }
        catch (Exception exception)
        {
            _logger.Write("open_download_failed", id, exception);
            MessageBox.Show(this, "Windows could not open that file. You can open it from its folder instead.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetId(sender, out var id)) return;
        var record = _manager.GetSnapshot().FirstOrDefault(item => item.Id == id);
        if (record is null || record.Status != DownloadStatus.Completed) return;
        var folder = Path.GetDirectoryName(record.DestinationPath);
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder)) return;
        try { Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true }); }
        catch (Exception exception)
        {
            _logger.Write("open_folder_failed", id, exception);
            MessageBox.Show(this, "Windows could not open the download folder.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private async Task RunActionAsync(Func<Task> action)
    {
        try { await action(); }
        catch (Exception exception)
        {
            _logger.Write("ui_action_failed", exception: exception);
            MessageBox.Show(this, "That action could not be completed. Check the app's diagnostic log.",
                "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void PriorityChanged(Guid id, DownloadPriority priority)
    {
        try { await _manager.SetPriorityAsync(id, priority); }
        catch (Exception exception)
        {
            _logger.Write("priority_update_failed", id, exception);
        }
    }

    private async void Settings_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SettingsWindow(_settings) { Owner = this };
        if (dialog.ShowDialog() != true) return;
        try
        {
            _settings = dialog.Settings.Clone().Normalize();
            await _settingsStore.SaveAsync(_settings);
            await _manager.UpdateSettingsAsync(_settings);
            StartupRegistry.Apply(_settings.StartWithWindows);
            ThemeManager.Apply(System.Windows.Application.Current, _settings.Theme == "Dark");
            DownloadDirectoryLabel = _settings.DownloadDirectory;
            ConfigureClipboardMonitor();
        }
        catch (Exception exception)
        {
            _logger.Write("settings_save_failed", exception: exception);
            MessageBox.Show(this, "Settings could not be saved. Verify the selected folder and try again.",
                "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void ConfigureClipboardMonitor()
    {
        ClipboardBanner.Visibility = Visibility.Collapsed;
        _pendingClipboardUrl = null;
        if (_settings.MonitorClipboard)
        {
            if (!_clipboardTimer.IsEnabled) _clipboardTimer.Start();
        }
        else
        {
            _clipboardTimer.Stop();
            _lastClipboardUrl = null;
        }
    }

    private void ClipboardTimer_Tick(object? sender, EventArgs e)
    {
        if (!_settings.MonitorClipboard) return;
        string text;
        try
        {
            if (!FormsClipboard.ContainsText()) return;
            text = FormsClipboard.GetText().Trim();
        }
        catch (Exception exception) when (exception is ExternalException or InvalidOperationException)
        {
            return;
        }
        if (!UrlPolicy.TryValidate(text, out var uri) || uri is null)
        {
            _lastClipboardUrl = null;
            ClipboardBanner.Visibility = Visibility.Collapsed;
            _pendingClipboardUrl = null;
            return;
        }
        if (string.Equals(uri.AbsoluteUri, _lastClipboardUrl, StringComparison.Ordinal)) return;
        _lastClipboardUrl = uri.AbsoluteUri;
        _pendingClipboardUrl = uri.AbsoluteUri;
        ClipboardHostText.Text = $"A direct link from {uri.Host} is ready. Import only if you intended to download it.";
        ClipboardBanner.Visibility = Visibility.Visible;
    }

    private async void ImportClipboard_Click(object sender, RoutedEventArgs e)
    {
        if (_pendingClipboardUrl is not { } url) return;
        ClipboardBanner.Visibility = Visibility.Collapsed;
        _pendingClipboardUrl = null;
        await AddDownloadAsync(url);
    }

    private void Window_DragEnter(object sender, System.Windows.DragEventArgs e)
    {
        e.Effects = TryGetDroppedUrl(e.Data, out _) ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private async void Window_Drop(object sender, System.Windows.DragEventArgs e)
    {
        e.Handled = true;
        if (!TryGetDroppedUrl(e.Data, out var url) || url is null) return;
        await ImportUrlAsync(url);
    }

    private static bool TryGetDroppedUrl(System.Windows.IDataObject data, out string? url)
    {
        url = null;
        if (data.GetDataPresent(DataFormats.UnicodeText) || data.GetDataPresent(DataFormats.Text))
        {
            var text = data.GetData(DataFormats.UnicodeText) as string ?? data.GetData(DataFormats.Text) as string;
            if (UrlPolicy.TryValidate(text, out var uri) && uri is not null)
            {
                url = uri.AbsoluteUri;
                return true;
            }
        }
        if (!data.GetDataPresent(DataFormats.FileDrop) || data.GetData(DataFormats.FileDrop) is not string[] files) return false;
        foreach (var file in files)
        {
            if (!Path.GetExtension(file).Equals(".url", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                foreach (var line in File.ReadLines(file).Take(32))
                {
                    if (!line.StartsWith("URL=", StringComparison.OrdinalIgnoreCase)) continue;
                    var candidate = line[4..].Trim();
                    if (!UrlPolicy.TryValidate(candidate, out var uri) || uri is null) continue;
                    url = uri.AbsoluteUri;
                    return true;
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // Ignore inaccessible shortcut files; never read or execute arbitrary dropped files.
            }
        }
        return false;
    }

    private void IntegrationHelp_Click(object sender, RoutedEventArgs e)
    {
        var exe = Environment.ProcessPath ?? "TurboLoadPro.exe";
        MessageBox.Show(this,
            "Browser handoff is explicit and direct-link only. A small browser helper can call:\n\n" +
            $"\"{exe}\" --url \"https://example.com/file.zip\"\n\n" +
            "Or open turbload://add?url=<percent-encoded-direct-url>. The installer registers that protocol per-user.\n\n" +
            "TurboLoad Pro does not read browsing history, cookies, passwords or page content.",
            "Browser integration", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private void Maximize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left) return;
        if (e.ClickCount == 2)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
            return;
        }
        try { DragMove(); }
        catch (InvalidOperationException) { }
    }

    private void Window_StateChanged(object? sender, EventArgs e) { }

    private static bool TryGetId(object sender, out Guid id)
    {
        id = Guid.Empty;
        return sender is Button { Tag: Guid value } && (id = value) != Guid.Empty;
    }

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    private bool SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(propertyName);
        return true;
    }

    protected override void OnClosed(EventArgs e)
    {
        _manager.DownloadChanged -= OnDownloadChanged;
        _summaryTimer.Stop();
        _clipboardTimer.Stop();
        base.OnClosed(e);
    }
}

using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Services;
using Microsoft.Win32;

namespace AdzakDownloadPro.ViewModels
{
    /// <summary>
    /// The main view model: owns the download engine, the download list, the history,
    /// the settings and the live speed graph.
    /// </summary>
    public sealed class MainViewModel : ViewModelBase, IDisposable
    {
        private readonly Dispatcher _dispatcher;
        private readonly DownloadEngine _engine;
        private readonly DownloadHistory _history;
        private readonly AppSettings _settings;
        private readonly string _settingsPath;
        private readonly DispatcherTimer _uiTimer;

        private string _urlInput = string.Empty;
        private string _destinationFolder;
        private DownloadMode _selectedMode;
        private bool _isHistoryVisible;
        private string _totalSpeedText = "—";
        private string _activeConnectionsText = "0";
        private string _statusMessage = "Ready. Paste a direct HTTP/HTTPS link and press Download.";
        private bool _hasError;
        private string? _errorText;
        private bool _isDarkTheme = true;

        public MainViewModel()
        {
            _dispatcher = Application.Current?.Dispatcher ?? Dispatcher.CurrentDispatcher;

            _settingsPath = AppSettings.GetDefaultSettingsPath();
            _settings = AppSettings.Load(_settingsPath);
            _destinationFolder = _settings.DestinationFolder;
            _selectedMode = _settings.DefaultMode;

            var engineOptions = _settings.ToEngineOptions();
            _engine = new DownloadEngine(engineOptions);

            var historyPath = AppSettings.GetDefaultHistoryPath();
            _history = new DownloadHistory(historyPath, _settings.HistoryCapacity);

            Downloads = new ObservableCollection<DownloadItemViewModel>();
            HistoryEntries = new ObservableCollection<HistoryEntry>();
            foreach (var entry in _history.Entries)
                HistoryEntries.Add(entry);

            Graph = new SpeedGraphViewModel();

            _engine.ItemAdded += OnItemAdded;
            _engine.ItemCompleted += OnItemCompleted;
            _engine.ItemFailed += OnItemFailed;

            AddDownloadCommand = new RelayCommand(AddDownload, () => !string.IsNullOrWhiteSpace(UrlInput));
            PauseAllCommand = new RelayCommand(() => _ = PauseAllAsync(), () => Downloads.Any(d => d.Status == DownloadStatus.Downloading));
            ResumeAllCommand = new RelayCommand(() => _ = ResumeAllAsync(), () => Downloads.Any(d => d.Status == DownloadStatus.Paused));
            CancelAllCommand = new RelayCommand(() => _ = _engine.CancelAllAsync(), () => Downloads.Any(d => d.IsActive || d.IsPaused));
            ClearCompletedCommand = new RelayCommand(ClearCompleted, () => Downloads.Any(d => d.IsTerminal));
            OpenDownloadFolderCommand = new RelayCommand(OpenDownloadFolder);
            ToggleHistoryCommand = new RelayCommand(() => IsHistoryVisible = !IsHistoryVisible);
            ToggleThemeCommand = new RelayCommand(ToggleTheme);
            OpenSettingsCommand = new RelayCommand(OpenSettings);
            BrowseDestinationCommand = new RelayCommand(BrowseDestination);
            ClearHistoryCommand = new RelayCommand(() => { _history.Clear(); HistoryEntries.Clear(); });
            RemoveHistoryEntryCommand = new RelayCommand(
                p => { if (p is HistoryEntry entry) { _history.Remove(entry.Id); HistoryEntries.Remove(entry); } });

            LowModeCommand = new RelayCommand(() => SelectedMode = DownloadMode.Low);
            MediumModeCommand = new RelayCommand(() => SelectedMode = DownloadMode.Medium);
            ProModeCommand = new RelayCommand(() => SelectedMode = DownloadMode.Pro);

            _isDarkTheme = _settings.Theme != "Light";
            ThemeService.Apply(_isDarkTheme ? "Dark" : "Light");

            _uiTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            _uiTimer.Tick += OnUiTimerTick;
            _uiTimer.Start();
        }

        public ObservableCollection<DownloadItemViewModel> Downloads { get; }
        public ObservableCollection<HistoryEntry> HistoryEntries { get; }
        public SpeedGraphViewModel Graph { get; }

        public ICommand AddDownloadCommand { get; }
        public ICommand PauseAllCommand { get; }
        public ICommand ResumeAllCommand { get; }
        public ICommand CancelAllCommand { get; }
        public ICommand ClearCompletedCommand { get; }
        public ICommand OpenDownloadFolderCommand { get; }
        public ICommand ToggleHistoryCommand { get; }
        public ICommand ToggleThemeCommand { get; }
        public ICommand OpenSettingsCommand { get; }
        public ICommand BrowseDestinationCommand { get; }
        public ICommand ClearHistoryCommand { get; }
        public ICommand RemoveHistoryEntryCommand { get; }
        public ICommand LowModeCommand { get; }
        public ICommand MediumModeCommand { get; }
        public ICommand ProModeCommand { get; }

        public string UrlInput
        {
            get => _urlInput;
            set { if (Set(ref _urlInput, value)) CommandManager.InvalidateRequerySuggested(); }
        }

        public string DestinationFolder
        {
            get => _destinationFolder;
            set => Set(ref _destinationFolder, value);
        }

        public DownloadMode SelectedMode
        {
            get => _selectedMode;
            set
            {
                if (Set(ref _selectedMode, value))
                {
                    RaisePropertyChanged(nameof(IsLowMode));
                    RaisePropertyChanged(nameof(IsMediumMode));
                    RaisePropertyChanged(nameof(IsProMode));
                }
            }
        }

        public bool IsLowMode
        {
            get => SelectedMode == DownloadMode.Low;
            set { if (value) SelectedMode = DownloadMode.Low; }
        }

        public bool IsMediumMode
        {
            get => SelectedMode == DownloadMode.Medium;
            set { if (value) SelectedMode = DownloadMode.Medium; }
        }

        public bool IsProMode
        {
            get => SelectedMode == DownloadMode.Pro;
            set { if (value) SelectedMode = DownloadMode.Pro; }
        }

        public bool IsHistoryVisible
        {
            get => _isHistoryVisible;
            set => Set(ref _isHistoryVisible, value);
        }

        public string TotalSpeedText { get => _totalSpeedText; private set => Set(ref _totalSpeedText, value); }
        public string ActiveConnectionsText { get => _activeConnectionsText; private set => Set(ref _activeConnectionsText, value); }
        public string StatusMessage { get => _statusMessage; private set => Set(ref _statusMessage, value); }

        public string? ErrorText
        {
            get => _errorText;
            private set { if (Set(ref _errorText, value)) HasError = value != null; }
        }

        public bool HasError { get => _hasError; private set => Set(ref _hasError, value); }

        public bool IsDarkTheme
        {
            get => _isDarkTheme;
            private set => Set(ref _isDarkTheme, value);
        }

        public AppSettings Settings => _settings;
        public DownloadEngine Engine => _engine;

        // ---------------------------------------------------------------------
        //  Commands
        // ---------------------------------------------------------------------

        private void AddDownload()
        {
            var url = UrlInput.Trim();
            if (url.Length == 0)
                return;

            try
            {
                ErrorText = null;
                var item = _engine.StartDownload(url, DestinationFolder, SelectedMode);
                StatusMessage = $"Downloading {item.FileName}…";
            }
            catch (ArgumentException ex)
            {
                ErrorText = ex.Message;
            }
            catch (Exception ex)
            {
                ErrorText = ex.Message;
            }
        }

        private async Task PauseAllAsync()
        {
            foreach (var vm in Downloads.ToList())
                if (vm.Status == DownloadStatus.Downloading || vm.Status == DownloadStatus.Probing)
                    await _engine.PauseAsync(vm.Item);
        }

        private async Task ResumeAllAsync()
        {
            foreach (var vm in Downloads.ToList())
                if (vm.Status == DownloadStatus.Paused)
                    await _engine.ResumeAsync(vm.Item);
        }

        private void ClearCompleted()
        {
            foreach (var vm in Downloads.Where(d => d.IsTerminal).ToList())
                Downloads.Remove(vm);
        }

        private void OpenDownloadFolder()
        {
            try
            {
                var folder = DestinationFolder;
                if (!Directory.Exists(folder))
                    Directory.CreateDirectory(folder);
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                ErrorText = ex.Message;
            }
        }

        private void ToggleTheme()
        {
            ThemeService.Toggle();
            IsDarkTheme = ThemeService.CurrentTheme == "Dark";
            _settings.Theme = ThemeService.CurrentTheme;
            SaveSettings();
        }

        private void OpenSettings()
        {
            var window = new SettingsWindow(_settings, this) { Owner = Application.Current?.MainWindow };
            window.ShowDialog();
        }

        private void BrowseDestination()
        {
            var dialog = new OpenFolderDialog
            {
                Title = "Choose the download folder",
                InitialDirectory = Directory.Exists(DestinationFolder) ? DestinationFolder : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            };
            if (dialog.ShowDialog() == true)
            {
                DestinationFolder = dialog.FolderName;
                _settings.DestinationFolder = DestinationFolder;
                SaveSettings();
            }
        }

        /// <summary>Called by the settings window when the user saves.</summary>
        public void ApplySettings()
        {
            _settings.ApplyEngineOptions(_engine.Options);
            _engine.Options.ValidateAndClamp();
            _settings.DestinationFolder = DestinationFolder;
            _settings.DefaultMode = SelectedMode;
            _settings.Theme = ThemeService.CurrentTheme;
            SaveSettings();
            StatusMessage = "Settings saved.";
        }

        public void SaveSettings() => _settings.Save(_settingsPath);

        // ---------------------------------------------------------------------
        //  Engine events
        // ---------------------------------------------------------------------

        private void OnItemAdded(object? sender, DownloadItem item)
        {
            _dispatcher.BeginInvoke(new Action(() =>
            {
                var vm = new DownloadItemViewModel(item, _engine, _dispatcher);
                vm.Removed += OnItemRemoved;
                Downloads.Insert(0, vm);
            }));
        }

        private void OnItemRemoved(object? sender, EventArgs e)
        {
            if (sender is DownloadItemViewModel vm)
                Downloads.Remove(vm);
        }

        private void OnItemCompleted(object? sender, DownloadItem item)
        {
            _dispatcher.BeginInvoke(new Action(() =>
            {
                StatusMessage = $"Completed: {item.FileName}";
                AddHistoryEntry(item, DownloadStatus.Completed);
            }));
        }

        private void OnItemFailed(object? sender, DownloadItem item)
        {
            _dispatcher.BeginInvoke(new Action(() =>
            {
                StatusMessage = $"Failed: {item.FileName}";
                AddHistoryEntry(item, DownloadStatus.Failed);
            }));
        }

        private void AddHistoryEntry(DownloadItem item, DownloadStatus status)
        {
            var entry = new HistoryEntry
            {
                Id = item.Id,
                Url = item.Url,
                FileName = item.FileName,
                DestinationPath = item.FinalFilePath,
                TotalBytes = item.TotalBytes,
                DownloadedBytes = item.DownloadedBytes,
                Status = status,
                Mode = item.Mode,
                StartedAt = item.StartedAt ?? item.CreatedAt,
                CompletedAt = item.CompletedAt,
                AverageSpeedBytesPerSecond = item.AverageSpeedBytesPerSecond,
                DurationSeconds = item.Elapsed.TotalSeconds,
                ErrorMessage = item.ErrorMessage,
            };
            _history.Add(entry);
            HistoryEntries.Insert(0, entry);
        }

        // ---------------------------------------------------------------------
        //  UI timer (speed graph + totals)
        // ---------------------------------------------------------------------

        private void OnUiTimerTick(object? sender, EventArgs e)
        {
            double totalSpeed = _engine.TotalSpeedBytesPerSecond;
            TotalSpeedText = ByteFormatter.FormatSpeed(totalSpeed);
            ActiveConnectionsText = _engine.TotalActiveConnections.ToString();
            Graph.AddSample(totalSpeed);
        }

        // ---------------------------------------------------------------------
        //  Shutdown
        // ---------------------------------------------------------------------

        public void Dispose()
        {
            _uiTimer.Stop();
            _engine.ItemAdded -= OnItemAdded;
            _engine.ItemCompleted -= OnItemCompleted;
            _engine.ItemFailed -= OnItemFailed;
            _engine.Dispose();
        }
    }
}

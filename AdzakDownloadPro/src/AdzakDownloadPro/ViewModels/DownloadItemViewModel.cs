using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using AdzakDownloadPro.Core;

namespace AdzakDownloadPro.ViewModels
{
    /// <summary>
    /// Bindable wrapper around one <see cref="DownloadItem"/>. Engine callbacks arrive on
    /// thread-pool threads and are marshalled to the UI thread.
    /// </summary>
    public sealed class DownloadItemViewModel : ViewModelBase
    {
        private readonly DownloadEngine _engine;
        private readonly Dispatcher _dispatcher;

        private string _fileName = string.Empty;
        private string _statusText = string.Empty;
        private string _progressText = "0%";
        private string _sizeText = "—";
        private string _speedText = "—";
        private string _etaText = "--:--";
        private string _connectionsText = "—";
        private string _modeText = string.Empty;
        private string? _errorMessage;
        private double _progress;
        private bool _isIndeterminate;
        private bool _isActive;
        private bool _isPaused;
        private bool _isTerminal;
        private bool _hasError;

        public DownloadItemViewModel(DownloadItem item, DownloadEngine engine, Dispatcher dispatcher)
        {
            Item = item;
            _engine = engine;
            _dispatcher = dispatcher;

            _fileName = string.IsNullOrEmpty(item.FileName) ? item.Url : item.FileName;
            _modeText = item.Mode.ToString().ToUpperInvariant();
            _statusText = DescribeStatus(item.Status);

            item.Progress += OnProgress;
            item.StatusChanged += OnStatusChanged;

            PauseCommand = new RelayCommand(
                () => _ = engine.PauseAsync(item),
                () => item.Status == DownloadStatus.Downloading || item.Status == DownloadStatus.Probing);
            ResumeCommand = new RelayCommand(
                () => _ = engine.ResumeAsync(item),
                () => item.Status == DownloadStatus.Paused);
            CancelCommand = new RelayCommand(
                () => _ = engine.CancelAsync(item),
                () => item.Status != DownloadStatus.Completed && item.Status != DownloadStatus.Canceled);
            RetryCommand = new RelayCommand(
                () => _ = engine.RetryAsync(item),
                () => item.Status == DownloadStatus.Failed || item.Status == DownloadStatus.Canceled);
            OpenFolderCommand = new RelayCommand(
                () => OpenFolder(item),
                () => item.Status == DownloadStatus.Completed);
            RemoveCommand = new RelayCommand(
                () => Removed?.Invoke(this, EventArgs.Empty),
                () => item.Status == DownloadStatus.Completed || item.Status == DownloadStatus.Failed
                    || item.Status == DownloadStatus.Canceled);

            RefreshFromItem();
        }

        public DownloadItem Item { get; }

        /// <summary>Raised when the user removes this entry from the list.</summary>
        public event EventHandler? Removed;

        public ICommand PauseCommand { get; }
        public ICommand ResumeCommand { get; }
        public ICommand CancelCommand { get; }
        public ICommand RetryCommand { get; }
        public ICommand OpenFolderCommand { get; }
        public ICommand RemoveCommand { get; }

        public string FileName { get => _fileName; private set => Set(ref _fileName, value); }
        public string Url => Item.Url;
        public string ModeText { get => _modeText; private set => Set(ref _modeText, value); }
        public string StatusText { get => _statusText; private set => Set(ref _statusText, value); }
        public string ProgressText { get => _progressText; private set => Set(ref _progressText, value); }
        public string SizeText { get => _sizeText; private set => Set(ref _sizeText, value); }
        public string SpeedText { get => _speedText; private set => Set(ref _speedText, value); }
        public string EtaText { get => _etaText; private set => Set(ref _etaText, value); }
        public string ConnectionsText { get => _connectionsText; private set => Set(ref _connectionsText, value); }
        public string? ErrorMessage { get => _errorMessage; private set { if (Set(ref _errorMessage, value)) HasError = value != null; } }

        public double Progress { get => _progress; private set => Set(ref _progress, value); }
        public bool IsIndeterminate { get => _isIndeterminate; private set => Set(ref _isIndeterminate, value); }
        public bool IsActive { get => _isActive; private set => Set(ref _isActive, value); }
        public bool IsPaused { get => _isPaused; private set => Set(ref _isPaused, value); }
        public bool IsTerminal { get => _isTerminal; private set => Set(ref _isTerminal, value); }
        public bool HasError { get => _hasError; private set => Set(ref _hasError, value); }

        /// <summary>True when the download is transferring (or about to).</summary>
        public bool CanPause => Item.Status == DownloadStatus.Downloading || Item.Status == DownloadStatus.Probing;

        /// <summary>True when the download is paused and can be resumed.</summary>
        public bool CanResume => Item.Status == DownloadStatus.Paused;

        /// <summary>True when the download failed or was canceled and can be retried.</summary>
        public bool CanRetry => Item.Status == DownloadStatus.Failed || Item.Status == DownloadStatus.Canceled;

        /// <summary>True when the download can be canceled.</summary>
        public bool CanCancel => Item.Status != DownloadStatus.Completed && Item.Status != DownloadStatus.Canceled;

        /// <summary>True when the finished file exists and its folder can be opened.</summary>
        public bool CanOpenFolder => Item.Status == DownloadStatus.Completed;

        public DownloadStatus Status => Item.Status;

        private void OnProgress(object? sender, DownloadProgress progress)
            => _dispatcher.BeginInvoke(new Action(() => RefreshFromItem()));

        private void OnStatusChanged(object? sender, EventArgs e)
            => _dispatcher.BeginInvoke(new Action(() => RefreshFromItem()));

        private void RefreshFromItem()
        {
            var item = Item;

            if (!string.IsNullOrEmpty(item.FileName))
                FileName = item.FileName;
            ModeText = item.Mode.ToString().ToUpperInvariant();
            StatusText = DescribeStatus(item.Status);
            ErrorMessage = item.Status == DownloadStatus.Failed ? item.ErrorMessage : null;

            Progress = item.Percent ?? 0;
            IsIndeterminate = item.TotalBytes == null && item.Status == DownloadStatus.Downloading;
            ProgressText = item.TotalBytes == null
                ? ByteFormatter.FormatSize(item.DownloadedBytes)
                : ByteFormatter.FormatPercent(item.Percent);

            SizeText = item.TotalBytes == null
                ? ByteFormatter.FormatSize(item.DownloadedBytes) + " / ?"
                : $"{ByteFormatter.FormatSize(item.DownloadedBytes)} / {ByteFormatter.FormatSize(item.TotalBytes.Value)}";

            SpeedText = item.Status == DownloadStatus.Downloading
                ? ByteFormatter.FormatSpeed(item.SpeedBytesPerSecond)
                : "—";
            EtaText = item.EtaSeconds == null ? "--:--" : ByteFormatter.FormatEta(item.EtaSeconds);
            ConnectionsText = item.ActiveConnections > 0 ? item.ActiveConnections.ToString() : "—";

            IsActive = item.Status == DownloadStatus.Queued || item.Status == DownloadStatus.Probing
                || item.Status == DownloadStatus.Downloading || item.Status == DownloadStatus.Merging
                || item.Status == DownloadStatus.Verifying || item.Status == DownloadStatus.Pausing;
            IsPaused = item.Status == DownloadStatus.Paused;
            IsTerminal = item.Status == DownloadStatus.Completed || item.Status == DownloadStatus.Failed
                || item.Status == DownloadStatus.Canceled;

            RaisePropertyChanged(nameof(CanPause));
            RaisePropertyChanged(nameof(CanResume));
            RaisePropertyChanged(nameof(CanRetry));
            RaisePropertyChanged(nameof(CanCancel));
            RaisePropertyChanged(nameof(CanOpenFolder));
        }

        private static string DescribeStatus(DownloadStatus status) => status switch
        {
            DownloadStatus.Queued => "Queued",
            DownloadStatus.Probing => "Probing…",
            DownloadStatus.Downloading => "Downloading",
            DownloadStatus.Merging => "Merging…",
            DownloadStatus.Verifying => "Verifying…",
            DownloadStatus.Pausing => "Pausing…",
            DownloadStatus.Paused => "Paused",
            DownloadStatus.Completed => "Completed",
            DownloadStatus.Failed => "Failed",
            DownloadStatus.Canceled => "Canceled",
            _ => status.ToString(),
        };

        private static void OpenFolder(DownloadItem item)
        {
            try
            {
                var path = item.FinalFilePath;
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                    path = item.DestinationDirectory;
                if (Directory.Exists(path))
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
            }
            catch (Exception)
            {
                // Opening the folder is a convenience; never crash because of it.
            }
        }
    }
}

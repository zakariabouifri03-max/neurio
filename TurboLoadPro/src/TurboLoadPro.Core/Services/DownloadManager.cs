using System.Collections.Concurrent;
using System.Diagnostics;
using TurboLoadPro.Core.Engine;
using TurboLoadPro.Core.Models;
using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Storage;

namespace TurboLoadPro.Core.Services;

/// <summary>Persistent queue and concurrent-download scheduler.</summary>
public sealed class DownloadManager
{
    private readonly IDownloadStore _store;
    private readonly DownloadEngine _engine;
    private readonly BandwidthLimiter _bandwidthLimiter;
    private readonly ITransferLogger _logger;
    private readonly object _recordsLock = new();
    private readonly List<DownloadRecord> _records = [];
    private readonly ConcurrentDictionary<Guid, RunningHandle> _running = new();
    private readonly SemaphoreSlim _schedulerGate = new(1, 1);
    private readonly SemaphoreSlim _addGate = new(1, 1);
    private DownloadSettings _settings;
    private bool _initialized;
    private volatile bool _shuttingDown;

    public event EventHandler<DownloadChangedEventArgs>? DownloadChanged;

    public DownloadManager(
        IDownloadStore store,
        DownloadEngine engine,
        BandwidthLimiter bandwidthLimiter,
        DownloadSettings settings,
        ITransferLogger? logger = null)
    {
        _store = store;
        _engine = engine;
        _bandwidthLimiter = bandwidthLimiter;
        _settings = settings.Normalize().Clone();
        _logger = logger ?? new NullTransferLogger();
        _bandwidthLimiter.SetLimit(_settings.GlobalSpeedLimitBytesPerSecond);
    }

    public DownloadSettings CurrentSettings
    {
        get { lock (_recordsLock) return _settings.Clone(); }
    }

    public IReadOnlyList<DownloadRecord> GetSnapshot()
    {
        lock (_recordsLock)
            return _records.Select(record => record.Snapshot()).ToArray();
    }

    public async Task InitializeAsync(bool autoResumeInterrupted, CancellationToken cancellationToken = default)
    {
        if (_initialized) return;
        await _store.InitializeAsync(cancellationToken).ConfigureAwait(false);
        var recovered = await _store.LoadAllAsync(cancellationToken).ConfigureAwait(false);
        lock (_recordsLock)
        {
            foreach (var record in recovered)
            {
                try
                {
                    record.Url = UrlPolicy.Validate(record.Url).AbsoluteUri;
                    record.DestinationPath = Path.GetFullPath(record.DestinationPath);
                    record.FileName = Path.GetFileName(record.DestinationPath);
                    if (record.Segments.Any(segment => segment.Start < 0 || segment.End < segment.Start ||
                                                       segment.BytesReceived < 0 || segment.BytesReceived > segment.Length))
                    {
                        record.Segments = [];
                        record.DownloadedBytes = 0;
                    }
                    if (record.Status is DownloadStatus.Probing or DownloadStatus.Downloading ||
                        (record.Status == DownloadStatus.Queued && !autoResumeInterrupted))
                    {
                        record.Status = autoResumeInterrupted ? DownloadStatus.Queued : DownloadStatus.Paused;
                        record.SpeedBytesPerSecond = 0;
                        record.Error = null;
                        record.UpdatedUtc = DateTimeOffset.UtcNow;
                    }
                }
                catch (Exception exception) when (exception is ArgumentException or IOException or InvalidOperationException)
                {
                    record.Status = DownloadStatus.Failed;
                    record.Error = "Saved download state was invalid and could not be resumed.";
                    record.SpeedBytesPerSecond = 0;
                }
                _records.Add(record);
            }
        }

        foreach (var record in GetSnapshot())
            await _store.SaveAsync(record, cancellationToken).ConfigureAwait(false);
        _initialized = true;
        if (autoResumeInterrupted) await PumpAsync().ConfigureAwait(false);
    }

    public async Task<DownloadRecord> AddDownloadAsync(
        string url,
        string? destinationDirectory = null,
        DownloadPriority priority = DownloadPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        await _addGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var uri = UrlPolicy.Validate(url);
            var settings = CurrentSettings;
            var directory = Path.GetFullPath(string.IsNullOrWhiteSpace(destinationDirectory)
                ? settings.DownloadDirectory : destinationDirectory);
            Directory.CreateDirectory(directory);
            var fileName = FileNamePolicy.FromUrl(uri);
            string[] reserved;
            lock (_recordsLock)
                reserved = _records.Select(record => record.DestinationPath).ToArray();
            var reservedSet = new HashSet<string>(reserved, OperatingSystem.IsWindows()
                ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
            var destination = FileNamePolicy.CreateUniquePath(directory, fileName, reservedSet);
            var record = new DownloadRecord
            {
                Id = Guid.NewGuid(),
                Url = uri.AbsoluteUri,
                FileName = Path.GetFileName(destination),
                DestinationPath = destination,
                Priority = priority,
                Status = DownloadStatus.Queued,
                Connections = settings.ConnectionsPerDownload == 0 ? 8 : settings.ConnectionsPerDownload,
                CreatedUtc = DateTimeOffset.UtcNow,
                UpdatedUtc = DateTimeOffset.UtcNow
            };
            lock (_recordsLock) _records.Insert(0, record);
            try
            {
                await _store.SaveAsync(record, cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                lock (_recordsLock) _records.Remove(record);
                throw;
            }
            RaiseChanged(record.Snapshot());
            _logger.Write("download_queued", record.Id);
            await PumpAsync().ConfigureAwait(false);
            return record.Snapshot();
        }
        finally
        {
            _addGate.Release();
        }
    }

    public async Task PauseAsync(Guid id)
    {
        var record = FindRecord(id);
        if (record is null) return;
        if (_running.TryGetValue(id, out var handle))
        {
            handle.RequestStop(StopIntent.Pause);
            await handle.Stopped.Task.ConfigureAwait(false);
            return;
        }
        if (record.Status != DownloadStatus.Queued) return;
        lock (record.SyncRoot)
        {
            record.Status = DownloadStatus.Paused;
            record.SpeedBytesPerSecond = 0;
            record.UpdatedUtc = DateTimeOffset.UtcNow;
        }
        await SaveAndPublishAsync(record).ConfigureAwait(false);
    }

    public async Task ResumeAsync(Guid id)
    {
        var record = FindRecord(id);
        if (record is null || record.Status != DownloadStatus.Paused) return;
        lock (record.SyncRoot)
        {
            record.Status = DownloadStatus.Queued;
            record.Error = null;
            record.UpdatedUtc = DateTimeOffset.UtcNow;
        }
        await SaveAndPublishAsync(record).ConfigureAwait(false);
        await PumpAsync().ConfigureAwait(false);
    }

    public async Task RetryAsync(Guid id)
    {
        var record = FindRecord(id);
        if (record is null || record.Status is not (DownloadStatus.Failed or DownloadStatus.Cancelled)) return;
        lock (record.SyncRoot)
        {
            record.Status = DownloadStatus.Queued;
            record.Error = null;
            record.SpeedBytesPerSecond = 0;
            record.UpdatedUtc = DateTimeOffset.UtcNow;
        }
        await SaveAndPublishAsync(record).ConfigureAwait(false);
        await PumpAsync().ConfigureAwait(false);
    }

    public async Task RestartAsync(Guid id)
    {
        var record = FindRecord(id);
        if (record is null) return;
        if (_running.TryGetValue(id, out var handle))
        {
            handle.RequestStop(StopIntent.Cancel);
            await handle.Stopped.Task.ConfigureAwait(false);
        }
        DeletePartial(record);
        var configuredConnections = CurrentSettings.ConnectionsPerDownload;
        var restartConnections = configuredConnections == 0 ? 8 : configuredConnections;
        lock (record.SyncRoot)
        {
            record.Status = DownloadStatus.Queued;
            record.Error = null;
            record.TotalBytes = null;
            record.DownloadedBytes = 0;
            record.SpeedBytesPerSecond = 0;
            record.SupportsRanges = null;
            record.EntityTag = null;
            record.LastModified = null;
            record.Sha256 = null;
            record.Connections = restartConnections;
            record.Segments = [];
            record.UpdatedUtc = DateTimeOffset.UtcNow;
        }
        await SaveAndPublishAsync(record).ConfigureAwait(false);
        await PumpAsync().ConfigureAwait(false);
    }

    public async Task CancelAsync(Guid id)
    {
        var record = FindRecord(id);
        if (record is null || record.Status == DownloadStatus.Completed) return;
        if (_running.TryGetValue(id, out var handle))
        {
            handle.RequestStop(StopIntent.Cancel);
            await handle.Stopped.Task.ConfigureAwait(false);
            return;
        }
        DeletePartial(record);
        lock (record.SyncRoot)
        {
            record.Status = DownloadStatus.Cancelled;
            record.DownloadedBytes = 0;
            record.Segments = [];
            record.SpeedBytesPerSecond = 0;
            record.Error = null;
            record.UpdatedUtc = DateTimeOffset.UtcNow;
        }
        await SaveAndPublishAsync(record).ConfigureAwait(false);
    }

    public async Task SetPriorityAsync(Guid id, DownloadPriority priority)
    {
        var record = FindRecord(id);
        if (record is null || record.Status != DownloadStatus.Queued) return;
        lock (record.SyncRoot)
        {
            record.Priority = priority;
            record.UpdatedUtc = DateTimeOffset.UtcNow;
        }
        await SaveAndPublishAsync(record).ConfigureAwait(false);
        await PumpAsync().ConfigureAwait(false);
    }

    public async Task UpdateSettingsAsync(DownloadSettings settings)
    {
        var normalized = settings.Normalize().Clone();
        lock (_recordsLock) _settings = normalized;
        _bandwidthLimiter.SetLimit(normalized.GlobalSpeedLimitBytesPerSecond);
        await PumpAsync().ConfigureAwait(false);
    }

    public async Task ShutdownAsync()
    {
        _shuttingDown = true;
        await _schedulerGate.WaitAsync().ConfigureAwait(false);
        RunningHandle[] handles;
        try { handles = _running.Values.ToArray(); }
        finally { _schedulerGate.Release(); }
        foreach (var handle in handles)
        {
            handle.RequestStop(StopIntent.Pause);
        }
        await Task.WhenAll(handles.Select(handle => handle.Stopped.Task)).ConfigureAwait(false);
    }

    private async Task PumpAsync()
    {
        if (!_initialized || _shuttingDown) return;
        await _schedulerGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_shuttingDown) return;
            var maximum = CurrentSettings.MaxSimultaneousDownloads;
            while (_running.Count < maximum)
            {
                DownloadRecord? next;
                lock (_recordsLock)
                {
                    next = _records
                        .Where(record => record.Status == DownloadStatus.Queued && !_running.ContainsKey(record.Id))
                        .OrderByDescending(record => record.Priority)
                        .ThenBy(record => record.CreatedUtc)
                        .FirstOrDefault();
                }
                if (next is null) break;
                var handle = new RunningHandle();
                if (!_running.TryAdd(next.Id, handle))
                {
                    handle.Dispose();
                    continue;
                }
                lock (next.SyncRoot)
                {
                    if (next.Status != DownloadStatus.Queued)
                    {
                        _running.TryRemove(next.Id, out _);
                        handle.Dispose();
                        continue;
                    }
                    next.Status = DownloadStatus.Probing;
                    next.UpdatedUtc = DateTimeOffset.UtcNow;
                }
                _logger.Write("download_started", next.Id);
                _ = Task.Run(() => RunOneAsync(next, handle));
            }
        }
        finally
        {
            _schedulerGate.Release();
        }
    }

    private async Task RunOneAsync(DownloadRecord record, RunningHandle handle)
    {
        using var progressGate = new SemaphoreSlim(1, 1);
        var lastPublished = Stopwatch.GetTimestamp();
        var lastSaved = lastPublished;
        var lastSpeedSample = lastPublished;
        var lastSpeedBytes = record.DownloadedBytes;
        try
        {
            lock (record.SyncRoot)
            {
                record.Status = DownloadStatus.Probing;
                record.Error = null;
                record.SpeedBytesPerSecond = 0;
                record.UpdatedUtc = DateTimeOffset.UtcNow;
            }
            await SaveAndPublishAsync(record).ConfigureAwait(false);

            async ValueTask ReportProgressAsync(DownloadRecord _, bool force)
            {
                await progressGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
                try
                {
                    var now = Stopwatch.GetTimestamp();
                    var elapsed = Stopwatch.GetElapsedTime(lastSpeedSample, now);
                    if (elapsed >= TimeSpan.FromMilliseconds(250))
                    {
                        long currentBytes;
                        lock (record.SyncRoot)
                        {
                            currentBytes = record.DownloadedBytes;
                            record.SpeedBytesPerSecond = Math.Max(0, currentBytes - lastSpeedBytes) / elapsed.TotalSeconds;
                        }
                        lastSpeedBytes = currentBytes;
                        lastSpeedSample = now;
                    }
                    var snapshot = record.Snapshot();
                    if (force || Stopwatch.GetElapsedTime(lastPublished, now) >= TimeSpan.FromMilliseconds(250))
                    {
                        RaiseChanged(snapshot);
                        lastPublished = now;
                    }
                    if (force || Stopwatch.GetElapsedTime(lastSaved, now) >= TimeSpan.FromSeconds(1))
                    {
                        await _store.SaveAsync(snapshot).ConfigureAwait(false);
                        lastSaved = now;
                    }
                }
                finally
                {
                    progressGate.Release();
                }
            }

            await _engine.ExecuteAsync(record, CurrentSettings, ReportProgressAsync, handle.Cancellation.Token)
                .ConfigureAwait(false);
            _logger.Write("download_completed", record.Id);
        }
        catch (OperationCanceledException) when (handle.Cancellation.IsCancellationRequested)
        {
            if (handle.Intent == StopIntent.Cancel)
            {
                DeletePartial(record);
                lock (record.SyncRoot)
                {
                    record.Status = DownloadStatus.Cancelled;
                    record.DownloadedBytes = 0;
                    record.Segments = [];
                    record.Error = null;
                }
                _logger.Write("download_cancelled", record.Id);
            }
            else
            {
                lock (record.SyncRoot)
                {
                    record.Status = DownloadStatus.Paused;
                    record.Error = null;
                }
                _logger.Write("download_paused", record.Id);
            }
        }
        catch (Exception exception)
        {
            lock (record.SyncRoot)
            {
                record.Status = DownloadStatus.Failed;
                record.Error = GetSafeError(exception);
            }
            _logger.Write("download_failed", record.Id, exception);
        }
        finally
        {
            lock (record.SyncRoot)
            {
                record.SpeedBytesPerSecond = 0;
                record.UpdatedUtc = DateTimeOffset.UtcNow;
            }
            try { await SaveAndPublishAsync(record).ConfigureAwait(false); }
            catch (Exception exception) { _logger.Write("state_save_failed", record.Id, exception); }
            _running.TryRemove(record.Id, out _);
            handle.Dispose();
            handle.Stopped.TrySetResult(true);
            _ = PumpAsync();
        }
    }

    private async Task SaveAndPublishAsync(DownloadRecord record)
    {
        var snapshot = record.Snapshot();
        await _store.SaveAsync(snapshot).ConfigureAwait(false);
        RaiseChanged(snapshot);
    }

    private void RaiseChanged(DownloadRecord snapshot)
    {
        var handlers = DownloadChanged;
        if (handlers is null) return;
        var args = new DownloadChangedEventArgs(snapshot);
        foreach (EventHandler<DownloadChangedEventArgs> handler in handlers.GetInvocationList())
        {
            try { handler(this, args); }
            catch (Exception exception) { _logger.Write("ui_observer_failed", snapshot.Id, exception); }
        }
    }

    private DownloadRecord? FindRecord(Guid id)
    {
        lock (_recordsLock) return _records.FirstOrDefault(record => record.Id == id);
    }

    private void DeletePartial(DownloadRecord record)
    {
        var path = record.DestinationPath + ".turbopart";
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            _logger.Write("partial_cleanup_failed", record.Id, exception);
        }
    }

    private static string GetSafeError(Exception exception) => exception switch
    {
        DownloadHttpException httpException => httpException.Message,
        DownloadStorageException => "Could not write to the selected destination. Check disk space and folder permissions.",
        UnauthorizedAccessException => "Access to the selected folder was denied. Choose another destination folder.",
        InvalidDataException => "The server returned inconsistent file data. The incomplete file was not published.",
        ArgumentException => "The download settings or destination path are invalid.",
        HttpRequestException or IOException => "A network or file-system error interrupted the download. You can retry it.",
        _ => "The download failed unexpectedly. Check the diagnostic log for details."
    };

    private void EnsureInitialized()
    {
        if (!_initialized) throw new InvalidOperationException("Initialize the download manager before adding downloads.");
    }

    private enum StopIntent { Pause = 0, Cancel = 1 }

    private sealed class RunningHandle : IDisposable
    {
        private int _intent;
        public CancellationTokenSource Cancellation { get; } = new();
        public TaskCompletionSource<bool> Stopped { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public StopIntent Intent => (StopIntent)Volatile.Read(ref _intent);
        public void RequestStop(StopIntent intent)
        {
            Interlocked.Exchange(ref _intent, (int)intent);
            try { Cancellation.Cancel(); }
            catch (ObjectDisposedException) { }
        }
        public void Dispose() => Cancellation.Dispose();
    }
}

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;

namespace AdzakDownloadPro.Core;

/// <summary>
/// Persistent, single-request-per-job HTTP download manager. Ranged jobs are kept as independently
/// checksummed byte-range files; a range is not considered complete until its bytes are flushed,
/// hashed and atomically recorded in the queue. A server that ignores Range is downloaded from
/// byte zero into a separate file so old partial data is never silently appended to a new version.
/// </summary>
public sealed class DownloadCoordinator : IAsyncDisposable
{
    private readonly DownloadQueueStore _store;
    private readonly INetworkMonitor _network;
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly DownloadEngineOptions _options;
    private readonly IClock _clock;
    private readonly SemaphoreSlim _downloadSlots;
    private readonly SemaphoreSlim _persistenceGate = new(1, 1);
    private readonly ConcurrentDictionary<Guid, DownloadJobRecord> _jobs = new();
    private readonly ConcurrentDictionary<Guid, JobRuntime> _runtimes = new();
    private volatile bool _initialized;
    private volatile bool _stopping;

    public DownloadCoordinator(
        DownloadQueueStore store,
        INetworkMonitor networkMonitor,
        HttpClient httpClient,
        DownloadEngineOptions? options = null,
        IClock? clock = null,
        bool ownsHttpClient = false)
    {
        _store = store;
        _network = networkMonitor;
        _httpClient = httpClient;
        _httpClient.Timeout = Timeout.InfiniteTimeSpan;
        _ownsHttpClient = ownsHttpClient;
        _options = options ?? new DownloadEngineOptions();
        _clock = clock ?? new SystemClock();
        if (_options.MaxConcurrentDownloads < 1)
            throw new ArgumentOutOfRangeException(nameof(options), "At least one download slot is required.");
        if (_options.SegmentSizeBytes < 1 || _options.CheckpointSizeBytes < 1)
            throw new ArgumentOutOfRangeException(nameof(options), "Segment and checkpoint sizes must be positive.");
        if (_options.RequestTimeout <= TimeSpan.Zero || _options.ConnectivityPollInterval <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(options), "Timeouts must be positive.");

        _downloadSlots = new SemaphoreSlim(_options.MaxConcurrentDownloads, _options.MaxConcurrentDownloads);
        _network.NetworkChanged += OnNetworkChanged;
    }

    public event EventHandler<DownloadProgressEventArgs>? JobChanged;

    public IReadOnlyList<DownloadJobRecord> Snapshot => _jobs.Values
        .OrderByDescending(job => job.CreatedAtUtc)
        .ToArray();

    public static DownloadCoordinator CreateDefault(
        DownloadQueueStore store,
        DownloadEngineOptions? options = null,
        IClock? clock = null)
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.None,
            UseCookies = true
        };
        var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        var monitor = new NetworkMonitor(client);
        return new DownloadCoordinator(store, monitor, client, options, clock, ownsHttpClient: true);
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized)
            return;

        var storedJobs = await _store.LoadAsync(cancellationToken).ConfigureAwait(false);
        foreach (var stored in storedJobs)
        {
            if (stored.Id == Guid.Empty || string.IsNullOrWhiteSpace(stored.Url) ||
                string.IsNullOrWhiteSpace(stored.DestinationPath))
                continue;

            var job = stored with
            {
                DestinationPath = Path.GetFullPath(stored.DestinationPath),
                WorkDirectory = MakeWorkDirectory(Path.GetFullPath(stored.DestinationPath), stored.Id),
                CurrentSpeedBytesPerSecond = 0
            };

            if (job.Status == DownloadStatus.Completed)
            {
                if (await IsFinalFileValidAsync(job, cancellationToken).ConfigureAwait(false))
                {
                    _jobs[job.Id] = job;
                    continue;
                }

                job = job with
                {
                    Status = DownloadStatus.Failed,
                    LastError = "The completed file no longer matches its saved size and checksum. Retry to download it again.",
                    NextRetryAtUtc = null
                };
            }
            else if (job.Status is DownloadStatus.Downloading or DownloadStatus.InternetDisconnected or
                     DownloadStatus.WaitingForInternet or DownloadStatus.Reconnecting or DownloadStatus.ResumingDownload)
            {
                job = job with { Status = DownloadStatus.Queued, CurrentSpeedBytesPerSecond = 0 };
            }

            job = await VerifyAndRepairLocalSegmentsAsync(job, cancellationToken).ConfigureAwait(false);
            _jobs[job.Id] = job;
            _runtimes[job.Id] = new JobRuntime(paused: job.Status == DownloadStatus.Paused);
        }

        await PersistAllAsync(cancellationToken).ConfigureAwait(false);
        _initialized = true;
        foreach (var job in Snapshot)
            RaiseJobChanged(job);
    }

    public async Task<DownloadJobRecord> AddAsync(
        string url,
        string destinationPath,
        bool overwriteExisting,
        CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("Enter a valid HTTP or HTTPS download URL.", nameof(url));
        if (string.IsNullOrWhiteSpace(destinationPath))
            throw new ArgumentException("Choose a destination file.", nameof(destinationPath));

        var destination = Path.GetFullPath(destinationPath);
        var parent = Path.GetDirectoryName(destination)
            ?? throw new ArgumentException("The destination must include a parent directory.", nameof(destinationPath));
        Directory.CreateDirectory(parent);
        if (File.Exists(destination) && !overwriteExisting)
            throw new IOException("The destination already exists. Confirm replacement or choose another file.");

        var id = Guid.NewGuid();
        var now = _clock.UtcNow;
        var job = new DownloadJobRecord
        {
            Id = id,
            Url = url,
            DestinationPath = destination,
            WorkDirectory = MakeWorkDirectory(destination, id),
            OverwriteExisting = overwriteExisting,
            Status = DownloadStatus.Queued,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        Directory.CreateDirectory(job.WorkDirectory);
        _jobs[id] = job;
        _runtimes[id] = new JobRuntime(paused: false);
        await PersistAllAsync(cancellationToken).ConfigureAwait(false);
        RaiseJobChanged(job);
        EnsureWorker(id);
        return job;
    }

    /// <summary>Resume only the jobs the user has explicitly approved after application startup.</summary>
    public async Task ResumePendingAsync(IEnumerable<Guid> jobIds, CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        foreach (var id in jobIds.Distinct())
        {
            if (!_jobs.TryGetValue(id, out var job) || job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
                continue;

            var runtime = _runtimes.GetOrAdd(id, _ => new JobRuntime(paused: false));
            runtime.Resume();
            runtime.SignalRetry();
            await UpdateJobAsync(id, current => current with
            {
                Status = DownloadStatus.Queued,
                NextRetryAtUtc = current.NextRetryAtUtc,
                CurrentSpeedBytesPerSecond = 0
            }, cancellationToken).ConfigureAwait(false);
            EnsureWorker(id);
        }
    }

    public async Task PauseAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        if (!_jobs.TryGetValue(id, out var job) || job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
            return;

        var runtime = _runtimes.GetOrAdd(id, _ => new JobRuntime(paused: false));
        runtime.Pause();
        await UpdateJobAsync(id, current => current with
        {
            Status = DownloadStatus.Paused,
            CurrentSpeedBytesPerSecond = 0
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task ResumeAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        if (!_jobs.TryGetValue(id, out var job) || job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
            return;

        var runtime = _runtimes.GetOrAdd(id, _ => new JobRuntime(paused: false));
        runtime.Resume();
        await UpdateJobAsync(id, current => current with
        {
            Status = DownloadStatus.Queued,
            CurrentSpeedBytesPerSecond = 0
        }, cancellationToken).ConfigureAwait(false);
        EnsureWorker(id);
    }

    public async Task RetryNowAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        if (!_jobs.TryGetValue(id, out var job) || job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
            return;

        var runtime = _runtimes.GetOrAdd(id, _ => new JobRuntime(paused: false));
        runtime.Resume();
        runtime.SignalRetry();
        await UpdateJobAsync(id, current => current with
        {
            Status = DownloadStatus.Queued,
            NextRetryAtUtc = null,
            CurrentSpeedBytesPerSecond = 0
        }, cancellationToken).ConfigureAwait(false);
        EnsureWorker(id);
    }

    /// <summary>Cancel is destructive only because the user explicitly invoked it.</summary>
    public async Task CancelAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        if (!_jobs.TryGetValue(id, out var job) || job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
            return;

        var runtime = _runtimes.GetOrAdd(id, _ => new JobRuntime(paused: false));
        runtime.CancelJob();
        Task? worker;
        lock (runtime.WorkerLock) worker = runtime.Worker;
        if (worker is not null)
        {
            try { await worker.WaitAsync(cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        }
        if (_jobs.TryGetValue(id, out var latest) && latest.Status != DownloadStatus.Cancelled)
            await MarkCancelledAndCleanAsync(id, cancellationToken).ConfigureAwait(false);
    }

    public async Task StopAsync()
    {
        if (_stopping)
            return;

        _stopping = true;
        foreach (var runtime in _runtimes.Values)
            runtime.StopForShutdown();

        var workers = _runtimes.Values
            .Select(runtime => runtime.Worker)
            .Where(task => task is not null)
            .Cast<Task>()
            .ToArray();
        try { await Task.WhenAll(workers).ConfigureAwait(false); }
        catch (OperationCanceledException) { }

        foreach (var job in Snapshot)
        {
            if (job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled or DownloadStatus.Failed)
                continue;
            var status = job.Status is DownloadStatus.Paused or DownloadStatus.Failed
                ? job.Status
                : DownloadStatus.Queued;
            await UpdateJobAsync(job.Id, current => current with
            {
                Status = status,
                CurrentSpeedBytesPerSecond = 0
            }).ConfigureAwait(false);
        }
        await PersistAllAsync().ConfigureAwait(false);
    }

    private void EnsureWorker(Guid id)
    {
        if (_stopping || !_runtimes.TryGetValue(id, out var runtime))
            return;

        lock (runtime.WorkerLock)
        {
            if (runtime.Worker is { IsCompleted: false })
                return;
            runtime.Worker = Task.Run(() => RunWorkerAsync(id, runtime));
        }
    }

    private async Task RunWorkerAsync(Guid id, JobRuntime runtime)
    {
        try
        {
            while (true)
            {
                var stopToken = runtime.StopToken;
                if (stopToken.IsCancellationRequested)
                {
                    if (runtime.IsExplicitlyCancelled)
                        await MarkCancelledAndCleanAsync(id).ConfigureAwait(false);
                    else
                        await SetRecoverableStatusAsync(id).ConfigureAwait(false);
                    return;
                }

                try
                {
                    await runtime.WaitUntilResumedAsync(stopToken).ConfigureAwait(false);
                    if (!_jobs.TryGetValue(id, out var job))
                        return;
                    if (job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
                        return;

                    if (job.Status == DownloadStatus.Failed)
                    {
                        await runtime.WaitForRetryAsync(stopToken).ConfigureAwait(false);
                        if (runtime.IsPaused)
                            continue;
                        await UpdateJobAsync(id, current => current with
                        {
                            Status = DownloadStatus.Queued,
                            NextRetryAtUtc = null,
                            CurrentSpeedBytesPerSecond = 0
                        }).ConfigureAwait(false);
                        continue;
                    }

                    if (!_network.IsNetworkAvailable)
                    {
                        await UpdateJobAsync(id, current => current with
                        {
                            Status = DownloadStatus.InternetDisconnected,
                            LastError = "The network interface is offline. Waiting for the connection to return."
                        }).ConfigureAwait(false);
                        using var offlineOperation = runtime.BeginOperation();
                        await WaitForNetworkOrRetryAsync(runtime, offlineOperation.Token).ConfigureAwait(false);
                        continue;
                    }

                    job = _jobs[id];
                    if (job.NextRetryAtUtc is { } retryAt && retryAt > _clock.UtcNow)
                    {
                        await UpdateJobAsync(id, current => current with
                        {
                            Status = DownloadStatus.Reconnecting,
                            CurrentSpeedBytesPerSecond = 0
                        }).ConfigureAwait(false);
                        using var backoffOperation = runtime.BeginOperation();
                        await WaitForWakeOrDelayAsync(runtime, retryAt - _clock.UtcNow, backoffOperation.Token)
                            .ConfigureAwait(false);
                        continue;
                    }

                    using var operation = runtime.BeginOperation();
                    if (job.RetryCount > 0 && !string.IsNullOrEmpty(job.LastError))
                    {
                        await UpdateJobAsync(id, current => current with
                        {
                            Status = DownloadStatus.WaitingForInternet,
                            CurrentSpeedBytesPerSecond = 0
                        }).ConfigureAwait(false);

                        var uri = new Uri(job.Url);
                        await _downloadSlots.WaitAsync(operation.Token).ConfigureAwait(false);
                        bool reachable;
                        try
                        {
                            reachable = await _network.IsInternetReachableAsync(uri, operation.Token).ConfigureAwait(false);
                        }
                        finally
                        {
                            _downloadSlots.Release();
                        }
                        if (!reachable)
                        {
                            await ScheduleRetryAsync(id,
                                "The download host is not reachable yet; checking again after a backoff delay.")
                                .ConfigureAwait(false);
                            continue;
                        }
                    }

                    job = _jobs[id];
                    await UpdateJobAsync(id, current => current with
                    {
                        Status = current.VerifiedBytes > 0
                            ? DownloadStatus.ResumingDownload
                            : DownloadStatus.Downloading,
                        NextRetryAtUtc = null
                    }).ConfigureAwait(false);

                    await _downloadSlots.WaitAsync(operation.Token).ConfigureAwait(false);
                    try
                    {
                        await DownloadNextStepAsync(id, operation.Token).ConfigureAwait(false);
                    }
                    finally
                    {
                        _downloadSlots.Release();
                    }

                    if (_jobs.TryGetValue(id, out var updated) && updated.Status == DownloadStatus.Completed)
                        return;
                }
                catch (OperationCanceledException) when (runtime.StopToken.IsCancellationRequested)
                {
                    if (runtime.IsExplicitlyCancelled)
                        await MarkCancelledAndCleanAsync(id).ConfigureAwait(false);
                    else
                        await SetRecoverableStatusAsync(id).ConfigureAwait(false);
                    return;
                }
                catch (OperationCanceledException) when (runtime.ConsumePauseInterrupt() || runtime.IsPaused)
                {
                    var stillPaused = runtime.IsPaused;
                    await UpdateJobAsync(id, current => current with
                    {
                        Status = stillPaused ? DownloadStatus.Paused : DownloadStatus.Queued,
                        CurrentSpeedBytesPerSecond = 0
                    }).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (runtime.ConsumeNetworkInterrupt() || !_network.IsNetworkAvailable)
                {
                    await ScheduleRetryAsync(id, "The network connection was interrupted. The verified partial data was kept.")
                        .ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    await ScheduleRetryAsync(id, "A network request timed out. The verified partial data was kept.")
                        .ConfigureAwait(false);
                }
                catch (DownloadException exception) when (exception.IsTransient)
                {
                    await ScheduleRetryAsync(id, exception.Message, exception.RetryAfter).ConfigureAwait(false);
                }
                catch (DownloadException exception)
                {
                    await MarkFailedAsync(id, exception.Message).ConfigureAwait(false);
                }
                catch (HttpRequestException exception)
                {
                    await ScheduleRetryAsync(id, FormatNetworkError(exception)).ConfigureAwait(false);
                }
                catch (IOException exception)
                {
                    await ScheduleRetryAsync(id, "Connection or local I/O was interrupted: " + exception.Message)
                        .ConfigureAwait(false);
                }
                catch (Exception exception)
                {
                    await MarkFailedAsync(id, "Unexpected download error: " + exception.Message).ConfigureAwait(false);
                }
            }
        }
        finally
        {
            lock (runtime.WorkerLock)
            {
                runtime.Worker = null;
            }
        }
    }

    private async Task DownloadNextStepAsync(Guid id, CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        if (job.Mode == TransferMode.FullRestart)
        {
            if (job.FullTransfer is { IsComplete: true })
                await FinalizeFullDownloadAsync(id, cancellationToken).ConfigureAwait(false);
            else
                await StartFullRestartAsync(id, cancellationToken).ConfigureAwait(false);
            return;
        }

        var committed = GetRangedByteCount(job);
        if (job.TotalBytes is { } knownTotal && committed == knownTotal && job.PartialRange is null)
        {
            await FinalizeRangedDownloadAsync(id, cancellationToken).ConfigureAwait(false);
            return;
        }

        // If the origin did not provide an HTTP validator, continuing an old byte range cannot be
        // proven safe. Retain the old segments and issue a clean full GET instead of combining versions.
        if (committed > 0 && !HasValidator(job))
        {
            await UpdateJobAsync(id, current => current with
            {
                Mode = TransferMode.FullRestart,
                RangeSupportKnown = current.RangeSupportKnown,
                LastError = "The server supplied no ETag or Last-Modified validator. Restarting from byte 0 safely; previous segments are preserved."
            }).ConfigureAwait(false);
            await StartFullRestartAsync(id, cancellationToken).ConfigureAwait(false);
            return;
        }

        job = await EnsurePartialRangeAsync(job).ConfigureAwait(false);
        var partialRange = job.PartialRange!;
        if (partialRange.BytesReceived > partialRange.ExpectedLength)
            throw new DownloadException("Saved range metadata is inconsistent; the incomplete segment was preserved.");

        var requestStart = partialRange.Start + partialRange.BytesReceived;
        var requestEnd = partialRange.Start + partialRange.ExpectedLength - 1;
        using var response = await SendRangeRequestAsync(job, requestStart, requestEnd, cancellationToken)
            .ConfigureAwait(false);

        if (response.StatusCode == HttpStatusCode.OK)
        {
            var changed = RemoteRepresentationChanged(job, response, response.Content.Headers.ContentLength);
            var note = changed
                ? "The remote file changed or its validators no longer match. Restarting from byte 0; old partial segments are preserved and will not be combined."
                : "The server refused the Range request. Restarting from byte 0 is unavoidable; old partial segments are preserved.";
            await UpdateJobAsync(id, current => current with
            {
                Mode = TransferMode.FullRestart,
                RangeSupportKnown = false,
                LastError = note,
                TotalBytes = response.Content.Headers.ContentLength ?? (changed ? null : current.TotalBytes),
                EntityTag = changed ? GetStrongEntityTag(response) : GetStrongEntityTag(response) ?? current.EntityTag,
                LastModifiedUtc = changed ? response.Content.Headers.LastModified : response.Content.Headers.LastModified ?? current.LastModifiedUtc
            }).ConfigureAwait(false);
            await ConsumeFullResponseAsync(id, response, cancellationToken).ConfigureAwait(false);
            return;
        }

        if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
        {
            var serverLength = response.Content.Headers.ContentRange?.Length;
            job = _jobs[id];
            if (serverLength == 0 && committed == 0)
            {
                await CompleteEmptyFileAsync(id).ConfigureAwait(false);
                return;
            }

            if (RemoteRepresentationChanged(job, response, serverLength))
            {
                await UpdateJobAsync(id, current => current with
                {
                    Mode = TransferMode.FullRestart,
                    LastError = "The remote file changed while paused. The old verified ranges were kept; downloading the new version from byte 0."
                }).ConfigureAwait(false);
                await StartFullRestartAsync(id, cancellationToken).ConfigureAwait(false);
                return;
            }

            if (serverLength is { } length && length == GetRangedByteCount(job) &&
                (job.TotalBytes is null || job.TotalBytes == length))
            {
                if (job.PartialRange is { } completePartial &&
                    completePartial.BytesReceived == completePartial.ExpectedLength)
                    await PromoteCompletePartialRangeAsync(id).ConfigureAwait(false);
                await UpdateJobAsync(id, current => current with { TotalBytes = length }).ConfigureAwait(false);
                await FinalizeRangedDownloadAsync(id, cancellationToken).ConfigureAwait(false);
                return;
            }

            if (serverLength is { } changedLength && job.TotalBytes is { } oldLength && changedLength != oldLength)
            {
                await UpdateJobAsync(id, current => current with
                {
                    Mode = TransferMode.FullRestart,
                    LastError = "The remote file size changed while the download was paused. Restarting the new version from byte 0; old ranges are preserved.",
                    TotalBytes = changedLength
                }).ConfigureAwait(false);
                await StartFullRestartAsync(id, cancellationToken).ConfigureAwait(false);
                return;
            }

            throw new DownloadException("The server rejected the requested byte range (HTTP 416). The partial file was retained.");
        }

        if (response.StatusCode != HttpStatusCode.PartialContent)
            throw BuildHttpError(response);

        var contentRange = response.Content.Headers.ContentRange;
        if (contentRange is null || !string.Equals(contentRange.Unit, "bytes", StringComparison.OrdinalIgnoreCase) ||
            contentRange.From is null || contentRange.To is null || contentRange.From.Value != requestStart ||
            contentRange.To.Value < contentRange.From.Value || contentRange.To.Value > requestEnd)
            throw new DownloadException("The server returned an invalid Content-Range header. No bytes were appended.");

        var rangeLength = contentRange.To.Value - contentRange.From.Value + 1;
        if (response.Content.Headers.ContentLength is { } responseLength && responseLength != rangeLength)
            throw new DownloadException("Content-Length does not match Content-Range. No bytes were appended.");

        if (RemoteRepresentationChanged(job, response, contentRange.Length))
        {
            await UpdateJobAsync(id, current => current with
            {
                Mode = TransferMode.FullRestart,
                LastError = "The remote file changed while paused. The old segments were kept; downloading the new version from byte 0."
            }).ConfigureAwait(false);
            await StartFullRestartAsync(id, cancellationToken).ConfigureAwait(false);
            return;
        }

        if (contentRange.Length is { } responseTotal && job.TotalBytes is { } previousTotal && responseTotal != previousTotal)
        {
            await UpdateJobAsync(id, current => current with
            {
                Mode = TransferMode.FullRestart,
                LastError = "The remote file size changed. Starting a clean download of the new version from byte 0."
            }).ConfigureAwait(false);
            await StartFullRestartAsync(id, cancellationToken).ConfigureAwait(false);
            return;
        }

        var expectedEnd = contentRange.Length is { } total ? Math.Min(requestEnd, total - 1) : contentRange.To.Value;
        if (contentRange.To.Value != expectedEnd)
            throw new DownloadException("The server returned an incomplete or inconsistent byte range. No bytes were appended.");

        var expectedForSegment = partialRange.BytesReceived == 0 && partialRange.Start == requestStart
            ? rangeLength
            : partialRange.ExpectedLength;
        if (partialRange.BytesReceived + rangeLength != expectedForSegment)
            throw new DownloadException("The server's byte range does not complete the saved segment. The existing partial data was retained.");

        job = await UpdateJobAsync(id, current => current with
        {
            Mode = TransferMode.Ranged,
            RangeSupportKnown = true,
            TotalBytes = contentRange.Length ?? current.TotalBytes,
            EntityTag = GetStrongEntityTag(response) ?? current.EntityTag,
            LastModifiedUtc = response.Content.Headers.LastModified ?? current.LastModifiedUtc,
            PartialRange = current.PartialRange is { } existing
                ? existing with { ExpectedLength = expectedForSegment }
                : current.PartialRange
        }).ConfigureAwait(false);

        await ConsumeRangeResponseAsync(id, response, expectedForSegment, cancellationToken).ConfigureAwait(false);
        job = _jobs[id];
        if (job.TotalBytes is { } totalBytes && GetRangedByteCount(job) == totalBytes && job.PartialRange is null)
            await FinalizeRangedDownloadAsync(id, cancellationToken).ConfigureAwait(false);
    }

    private async Task<DownloadJobRecord> EnsurePartialRangeAsync(DownloadJobRecord job)
    {
        if (job.PartialRange is not null)
            return job;

        var start = GetRangedByteCount(job);
        if (job.TotalBytes is { } total && start >= total)
            return job;

        var expected = job.TotalBytes is { } length
            ? checked((int)Math.Min(_options.SegmentSizeBytes, length - start))
            : _options.SegmentSizeBytes;
        if (expected <= 0)
            throw new DownloadException("The server reported an invalid file length.");

        Directory.CreateDirectory(job.WorkDirectory);
        var path = Path.Combine(job.WorkDirectory, $"range-{start:D20}-{Guid.NewGuid():N}.part");
        var partialRange = new PartialRange(start, expected, 0, path, EmptySha256);
        return await UpdateJobAsync(job.Id, current => current with
        {
            PartialRange = partialRange,
            TemporaryFiles = AddUnique(current.TemporaryFiles, path)
        }).ConfigureAwait(false);
    }

    private async Task<HttpResponseMessage> SendRangeRequestAsync(
        DownloadJobRecord job,
        long start,
        long end,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, job.Url);
        request.Headers.Range = new RangeHeaderValue(start, end);
        request.Headers.AcceptEncoding.ParseAdd("identity");
        AddIfRangeHeader(request, job);
        return await SendAsync(request, cancellationToken).ConfigureAwait(false);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_options.RequestTimeout);
        try
        {
            return await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new DownloadException("The server did not answer before the connection timed out.", isTransient: true);
        }
        catch (HttpRequestException exception)
        {
            throw new DownloadException(FormatNetworkError(exception), isTransient: true);
        }
        catch (IOException exception)
        {
            throw new DownloadException("The network connection failed while opening the response: " + exception.Message,
                isTransient: true);
        }
    }

    private async Task ConsumeRangeResponseAsync(
        Guid id,
        HttpResponseMessage response,
        long expectedLength,
        CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        var partialRange = job.PartialRange!;
        Directory.CreateDirectory(job.WorkDirectory);
        await using var file = new FileStream(
            partialRange.Path,
            FileMode.OpenOrCreate,
            FileAccess.ReadWrite,
            FileShare.ReadWrite,
            bufferSize: 128 * 1024,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);

        if (file.Length < partialRange.BytesReceived)
        {
            var actual = file.Length;
            var actualHash = await HashPrefixAsync(partialRange.Path, actual, CancellationToken.None).ConfigureAwait(false);
            partialRange = partialRange with { BytesReceived = actual, Sha256 = actualHash };
            job = await UpdateJobAsync(id, current => current with { PartialRange = partialRange }).ConfigureAwait(false);
        }
        else if (file.Length > partialRange.BytesReceived)
        {
            file.SetLength(partialRange.BytesReceived);
        }

        file.Position = partialRange.BytesReceived;
        var received = partialRange.BytesReceived;
        var lastCheckpoint = received;
        var buffer = new byte[Math.Min(128 * 1024, Math.Max(1, _options.CheckpointSizeBytes))];
        var speed = new SpeedWindow();

        try
        {
            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            while (received < expectedLength)
            {
                var wanted = (int)Math.Min(buffer.Length, expectedLength - received);
                var read = await ReadWithTimeoutAsync(body, buffer.AsMemory(0, wanted), cancellationToken)
                    .ConfigureAwait(false);
                if (read == 0)
                {
                    await CommitPartialRangeAsync(id, file, received, partialRange, force: true).ConfigureAwait(false);
                    throw new DownloadException("The connection ended before the requested byte range was complete.",
                        isTransient: true);
                }

                await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                received += read;
                speed.Add(read);
                PublishSpeed(id, speed.GetBytesPerSecond());

                if (received - lastCheckpoint >= _options.CheckpointSizeBytes)
                {
                    await CommitPartialRangeAsync(id, file, received, partialRange, force: true).ConfigureAwait(false);
                    lastCheckpoint = received;
                    partialRange = _jobs[id].PartialRange!;
                }
            }
        }
        catch (OperationCanceledException)
        {
            await CommitPartialRangeAsync(id, file, received, partialRange, force: true).ConfigureAwait(false);
            throw;
        }
        catch (DownloadException)
        {
            await CommitPartialRangeAsync(id, file, received, partialRange, force: true).ConfigureAwait(false);
            throw;
        }
        catch (HttpRequestException exception)
        {
            await CommitPartialRangeAsync(id, file, received, partialRange, force: true).ConfigureAwait(false);
            throw new DownloadException("Connection interrupted while receiving a byte range: " + exception.Message,
                isTransient: true);
        }
        catch (IOException exception)
        {
            await CommitPartialRangeAsync(id, file, received, partialRange, force: true).ConfigureAwait(false);
            throw new DownloadException("Connection interrupted while receiving a byte range: " + exception.Message,
                isTransient: true);
        }

        await file.FlushAsync(CancellationToken.None).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
        var digest = await HashPrefixAsync(partialRange.Path, expectedLength, CancellationToken.None).ConfigureAwait(false);
        var range = new VerifiedRange(partialRange.Start, expectedLength, partialRange.Path, digest);
        await UpdateJobAsync(id, current => current with
        {
            VerifiedRanges = current.VerifiedRanges.Where(item => item.Start != range.Start).Append(range)
                .OrderBy(item => item.Start).ToList(),
            PartialRange = null,
            TotalBytes = current.TotalBytes,
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
    }

    private async Task CommitPartialRangeAsync(
        Guid id,
        FileStream file,
        long received,
        PartialRange partialRange,
        bool force)
    {
        if (!force)
            return;

        await file.FlushAsync(CancellationToken.None).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
        var hash = await HashPrefixAsync(partialRange.Path, received, CancellationToken.None).ConfigureAwait(false);
        await UpdateJobAsync(id, current => current with
        {
            PartialRange = partialRange with { BytesReceived = received, Sha256 = hash },
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
    }

    private async Task StartFullRestartAsync(Guid id, CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        using var request = new HttpRequestMessage(HttpMethod.Get, job.Url);
        request.Headers.AcceptEncoding.ParseAdd("identity");
        using var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.OK)
            throw BuildHttpError(response);

        await ConsumeFullResponseAsync(id, response, cancellationToken).ConfigureAwait(false);
    }

    private async Task ConsumeFullResponseAsync(
        Guid id,
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        Directory.CreateDirectory(job.WorkDirectory);
        var path = Path.Combine(job.WorkDirectory, $"full-{Guid.NewGuid():N}.part");
        var expectedTotal = response.Content.Headers.ContentLength;
        var transfer = new FullTransfer(path, 0, expectedTotal, EmptySha256, IsComplete: false);
        job = await UpdateJobAsync(id, current => current with
        {
            Mode = TransferMode.FullRestart,
            RangeSupportKnown = current.RangeSupportKnown ?? false,
            TotalBytes = expectedTotal,
            EntityTag = GetStrongEntityTag(response),
            LastModifiedUtc = response.Content.Headers.LastModified,
            PartialRange = null,
            FullTransfer = transfer,
            TemporaryFiles = AddUnique(current.TemporaryFiles, path)
        }).ConfigureAwait(false);

        await using var file = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.ReadWrite,
            bufferSize: 128 * 1024,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[Math.Min(128 * 1024, Math.Max(1, _options.CheckpointSizeBytes))];
        var received = 0L;
        var lastCheckpoint = 0L;
        var speed = new SpeedWindow();

        try
        {
            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            while (true)
            {
                var read = await ReadWithTimeoutAsync(body, buffer, cancellationToken).ConfigureAwait(false);
                if (read == 0)
                    break;

                await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                received += read;
                speed.Add(read);
                PublishSpeed(id, speed.GetBytesPerSecond());

                if (received - lastCheckpoint >= _options.CheckpointSizeBytes)
                {
                    await CommitFullTransferAsync(id, file, path, received, expectedTotal).ConfigureAwait(false);
                    lastCheckpoint = received;
                }
                if (expectedTotal is { } total && received > total)
                    throw new DownloadException("The response exceeded its advertised Content-Length. The response was not finalized.");
            }
        }
        catch (OperationCanceledException)
        {
            await CommitFullTransferAsync(id, file, path, received, expectedTotal).ConfigureAwait(false);
            throw;
        }
        catch (DownloadException)
        {
            await CommitFullTransferAsync(id, file, path, received, expectedTotal).ConfigureAwait(false);
            throw;
        }
        catch (HttpRequestException exception)
        {
            await CommitFullTransferAsync(id, file, path, received, expectedTotal).ConfigureAwait(false);
            throw new DownloadException("Connection interrupted while receiving the full response: " + exception.Message,
                isTransient: true);
        }
        catch (IOException exception)
        {
            await CommitFullTransferAsync(id, file, path, received, expectedTotal).ConfigureAwait(false);
            throw new DownloadException("Connection interrupted while receiving the full response: " + exception.Message,
                isTransient: true);
        }

        await file.FlushAsync(CancellationToken.None).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
        if (expectedTotal is { } advertised && advertised != received)
        {
            await CommitFullTransferAsync(id, file, path, received, expectedTotal).ConfigureAwait(false);
            throw new DownloadException("The response ended before its advertised Content-Length was received.",
                isTransient: true);
        }

        var digest = await HashPrefixAsync(path, received, CancellationToken.None).ConfigureAwait(false);
        transfer = new FullTransfer(path, received, expectedTotal ?? received, digest, IsComplete: true);
        await UpdateJobAsync(id, current => current with
        {
            FullTransfer = transfer,
            TotalBytes = received,
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
        await FinalizeFullDownloadAsync(id, cancellationToken).ConfigureAwait(false);
    }

    private async Task CommitFullTransferAsync(
        Guid id,
        FileStream file,
        string path,
        long received,
        long? expectedTotal)
    {
        await file.FlushAsync(CancellationToken.None).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
        var hash = await HashPrefixAsync(path, received, CancellationToken.None).ConfigureAwait(false);
        await UpdateJobAsync(id, current => current with
        {
            FullTransfer = new FullTransfer(path, received, expectedTotal, hash, IsComplete: false),
            TotalBytes = expectedTotal ?? current.TotalBytes,
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
    }

    private async Task PromoteCompletePartialRangeAsync(Guid id)
    {
        var job = _jobs[id];
        var partialRange = job.PartialRange;
        if (partialRange is null || partialRange.BytesReceived != partialRange.ExpectedLength ||
            !IsPathInWorkDirectory(job, partialRange.Path) || !File.Exists(partialRange.Path) ||
            new FileInfo(partialRange.Path).Length != partialRange.BytesReceived ||
            !HashEquals(await HashPrefixAsync(partialRange.Path, partialRange.BytesReceived, CancellationToken.None).ConfigureAwait(false), partialRange.Sha256))
            throw new DownloadException("The completed partial range failed its checksum and cannot be finalized.");

        var range = new VerifiedRange(partialRange.Start, partialRange.BytesReceived, partialRange.Path, partialRange.Sha256);
        await UpdateJobAsync(id, current => current with
        {
            VerifiedRanges = current.VerifiedRanges.Where(item => item.Start != range.Start).Append(range)
                .OrderBy(item => item.Start).ToList(),
            PartialRange = null
        }).ConfigureAwait(false);
    }

    private async Task CompleteEmptyFileAsync(Guid id)
    {
        var job = _jobs[id];
        Directory.CreateDirectory(job.WorkDirectory);
        var path = Path.Combine(job.WorkDirectory, $"empty-{Guid.NewGuid():N}.part");
        await File.WriteAllBytesAsync(path, Array.Empty<byte>(), CancellationToken.None).ConfigureAwait(false);
        await UpdateJobAsync(id, current => current with
        {
            Mode = TransferMode.FullRestart,
            RangeSupportKnown = true,
            TotalBytes = 0,
            FullTransfer = new FullTransfer(path, 0, 0, EmptySha256, IsComplete: true),
            TemporaryFiles = AddUnique(current.TemporaryFiles, path)
        }).ConfigureAwait(false);
        await FinalizeFullDownloadAsync(id, CancellationToken.None).ConfigureAwait(false);
    }

    private async Task FinalizeRangedDownloadAsync(Guid id, CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        var ranges = job.VerifiedRanges.OrderBy(range => range.Start).ToArray();
        var position = 0L;
        foreach (var range in ranges)
        {
            if (range.Start != position || range.Length <= 0)
                throw new DownloadException("The saved segments contain a missing or overlapping byte range.");
            if (!IsPathInWorkDirectory(job, range.Path) || !File.Exists(range.Path) ||
                new FileInfo(range.Path).Length != range.Length ||
                !HashEquals(await HashPrefixAsync(range.Path, range.Length, cancellationToken).ConfigureAwait(false), range.Sha256))
                throw new DownloadException("A downloaded segment failed its checksum. It will not be merged.");
            position += range.Length;
        }

        if (job.TotalBytes is not { } total || position != total || job.PartialRange is not null)
            throw new DownloadException("The download is incomplete; it cannot be marked completed.");

        await AssembleAndCommitAsync(id, ranges.Select(range => (range.Path, range.Length)), total, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task FinalizeFullDownloadAsync(Guid id, CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        var transfer = job.FullTransfer;
        if (transfer is null || !transfer.IsComplete || !IsPathInWorkDirectory(job, transfer.Path) ||
            !File.Exists(transfer.Path) || new FileInfo(transfer.Path).Length != transfer.BytesReceived ||
            !HashEquals(await HashPrefixAsync(transfer.Path, transfer.BytesReceived, cancellationToken).ConfigureAwait(false), transfer.Sha256))
            throw new DownloadException("The full response failed local length or checksum verification.");

        if (transfer.ExpectedLength is { } expected && expected != transfer.BytesReceived)
            throw new DownloadException("The full response is incomplete and cannot be finalized.");

        await AssembleAndCommitAsync(id, [(transfer.Path, transfer.BytesReceived)], transfer.BytesReceived, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task AssembleAndCommitAsync(
        Guid id,
        IEnumerable<(string Path, long Length)> pieces,
        long expectedLength,
        CancellationToken cancellationToken)
    {
        var job = _jobs[id];
        Directory.CreateDirectory(job.WorkDirectory);
        var assemblyPath = Path.Combine(job.WorkDirectory, "assembled.tmp");
        long written = 0;
        await using (var output = new FileStream(
            assemblyPath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 256 * 1024,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            foreach (var (path, length) in pieces)
            {
                if (!IsPathInWorkDirectory(job, path) || !File.Exists(path) || new FileInfo(path).Length != length)
                    throw new DownloadException("A temporary segment is missing or has an unexpected size.");

                await using var input = new FileStream(
                    path,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    bufferSize: 256 * 1024,
                    options: FileOptions.Asynchronous | FileOptions.SequentialScan);
                await input.CopyToAsync(output, 256 * 1024, cancellationToken).ConfigureAwait(false);
                written += length;
            }
            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
            output.Flush(flushToDisk: true);
        }

        if (written != expectedLength || new FileInfo(assemblyPath).Length != expectedLength)
            throw new DownloadException("The assembled file length does not match the verified byte ranges.");

        var finalHash = await HashPrefixAsync(assemblyPath, written, cancellationToken).ConfigureAwait(false);
        job = await UpdateJobAsync(id, current => current with
        {
            FinalSha256 = finalHash,
            TotalBytes = expectedLength
        }).ConfigureAwait(false);

        if (File.Exists(job.DestinationPath) && !job.OverwriteExisting)
            throw new DownloadException("The destination file appeared during the download. Choose a new path or confirm replacement.");

        File.Move(assemblyPath, job.DestinationPath, overwrite: job.OverwriteExisting);
        await UpdateJobAsync(id, current => current with
        {
            Status = DownloadStatus.Completed,
            TotalBytes = expectedLength,
            NextRetryAtUtc = null,
            CurrentSpeedBytesPerSecond = 0,
            UpdatedAtUtc = _clock.UtcNow
        }).ConfigureAwait(false);
        TryDeleteJobWorkDirectory(job);
    }

    private async Task<DownloadJobRecord> VerifyAndRepairLocalSegmentsAsync(
        DownloadJobRecord job,
        CancellationToken cancellationToken)
    {
        var root = job.WorkDirectory;
        Directory.CreateDirectory(root);

        if (job.Mode == TransferMode.FullRestart)
        {
            // Full GETs are deliberately not appended after a restart. Preserve any incomplete
            // response file, but request a fresh full body on the next attempt.
            if (job.FullTransfer is { IsComplete: true } transfer &&
                IsPathInWorkDirectory(job, transfer.Path) && File.Exists(transfer.Path) &&
                new FileInfo(transfer.Path).Length == transfer.BytesReceived &&
                HashEquals(await HashPrefixAsync(transfer.Path, transfer.BytesReceived, cancellationToken).ConfigureAwait(false), transfer.Sha256))
                return job;

            return job with { FullTransfer = null };
        }

        var validRanges = new List<VerifiedRange>();
        var expectedStart = 0L;
        var damaged = false;
        foreach (var range in job.VerifiedRanges.OrderBy(item => item.Start))
        {
            if (damaged || range.Start != expectedStart || range.Length <= 0 ||
                !IsPathInWorkDirectory(job, range.Path) || !File.Exists(range.Path) ||
                new FileInfo(range.Path).Length != range.Length ||
                !HashEquals(await HashPrefixAsync(range.Path, range.Length, cancellationToken).ConfigureAwait(false), range.Sha256))
            {
                damaged = true;
                continue;
            }
            validRanges.Add(range);
            expectedStart += range.Length;
        }

        var partialRange = job.PartialRange;
        if (partialRange is not null)
        {
            if (damaged || partialRange.Start != expectedStart || partialRange.ExpectedLength <= 0 ||
                partialRange.BytesReceived < 0 || partialRange.BytesReceived > partialRange.ExpectedLength ||
                !IsPathInWorkDirectory(job, partialRange.Path) || !File.Exists(partialRange.Path))
            {
                partialRange = null;
                damaged = true;
            }
            else
            {
                var actualLength = new FileInfo(partialRange.Path).Length;
                if (actualLength < partialRange.BytesReceived)
                {
                    partialRange = partialRange with
                    {
                        BytesReceived = actualLength,
                        Sha256 = await HashPrefixAsync(partialRange.Path, actualLength, cancellationToken).ConfigureAwait(false)
                    };
                }
                else
                {
                    if (actualLength > partialRange.BytesReceived)
                    {
                        await using var trim = new FileStream(partialRange.Path, FileMode.Open, FileAccess.Write, FileShare.Read);
                        trim.SetLength(partialRange.BytesReceived);
                        trim.Flush(flushToDisk: true);
                    }
                    var actualHash = await HashPrefixAsync(partialRange.Path, partialRange.BytesReceived, cancellationToken).ConfigureAwait(false);
                    if (!HashEquals(actualHash, partialRange.Sha256))
                    {
                        partialRange = null;
                        damaged = true;
                    }
                }
            }
        }

        if (partialRange is { } completePartial && completePartial.BytesReceived == completePartial.ExpectedLength)
        {
            validRanges.Add(new VerifiedRange(
                completePartial.Start,
                completePartial.BytesReceived,
                completePartial.Path,
                completePartial.Sha256));
            expectedStart += completePartial.BytesReceived;
            partialRange = null;
        }

        var lastError = damaged
            ? "A temporary segment was incomplete or corrupted. It was excluded from verified progress and will be downloaded again."
            : job.LastError;
        return job with
        {
            VerifiedRanges = validRanges,
            PartialRange = partialRange,
            LastError = lastError,
            Status = job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled or DownloadStatus.Failed or DownloadStatus.Paused
                ? job.Status
                : DownloadStatus.Queued
        };
    }

    private async Task<bool> IsFinalFileValidAsync(DownloadJobRecord job, CancellationToken cancellationToken)
    {
        if (!File.Exists(job.DestinationPath))
            return false;
        var file = new FileInfo(job.DestinationPath);
        if (job.TotalBytes is { } total && file.Length != total)
            return false;
        if (string.IsNullOrWhiteSpace(job.FinalSha256))
            return job.Status == DownloadStatus.Completed;
        return HashEquals(
            await HashPrefixAsync(job.DestinationPath, file.Length, cancellationToken).ConfigureAwait(false),
            job.FinalSha256);
    }

    private async Task<int> ReadWithTimeoutAsync(Stream stream, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_options.RequestTimeout);
        try
        {
            return await stream.ReadAsync(buffer, timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new DownloadException("The server stopped sending data and the read timed out.", isTransient: true);
        }
    }

    private async Task ScheduleRetryAsync(Guid id, string message, TimeSpan? retryAfter = null)
    {
        if (!_jobs.ContainsKey(id))
            return;

        var job = _jobs[id];
        var nextCount = checked(job.RetryCount + 1);
        TimeSpan[] delays = _options.RetryDelays.Length == 0
            ? new[] { TimeSpan.FromSeconds(2) }
            : _options.RetryDelays;
        var backoff = delays[Math.Min(nextCount - 1, delays.Length - 1)];
        if (retryAfter is { } serverDelay && serverDelay > backoff)
            backoff = serverDelay > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : serverDelay;
        if (backoff < TimeSpan.Zero)
            backoff = TimeSpan.Zero;

        var disconnected = !_network.IsNetworkAvailable;
        await UpdateJobAsync(id, current => current with
        {
            Status = disconnected ? DownloadStatus.InternetDisconnected : DownloadStatus.Reconnecting,
            RetryCount = nextCount,
            LastError = message,
            NextRetryAtUtc = _clock.UtcNow + backoff,
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
    }

    private async Task MarkFailedAsync(Guid id, string message)
    {
        if (!_jobs.ContainsKey(id))
            return;
        await UpdateJobAsync(id, current => current with
        {
            Status = DownloadStatus.Failed,
            LastError = message,
            NextRetryAtUtc = null,
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
    }

    private async Task MarkCancelledAndCleanAsync(Guid id, CancellationToken cancellationToken = default)
    {
        if (!_jobs.TryGetValue(id, out var job))
            return;
        await UpdateJobAsync(id, current => current with
        {
            Status = DownloadStatus.Cancelled,
            LastError = "Cancelled by the user. Partial files were removed on explicit cancellation.",
            NextRetryAtUtc = null,
            CurrentSpeedBytesPerSecond = 0
        }, cancellationToken).ConfigureAwait(false);
        TryDeleteJobWorkDirectory(_jobs[id]);
    }

    private async Task SetRecoverableStatusAsync(Guid id)
    {
        if (!_jobs.TryGetValue(id, out var job) || job.Status is DownloadStatus.Completed or DownloadStatus.Cancelled)
            return;

        await UpdateJobAsync(id, current => current with
        {
            Status = current.Status is DownloadStatus.Paused or DownloadStatus.Failed
                ? current.Status
                : DownloadStatus.Queued,
            CurrentSpeedBytesPerSecond = 0
        }).ConfigureAwait(false);
    }

    private async Task WaitForNetworkOrRetryAsync(JobRuntime runtime, CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var networkTask = _network.WaitForChangeAsync(_options.ConnectivityPollInterval, linked.Token);
        var wakeTask = runtime.WaitForWakeAsync(linked.Token);
        await Task.WhenAny(networkTask, wakeTask).ConfigureAwait(false);
        linked.Cancel();
        try { await Task.WhenAll(networkTask, wakeTask).ConfigureAwait(false); }
        catch (OperationCanceledException) { }
    }

    private async Task WaitForWakeOrDelayAsync(JobRuntime runtime, TimeSpan delay, CancellationToken cancellationToken)
    {
        if (delay <= TimeSpan.Zero)
            return;

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var delayTask = _clock.DelayAsync(delay, linked.Token);
        var networkTask = _network.WaitForChangeAsync(_options.ConnectivityPollInterval, linked.Token);
        var wakeTask = runtime.WaitForWakeAsync(linked.Token);
        await Task.WhenAny(delayTask, networkTask, wakeTask).ConfigureAwait(false);
        linked.Cancel();
        try { await Task.WhenAll(delayTask, networkTask, wakeTask).ConfigureAwait(false); }
        catch (OperationCanceledException) { }
    }

    private void OnNetworkChanged(object? sender, EventArgs e)
    {
        if (_stopping)
            return;

        var available = false;
        try { available = _network.IsNetworkAvailable; }
        catch (NetworkInformationException) { }

        foreach (var item in _jobs.Values)
        {
            if (item.Status is not (DownloadStatus.Downloading or DownloadStatus.ResumingDownload or
                DownloadStatus.WaitingForInternet or DownloadStatus.Reconnecting or DownloadStatus.InternetDisconnected))
                continue;
            if (!_runtimes.TryGetValue(item.Id, out var runtime))
                continue;

            if (!available)
            {
                runtime.InterruptForNetworkLoss();
                MarkNetworkDisconnectedImmediately(item.Id);
            }
            else
            {
                runtime.SignalWake();
            }
        }
    }

    private void MarkNetworkDisconnectedImmediately(Guid id)
    {
        if (!_jobs.TryGetValue(id, out var current))
            return;
        var updated = current with
        {
            Status = DownloadStatus.InternetDisconnected,
            LastError = "Network connectivity was lost. Waiting for a verified internet connection.",
            CurrentSpeedBytesPerSecond = 0,
            UpdatedAtUtc = _clock.UtcNow
        };
        if (_jobs.TryUpdate(id, updated, current))
            RaiseJobChanged(updated);
    }

    private async Task<DownloadJobRecord> UpdateJobAsync(
        Guid id,
        Func<DownloadJobRecord, DownloadJobRecord> updater,
        CancellationToken cancellationToken = default)
    {
        if (!_jobs.TryGetValue(id, out var before))
            throw new KeyNotFoundException($"Download job {id} was not found.");

        DownloadJobRecord after;
        while (true)
        {
            after = updater(before) with { UpdatedAtUtc = _clock.UtcNow };
            if (_jobs.TryUpdate(id, after, before))
                break;
            if (!_jobs.TryGetValue(id, out before))
                throw new KeyNotFoundException($"Download job {id} was not found.");
        }

        await PersistAllAsync(cancellationToken).ConfigureAwait(false);
        RaiseJobChanged(after);
        return after;
    }

    private void PublishSpeed(Guid id, long bytesPerSecond)
    {
        if (!_jobs.TryGetValue(id, out var current))
            return;
        var updated = current with { CurrentSpeedBytesPerSecond = Math.Max(0, bytesPerSecond) };
        _jobs.TryUpdate(id, updated, current);
        RaiseJobChanged(updated);
    }

    private async Task PersistAllAsync(CancellationToken cancellationToken = default)
    {
        await _persistenceGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _store.SaveAsync(_jobs.Values.ToArray(), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _persistenceGate.Release();
        }
    }

    private void RaiseJobChanged(DownloadJobRecord job)
    {
        try { JobChanged?.Invoke(this, new DownloadProgressEventArgs(job)); }
        catch { /* A view callback must never terminate a download worker. */ }
    }

    private void EnsureInitialized()
    {
        if (!_initialized)
            throw new InvalidOperationException("Call InitializeAsync before using the download queue.");
        if (_stopping)
            throw new ObjectDisposedException(nameof(DownloadCoordinator));
    }

    private static long GetRangedByteCount(DownloadJobRecord job) =>
        job.VerifiedRanges.Sum(range => range.Length) + (job.PartialRange?.BytesReceived ?? 0);

    private static string MakeWorkDirectory(string destination, Guid id)
    {
        var parent = Path.GetDirectoryName(destination)!;
        var name = Path.GetFileName(destination);
        return Path.Combine(parent, $".{name}.adz-{id:N}.parts");
    }

    private static bool IsPathInWorkDirectory(DownloadJobRecord job, string path)
    {
        try
        {
            var expectedRoot = Path.GetFullPath(MakeWorkDirectory(job.DestinationPath, job.Id))
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var fullPath = Path.GetFullPath(path);
            return fullPath.StartsWith(expectedRoot, OperatingSystem.IsWindows()
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal);
        }
        catch (Exception exception) when (exception is ArgumentException or IOException or NotSupportedException)
        {
            return false;
        }
    }

    private static List<string> AddUnique(IEnumerable<string> current, string path)
    {
        var items = current.ToList();
        if (!items.Contains(path, OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal))
            items.Add(path);
        return items;
    }

    private static void TryDeleteJobWorkDirectory(DownloadJobRecord job)
    {
        try
        {
            var safePath = MakeWorkDirectory(job.DestinationPath, job.Id);
            if (Directory.Exists(safePath))
                Directory.Delete(safePath, recursive: true);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static readonly string EmptySha256 = Convert.ToHexString(SHA256.HashData(Array.Empty<byte>())).ToLowerInvariant();

    private static async Task<string> HashPrefixAsync(string path, long length, CancellationToken cancellationToken)
    {
        if (length < 0)
            throw new ArgumentOutOfRangeException(nameof(length));
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite,
            bufferSize: 256 * 1024,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length < length)
            throw new EndOfStreamException("Temporary data is shorter than its saved byte range.");

        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[256 * 1024];
        var remaining = length;
        while (remaining > 0)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), cancellationToken)
                .ConfigureAwait(false);
            if (read == 0)
                throw new EndOfStreamException("Temporary data ended before its saved byte range.");
            hash.AppendData(buffer, 0, read);
            remaining -= read;
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static bool HashEquals(string left, string right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    private static bool HasValidator(DownloadJobRecord job) =>
        !string.IsNullOrWhiteSpace(job.EntityTag) || job.LastModifiedUtc is not null;

    private static void AddIfRangeHeader(HttpRequestMessage request, DownloadJobRecord job)
    {
        if (!string.IsNullOrWhiteSpace(job.EntityTag))
        {
            try
            {
                request.Headers.IfRange = new RangeConditionHeaderValue(EntityTagHeaderValue.Parse(job.EntityTag));
                return;
            }
            catch (FormatException) { /* A malformed saved tag is ignored; response validators are still checked. */ }
        }
        if (job.LastModifiedUtc is { } lastModified)
            request.Headers.IfRange = new RangeConditionHeaderValue(lastModified);
    }

    private static string? GetStrongEntityTag(HttpResponseMessage response)
    {
        var tag = response.Headers.ETag;
        return tag is { IsWeak: false } ? tag.ToString() : null;
    }

    private static bool RemoteRepresentationChanged(
        DownloadJobRecord previous,
        HttpResponseMessage response,
        long? responseTotal)
    {
        if (previous.TotalBytes is { } oldTotal && responseTotal is { } newTotal && oldTotal != newTotal)
            return true;
        if (previous.EntityTag is { Length: > 0 } oldTag && response.Headers.ETag is { } newTag &&
            !string.Equals(oldTag, newTag.ToString(), StringComparison.Ordinal))
            return true;
        if (previous.LastModifiedUtc is { } oldModified && response.Content.Headers.LastModified is { } newModified &&
            oldModified != newModified)
            return true;
        return false;
    }

    private static DownloadException BuildHttpError(HttpResponseMessage response)
    {
        var code = (int)response.StatusCode;
        var retryAfter = GetRetryAfter(response);
        if (response.StatusCode is HttpStatusCode.RequestTimeout || code is 425 or 429 || code >= 500)
            return new DownloadException($"Temporary server response: HTTP {code} {response.ReasonPhrase}.",
                isTransient: true, retryAfter);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return new DownloadException($"HTTP {code}: authentication failed or the signed download URL expired. Refresh the URL or credentials.");
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            return new DownloadException($"HTTP {code}: the remote file is unavailable. Check the URL.");
        return new DownloadException($"The server returned HTTP {code} {response.ReasonPhrase}.");
    }

    private static TimeSpan? GetRetryAfter(HttpResponseMessage response)
    {
        var retry = response.Headers.RetryAfter;
        if (retry?.Delta is { } delta)
            return delta;
        if (retry?.Date is { } date)
            return date - DateTimeOffset.UtcNow;
        return null;
    }

    private static void ThrowIfInvalidFullResponse(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden ||
            response.StatusCode == HttpStatusCode.NotFound || response.StatusCode == HttpStatusCode.Gone)
            throw BuildHttpError(response);
        if (response.StatusCode != HttpStatusCode.OK)
            throw BuildHttpError(response);
    }

    private static string FormatNetworkError(HttpRequestException exception)
    {
        var message = exception.Message;
        var marker = message.IndexOf("http", StringComparison.OrdinalIgnoreCase);
        if (marker >= 0)
        {
            var end = message.IndexOfAny([' ', ')', '\n', '\r'], marker);
            if (end < 0) end = message.Length;
            message = message.Remove(marker, end - marker).Insert(marker, "[download host]");
        }
        return "DNS, TLS or connection error: " + message;
    }

    private async Task MarkAsFullRestartAsync(Guid id, string reason, CancellationToken cancellationToken)
    {
        await UpdateJobAsync(id, current => current with
        {
            Mode = TransferMode.FullRestart,
            PartialRange = null,
            LastError = reason
        }, cancellationToken).ConfigureAwait(false);
    }

    private async ValueTask DisposeAsyncCore()
    {
        await StopAsync().ConfigureAwait(false);
        _network.NetworkChanged -= OnNetworkChanged;
        await _network.DisposeAsync().ConfigureAwait(false);
        if (_ownsHttpClient)
            _httpClient.Dispose();
        _downloadSlots.Dispose();
        _persistenceGate.Dispose();
    }

    public async ValueTask DisposeAsync() => await DisposeAsyncCore().ConfigureAwait(false);

    private sealed class SpeedWindow
    {
        private long _bytes;
        private long _lastTimestamp = Stopwatch.GetTimestamp();
        private long _rate;

        public void Add(int bytes)
        {
            _bytes += bytes;
            var now = Stopwatch.GetTimestamp();
            var elapsed = Stopwatch.GetElapsedTime(_lastTimestamp, now);
            if (elapsed < TimeSpan.FromMilliseconds(400))
                return;
            _rate = elapsed.TotalSeconds <= 0 ? 0 : (long)(_bytes / elapsed.TotalSeconds);
            _bytes = 0;
            _lastTimestamp = now;
        }

        public long GetBytesPerSecond() => _rate;
    }

    private sealed class JobRuntime
    {
        private readonly CancellationTokenSource _stop = new();
        private readonly AsyncManualResetEvent _resumeGate;
        private readonly Channel<byte> _wake = Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
        {
            SingleReader = false,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        private readonly Channel<byte> _retry = Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
        {
            SingleReader = false,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        private readonly object _operationLock = new();
        private CancellationTokenSource? _activeOperation;
        private int _paused;
        private int _pauseInterrupt;
        private int _explicitlyCancelled;
        private int _networkInterrupted;

        public JobRuntime(bool paused)
        {
            _paused = paused ? 1 : 0;
            _resumeGate = new AsyncManualResetEvent(initiallySet: !paused);
        }

        public object WorkerLock { get; } = new();
        public Task? Worker { get; set; }
        public CancellationToken StopToken => _stop.Token;
        public bool IsPaused => Volatile.Read(ref _paused) != 0;
        public bool IsExplicitlyCancelled => Volatile.Read(ref _explicitlyCancelled) != 0;

        public CancellationTokenSource BeginOperation()
        {
            var operation = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
            lock (_operationLock)
            {
                // Clear a stale pause only when no pause is currently requested. Pause() sets
                // the flag under this same lock before it cancels the active operation.
                if (!IsPaused)
                    Interlocked.Exchange(ref _pauseInterrupt, 0);
                _activeOperation = operation;
                if (IsPaused || IsExplicitlyCancelled)
                    TryCancel(operation);
            }
            return operation;
        }

        public void Pause()
        {
            Interlocked.Exchange(ref _paused, 1);
            _resumeGate.Reset();
            lock (_operationLock)
            {
                Interlocked.Exchange(ref _pauseInterrupt, 1);
                if (_activeOperation is not null)
                    TryCancel(_activeOperation);
            }
            SignalWake();
        }

        public void Resume()
        {
            Interlocked.Exchange(ref _paused, 0);
            _resumeGate.Set();
            SignalWake();
        }

        public void CancelJob()
        {
            Interlocked.Exchange(ref _explicitlyCancelled, 1);
            try { _stop.Cancel(); } catch (ObjectDisposedException) { }
            _resumeGate.Set();
            SignalWake();
            SignalRetry();
        }

        public void StopForShutdown()
        {
            try { _stop.Cancel(); } catch (ObjectDisposedException) { }
            _resumeGate.Set();
            SignalWake();
            SignalRetry();
        }

        public void InterruptForNetworkLoss()
        {
            Interlocked.Exchange(ref _networkInterrupted, 1);
            CancelActiveOperation();
            SignalWake();
        }

        public bool ConsumeNetworkInterrupt() => Interlocked.Exchange(ref _networkInterrupted, 0) != 0;
        public bool ConsumePauseInterrupt() => Interlocked.Exchange(ref _pauseInterrupt, 0) != 0;

        public void SignalWake() => _wake.Writer.TryWrite(0);
        public void SignalRetry() => _retry.Writer.TryWrite(0);
        public Task WaitForWakeAsync(CancellationToken cancellationToken) => _wake.Reader.ReadAsync(cancellationToken).AsTask();
        public Task WaitForRetryAsync(CancellationToken cancellationToken) => _retry.Reader.ReadAsync(cancellationToken).AsTask();
        public Task WaitUntilResumedAsync(CancellationToken cancellationToken) => _resumeGate.WaitAsync(cancellationToken);

        private void CancelActiveOperation()
        {
            lock (_operationLock)
            {
                if (_activeOperation is not null)
                    TryCancel(_activeOperation);
            }
        }

        private static void TryCancel(CancellationTokenSource source)
        {
            try { source.Cancel(); }
            catch (ObjectDisposedException) { }
        }
    }

    private sealed class AsyncManualResetEvent
    {
        private volatile TaskCompletionSource<bool> _source;

        public AsyncManualResetEvent(bool initiallySet) =>
            _source = NewSource(initiallySet);

        public Task WaitAsync(CancellationToken cancellationToken) => _source.Task.WaitAsync(cancellationToken);

        public void Set() => _source.TrySetResult(true);

        public void Reset()
        {
            while (true)
            {
                var current = _source;
                if (!current.Task.IsCompleted)
                    return;
                var replacement = NewSource(initiallySet: false);
                if (ReferenceEquals(Interlocked.CompareExchange(ref _source, replacement, current), current))
                    return;
            }
        }

        private static TaskCompletionSource<bool> NewSource(bool initiallySet)
        {
            var source = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (initiallySet)
                source.TrySetResult(true);
            return source;
        }
    }
}

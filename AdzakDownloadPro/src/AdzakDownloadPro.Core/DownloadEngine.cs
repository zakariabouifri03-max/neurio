using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// The ADZAK DOWNLOAD PRO download engine.
    ///
    /// Orchestrates one <see cref="HttpClient"/> (pooled connections, bounded per-server connection
    /// count) and any number of concurrent downloads. For every download it:
    /// <list type="bullet">
    /// <item>probes the server once (size, range support, redirects, checksum headers),</item>
    /// <item>plans byte-range segments appropriate for the selected mode (LOW / MEDIUM / PRO),</item>
    /// <item>downloads the segments concurrently to part files with retries, resume-from-offset and
    /// response validation,</item>
    /// <item>in PRO mode, watches real per-segment throughput and splits stalled segments (bounded by
    /// <see cref="DownloadEngineOptions.MaxConnections"/>),</item>
    /// <item>merges the parts, verifies the final size and (when advertised) the SHA-256 checksum,</item>
    /// <item>persists resume metadata so downloads survive restarts.</item>
    /// </list>
    /// All speeds reported are measured from bytes that actually moved; nothing is estimated or invented.
    /// </summary>
    public sealed class DownloadEngine : IDisposable
    {
        private readonly object _itemsLock = new object();
        private readonly List<DownloadItem> _items = new List<DownloadItem>();
        private readonly SemaphoreSlim _downloadSlots;
        private readonly Random _jitter = new Random();
        private readonly HttpClient _httpClient;
        private bool _disposed;

        public DownloadEngine(DownloadEngineOptions? options = null)
        {
            Options = options ?? new DownloadEngineOptions();
            Options.ValidateAndClamp();
            Clock = () => DateTimeOffset.UtcNow;

            // SocketsHttpHandler: pooled connections, bounded per-server connection count so we never
            // flood a server even if a bug let the segment planner run wild.
            var handler = new SocketsHttpHandler
            {
                AllowAutoRedirect = true,
                MaxAutomaticRedirections = 10,
                UseProxy = true,
                AutomaticDecompression = DecompressionMethods.None, // we must see the raw bytes for range math
                MaxConnectionsPerServer = Options.MaxConnections,
                ConnectTimeout = TimeSpan.FromSeconds(Options.ResponseTimeoutSeconds),
            };
            _httpClient = new HttpClient(handler)
            {
                // We manage our own response/idle timeouts; never let HttpClient kill long transfers.
                Timeout = Timeout.InfiniteTimeSpan,
            };

            _downloadSlots = new SemaphoreSlim(Options.MaxSimultaneousDownloads);
        }

        /// <summary>Engine options. Read live — changing values affects subsequent decisions.</summary>
        public DownloadEngineOptions Options { get; }

        internal Func<DateTimeOffset> Clock { get; set; }

        internal HttpClient HttpClient => _httpClient;

        /// <summary>All downloads ever started through this engine.</summary>
        public IReadOnlyList<DownloadItem> Items
        {
            get { lock (_itemsLock) return _items.ToArray(); }
        }

        /// <summary>Sum of the current measured speeds of all actively transferring downloads.</summary>
        public double TotalSpeedBytesPerSecond
        {
            get
            {
                lock (_itemsLock)
                {
                    double sum = 0;
                    foreach (var item in _items)
                        if (item.Status == DownloadStatus.Downloading)
                            sum += item.SpeedBytesPerSecond;
                    return sum;
                }
            }
        }

        /// <summary>Total number of connections currently transferring across all downloads.</summary>
        public int TotalActiveConnections
        {
            get
            {
                lock (_itemsLock)
                {
                    int sum = 0;
                    foreach (var item in _items)
                        if (item.Status == DownloadStatus.Downloading)
                            sum += item.ActiveConnections;
                    return sum;
                }
            }
        }

        /// <summary>Raised for every progress snapshot of every download (throttled per download).</summary>
        public event EventHandler<DownloadProgress>? Progress;

        /// <summary>Raised when a download is added.</summary>
        public event EventHandler<DownloadItem>? ItemAdded;

        /// <summary>Raised when a download completes successfully (and was verified).</summary>
        public event EventHandler<DownloadItem>? ItemCompleted;

        /// <summary>Raised when a download fails.</summary>
        public event EventHandler<DownloadItem>? ItemFailed;

        /// <summary>
        /// Starts a download. Returns immediately; observe the returned item's events.
        /// </summary>
        /// <param name="url">Direct HTTP/HTTPS URL.</param>
        /// <param name="destinationDirectory">Folder for the final file and partial data.</param>
        /// <param name="mode">LOW / MEDIUM / PRO.</param>
        /// <param name="fileName">Optional file name override.</param>
        /// <param name="expectedSha256">Optional SHA-256 (hex) the final file must match.</param>
        /// <param name="progress">Optional progress sink (e.g. created on the UI thread).</param>
        public DownloadItem StartDownload(
            string url,
            string destinationDirectory,
            DownloadMode mode,
            string? fileName = null,
            string? expectedSha256 = null,
            IProgress<DownloadProgress>? progress = null)
        {
            if (string.IsNullOrWhiteSpace(url))
                throw new ArgumentException("A download URL is required.", nameof(url));
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                throw new ArgumentException($"'{url}' is not a valid absolute HTTP/HTTPS URL.", nameof(url));
            if (string.IsNullOrWhiteSpace(destinationDirectory))
                throw new ArgumentException("A destination folder is required.", nameof(destinationDirectory));

            var item = new DownloadItem(url.Trim(), destinationDirectory, mode, fileName, expectedSha256);
            item.PauseCts = new CancellationTokenSource();
            item.CancelCts = new CancellationTokenSource();
            item.Progress += (sender, snapshot) =>
            {
                Progress?.Invoke(this, snapshot);
                progress?.Report(snapshot);
            };
            item.StatusChanged += (sender, _) =>
            {
                var changed = (DownloadItem)sender!;
                if (changed.Status == DownloadStatus.Completed)
                    ItemCompleted?.Invoke(this, changed);
                else if (changed.Status == DownloadStatus.Failed)
                    ItemFailed?.Invoke(this, changed);
            };

            lock (_itemsLock)
                _items.Add(item);

            Directory.CreateDirectory(destinationDirectory);

            item.RunTask = RunDownloadAsync(item);
            ItemAdded?.Invoke(this, item);
            return item;
        }

        /// <summary>Pauses a download. Progress is kept on disk; call <see cref="ResumeAsync"/> to continue.</summary>
        public async Task PauseAsync(DownloadItem item)
        {
            if (item == null)
                throw new ArgumentNullException(nameof(item));
            if (item.Status != DownloadStatus.Downloading && item.Status != DownloadStatus.Probing
                && item.Status != DownloadStatus.Merging && item.Status != DownloadStatus.Verifying)
                return;

            item.Status = DownloadStatus.Pausing;
            item.RaiseStatusChanged();
            item.PauseCts?.Cancel();
            if (item.RunTask != null)
            {
                try { await item.RunTask.ConfigureAwait(false); } catch (Exception) { /* state already recorded */ }
            }
            if (item.Status == DownloadStatus.Pausing)
            {
                // Paused before the transfer even started (queued/probing): nothing to save yet.
                item.Status = DownloadStatus.Paused;
                item.RaiseStatusChanged();
            }
        }

        /// <summary>Resumes a paused download (in this session or after a restart, via resume metadata).</summary>
        public Task ResumeAsync(DownloadItem item)
        {
            if (item == null)
                throw new ArgumentNullException(nameof(item));
            if (item.Status != DownloadStatus.Paused)
                return Task.CompletedTask;

            item.ErrorMessage = null;
            item.PauseCts?.Dispose();
            item.CancelCts?.Dispose();
            item.PauseCts = new CancellationTokenSource();
            item.CancelCts = new CancellationTokenSource();
            item.Status = DownloadStatus.Queued;
            item.RaiseStatusChanged();
            item.RunTask = RunDownloadAsync(item);
            return item.RunTask;
        }

        /// <summary>Cancels a download and deletes its partial files.</summary>
        public async Task CancelAsync(DownloadItem item)
        {
            if (item == null)
                throw new ArgumentNullException(nameof(item));
            if (item.Status == DownloadStatus.Completed || item.Status == DownloadStatus.Canceled)
                return;

            item.Status = DownloadStatus.Canceled;
            item.RaiseStatusChanged();
            item.PauseCts?.Cancel();
            item.CancelCts?.Cancel();
            if (item.RunTask != null)
            {
                try { await item.RunTask.ConfigureAwait(false); } catch (Exception) { /* state already recorded */ }
            }
            CleanupTemp(item);
            ReportProgress(item, force: true);
        }

        /// <summary>Restarts a failed or canceled download (keeps already-downloaded bytes when possible).</summary>
        public Task RetryAsync(DownloadItem item)
        {
            if (item == null)
                throw new ArgumentNullException(nameof(item));
            if (item.Status != DownloadStatus.Failed && item.Status != DownloadStatus.Canceled)
                return Task.CompletedTask;

            item.ErrorMessage = null;
            item.CompletedAt = null;
            item.StartedAt = null;
            item.DownloadedBytes = 0;
            item.SpeedMeter.Reset();
            item.PauseCts?.Dispose();
            item.CancelCts?.Dispose();
            item.PauseCts = new CancellationTokenSource();
            item.CancelCts = new CancellationTokenSource();
            item.Status = DownloadStatus.Queued;
            item.RaiseStatusChanged();
            item.RunTask = RunDownloadAsync(item);
            return item.RunTask;
        }

        /// <summary>Cancels every active download (used on application exit). Best effort.</summary>
        public async Task CancelAllAsync()
        {
            var items = Items;
            var tasks = new List<Task>();
            foreach (var item in items)
            {
                if (item.Status == DownloadStatus.Queued || item.Status == DownloadStatus.Probing
                    || item.Status == DownloadStatus.Downloading || item.Status == DownloadStatus.Pausing
                    || item.Status == DownloadStatus.Paused)
                    tasks.Add(CancelAsync(item));
            }
            try { await Task.WhenAll(tasks).ConfigureAwait(false); } catch (Exception) { /* best effort */ }
        }

        public void Dispose()
        {
            if (_disposed)
                return;
            _disposed = true;
            _httpClient.Dispose();
            _downloadSlots.Dispose();
        }

        // ---------------------------------------------------------------------------------
        //  Core pipeline
        // ---------------------------------------------------------------------------------

        private async Task RunDownloadAsync(DownloadItem item)
        {
            using (var abort = CancellationTokenSource.CreateLinkedTokenSource(
                item.PauseCts?.Token ?? CancellationToken.None,
                item.CancelCts?.Token ?? CancellationToken.None))
            {
                try
                {
                    await _downloadSlots.WaitAsync(abort.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return; // canceled/paused while queued — status already set by the caller
                }
            }

            try
            {
                await RunDownloadCoreAsync(item).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // pause/cancel — already reflected in the item state
            }
            catch (Exception ex)
            {
                FailItem(item, ex is DownloadException dex ? dex.Message : Describe(ex));
            }
            finally
            {
                _downloadSlots.Release();
            }
        }

        private async Task RunDownloadCoreAsync(DownloadItem item)
        {
            // ---- probe ----
            item.Status = DownloadStatus.Probing;
            item.RaiseStatusChanged();
            ReportProgress(item, force: true);

            ProbeResult probe;
            using (var probeCts = CancellationTokenSource.CreateLinkedTokenSource(
                item.PauseCts!.Token, item.CancelCts!.Token))
            {
                try
                {
                    probe = await ProbeAsync(item, probeCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return; // paused/canceled during probe — status handled by Pause/CancelAsync
                }
                catch (Exception ex)
                {
                    FailItem(item, $"Could not reach the server: {Describe(ex)}");
                    return;
                }
            }
            if (item.Status == DownloadStatus.Canceled || item.Status == DownloadStatus.Pausing)
                return;
            if (!probe.Success)
            {
                FailItem(item, probe.ErrorMessage ?? "The server probe failed.");
                return;
            }

            // ---- paths & file name ----
            item.FileName = HttpUtils.SanitizeFileName(
                !string.IsNullOrWhiteSpace(item.FileName) ? item.FileName
                : probe.SuggestedFileName ?? HttpUtils.GetFileNameFromUrl(probe.FinalUrl ?? new Uri(item.Url)));
            item.FinalFilePath = ReserveUniqueFinalPath(item);
            item.TempDirectory = Path.Combine(item.DestinationDirectory, ".adzak-tmp");
            Directory.CreateDirectory(item.TempDirectory);
            item.MetaFilePath = Path.Combine(item.TempDirectory, item.Id + ".adzakmeta");
            item.ETag = probe.ETag;
            item.TotalBytes = probe.TotalBytes; // must be set before segment planning reads it
            if (item.ExpectedSha256 == null && Options.VerifyChecksums)
                item.ExpectedSha256 = probe.ExpectedSha256;

            if (probe.TotalBytes == 0)
            {
                // Empty file: nothing to transfer.
                File.WriteAllBytes(item.FinalFilePath, Array.Empty<byte>());
                item.TotalBytes = 0;
                CompleteItem(item);
                return;
            }

            // ---- decide segmentation ----
            bool canSegment = probe.SupportsRanges && probe.TotalBytes != null
                && probe.TotalBytes >= Options.MinSegmentSizeBytes;
            int requested = item.Mode switch
            {
                DownloadMode.Low => Options.LowConnections,
                DownloadMode.Medium => Options.MediumConnections,
                DownloadMode.Pro => Options.ProConnections,
                _ => 1,
            };
            int connectionCount = canSegment ? Math.Min(requested, Options.MaxConnections) : 1;
            item.UseRangeHeaders = canSegment;

            // ---- segments: in-memory continuation, resume metadata, or a fresh plan ----
            List<SegmentState> segments;
            bool continuing = false;
            lock (item.Segments)
            {
                if (item.Segments.Count > 0)
                {
                    // Same-session continuation (pause→resume or retry after failure): the in-memory
                    // state is authoritative — but only if the file on the server did not change.
                    bool sameFile = item.TotalBytes == probe.TotalBytes
                        && (string.IsNullOrEmpty(probe.ETag) || string.IsNullOrEmpty(item.ETag)
                            || string.Equals(item.ETag, probe.ETag, StringComparison.Ordinal));
                    if (sameFile)
                    {
                        segments = item.Segments.ToList();
                        continuing = true;
                    }
                    else
                    {
                        item.Segments.Clear();
                        segments = new List<SegmentState>();
                    }
                }
                else
                {
                    segments = new List<SegmentState>();
                }
            }

            if (!continuing)
            {
                var reusable = DownloadMetaStore.FindReusable(
                    item.TempDirectory, item.Url, item.FinalFilePath, item.FileName, probe.TotalBytes, probe.ETag);
                if (reusable != null && reusable.Segments.Count > 0)
                {
                    item.Id = reusable.Id; // keep part-file names stable across restarts
                    item.MetaFilePath = Path.Combine(item.TempDirectory, item.Id + ".adzakmeta");
                    segments = BuildSegmentsFromMeta(item, reusable) ?? new List<SegmentState>();
                }
                else
                {
                    ClearTemp(item); // nothing reusable — start from a clean slate
                    segments = PlanSegments(item, connectionCount);
                }
            }

            lock (item.Segments)
            {
                item.Segments.Clear();
                item.Segments.AddRange(segments);
            }

            // Recompute the downloaded-bytes counter from the (possibly resumed) segments.
            long downloaded = 0;
            foreach (var s in segments)
                downloaded += s.DownloadedBytes;
            item.DownloadedBytes = downloaded;

            item.StartedAt ??= Clock();
            item.SpeedMeter.Start();

            SaveMeta(item);
            item.Status = DownloadStatus.Downloading;
            item.RaiseStatusChanged();
            ReportProgress(item, force: true);

            // ---- transfer ----
            CancellationTokenSource? controllerCts = null;
            Task? controller = null;
            if (item.Mode == DownloadMode.Pro && connectionCount > 1)
            {
                controllerCts = new CancellationTokenSource();
                controller = RunAdaptiveControllerAsync(item, controllerCts.Token);
            }

            try
            {
                await RunSegmentsAsync(item, item.PauseCts.Token, item.CancelCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (item.PauseCts.IsCancellationRequested || item.CancelCts.IsCancellationRequested)
            {
                // pause or cancel — handled by the state checks below
            }
            finally
            {
                controllerCts?.Cancel();
                if (controller != null)
                {
                    try { await controller.ConfigureAwait(false); } catch (Exception) { /* controller noise */ }
                }
            }

            if (item.Status == DownloadStatus.Canceled)
            {
                CleanupTemp(item);
                return;
            }
            if (item.Status == DownloadStatus.Pausing || item.PauseCts.IsCancellationRequested)
            {
                item.Status = DownloadStatus.Paused;
                item.SpeedMeter.Pause();
                SaveMeta(item);
                ReportProgress(item, force: true);
                return;
            }

            // ---- merge ----
            item.Status = DownloadStatus.Merging;
            item.ActiveConnections = 0;
            item.RaiseStatusChanged();
            ReportProgress(item, force: true);
            await MergeSegmentsAsync(item).ConfigureAwait(false);

            // ---- verify ----
            item.Status = DownloadStatus.Verifying;
            item.RaiseStatusChanged();
            ReportProgress(item, force: true);
            await VerifyFinalAsync(item).ConfigureAwait(false);

            CompleteItem(item);
        }

        // ---------------------------------------------------------------------------------
        //  Probe
        // ---------------------------------------------------------------------------------

        private async Task<ProbeResult> ProbeAsync(DownloadItem item, CancellationToken cancellationToken)
        {
            // MaxRetries is the number of *retries* after the first attempt.
            int maxAttempts = Options.MaxRetries + 1;
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    using (var request = new HttpRequestMessage(HttpMethod.Get, item.Url))
                    {
                        // A 1-byte ranged GET is the most reliable probe: it reveals range support,
                        // total size, redirects, checksum headers and the suggested file name —
                        // without transferring the file.
                        request.Headers.Range = new RangeHeaderValue(0, 0);

                        using (var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                        {
                            cts.CancelAfter(TimeSpan.FromSeconds(Options.ResponseTimeoutSeconds));
                            using (var response = await _httpClient.SendAsync(
                                request, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false))
                            {
                                int code = (int)response.StatusCode;
                                var result = new ProbeResult
                                {
                                    StatusCode = code,
                                    FinalUrl = response.RequestMessage?.RequestUri ?? new Uri(item.Url),
                                    ETag = response.Headers.ETag?.ToString(),
                                    LastModified = response.Content.Headers.LastModified?.ToString(),
                                    ExpectedSha256 = Checksum.GetSha256FromHeaders(response.Headers)
                                        ?? Checksum.GetSha256FromHeaders(response.Content.Headers),
                                };

                                var disposition = response.Content.Headers.ContentDisposition;
                                if (disposition != null)
                                    result.SuggestedFileName = HttpUtils.GetFileNameFromContentDisposition(disposition.ToString());

                                if (code == 206)
                                {
                                    var cr = response.Content.Headers.ContentRange;
                                    if (cr != null && cr.HasRange && cr.From == 0 && cr.Length != null)
                                    {
                                        result.SupportsRanges = true;
                                        result.TotalBytes = cr.Length;
                                    }
                                    else if (cr != null && cr.Length != null)
                                    {
                                        // Broken 206 — treat as "no range support" but keep the size.
                                        result.SupportsRanges = false;
                                        result.TotalBytes = cr.Length;
                                    }
                                    else
                                    {
                                        result.SupportsRanges = false;
                                    }
                                }
                                else if (code == 416)
                                {
                                    // An empty file has no satisfiable range; the Content-Range
                                    // total ("bytes */0") tells us the file is empty.
                                    var cr416 = response.Content.Headers.ContentRange;
                                    if (cr416 != null && cr416.Length == 0)
                                    {
                                        result.Success = true;
                                        result.SupportsRanges = false;
                                        result.TotalBytes = 0;
                                        return result;
                                    }
                                    result.ErrorMessage = "The server rejected the range request (HTTP 416).";
                                    return result;
                                }
                                else if (code == 200)
                                {
                                    result.SupportsRanges = false;
                                    result.TotalBytes = response.Content.Headers.ContentLength;
                                }
                                else if (HttpUtils.IsRetryableStatusCode(code) && attempt < maxAttempts)
                                {
                                    await BackoffAsync(attempt, cancellationToken).ConfigureAwait(false);
                                    continue;
                                }
                                else
                                {
                                    result.ErrorMessage = $"The server returned HTTP {code} ({response.ReasonPhrase}).";
                                    return result;
                                }

                                result.Success = true;
                                return result;
                            }
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex) when (attempt < maxAttempts && IsTransient(ex))
                {
                    await BackoffAsync(attempt, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    return new ProbeResult { ErrorMessage = ex.Message };
                }
            }
        }

        // ---------------------------------------------------------------------------------
        //  Segments
        // ---------------------------------------------------------------------------------

        /// <summary>
        /// Picks a final file path that is unique on disk AND among the downloads currently in
        /// flight (two simultaneous downloads of the same URL must not end up with the same file,
        /// and must not adopt each other's resume metadata).
        /// </summary>
        private string ReserveUniqueFinalPath(DownloadItem item)
        {
            var fileName = item.FileName;
            var baseName = Path.GetFileNameWithoutExtension(fileName);
            var extension = Path.GetExtension(fileName);

            lock (_itemsLock)
            {
                var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var other in _items)
                {
                    if (other == item || string.IsNullOrEmpty(other.FinalFilePath))
                        continue;
                    if (other.Status == DownloadStatus.Completed
                        || other.Status == DownloadStatus.Failed
                        || other.Status == DownloadStatus.Canceled)
                        continue;
                    reserved.Add(other.FinalFilePath);
                }

                var candidate = Path.Combine(item.DestinationDirectory, fileName);
                int counter = 1;
                while (File.Exists(candidate) || reserved.Contains(candidate))
                {
                    candidate = Path.Combine(item.DestinationDirectory, $"{baseName} ({counter}){extension}");
                    counter++;
                }
                return candidate;
            }
        }

        private List<SegmentState> PlanSegments(DownloadItem item, int connectionCount)
        {
            var segments = new List<SegmentState>();
            IReadOnlyList<SegmentRange> ranges = item.TotalBytes != null
                ? SegmentPlanner.Plan(item.TotalBytes.Value, connectionCount, Options.MinSegmentSizeBytes)
                : new[] { SegmentPlanner.PlanUnknownSize() };

            int index = 0;
            foreach (var range in ranges)
            {
                int i = index++;
                segments.Add(new SegmentState
                {
                    Index = i,
                    StartByte = range.Start,
                    EndByte = range.End,
                    DownloadedBytes = 0,
                    TempFilePath = NewPartPath(item, i),
                });
            }
            return segments;
        }

        private string NewPartPath(DownloadItem item, int index)
            => Path.Combine(item.TempDirectory, $"{item.Id}.part{index}");

        /// <summary>Rebuilds segment state from resume metadata. Part files are reconciled with what is
        /// actually on disk, so a crash between a disk write and a metadata write cannot corrupt anything.</summary>
        private List<SegmentState>? BuildSegmentsFromMeta(DownloadItem item, DownloadMetaStore.MetaData meta)
        {
            var segments = new List<SegmentState>();
            int index = 0;
            foreach (var sm in meta.Segments)
            {
                var segment = new SegmentState
                {
                    Index = index++,
                    StartByte = sm.StartByte,
                    EndByte = sm.EndByte,
                    DownloadedBytes = sm.DownloadedBytes,
                    TempFilePath = NewPartPath(item, sm.Index),
                };

                if (!File.Exists(segment.TempFilePath))
                {
                    segment.DownloadedBytes = 0;
                }
                else
                {
                    long fileLength = new FileInfo(segment.TempFilePath).Length;
                    long expected = segment.RangeLength;
                    if (expected >= 0 && fileLength > expected)
                        segment.DownloadedBytes = expected;
                    else if (fileLength < segment.DownloadedBytes)
                        segment.DownloadedBytes = fileLength;
                }

                if (segment.RangeLength >= 0 && segment.DownloadedBytes >= segment.RangeLength)
                    segment.IsComplete = true;

                segments.Add(segment);
            }
            return segments;
        }

        private async Task RunSegmentsAsync(DownloadItem item, CancellationToken pauseToken, CancellationToken cancelToken)
        {
            while (true)
            {
                List<SegmentState> pending;
                lock (item.Segments)
                    pending = item.Segments.Where(s => !s.IsComplete && !s.Superseded).ToList();

                if (pending.Count == 0)
                    return;

                // Make sure every pending segment has a running task.
                lock (item.Segments)
                {
                    foreach (var segment in pending)
                        StartSegmentTask(item, segment, pauseToken, cancelToken);
                }

                item.ActiveConnections = CountActiveSegments(item);
                ReportProgress(item, force: true);

                Task[] running;
                lock (item.Segments)
                    running = item.Segments.Where(s => s.Task != null).Select(s => s.Task!).ToArray();

                if (running.Length == 0)
                    continue;

                try
                {
                    await Task.WhenAll(running).ConfigureAwait(false);
                }
                catch (Exception)
                {
                    // A segment failed: stop the others, then surface the error.
                    lock (item.Segments)
                    {
                        foreach (var segment in item.Segments)
                        {
                            if (!segment.IsComplete && !segment.Superseded)
                                segment.LinkedCts?.Cancel();
                        }
                    }
                    Task[] all;
                    lock (item.Segments)
                        all = item.Segments.Where(s => s.Task != null).Select(s => s.Task!).ToArray();
                    try { await Task.WhenAll(all).ConfigureAwait(false); } catch (Exception) { /* observe */ }
                    throw;
                }

                // Clean finished tasks out of the runtime handles.
                lock (item.Segments)
                {
                    foreach (var segment in item.Segments)
                    {
                        if (segment.Task != null && segment.Task.IsCompleted)
                        {
                            segment.Task = null;
                            segment.LinkedCts?.Dispose();
                            segment.LinkedCts = null;
                        }
                    }
                }

                bool anyIncomplete;
                lock (item.Segments)
                    anyIncomplete = item.Segments.Any(s => !s.IsComplete);
                if (!anyIncomplete)
                    return;
                // Otherwise the adaptive controller superseded a segment — loop and pick up the children.
            }
        }

        private void StartSegmentTask(DownloadItem item, SegmentState segment, CancellationToken pauseToken, CancellationToken cancelToken)
        {
            if (segment.Task != null && !segment.Task.IsCompleted)
                return;

            segment.LinkedCts?.Dispose();
            segment.LinkedCts = CancellationTokenSource.CreateLinkedTokenSource(pauseToken, cancelToken);
            var downloader = new SegmentDownloader(this, item, segment, _jitter);
            var token = segment.LinkedCts.Token;
            segment.Task = RunSegmentWrapperAsync(downloader, segment, token);
        }

        /// <summary>
        /// A superseded segment (split by the adaptive controller) ends quietly: its remaining range is
        /// continued by its two children, so its cancellation is not an error. Pause/cancel cancellations
        /// still propagate.
        /// </summary>
        private static async Task RunSegmentWrapperAsync(SegmentDownloader downloader, SegmentState segment, CancellationToken token)
        {
            try
            {
                await downloader.RunAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (segment.Superseded)
            {
                // split — the children take over
            }
        }

        private int CountActiveSegments(DownloadItem item)
        {
            lock (item.Segments)
                return item.Segments.Count(s => !s.IsComplete && !s.Superseded && s.Task != null && !s.Task.IsCompleted);
        }

        // ---------------------------------------------------------------------------------
        //  Adaptive concurrency (PRO mode)
        // ---------------------------------------------------------------------------------

        /// <summary>
        /// Watches the real per-segment throughput and, when one connection clearly stalls while others
        /// keep moving, splits that segment's remaining range in two so a fresh connection can help.
        /// Total connections never exceed <see cref="DownloadEngineOptions.MaxConnections"/> and each
        /// segment is split at most twice, at most once per
        /// <see cref="DownloadEngineOptions.AdaptiveMinSplitIntervalSeconds"/>.
        /// </summary>
        private async Task RunAdaptiveControllerAsync(DownloadItem item, CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(Options.AdaptiveCheckIntervalSeconds), cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }

                if (item.Status != DownloadStatus.Downloading)
                    continue;

                List<SegmentState> snapshot;
                lock (item.Segments)
                    snapshot = item.Segments.Where(s => !s.IsComplete && !s.Superseded).ToList();
                if (snapshot.Count == 0)
                    continue;

                var windows = new List<(SegmentState Segment, long Bytes)>(snapshot.Count);
                long max = 0;
                foreach (var segment in snapshot)
                {
                    long bytes = Interlocked.Exchange(ref segment.BytesInWindow, 0);
                    windows.Add((segment, bytes));
                    if (bytes > max)
                        max = bytes;
                }
                if (max <= 0)
                    continue;

                foreach (var (segment, bytes) in windows)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    if (bytes >= Options.AdaptiveStallRatio * max)
                        continue; // this segment is keeping up with the fastest one
                    if (CountActiveSegments(item) >= Options.MaxConnections)
                        break;
                    if (segment.SplitCount >= 2)
                        continue;
                    if (Clock() - segment.LastSplitAt < TimeSpan.FromSeconds(Options.AdaptiveMinSplitIntervalSeconds))
                        continue;

                    long? mid = SegmentPlanner.ChooseSplitOffset(segment.Range, segment.CurrentOffset, Options.MinSegmentSizeBytes);
                    if (mid == null)
                        continue;

                    SplitSegment(item, segment, mid.Value);
                    break; // one split per evaluation tick
                }
            }
        }

        /// <summary>
        /// Replaces <paramref name="parent"/> with two segments covering its remaining range. The left
        /// child keeps the parent's part file and therefore resumes exactly where the parent stopped —
        /// no byte is downloaded twice. The right child gets a fresh part file.
        /// </summary>
        private void SplitSegment(DownloadItem item, SegmentState parent, long mid)
        {
            SegmentState left;
            SegmentState right;
            lock (item.Segments)
            {
                if (!item.Segments.Contains(parent) || parent.Superseded)
                    return;

                parent.Superseded = true;
                parent.SplitCount++;
                parent.LastSplitAt = Clock();

                int nextIndex = item.Segments.Count == 0 ? 0 : item.Segments.Max(s => s.Index) + 1;

                left = new SegmentState
                {
                    Index = parent.Index,
                    StartByte = parent.StartByte,
                    EndByte = mid - 1,
                    DownloadedBytes = parent.DownloadedBytes,
                    TempFilePath = parent.TempFilePath, // resumes from the parent's offset
                    LastSplitAt = parent.LastSplitAt,
                };
                right = new SegmentState
                {
                    Index = nextIndex,
                    StartByte = mid,
                    EndByte = parent.EndByte,
                    DownloadedBytes = 0,
                    TempFilePath = NewPartPath(item, nextIndex),
                    LastSplitAt = parent.LastSplitAt,
                };

                item.Segments.Remove(parent);
                item.Segments.Add(left);
                item.Segments.Add(right);
            }

            parent.LinkedCts?.Cancel(); // stop the parent task; its progress lives on in the left child

            var pauseToken = item.PauseCts?.Token ?? CancellationToken.None;
            var cancelToken = item.CancelCts?.Token ?? CancellationToken.None;
            lock (item.Segments)
            {
                StartSegmentTask(item, left, pauseToken, cancelToken);
                StartSegmentTask(item, right, pauseToken, cancelToken);
            }

            SaveMeta(item);
            ReportProgress(item, force: true);
        }

        // ---------------------------------------------------------------------------------
        //  Merge & verify
        // ---------------------------------------------------------------------------------

        private async Task MergeSegmentsAsync(DownloadItem item)
        {
            List<SegmentState> segments;
            lock (item.Segments)
                segments = item.Segments.OrderBy(s => s.StartByte).ToList();

            if (segments.Count == 1)
            {
                var only = segments[0];
                if (File.Exists(item.FinalFilePath))
                    File.Delete(item.FinalFilePath);
                File.Move(only.TempFilePath, item.FinalFilePath);
                return;
            }

            var buffer = new byte[Options.BufferSizeBytes];
            await using (var output = new FileStream(
                item.FinalFilePath, FileMode.Create, FileAccess.Write, FileShare.None,
                Options.BufferSizeBytes, useAsync: true))
            {
                foreach (var segment in segments)
                {
                    long partLength = new FileInfo(segment.TempFilePath).Length;
                    long expected = segment.RangeLength;
                    if (expected >= 0 && partLength != expected)
                        throw new DownloadException(
                            $"Refusing to merge: segment {segment.Index} holds {partLength} bytes but its range is {expected} bytes.");

                    await using (var input = new FileStream(
                        segment.TempFilePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                        Options.BufferSizeBytes, useAsync: true))
                    {
                        await input.CopyToAsync(output, buffer.Length).ConfigureAwait(false);
                    }
                }
                await output.FlushAsync().ConfigureAwait(false);
            }
        }

        private async Task VerifyFinalAsync(DownloadItem item)
        {
            long actual = new FileInfo(item.FinalFilePath).Length;
            if (item.TotalBytes != null && actual != item.TotalBytes.Value)
            {
                TryDelete(item.FinalFilePath);
                throw new DownloadException(
                    $"Size verification failed: expected {item.TotalBytes.Value} bytes but the merged file holds {actual} bytes. The file was removed.");
            }

            if (!string.IsNullOrEmpty(item.ExpectedSha256) && Options.VerifyChecksums)
            {
                string hash;
                using (var stream = File.OpenRead(item.FinalFilePath))
                    hash = await Checksum.ComputeSha256HexAsync(stream).ConfigureAwait(false);

                if (!Checksum.Sha256Equals(item.ExpectedSha256, hash))
                {
                    TryDelete(item.FinalFilePath);
                    throw new DownloadException(
                        $"SHA-256 verification failed: expected {item.ExpectedSha256.ToLowerInvariant()} but the file hashes to {hash}. The corrupted file was removed.");
                }
            }
        }

        // ---------------------------------------------------------------------------------
        //  Item state transitions, progress, metadata
        // ---------------------------------------------------------------------------------

        private void CompleteItem(DownloadItem item)
        {
            item.SpeedMeter.Pause();
            item.ActiveConnections = 0;
            item.Status = DownloadStatus.Completed;
            item.CompletedAt = Clock();
            item.RaiseStatusChanged();
            CleanupTemp(item);
            ReportProgress(item, force: true);
        }

        private void FailItem(DownloadItem item, string message)
        {
            item.SpeedMeter.Pause();
            item.ActiveConnections = 0;
            item.Status = DownloadStatus.Failed;
            item.ErrorMessage = message;
            item.RaiseStatusChanged();
            SaveMeta(item); // keep partial progress so Retry can resume
            ReportProgress(item, force: true);
        }

        internal void ReportProgress(DownloadItem item, bool force = false)
        {
            var now = Clock();
            if (!force)
            {
                long last = Interlocked.Read(ref item.ProgressReportTicks);
                long throttleTicks = Options.ProgressThrottleMilliseconds * TimeSpan.TicksPerMillisecond;
                if (now.Ticks - last < throttleTicks)
                    return;
                if (Interlocked.CompareExchange(ref item.ProgressReportTicks, now.Ticks, last) != last)
                    return;
            }

            double currentSpeed = item.SpeedMeter.CurrentSpeed;
            double averageSpeed = item.SpeedMeter.AverageSpeed;
            item.SpeedBytesPerSecond = currentSpeed;
            item.AverageSpeedBytesPerSecond = averageSpeed;

            if (item.TotalBytes != null && item.TotalBytes > 0 && currentSpeed > 1)
            {
                double remaining = item.TotalBytes.Value - item.DownloadedBytes;
                item.EtaSeconds = remaining > 0 ? remaining / currentSpeed : 0;
            }
            else
            {
                item.EtaSeconds = null;
            }

            item.RaiseProgress(item.CreateSnapshot());

            // Periodically persist resume metadata so a crash/restart loses at most a few seconds.
            long lastMeta = Interlocked.Read(ref item.LastMetaSaveTicks);
            long metaTicks = Options.MetaSaveIntervalSeconds * TimeSpan.TicksPerSecond;
            if (now.Ticks - lastMeta >= metaTicks)
            {
                if (Interlocked.CompareExchange(ref item.LastMetaSaveTicks, now.Ticks, lastMeta) == lastMeta)
                    SaveMeta(item);
            }
        }

        private void SaveMeta(DownloadItem item)
        {
            try
            {
                if (string.IsNullOrEmpty(item.MetaFilePath) || string.IsNullOrEmpty(item.FileName))
                    return;
                List<SegmentState> snapshot;
                lock (item.Segments)
                    snapshot = item.Segments.ToList();
                DownloadMetaStore.Save(item, snapshot);
            }
            catch (Exception)
            {
                // metadata is best-effort; never fail a download because of it
            }
        }

        private void CleanupTemp(DownloadItem item)
        {
            try
            {
                if (string.IsNullOrEmpty(item.TempDirectory) || !Directory.Exists(item.TempDirectory))
                    return;
                foreach (var file in Directory.GetFiles(item.TempDirectory, item.Id + ".*"))
                    TryDelete(file);
                if (!string.IsNullOrEmpty(item.MetaFilePath) && File.Exists(item.MetaFilePath))
                    TryDelete(item.MetaFilePath);
            }
            catch (Exception)
            {
                // best effort
            }
        }

        private void ClearTemp(DownloadItem item)
        {
            // Only this item's files: the temp directory is shared by all downloads of the
            // destination folder, so wiping it would destroy other downloads' partial data.
            try
            {
                if (string.IsNullOrEmpty(item.TempDirectory) || !Directory.Exists(item.TempDirectory))
                    return;
                foreach (var file in Directory.GetFiles(item.TempDirectory, item.Id + ".*"))
                    TryDelete(file);
                if (!string.IsNullOrEmpty(item.MetaFilePath) && File.Exists(item.MetaFilePath))
                    TryDelete(item.MetaFilePath);
            }
            catch (Exception)
            {
                // best effort
            }
        }

        /// <summary>Formats an exception chain into one readable line (for error messages shown to the user).</summary>
        private static string Describe(Exception ex)
        {
            var sb = new System.Text.StringBuilder();
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (sb.Length > 0)
                    sb.Append(" → ");
                sb.Append(e.GetType().Name).Append(": ").Append(e.Message);
            }
            return sb.ToString();
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path))
                    File.Delete(path);
            }
            catch (Exception)
            {
                // best effort
            }
        }

        private async Task BackoffAsync(int attempt, CancellationToken cancellationToken = default)
        {
            double seconds = Math.Min(0.5 * Math.Pow(2, Math.Min(attempt - 1, 5)), 10);
            int jitterMs;
            lock (_jitter)
                jitterMs = _jitter.Next(0, 250);
            await Task.Delay(TimeSpan.FromSeconds(seconds) + TimeSpan.FromMilliseconds(jitterMs), cancellationToken)
                .ConfigureAwait(false);
        }

        private static bool IsTransient(Exception ex)
            => ex is HttpRequestException || ex is IOException || ex is TimeoutException
               || ex is TaskCanceledException || ex is OperationCanceledException
               || (ex is DownloadException dex && dex.IsRetryable);
    }
}

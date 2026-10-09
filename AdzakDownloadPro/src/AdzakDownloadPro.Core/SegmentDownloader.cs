using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Downloads one byte-range segment to its own part file, with:
    /// <list type="bullet">
    /// <item>HTTP response validation (206 + Content-Range checked against the requested range),</item>
    /// <item>resume from the current offset (never re-downloads bytes already on disk),</item>
    /// <item>automatic retries with exponential backoff for transient failures,</item>
    /// <item>idle-timeout detection so a stalled connection cannot hang a download forever.</item>
    /// </list>
    /// </summary>
    internal sealed class SegmentDownloader
    {
        private readonly DownloadEngine _engine;
        private readonly DownloadItem _item;
        private readonly SegmentState _segment;
        private readonly DownloadEngineOptions _options;
        private readonly Func<DateTimeOffset> _clock;
        private readonly Random _jitter;

        public SegmentDownloader(DownloadEngine engine, DownloadItem item, SegmentState segment, Random jitter)
        {
            _engine = engine;
            _item = item;
            _segment = segment;
            _options = engine.Options;
            _clock = engine.Clock;
            _jitter = jitter;
        }

        /// <summary>Runs the segment until it is complete. Throws <see cref="DownloadException"/> on permanent
        /// failure and <see cref="OperationCanceledException"/> when paused/canceled/superseded.</summary>
        public async Task RunAsync(CancellationToken cancellationToken)
        {
            ReconcilePartFile();

            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (_segment.IsComplete)
                    return;

                _segment.Attempts++;
                try
                {
                    await DownloadAttemptAsync(cancellationToken).ConfigureAwait(false);

                    // A segment is only complete when its part file holds exactly the expected bytes.
                    long expected = _segment.RangeLength;
                    if (expected >= 0)
                    {
                        long actual = new FileInfo(_segment.TempFilePath).Length;
                        if (actual != expected)
                            throw new DownloadException(
                                $"Segment {_segment.Index}: part file holds {actual} bytes but the range is {expected} bytes.",
                                null, true);
                    }

                    _segment.IsComplete = true;
                    _engine.ReportProgress(_item);
                    return;
                }
                catch (OperationCanceledException)
                {
                    throw; // pause / cancel / supersede — the engine decides what it means
                }
                catch (DownloadException ex) when (!ex.IsRetryable)
                {
                    throw;
                }
                catch (Exception ex) when (_segment.Attempts <= _options.MaxRetries && IsTransient(ex))
                {
                    // Transient failure (network reset, timeout, 5xx, 429, mid-body drop…): back off and resume.
                    var dex = ex as DownloadException;
                    await BackoffAsync(_segment.Attempts, dex?.StatusCode, dex?.RetryAfter, cancellationToken)
                        .ConfigureAwait(false);
                }
            }
        }

        private async Task DownloadAttemptAsync(CancellationToken cancellationToken)
        {
            var range = _segment.Range;
            long offset = _segment.CurrentOffset;

            using (var request = new HttpRequestMessage(HttpMethod.Get, _item.Url))
            {
                if (_item.UseRangeHeaders && !range.IsOpenEnded)
                {
                    request.Headers.Range = new RangeHeaderValue(offset, range.End);

                    // When resuming, make sure the file on the server is still the same one.
                    if (offset > 0 && !string.IsNullOrEmpty(_item.ETag))
                        request.Headers.IfRange = new RangeConditionHeaderValue(_item.ETag!);
                }

                using (var responseCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    responseCts.CancelAfter(TimeSpan.FromSeconds(_options.ResponseTimeoutSeconds));
                    using (var response = await _engine.HttpClient.SendAsync(
                        request, HttpCompletionOption.ResponseHeadersRead, responseCts.Token).ConfigureAwait(false))
                    {
                        ValidateResponse(response, range, offset);
                        await ReadBodyAsync(response, range, cancellationToken).ConfigureAwait(false);
                    }
                }
            }
        }

        private void ValidateResponse(HttpResponseMessage response, SegmentRange range, long offset)
        {
            int code = (int)response.StatusCode;

            if (code == 416)
            {
                // The range is not satisfiable: either the file changed or our offset is stale.
                if (offset > 0)
                {
                    ResetSegment();
                    throw new DownloadException(
                        $"Server rejected the requested range (HTTP 416) — restarting segment {_segment.Index} from byte 0.",
                        416, true);
                }
                throw new DownloadException("Server returned HTTP 416 for the initial range request.", 416, false);
            }

            if (code == 200)
            {
                // The server ignored our Range header and is sending the whole file.
                if (_item.GetSegmentsSnapshot().Count > 1)
                    throw new DownloadException(
                        "The server stopped honouring Range requests mid-download (HTTP 200 to a ranged request). " +
                        "The file cannot be downloaded in segments from this server.", 200, false);
                if (offset > 0)
                {
                    ResetSegment();
                    throw new DownloadException(
                        "Cannot resume: the server does not support Range requests (HTTP 200 to a ranged request). Restarting from byte 0.",
                        200, true);
                }
                return; // single segment from byte 0 — a plain full-body response is fine
            }

            if (code == 206)
            {
                var contentRange = response.Content.Headers.ContentRange;
                if (contentRange == null || !contentRange.HasRange)
                    throw new DownloadException("Server returned 206 without a usable Content-Range header.", 206, true);

                long from = contentRange.From ?? -1;
                long to = contentRange.To ?? -1;
                if (from != offset)
                    throw new DownloadException(
                        $"Content-Range mismatch: requested byte {offset} but the server started at {from}. Refusing to write out-of-order data.",
                        206, true);
                if (!range.IsOpenEnded && to != range.End)
                    throw new DownloadException(
                        $"Content-Range mismatch: requested range ends at {range.End} but the server sent up to {to}.",
                        206, true);
                if (_item.TotalBytes != null && contentRange.Length != null && contentRange.Length != _item.TotalBytes)
                    throw new DownloadException(
                        $"The file changed on the server (size {_item.TotalBytes} → {contentRange.Length}). Restarting the download would be required.",
                        206, false);
                return;
            }

            if (HttpUtils.IsRetryableStatusCode(code))
                throw new DownloadException($"Server returned HTTP {code} ({response.ReasonPhrase}).", code, true);

            throw new DownloadException($"Server returned HTTP {code} ({response.ReasonPhrase}).", code, false);
        }

        private async Task ReadBodyAsync(HttpResponseMessage response, SegmentRange range, CancellationToken cancellationToken)
        {
            using (var idleCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                DateTimeOffset lastActivity = _clock();

                // Watchdog: cancel the transfer if no bytes arrive for longer than the idle timeout.
                var watchdog = Task.Run(async () =>
                {
                    while (!idleCts.IsCancellationRequested)
                    {
                        await Task.Delay(500, cancellationToken).ConfigureAwait(false);
                        if (_clock() - lastActivity > TimeSpan.FromSeconds(_options.IdleTimeoutSeconds))
                            idleCts.Cancel();
                    }
                }, cancellationToken);

                try
                {
                    await using (var fileStream = new FileStream(
                        _segment.TempFilePath, FileMode.Append, FileAccess.Write, FileShare.Read,
                        _options.BufferSizeBytes, useAsync: true))
                    {
                        var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
                        var buffer = new byte[_options.BufferSizeBytes];

                        while (true)
                        {
                            int read = await stream.ReadAsync(buffer, 0, buffer.Length, idleCts.Token).ConfigureAwait(false);
                            if (read == 0)
                                break;

                            await fileStream.WriteAsync(buffer, 0, read, cancellationToken).ConfigureAwait(false);

                            _segment.DownloadedBytes += read;
                            _segment.BytesInWindow += read;
                            _item.AddDownloadedBytes(read);
                            _item.SpeedMeter.AddBytes(read);
                            lastActivity = _clock();

                            _engine.ReportProgress(_item);

                            // Never read past the end of our own range, even if the server sends more.
                            if (!range.IsOpenEnded && _segment.DownloadedBytes >= range.Length)
                                break;
                        }

                        await fileStream.FlushAsync(cancellationToken).ConfigureAwait(false);
                    }
                }
                finally
                {
                    idleCts.Cancel();
                    try { await watchdog.ConfigureAwait(false); } catch (Exception) { /* watchdog noise */ }
                }
            }

            if (!range.IsOpenEnded && _segment.DownloadedBytes < range.Length)
                throw new DownloadException(
                    $"Connection closed after {_segment.DownloadedBytes} of {range.Length} bytes for segment {_segment.Index}.",
                    null, true);
        }

        /// <summary>
        /// Makes the on-disk part file and the in-memory counter agree. Data already written to disk is
        /// never thrown away: if the file is longer than the counter says, the extra (fully written) bytes
        /// are adopted; if it is shorter, the counter is lowered. This makes resume robust even after a
        /// crash between a disk write and a counter update.
        /// </summary>
        private void ReconcilePartFile()
        {
            try
            {
                long expected = _segment.RangeLength;

                if (!File.Exists(_segment.TempFilePath))
                {
                    if (_segment.DownloadedBytes != 0)
                        _item.AddDownloadedBytes(-_segment.DownloadedBytes);
                    _segment.DownloadedBytes = 0;
                    return;
                }

                long fileLength = new FileInfo(_segment.TempFilePath).Length;
                if (expected >= 0 && fileLength > expected)
                {
                    // More bytes than the range needs: truncate the surplus.
                    using (var fs = new FileStream(_segment.TempFilePath, FileMode.Open, FileAccess.Write, FileShare.None))
                        fs.SetLength(expected);
                    fileLength = expected;
                }

                // Adopt fully-written bytes the counter does not know about yet (crash between write and
                // counter update), or lower the counter if the file is shorter than recorded.
                long delta = fileLength - _segment.DownloadedBytes;
                if (delta != 0)
                {
                    _segment.DownloadedBytes = fileLength;
                    _item.AddDownloadedBytes(delta);
                }
            }
            catch (Exception)
            {
                if (_segment.DownloadedBytes != 0)
                    _item.AddDownloadedBytes(-_segment.DownloadedBytes);
                _segment.DownloadedBytes = 0;
            }
        }

        private void ResetSegment()
        {
            try
            {
                if (File.Exists(_segment.TempFilePath))
                    File.Delete(_segment.TempFilePath);
            }
            catch (Exception)
            {
                // best effort
            }
            _segment.DownloadedBytes = 0;
        }

        private async Task BackoffAsync(int attempt, int? statusCode, TimeSpan? retryAfter, CancellationToken cancellationToken)
        {
            TimeSpan delay;
            if (retryAfter != null)
            {
                // Respect the server's Retry-After when it sends one.
                delay = retryAfter.Value;
            }
            else
            {
                double seconds = 0.5 * Math.Pow(2, Math.Min(attempt - 1, 5));
                delay = TimeSpan.FromSeconds(Math.Min(seconds, 10));
            }

            int jitterMs;
            lock (_jitter)
                jitterMs = _jitter.Next(0, 250);
            await Task.Delay(delay + TimeSpan.FromMilliseconds(jitterMs), cancellationToken).ConfigureAwait(false);
        }

        private static bool IsTransient(Exception ex)
        {
            if (ex is DownloadException dex)
                return dex.IsRetryable;
            return ex is HttpRequestException
                || ex is IOException
                || ex is TimeoutException
                || ex is TaskCanceledException
                || ex is OperationCanceledException;
        }
    }
}

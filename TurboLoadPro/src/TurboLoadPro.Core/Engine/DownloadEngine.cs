using System.Buffers;
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using TurboLoadPro.Core.Models;
using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Services;

namespace TurboLoadPro.Core.Engine;

/// <summary>
/// Streaming transfer engine. Segments write to disjoint offsets in one .turbopart file;
/// no complete file or segment is buffered in memory.
/// </summary>
public sealed class DownloadEngine
{
    private const int MaximumRetries = 6;
    private static readonly TimeSpan ReadIdleTimeout = TimeSpan.FromSeconds(60);
    private readonly SafeHttpClient _http;
    private readonly BandwidthLimiter _bandwidthLimiter;

    public DownloadEngine(SafeHttpClient http, BandwidthLimiter bandwidthLimiter)
    {
        _http = http;
        _bandwidthLimiter = bandwidthLimiter;
    }

    public async Task ExecuteAsync(
        DownloadRecord record,
        DownloadSettings settings,
        Func<DownloadRecord, bool, ValueTask> reportProgressAsync,
        CancellationToken cancellationToken)
    {
        settings.Normalize();
        var destination = Path.GetFullPath(record.DestinationPath);
        var directory = Path.GetDirectoryName(destination)
            ?? throw new InvalidDataException("The selected destination folder is invalid.");
        Directory.CreateDirectory(directory);
        var partPath = destination + ".turbopart";

        record.Status = DownloadStatus.Probing;
        record.Error = null;
        record.Sha256 = null;
        record.UpdatedUtc = DateTimeOffset.UtcNow;
        await reportProgressAsync(record, true).ConfigureAwait(false);

        var hadProgress = record.DownloadedBytes > 0 || record.Segments.Any(segment => segment.BytesReceived > 0);
        var probe = await ProbeWithRetryAsync(record.Url, cancellationToken).ConfigureAwait(false);
        var representationIsSafeToResume = IsSameRepresentation(record, probe);
        if (hadProgress && (!representationIsSafeToResume || !PartialStateMatchesDisk(record, partPath)))
            ResetPartialState(record, partPath);

        record.TotalBytes = probe.TotalBytes;
        record.EntityTag = probe.EntityTag;
        record.LastModified = probe.LastModified;
        record.SupportsRanges = probe.SupportsRanges;
        record.Connections = DownloadPlanner.ChooseConnections(
            probe.TotalBytes, settings.ConnectionsPerDownload, probe.Latency);
        record.Status = DownloadStatus.Downloading;
        record.UpdatedUtc = DateTimeOffset.UtcNow;
        await reportProgressAsync(record, true).ConfigureAwait(false);

        if (probe.TotalBytes == 0)
        {
            await using (var empty = new FileStream(partPath, FileMode.Create, FileAccess.Write, FileShare.Read,
                             1, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await empty.FlushAsync(cancellationToken).ConfigureAwait(false);
                empty.Flush(flushToDisk: true);
            }
            record.DownloadedBytes = 0;
        }
        else if (probe.SupportsRanges && probe.TotalBytes is > 0 &&
                 (IsStrongEntityTag(probe.EntityTag) || probe.LastModified.HasValue))
        {
            var segments = DownloadPlanner.CreateSegments(probe.TotalBytes.Value, record.Connections);
            PrepareSegments(record, segments);
            try
            {
                await DownloadRangesAsync(record, partPath, settings, reportProgressAsync, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (RangeUnsupportedException)
            {
                // A server may lie during the probe or change behavior. Stop every worker,
                // discard potentially mixed range data, and use one ordinary GET instead.
                ResetPartialState(record, partPath);
                record.SupportsRanges = false;
                record.Connections = 1;
                await reportProgressAsync(record, true).ConfigureAwait(false);
                await DownloadSingleStreamAsync(record, partPath, settings, reportProgressAsync, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        else
        {
            record.Connections = 1;
            record.Segments = [];
            await DownloadSingleStreamAsync(record, partPath, settings, reportProgressAsync, cancellationToken)
                .ConfigureAwait(false);
        }

        cancellationToken.ThrowIfCancellationRequested();
        await VerifyAndFinalizeAsync(record, partPath, settings.CalculateSha256, cancellationToken)
            .ConfigureAwait(false);
        record.Status = DownloadStatus.Completed;
        record.DownloadedBytes = new FileInfo(record.DestinationPath).Length;
        record.SpeedBytesPerSecond = 0;
        record.Error = null;
        record.UpdatedUtc = DateTimeOffset.UtcNow;
        await reportProgressAsync(record, true).ConfigureAwait(false);
    }

    private async Task<RangeProbeResult> ProbeWithRetryAsync(string url, CancellationToken cancellationToken)
    {
        for (var retry = 0; ; retry++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return await _http.ProbeAsync(url, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception) when (IsRecoverable(exception))
            {
                if (retry >= MaximumRetries) throw;
                await Task.Delay(GetRetryDelay(exception, retry), cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task DownloadRangesAsync(
        DownloadRecord record,
        string partPath,
        DownloadSettings settings,
        Func<DownloadRecord, bool, ValueTask> reportProgressAsync,
        CancellationToken cancellationToken)
    {
        var totalBytes = record.TotalBytes ?? throw new InvalidDataException("The server did not provide a file size for segmented downloading.");
        await using var output = new FileStream(partPath, FileMode.OpenOrCreate, FileAccess.ReadWrite,
            FileShare.ReadWrite, 1, FileOptions.Asynchronous | FileOptions.RandomAccess);
        if (output.Length != totalBytes) output.SetLength(totalBytes);

        var gate = new AdaptiveConcurrencyGate(record.Segments.Count);
        var checkpoint = new DiskCheckpoint(output.SafeFileHandle);
        using var workersCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var tasks = record.Segments
            .Where(segment => !segment.IsComplete)
            .Select(segment => DownloadSegmentAsync(record, segment, output.SafeFileHandle, settings,
                gate, checkpoint, reportProgressAsync, workersCancellation.Token))
            .ToArray();

        try
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }
        catch
        {
            workersCancellation.Cancel();
            try { await Task.WhenAll(tasks).ConfigureAwait(false); }
            catch { /* observe sibling cancellation/faults before releasing the shared file */ }

            if (!cancellationToken.IsCancellationRequested && tasks.Any(ContainsRangeUnsupported))
                throw new RangeUnsupportedException();
            throw;
        }
        finally
        {
            await output.FlushAsync(CancellationToken.None).ConfigureAwait(false);
            output.Flush(flushToDisk: true);
        }

        lock (record.SyncRoot)
        {
            if (record.Segments.Any(segment => !segment.IsComplete))
                throw new EndOfStreamException("One or more byte ranges were incomplete.");
            record.DownloadedBytes = record.Segments.Sum(segment => segment.BytesReceived);
        }
        await reportProgressAsync(record, true).ConfigureAwait(false);
    }

    private async Task DownloadSegmentAsync(
        DownloadRecord record,
        DownloadSegment segment,
        Microsoft.Win32.SafeHandles.SafeFileHandle fileHandle,
        DownloadSettings settings,
        AdaptiveConcurrencyGate gate,
        DiskCheckpoint checkpoint,
        Func<DownloadRecord, bool, ValueTask> reportProgressAsync,
        CancellationToken cancellationToken)
    {
        var retries = 0;
        var buffer = ArrayPool<byte>.Shared.Rent(settings.BufferSizeKiB * 1024);
        try
        {
            while (!segment.IsComplete)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var position = checked(segment.Start + segment.BytesReceived);
                var requestedEnd = segment.End;
                var bytesBeforeRequest = segment.BytesReceived;
                try
                {
                    using var lease = await gate.AcquireAsync(cancellationToken).ConfigureAwait(false);
                    var requestTimer = Stopwatch.StartNew();
                    using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    requestTimeout.CancelAfter(ReadIdleTimeout);
                    using var response = await _http.GetRangeAsync(record.Url, position, requestedEnd,
                        record.EntityTag, record.LastModified, requestTimeout.Token).ConfigureAwait(false);

                    if (response.StatusCode == HttpStatusCode.OK)
                        throw new RangeUnsupportedException();
                    if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
                        throw new InvalidDataException("The server rejected a byte range that should exist.");
                    if (response.StatusCode != HttpStatusCode.PartialContent)
                        SafeHttpClient.EnsureSuccess(response);

                    var contentRange = response.Content.Headers.ContentRange;
                    if (contentRange is null || !string.Equals(contentRange.Unit, "bytes", StringComparison.OrdinalIgnoreCase) ||
                        contentRange.From != position || contentRange.To is null || contentRange.To.Value < position ||
                        contentRange.To.Value > requestedEnd || contentRange.Length != record.TotalBytes)
                        throw new InvalidDataException("The server returned an incorrect Content-Range response; the output was not accepted.");

                    ValidateRepresentationHeaders(record, response);
                    var responseLength = checked(contentRange.To.Value - contentRange.From!.Value + 1);
                    if (response.Content.Headers.ContentLength is { } declaredLength && declaredLength != responseLength)
                        throw new InvalidDataException("The server returned inconsistent byte-range lengths.");

                    await using var input = await response.Content.ReadAsStreamAsync(requestTimeout.Token).ConfigureAwait(false);
                    var receivedThisResponse = 0L;
                    while (true)
                    {
                        requestTimeout.CancelAfter(ReadIdleTimeout);
                        var read = await input.ReadAsync(buffer.AsMemory(0, settings.BufferSizeKiB * 1024), requestTimeout.Token)
                            .ConfigureAwait(false);
                        requestTimeout.CancelAfter(Timeout.InfiniteTimeSpan);
                        if (read == 0) break;
                        if (receivedThisResponse + read > responseLength || segment.BytesReceived + read > segment.Length)
                            throw new InvalidDataException("The server sent more data than requested for a byte range.");

                        await _bandwidthLimiter.WaitAsync(read, cancellationToken).ConfigureAwait(false);
                        try
                        {
                            await RandomAccess.WriteAsync(fileHandle, buffer.AsMemory(0, read),
                                checked(position + receivedThisResponse), cancellationToken).ConfigureAwait(false);
                        }
                        catch (IOException exception)
                        {
                            throw new DownloadStorageException("A disk write failed while saving a download segment.", exception);
                        }
                        receivedThisResponse += read;
                        lock (record.SyncRoot)
                        {
                            segment.BytesReceived += read;
                            record.DownloadedBytes = record.Segments.Sum(current => current.BytesReceived);
                            record.UpdatedUtc = DateTimeOffset.UtcNow;
                        }
                        checkpoint.FlushIfDue();
                        await reportProgressAsync(record, false).ConfigureAwait(false);
                    }

                    if (receivedThisResponse != responseLength)
                        throw new EndOfStreamException("The server closed a byte-range response before all bytes arrived.");

                    requestTimer.Stop();
                    gate.ReportSuccess(receivedThisResponse, requestTimer.Elapsed);
                    retries = 0;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (RangeUnsupportedException)
                {
                    throw;
                }
                catch (Exception exception) when (IsRecoverable(exception))
                {
                    if (exception is DownloadHttpException { StatusCode: HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable })
                        gate.ReportServerThrottle();
                    if (retries >= MaximumRetries) throw;
                    await Task.Delay(GetRetryDelay(exception, retries), cancellationToken).ConfigureAwait(false);
                    retries++;

                    // If a response ended cleanly before the requested end, the next range
                    // request resumes exactly after the bytes already committed to disk.
                    if (segment.BytesReceived == bytesBeforeRequest && exception is EndOfStreamException)
                        continue;
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private async Task DownloadSingleStreamAsync(
        DownloadRecord record,
        string partPath,
        DownloadSettings settings,
        Func<DownloadRecord, bool, ValueTask> reportProgressAsync,
        CancellationToken cancellationToken)
    {
        var retries = 0;
        var buffer = ArrayPool<byte>.Shared.Rent(settings.BufferSizeKiB * 1024);
        try
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    requestTimeout.CancelAfter(ReadIdleTimeout);
                    using var response = await _http.GetAsync(record.Url, requestTimeout.Token).ConfigureAwait(false);
                    if (response.StatusCode != HttpStatusCode.OK)
                    {
                        SafeHttpClient.EnsureSuccess(response);
                        throw new InvalidDataException("The server returned an unexpected response to a non-ranged download.");
                    }

                    var contentLength = response.Content.Headers.ContentLength;
                    var responseTag = response.Headers.ETag?.ToString();
                    var responseModified = response.Content.Headers.LastModified;
                    if (record.TotalBytes.HasValue && contentLength.HasValue && record.TotalBytes != contentLength)
                        record.Segments = [];
                    record.TotalBytes = contentLength;
                    record.EntityTag = responseTag ?? record.EntityTag;
                    record.LastModified = responseModified ?? record.LastModified;
                    record.SupportsRanges = false;
                    record.Segments = [];
                    record.DownloadedBytes = 0;

                    await using var output = new FileStream(partPath, FileMode.Create, FileAccess.Write, FileShare.Read,
                        settings.BufferSizeKiB * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                    await using var input = await response.Content.ReadAsStreamAsync(requestTimeout.Token).ConfigureAwait(false);
                    long downloaded = 0;
                    var lastDurableFlush = Stopwatch.GetTimestamp();
                    while (true)
                    {
                        requestTimeout.CancelAfter(ReadIdleTimeout);
                        var read = await input.ReadAsync(buffer.AsMemory(0, settings.BufferSizeKiB * 1024), requestTimeout.Token)
                            .ConfigureAwait(false);
                        requestTimeout.CancelAfter(Timeout.InfiniteTimeSpan);
                        if (read == 0) break;
                        await _bandwidthLimiter.WaitAsync(read, cancellationToken).ConfigureAwait(false);
                        try
                        {
                            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                        }
                        catch (IOException exception)
                        {
                            throw new DownloadStorageException("A disk write failed while saving the download.", exception);
                        }
                        downloaded += read;
                        if (Stopwatch.GetElapsedTime(lastDurableFlush) >= TimeSpan.FromSeconds(1))
                        {
                            output.Flush(flushToDisk: true);
                            lastDurableFlush = Stopwatch.GetTimestamp();
                        }
                        lock (record.SyncRoot)
                        {
                            record.DownloadedBytes = downloaded;
                            record.UpdatedUtc = DateTimeOffset.UtcNow;
                        }
                        await reportProgressAsync(record, false).ConfigureAwait(false);
                    }
                    await output.FlushAsync(CancellationToken.None).ConfigureAwait(false);
                    output.Flush(flushToDisk: true);

                    if (contentLength.HasValue && downloaded != contentLength.Value)
                        throw new EndOfStreamException("The server closed the download before the announced file size arrived.");
                    record.TotalBytes = downloaded;
                    record.DownloadedBytes = downloaded;
                    await reportProgressAsync(record, true).ConfigureAwait(false);
                    return;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception) when (IsRecoverable(exception))
                {
                    if (retries >= MaximumRetries) throw;
                    await Task.Delay(GetRetryDelay(exception, retries), cancellationToken).ConfigureAwait(false);
                    retries++;
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static async Task VerifyAndFinalizeAsync(
        DownloadRecord record, string partPath, bool calculateSha256, CancellationToken cancellationToken)
    {
        var file = new FileInfo(partPath);
        if (!file.Exists) throw new FileNotFoundException("The temporary download file is missing.");
        if (record.TotalBytes.HasValue && file.Length != record.TotalBytes.Value)
            throw new InvalidDataException("The downloaded file size does not match the server's announced size.");
        if (record.SupportsRanges == true && record.Segments.Count > 0 &&
            record.Segments.Sum(segment => segment.BytesReceived) != record.TotalBytes)
            throw new InvalidDataException("The byte ranges do not cover the complete file.");

        if (calculateSha256)
        {
            await using var hashInput = new FileStream(partPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var digest = await SHA256.HashDataAsync(hashInput, cancellationToken).ConfigureAwait(false);
            record.Sha256 = Convert.ToHexString(digest);
        }

        var destination = record.DestinationPath;
        var directory = Path.GetDirectoryName(destination)!;
        var name = Path.GetFileName(destination);
        for (var attempt = 0; ; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (attempt > 0)
            {
                var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { destination };
                destination = FileNamePolicy.CreateUniquePath(directory, name, reserved);
                name = Path.GetFileName(destination);
            }
            try
            {
                File.Move(partPath, destination, overwrite: false);
                record.DestinationPath = destination;
                record.FileName = Path.GetFileName(destination);
                return;
            }
            catch (IOException) when (File.Exists(destination))
            {
                // Never replace a user file. Find another name if another process created it meanwhile.
            }
        }
    }

    private static bool PartialStateMatchesDisk(DownloadRecord record, string partPath)
    {
        try
        {
            var file = new FileInfo(partPath);
            if (!file.Exists) return false;
            if (record.SupportsRanges == true && record.Segments.Count > 0)
            {
                var sum = record.Segments.Sum(segment => segment.BytesReceived);
                return record.TotalBytes.HasValue && file.Length == record.TotalBytes.Value &&
                       sum == record.DownloadedBytes;
            }
            return file.Length >= record.DownloadedBytes;
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static bool IsSameRepresentation(DownloadRecord record, RangeProbeResult probe)
    {
        var hasPriorBytes = record.DownloadedBytes > 0 || record.Segments.Any(segment => segment.BytesReceived > 0);
        if (!hasPriorBytes) return true;
        if (record.TotalBytes != probe.TotalBytes) return false;

        var oldStrongTag = IsStrongEntityTag(record.EntityTag) ? record.EntityTag : null;
        var newStrongTag = IsStrongEntityTag(probe.EntityTag) ? probe.EntityTag : null;
        if (oldStrongTag is not null || newStrongTag is not null)
            return oldStrongTag is not null && string.Equals(oldStrongTag, newStrongTag, StringComparison.Ordinal);
        if (record.LastModified.HasValue || probe.LastModified.HasValue)
            return record.LastModified.HasValue && record.LastModified == probe.LastModified;
        // Without a stable validator it is safer to restart than risk joining two different versions.
        return false;
    }

    private static bool IsStrongEntityTag(string? entityTag) =>
        !string.IsNullOrWhiteSpace(entityTag) && !entityTag.StartsWith("W/", StringComparison.OrdinalIgnoreCase);

    private static void ValidateRepresentationHeaders(DownloadRecord record, HttpResponseMessage response)
    {
        var responseTag = response.Headers.ETag?.ToString();
        if (IsStrongEntityTag(record.EntityTag))
        {
            if (responseTag is null || !string.Equals(record.EntityTag, responseTag, StringComparison.Ordinal))
                throw new RangeUnsupportedException();
            return;
        }

        if (record.LastModified.HasValue && response.Content.Headers.LastModified != record.LastModified)
            throw new RangeUnsupportedException();
    }

    private static void PrepareSegments(DownloadRecord record, List<DownloadSegment> planned)
    {
        lock (record.SyncRoot)
        {
            if (!DownloadPlanner.SegmentsMatch(record.Segments, planned))
                record.Segments = planned;
            record.DownloadedBytes = record.Segments.Sum(segment => segment.BytesReceived);
        }
    }

    private static void ResetPartialState(DownloadRecord record, string partPath)
    {
        try { if (File.Exists(partPath)) File.Delete(partPath); }
        catch (IOException exception) { throw new DownloadStorageException("The stale temporary download file could not be removed.", exception); }
        lock (record.SyncRoot)
        {
            record.Segments = [];
            record.DownloadedBytes = 0;
        }
    }

    private static bool ContainsRangeUnsupported(Task task) => task.Exception?.Flatten().InnerExceptions
        .Any(exception => exception is RangeUnsupportedException) == true;

    private static bool IsRecoverable(Exception exception) => exception switch
    {
        DownloadHttpException httpException => httpException.IsTransient,
        HttpRequestException => true,
        EndOfStreamException => true,
        IOException when exception is not DownloadStorageException && exception is not InvalidDataException => true,
        OperationCanceledException => true,
        _ => false
    };

    private static TimeSpan GetRetryDelay(Exception exception, int retryIndex)
    {
        if (exception is DownloadHttpException { RetryAfter: { } retryAfter })
        {
            if (retryAfter <= TimeSpan.Zero) return TimeSpan.FromSeconds(1);
            return retryAfter > TimeSpan.FromDays(30) ? TimeSpan.FromDays(30) : retryAfter;
        }
        var milliseconds = Math.Min(30_000, 500 * Math.Pow(2, retryIndex));
        return TimeSpan.FromMilliseconds(milliseconds + Random.Shared.Next(0, 350));
    }

    private sealed class DiskCheckpoint(Microsoft.Win32.SafeHandles.SafeFileHandle handle)
    {
        private long _lastFlushTimestamp = Stopwatch.GetTimestamp();

        public void FlushIfDue()
        {
            var now = Stopwatch.GetTimestamp();
            var previous = Interlocked.Read(ref _lastFlushTimestamp);
            if (Stopwatch.GetElapsedTime(previous, now) < TimeSpan.FromSeconds(1)) return;
            if (Interlocked.CompareExchange(ref _lastFlushTimestamp, now, previous) != previous) return;
            try { RandomAccess.FlushToDisk(handle); }
            catch (IOException exception)
            {
                throw new DownloadStorageException("A disk checkpoint failed while saving download progress.", exception);
            }
        }
    }

    private sealed class RangeUnsupportedException : Exception { }
}

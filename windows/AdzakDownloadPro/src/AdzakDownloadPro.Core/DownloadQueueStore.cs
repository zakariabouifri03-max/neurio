using System.Text.Json;

namespace AdzakDownloadPro.Core;

/// <summary>Crash-safe local queue storage using write-through + same-volume atomic replacement.</summary>
public sealed class DownloadQueueStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly string _queuePath;
    private readonly SemaphoreSlim _ioLock = new(1, 1);

    public DownloadQueueStore(string? queuePath = null)
    {
        _queuePath = Path.GetFullPath(queuePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AdzakDownloadPro",
            "downloads.json"));
    }

    public string QueuePath => _queuePath;

    public async Task<IReadOnlyList<DownloadJobRecord>> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _ioLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!File.Exists(_queuePath))
                return [];

            await using var stream = new FileStream(
                _queuePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 64 * 1024,
                options: FileOptions.Asynchronous | FileOptions.SequentialScan);

            var jobs = await JsonSerializer.DeserializeAsync<List<DownloadJobRecord>>(
                stream, SerializerOptions, cancellationToken).ConfigureAwait(false);
            return jobs ?? [];
        }
        finally
        {
            _ioLock.Release();
        }
    }

    public async Task SaveAsync(
        IReadOnlyCollection<DownloadJobRecord> jobs,
        CancellationToken cancellationToken = default)
    {
        await _ioLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        string? temporaryPath = null;
        try
        {
            var directory = Path.GetDirectoryName(_queuePath)
                ?? throw new InvalidOperationException("Queue file must have a parent directory.");
            Directory.CreateDirectory(directory);

            temporaryPath = _queuePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            var payload = JsonSerializer.SerializeToUtf8Bytes(jobs, SerializerOptions);
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 64 * 1024,
                options: FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                // FlushAsync drains managed buffers; Flush(true) also requests an OS/disk flush.
                stream.Flush(flushToDisk: true);
            }

            // Source and destination are in the same directory, so replacement is atomic to readers.
            File.Move(temporaryPath, _queuePath, overwrite: true);
            temporaryPath = null;
        }
        finally
        {
            if (temporaryPath is not null)
            {
                try { File.Delete(temporaryPath); }
                catch (IOException) { /* The last valid queue file is still intact. */ }
                catch (UnauthorizedAccessException) { /* The last valid queue file is still intact. */ }
            }

            _ioLock.Release();
        }
    }
}

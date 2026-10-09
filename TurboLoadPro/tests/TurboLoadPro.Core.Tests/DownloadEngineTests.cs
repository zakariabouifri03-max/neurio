using System.Security.Cryptography;
using System.Text;
using TurboLoadPro.Core.Engine;
using TurboLoadPro.Core.Models;
using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Services;
using TurboLoadPro.Core.Storage;
using Xunit;

namespace TurboLoadPro.Core.Tests;

public sealed class DownloadEngineTests
{
    private static readonly Func<DownloadRecord, bool, ValueTask> NoProgress = (_, _) => ValueTask.CompletedTask;

    [Theory]
    [InlineData(0, 1)]
    [InlineData(20 * 1024 * 1024, 8)]
    [InlineData(300L * 1024 * 1024, 16)]
    [InlineData(3L * 1024 * 1024 * 1024, 32)]
    public void PlannerSelectsSensibleAutomaticConnectionCounts(long size, int expected)
    {
        Assert.Equal(expected, DownloadPlanner.ChooseConnections(size, 0, TimeSpan.FromMilliseconds(80)));
    }

    [Fact]
    public void PlannerCreatesNonOverlappingInclusiveRanges()
    {
        var segments = DownloadPlanner.CreateSegments(1_000_003, 8);
        Assert.Equal(8, segments.Count);
        Assert.Equal(0, segments[0].Start);
        Assert.Equal(1_000_002, segments[^1].End);
        Assert.Equal(1_000_003, segments.Sum(segment => segment.Length));
        for (var index = 1; index < segments.Count; index++)
            Assert.Equal(segments[index - 1].End + 1, segments[index].Start);
    }

    [Fact]
    public async Task SegmentedDownloadCombinesExactlyAndCalculatesSha256()
    {
        var bytes = MakeBytes(3 * 1024 * 1024 + 137);
        await using var server = new LocalHttpTestServer(bytes);
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "archive.bin"));
        var settings = Settings(connections: 8, hash: true);
        var engine = new DownloadEngine(http, new BandwidthLimiter());

        await engine.ExecuteAsync(record, settings, NoProgress, CancellationToken.None);

        Assert.Equal(DownloadStatus.Completed, record.Status);
        Assert.True(record.SupportsRanges);
        Assert.Equal(8, record.Segments.Count);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(record.DestinationPath));
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)), record.Sha256);
        Assert.Equal(bytes.LongLength, record.DownloadedBytes);
        Assert.Equal(9, server.RangeRequests.Count); // one-byte capability probe plus eight unique ranges
    }

    [Fact]
    public async Task ServerWithoutRangeSupportFallsBackToOneStreamingRequest()
    {
        var bytes = MakeBytes(1024 * 1024 + 19);
        await using var server = new LocalHttpTestServer(bytes) { IgnoreRangeRequests = true };
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "single-stream.dat"));

        await new DownloadEngine(http, new BandwidthLimiter())
            .ExecuteAsync(record, Settings(connections: 16), NoProgress, CancellationToken.None);

        Assert.Equal(DownloadStatus.Completed, record.Status);
        Assert.False(record.SupportsRanges);
        Assert.Empty(record.Segments);
        Assert.Empty(server.RangeRequests);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(record.DestinationPath));
    }

    [Fact]
    public async Task RangeMethodRejectedByServerFallsBackToPlainGet()
    {
        var bytes = MakeBytes(768 * 1024 + 41);
        await using var server = new LocalHttpTestServer(bytes) { RejectRangeRequests = true };
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "method-rejected.bin"));

        await new DownloadEngine(http, new BandwidthLimiter())
            .ExecuteAsync(record, Settings(connections: 16), NoProgress, CancellationToken.None);

        Assert.Equal(DownloadStatus.Completed, record.Status);
        Assert.False(record.SupportsRanges);
        Assert.Empty(record.Segments);
        Assert.Empty(server.RangeRequests);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(record.DestinationPath));
    }

    [Fact]
    public async Task InterruptedRangeRetriesFromCommittedOffsetWithoutCorruptingFile()
    {
        var bytes = MakeBytes(2 * 1024 * 1024 + 73);
        await using var server = new LocalHttpTestServer(bytes) { InterruptFirstTransferRange = true };
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "interrupted.iso"));

        await new DownloadEngine(http, new BandwidthLimiter())
            .ExecuteAsync(record, Settings(connections: 8), NoProgress, CancellationToken.None);

        Assert.Equal(DownloadStatus.Completed, record.Status);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(record.DestinationPath));
        Assert.Contains(server.RangeRequests, range => range.Start > 0);
    }

    [Fact]
    public async Task PauseAndResumePreservesCompletedOffsets()
    {
        var bytes = MakeBytes(4 * 1024 * 1024 + 111);
        await using var server = new LocalHttpTestServer(bytes);
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "resume.zip"));
        var settings = Settings(connections: 8);
        var engine = new DownloadEngine(http, new BandwidthLimiter());
        using var pause = new CancellationTokenSource();
        var pausedOnce = 0;
        ValueTask PauseAfterProgress(DownloadRecord current, bool force)
        {
            if (!force && current.DownloadedBytes >= 400_000 && Interlocked.Exchange(ref pausedOnce, 1) == 0)
                pause.Cancel();
            return ValueTask.CompletedTask;
        }

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            engine.ExecuteAsync(record, settings, PauseAfterProgress, pause.Token));
        var savedBytes = record.DownloadedBytes;
        Assert.True(savedBytes > 0);
        Assert.True(savedBytes < bytes.LongLength);
        Assert.True(File.Exists(record.DestinationPath + ".turbopart"));
        Assert.Equal(savedBytes, record.Segments.Sum(segment => segment.BytesReceived));

        await engine.ExecuteAsync(record, settings, NoProgress, CancellationToken.None);

        Assert.Equal(DownloadStatus.Completed, record.Status);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(record.DestinationPath));
    }

    [Fact]
    public async Task IncorrectContentRangeIsRejectedBeforePublishingAFile()
    {
        var bytes = MakeBytes(512 * 1024 + 31);
        await using var server = new LocalHttpTestServer(bytes) { ReturnInvalidContentRange = true };
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "bad-range.bin"));

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            new DownloadEngine(http, new BandwidthLimiter()).ExecuteAsync(
                record, Settings(connections: 8), NoProgress, CancellationToken.None));

        Assert.False(File.Exists(record.DestinationPath));
    }

    [Fact]
    public async Task ExpiredOrForbiddenUrlFailsWithoutEchoingSignedQueryTokens()
    {
        var bytes = MakeBytes(128);
        await using var server = new LocalHttpTestServer(bytes) { ErrorStatusCode = 403 };
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "denied.bin"));

        var exception = await Assert.ThrowsAsync<DownloadHttpException>(() =>
            new DownloadEngine(http, new BandwidthLimiter()).ExecuteAsync(
                record, Settings(), NoProgress, CancellationToken.None));

        Assert.Contains("denied", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("sample-test-token", exception.Message, StringComparison.Ordinal);
        Assert.False(File.Exists(record.DestinationPath));
    }

    [Fact]
    public async Task LargeFileIsStreamedToDiskAndHasCorrectHash()
    {
        // The transfer engine only rents bounded per-connection buffers; neither it nor this
        // assertion reads the completed 48 MiB output back into a second whole-file array.
        var bytes = MakeBytes(48 * 1024 * 1024 + 5);
        await using var server = new LocalHttpTestServer(bytes);
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var record = NewRecord(server.Url, Path.Combine(temp.Path, "large-file.iso"));
        var settings = Settings(connections: 16, hash: true);
        settings.BufferSizeKiB = 64;

        await new DownloadEngine(http, new BandwidthLimiter())
            .ExecuteAsync(record, settings, NoProgress, CancellationToken.None);

        await using var output = new FileStream(record.DestinationPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(output));
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)), actualHash);
        Assert.Equal(bytes.LongLength, output.Length);
    }

    [Fact]
    public async Task DiskWriteFailureDoesNotPublishACompletedFile()
    {
        var bytes = MakeBytes(1024);
        await using var server = new LocalHttpTestServer(bytes);
        using var http = new SafeHttpClient();
        using var temp = new TemporaryDirectory();
        var blocker = Path.Combine(temp.Path, "not-a-directory");
        await File.WriteAllTextAsync(blocker, "blocker");
        var record = NewRecord(server.Url, Path.Combine(blocker, "cannot-write.bin"));

        await Assert.ThrowsAnyAsync<IOException>(() =>
            new DownloadEngine(http, new BandwidthLimiter()).ExecuteAsync(
                record, Settings(), NoProgress, CancellationToken.None));

        Assert.False(File.Exists(record.DestinationPath));
    }

    [Fact]
    public async Task SqliteRestartRecoveryResumesAnInterruptedSegmentedDownload()
    {
        var bytes = MakeBytes(2 * 1024 * 1024 + 29);
        await using var server = new LocalHttpTestServer(bytes);
        using var temp = new TemporaryDirectory();
        var destination = Path.Combine(temp.Path, "recovered.bin");
        var partPath = destination + ".turbopart";
        var segments = DownloadPlanner.CreateSegments(bytes.LongLength, 8);
        var committed = Math.Min(48 * 1024, segments[0].Length);
        await using (var part = new FileStream(partPath, FileMode.Create, FileAccess.ReadWrite, FileShare.ReadWrite))
        {
            part.SetLength(bytes.LongLength);
            part.Position = 0;
            await part.WriteAsync(bytes.AsMemory(0, (int)committed));
            part.Flush(flushToDisk: true);
        }
        segments[0].BytesReceived = committed;
        var record = NewRecord(server.Url, destination);
        record.Status = DownloadStatus.Downloading;
        record.TotalBytes = bytes.LongLength;
        record.DownloadedBytes = committed;
        record.SupportsRanges = true;
        record.EntityTag = "\"stable-test-version\"";
        record.LastModified = new DateTimeOffset(2015, 10, 21, 7, 28, 0, TimeSpan.Zero);
        record.Connections = 8;
        record.Segments = segments;

        var database = Path.Combine(temp.Path, "history.sqlite3");
        var seedStore = new SqliteDownloadStore(database);
        await seedStore.InitializeAsync();
        await seedStore.SaveAsync(record);

        using var http = new SafeHttpClient();
        var bandwidth = new BandwidthLimiter();
        var manager = new DownloadManager(new SqliteDownloadStore(database),
            new DownloadEngine(http, bandwidth), bandwidth, Settings(connections: 8));
        await manager.InitializeAsync(autoResumeInterrupted: true);

        var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
        DownloadRecord? state;
        do
        {
            state = manager.GetSnapshot().Single(item => item.Id == record.Id);
            if (state.Status == DownloadStatus.Completed) break;
            await Task.Delay(50);
        } while (DateTimeOffset.UtcNow < deadline);
        await manager.ShutdownAsync();

        Assert.NotNull(state);
        Assert.Equal(DownloadStatus.Completed, state!.Status);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(state.DestinationPath));
    }

    private static DownloadRecord NewRecord(string url, string destination) => new()
    {
        Url = url,
        FileName = Path.GetFileName(destination),
        DestinationPath = destination,
        Status = DownloadStatus.Queued,
        Connections = 8
    };

    private static DownloadSettings Settings(int connections = 0, bool hash = false) => new()
    {
        DownloadDirectory = Path.GetTempPath(),
        ConnectionsPerDownload = connections,
        BufferSizeKiB = 64,
        CalculateSha256 = hash
    };

    private static byte[] MakeBytes(int count)
    {
        var bytes = new byte[count];
        new Random(410_2026).NextBytes(bytes);
        return bytes;
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "TurboLoadPro.Tests", Guid.NewGuid().ToString("N"));
        public TemporaryDirectory() => Directory.CreateDirectory(Path);
        public void Dispose()
        {
            try { Directory.Delete(Path, recursive: true); } catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}

using System.Diagnostics;
using System.Text;
using AdzakDownloadPro.Core;

namespace AdzakDownloadPro.Tests;

internal static class DownloadEngineScenarios
{
    private static readonly byte[] Payload = Encoding.ASCII.GetBytes("0123456789ABCDEFGHIJ");

    public static async Task WiFiDisconnectDuringDownloadAsync() =>
        await ReconnectAfterAsync(TimeSpan.FromSeconds(5), "Wi-Fi disconnect detection and automatic recovery");

    public static async Task InternetReturnsAfter10SecondsAsync() =>
        await ReconnectAfterAsync(TimeSpan.FromSeconds(10), "internet returns after 10 seconds");

    public static async Task InternetReturnsAfter30SecondsAsync() =>
        await ReconnectAfterAsync(TimeSpan.FromSeconds(30), "internet returns after 30 seconds");

    public static async Task InternetReturnsAfter60SecondsAsync() =>
        await ReconnectAfterAsync(TimeSpan.FromSeconds(60), "internet returns after 60 seconds");

    public static async Task RepeatedConnectionFailuresAsync()
    {
        var handler = new ScriptedHttpHandler(Payload);
        handler.FailNextConnections(3);
        var clock = new ManualClock();
        await using var fixture = await TestFixture.CreateAsync(handler, clock: clock);
        var job = await AddJobAsync(fixture, "repeated-failures.bin");

        for (var expectedRetry = 1; expectedRetry <= 3; expectedRetry++)
        {
            await WaitForJobAsync(fixture, job.Id, current => current.RetryCount >= expectedRetry,
                $"retry {expectedRetry}");
            clock.AdvanceBy(TimeSpan.FromMinutes(2));
        }

        var completed = await WaitForJobAsync(fixture, job.Id,
            current => current.Status == DownloadStatus.Completed, "repeated failures to recover");
        Assert(completed.RetryCount == 3, $"Expected 3 automatic retries, got {completed.RetryCount}.");
        AssertFileEquals(Path.Combine(fixture.Root, "repeated-failures.bin"), Payload);
        Assert(handler.Requests.Count(request => request.Method == HttpMethod.Get) >= 4,
            "Expected the original attempt plus three recovery attempts.");
    }

    public static async Task ServerSupportsRangeAsync()
    {
        var handler = new ScriptedHttpHandler(Payload);
        await using var fixture = await TestFixture.CreateAsync(handler);
        var job = await AddJobAsync(fixture, "range-supported.bin");
        await WaitForJobAsync(fixture, job.Id, current => current.Status == DownloadStatus.Completed, "range download completion");

        Assert(handler.Requests.Any(request => request.Method == HttpMethod.Get && request.RangeStart == 0),
            "The download did not issue its initial HTTP Range request.");
        Assert(handler.Requests.Any(request => request.Method == HttpMethod.Get && request.RangeStart == 8),
            "The download did not fetch the following byte range.");
        AssertFileEquals(Path.Combine(fixture.Root, "range-supported.bin"), Payload);
    }

    public static async Task ServerRefusesRangeAsync()
    {
        var handler = new ScriptedHttpHandler(Payload);
        handler.RefuseRanges(refuse: true);
        await using var fixture = await TestFixture.CreateAsync(handler);
        var job = await AddJobAsync(fixture, "range-refused.bin");
        var completed = await WaitForJobAsync(fixture, job.Id,
            current => current.Status == DownloadStatus.Completed, "full-response fallback completion");

        Assert(completed.RangeSupportKnown == false, "The range refusal was not recorded.");
        Assert(completed.LastError?.Contains("refused the Range", StringComparison.OrdinalIgnoreCase) == true,
            "The user was not told that a restart from byte zero is required.");
        AssertFileEquals(Path.Combine(fixture.Root, "range-refused.bin"), Payload);
    }

    public static async Task RemoteChangesWhilePausedAsync()
    {
        var monitor = new FakeNetworkMonitor(available: true);
        var handler = new ScriptedHttpHandler(Payload, "\"version-1\"");
        handler.DropRangeAfterBytes(0, 3, callback: null);
        var clock = new ManualClock();
        await using var fixture = await TestFixture.CreateAsync(handler, clock: clock, network: monitor);
        var job = await AddJobAsync(fixture, "changed-file.bin");
        var interrupted = await WaitForJobAsync(fixture, job.Id,
            current => current.RetryCount > 0 && current.PartialRange?.BytesReceived == 3,
            "paused partial download before remote change");

        await fixture.Coordinator.PauseAsync(job.Id);
        await WaitForJobAsync(fixture, job.Id, current => current.Status == DownloadStatus.Paused, "pause confirmation");
        var newPayload = Encoding.ASCII.GetBytes("abcdefghijKLMNOPQRST");
        handler.ChangeRemoteFile(newPayload, "\"version-2\"");
        clock.AdvanceBy(TimeSpan.FromMinutes(1));
        await fixture.Coordinator.ResumeAsync(job.Id);

        var completed = await WaitForJobAsync(fixture, job.Id,
            current => current.Status == DownloadStatus.Completed, "safe full restart after remote change");
        Assert(completed.LastError?.Contains("remote file changed", StringComparison.OrdinalIgnoreCase) == true,
            "The changed remote representation was not clearly reported.");
        Assert(handler.Requests.Any(request => request.RangeStart == 3 && request.IfRange == "\"version-1\""),
            "The resumed request did not use the saved HTTP validator.");
        AssertFileEquals(Path.Combine(fixture.Root, "changed-file.bin"), newPayload);
    }

    public static async Task ApplicationReopensAndResumesAsync()
    {
        var root = NewWorkspace();
        var monitor = new FakeNetworkMonitor(available: true);
        var firstHandler = new ScriptedHttpHandler(Payload);
        firstHandler.DropRangeAfterBytes(0, 3, callback: () => monitor.SetAvailable(false));
        var first = await TestFixture.CreateAsync(firstHandler, network: monitor, root: root, deleteWorkspace: false);
        var job = await AddJobAsync(first, "reopened.bin");
        await WaitForJobAsync(first, job.Id,
            current => current.RetryCount > 0 && current.PartialRange?.BytesReceived == 3,
            "saved partial before shutdown");
        await first.Coordinator.StopAsync();
        await first.DisposeAsync();

        var secondHandler = new ScriptedHttpHandler(Payload);
        var resumedClock = new ManualClock(DateTimeOffset.UtcNow.AddMinutes(1));
        await using var second = await TestFixture.CreateAsync(secondHandler, clock: resumedClock, root: root, deleteWorkspace: true);
        var restored = second.Coordinator.Snapshot.Single(item => item.Id == job.Id);
        Assert(restored.PartialRange?.BytesReceived == 3,
            $"Expected 3 persisted bytes after restart; got {restored.PartialRange?.BytesReceived ?? 0}.");
        await second.Coordinator.ResumePendingAsync([job.Id]);
        var completed = await WaitForJobAsync(second, job.Id,
            current => current.Status == DownloadStatus.Completed, "application restart resume");
        Assert(completed.RetryCount >= 1, "The original retry count was not restored.");
        Assert(secondHandler.Requests.Any(request => request.Method == HttpMethod.Get && request.RangeStart == 3),
            "The reopened application restarted from byte zero instead of the verified position.");
        AssertFileEquals(Path.Combine(root, "reopened.bin"), Payload);
    }

    public static async Task CorruptAndIncompleteSegmentAsync()
    {
        var root = NewWorkspace();
        var monitor = new FakeNetworkMonitor(available: true);
        var firstHandler = new ScriptedHttpHandler(Payload);
        firstHandler.DropRangeAfterBytes(8, 3, callback: () => monitor.SetAvailable(false));
        var first = await TestFixture.CreateAsync(firstHandler, network: monitor, root: root, deleteWorkspace: false);
        var job = await AddJobAsync(first, "corrupted-segment.bin");
        var interrupted = await WaitForJobAsync(first, job.Id,
            current => current.RetryCount > 0 && current.VerifiedRanges.Count == 1 &&
                       current.PartialRange?.BytesReceived == 3,
            "one complete and one partial segment");
        Assert(interrupted.VerifiedRanges[0].Start == 0, "First verified segment does not begin at byte zero.");
        var verifiedFile = interrupted.VerifiedRanges[0].Path;
        var incompleteFile = interrupted.PartialRange!.Path;
        await first.Coordinator.StopAsync();
        await first.DisposeAsync();

        // Corrupt a previously verified segment and truncate the interrupted segment before restore.
        await File.WriteAllBytesAsync(verifiedFile, Enumerable.Repeat((byte)0xFE, 8).ToArray());
        await using (var truncate = new FileStream(incompleteFile, FileMode.Open, FileAccess.Write, FileShare.Read))
        {
            truncate.SetLength(1);
            truncate.Flush(flushToDisk: true);
        }

        var monitor2 = new FakeNetworkMonitor(available: true);
        var handler2 = new ScriptedHttpHandler(Payload);
        var client2 = new HttpClient(handler2, disposeHandler: false) { Timeout = Timeout.InfiniteTimeSpan };
        var coordinator2 = new DownloadCoordinator(
            new DownloadQueueStore(Path.Combine(root, "queue.json")), monitor2, client2,
            TestFixture.TestOptions(), new ManualClock(DateTimeOffset.UtcNow.AddMinutes(1)));
        try
        {
            await coordinator2.InitializeAsync();
            var repaired = coordinator2.Snapshot.Single(item => item.Id == job.Id);
            Assert(repaired.VerifiedBytes == 0, "Corrupted bytes were incorrectly counted as verified.");
            Assert(repaired.LastError?.Contains("corrupted", StringComparison.OrdinalIgnoreCase) == true,
                "Corruption was not surfaced in the persisted job status.");
            await coordinator2.ResumePendingAsync([job.Id]);
            await WaitUntilAsync(() => coordinator2.Snapshot.Single(item => item.Id == job.Id).Status == DownloadStatus.Completed,
                "corrupted segment redownload", TimeSpan.FromSeconds(8));
            Assert(handler2.Requests.Any(request => request.Method == HttpMethod.Get && request.RangeStart == 0),
                "The corrupt prefix was not re-downloaded from byte zero.");
            AssertFileEquals(Path.Combine(root, "corrupted-segment.bin"), Payload);
        }
        finally
        {
            await coordinator2.DisposeAsync();
            client2.Dispose();
            await monitor2.DisposeAsync();
            try { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static async Task ReconnectAfterAsync(TimeSpan offlineDuration, string scenario)
    {
        var network = new FakeNetworkMonitor(available: true);
        var handler = new ScriptedHttpHandler(Payload);
        handler.DropRangeAfterBytes(0, 3, callback: () => network.SetAvailable(false));
        var clock = new ManualClock();
        await using var fixture = await TestFixture.CreateAsync(handler, clock: clock, network: network);
        var job = await AddJobAsync(fixture, $"resume-{(int)offlineDuration.TotalSeconds}.bin");
        var interrupted = await WaitForJobAsync(fixture, job.Id,
            current => current.RetryCount > 0 && current.PartialRange?.BytesReceived == 3,
            scenario + " partial checkpoint");
        Assert(interrupted.Status == DownloadStatus.InternetDisconnected,
            $"Expected disconnected status, got {interrupted.StatusText}.");
        Assert(interrupted.VerifiedBytes == 3, "The exact safely committed byte count was not preserved.");

        clock.AdvanceBy(offlineDuration < TimeSpan.FromSeconds(2) ? TimeSpan.FromSeconds(2) : offlineDuration);
        network.SetAvailable(true);
        var completed = await WaitForJobAsync(fixture, job.Id,
            current => current.Status == DownloadStatus.Completed, scenario + " automatic resume");
        Assert(completed.RetryCount == 1, "A single interruption should require only one automatic retry.");
        Assert(handler.Requests.Any(request => request.Method == HttpMethod.Get && request.RangeStart == 3),
            "The manager did not resume from the exact saved range.");
        AssertFileEquals(Path.Combine(fixture.Root, $"resume-{(int)offlineDuration.TotalSeconds}.bin"), Payload);
    }

    private static async Task<DownloadJobRecord> AddJobAsync(TestFixture fixture, string fileName) =>
        await fixture.Coordinator.AddAsync(
            "https://downloads.example.test/archive.bin?token=test-token",
            Path.Combine(fixture.Root, fileName),
            overwriteExisting: false);

    private static async Task<DownloadJobRecord> WaitForJobAsync(
        TestFixture fixture,
        Guid id,
        Func<DownloadJobRecord, bool> condition,
        string expectation,
        TimeSpan? timeout = null)
    {
        await WaitUntilAsync(() =>
        {
            var job = fixture.Coordinator.Snapshot.SingleOrDefault(item => item.Id == id);
            return job is not null && condition(job);
        }, expectation, timeout ?? TimeSpan.FromSeconds(8), () => fixture.Coordinator.Snapshot.Single(item => item.Id == id));
        return fixture.Coordinator.Snapshot.Single(item => item.Id == id);
    }

    private static async Task WaitUntilAsync(
        Func<bool> condition,
        string expectation,
        TimeSpan timeout,
        Func<DownloadJobRecord>? jobSnapshot = null)
    {
        var timer = Stopwatch.StartNew();
        while (timer.Elapsed < timeout)
        {
            if (condition())
                return;
            await Task.Delay(10);
        }
        var details = jobSnapshot is null ? "" : $" Last state: {jobSnapshot().StatusText}; retries={jobSnapshot().RetryCount}; error={jobSnapshot().LastError}";
        throw new TimeoutException($"Timed out waiting for {expectation}.{details}");
    }

    private static string NewWorkspace()
    {
        var root = Path.Combine(Path.GetTempPath(), "adz-dlp-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static void AssertFileEquals(string path, byte[] expected)
    {
        Assert(File.Exists(path), $"Expected output file was not created: {path}");
        var actual = File.ReadAllBytes(path);
        Assert(actual.SequenceEqual(expected), "The completed output bytes did not match the remote representation.");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException(message);
    }
}

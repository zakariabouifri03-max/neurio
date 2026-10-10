using System.Net;
using System.Net.Http.Headers;
using System.Threading.Channels;
using AdzakDownloadPro.Core;

namespace AdzakDownloadPro.Tests;

internal sealed class FakeNetworkMonitor : INetworkMonitor
{
    private readonly Channel<byte> _changes = Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
    {
        SingleReader = false,
        SingleWriter = false,
        FullMode = BoundedChannelFullMode.DropOldest
    });
    private int _available;

    public FakeNetworkMonitor(bool available = true) => _available = available ? 1 : 0;
    public bool IsNetworkAvailable => Volatile.Read(ref _available) != 0;
    public event EventHandler? NetworkChanged;
    public Func<Uri, CancellationToken, Task<bool>> Probe { get; set; } = (_, _) => Task.FromResult(true);

    public void SetAvailable(bool available)
    {
        var next = available ? 1 : 0;
        if (Interlocked.Exchange(ref _available, next) == next)
            return;
        _changes.Writer.TryWrite(0);
        NetworkChanged?.Invoke(this, EventArgs.Empty);
    }

    public Task<bool> IsInternetReachableAsync(Uri downloadUri, CancellationToken cancellationToken) =>
        Probe(downloadUri, cancellationToken);

    public async Task WaitForChangeAsync(TimeSpan fallbackInterval, CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var read = _changes.Reader.ReadAsync(linked.Token).AsTask();
        var timer = Task.Delay(fallbackInterval, linked.Token);
        await Task.WhenAny(read, timer).ConfigureAwait(false);
        linked.Cancel();
        try { await read.ConfigureAwait(false); }
        catch (OperationCanceledException) { }
        catch (ChannelClosedException) { }
        cancellationToken.ThrowIfCancellationRequested();
    }

    public ValueTask DisposeAsync()
    {
        _changes.Writer.TryComplete();
        return ValueTask.CompletedTask;
    }
}

internal sealed class ManualClock : IClock
{
    private readonly object _sync = new();
    private readonly List<(DateTimeOffset Due, TaskCompletionSource<bool> Completion)> _waiters = [];
    private DateTimeOffset _now;

    public ManualClock(DateTimeOffset? initialTime = null) => _now = initialTime ?? DateTimeOffset.UtcNow;

    public DateTimeOffset UtcNow
    {
        get { lock (_sync) return _now; }
    }

    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        TaskCompletionSource<bool> completion;
        lock (_sync)
        {
            if (delay <= TimeSpan.Zero)
                return Task.CompletedTask;
            if (_now + delay <= _now)
                return Task.CompletedTask;
            completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            _waiters.Add((_now + delay, completion));
        }

        if (cancellationToken.CanBeCanceled)
            cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
        return completion.Task;
    }

    public void AdvanceBy(TimeSpan amount)
    {
        List<TaskCompletionSource<bool>> due;
        lock (_sync)
        {
            _now += amount;
            due = _waiters.Where(waiter => waiter.Due <= _now).Select(waiter => waiter.Completion).ToList();
            _waiters.RemoveAll(waiter => waiter.Due <= _now);
        }
        foreach (var completion in due)
            completion.TrySetResult(true);
    }
}

internal sealed class ScriptedHttpHandler : HttpMessageHandler
{
    private readonly object _sync = new();
    private byte[] _data;
    private string _etag;
    private DateTimeOffset _lastModified;
    private bool _supportsRanges = true;
    private int _connectionFailures;
    private int _dropRangeStart = -1;
    private int _dropCount;
    private int _dropAfterBytes;
    private Action? _onDrop;
    private readonly List<RequestObservation> _requests = [];

    public ScriptedHttpHandler(byte[] data, string etag = "\"version-1\"")
    {
        _data = data.ToArray();
        _etag = etag;
        _lastModified = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
    }

    public IReadOnlyList<RequestObservation> Requests
    {
        get { lock (_sync) return _requests.ToArray(); }
    }

    public void RefuseRanges(bool refuse)
    {
        lock (_sync) _supportsRanges = !refuse;
    }

    public void FailNextConnections(int count)
    {
        lock (_sync) _connectionFailures = count;
    }

    public void DropRangeAfterBytes(int start, int afterBytes, Action? callback = null, int times = 1)
    {
        lock (_sync)
        {
            _dropRangeStart = start;
            _dropAfterBytes = afterBytes;
            _dropCount = times;
            _onDrop = callback;
        }
    }

    public void ChangeRemoteFile(byte[] data, string etag)
    {
        lock (_sync)
        {
            _data = data.ToArray();
            _etag = etag;
            _lastModified = DateTimeOffset.UtcNow;
        }
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (request.Method == HttpMethod.Head)
            return Task.FromResult(CreateResponse(HttpStatusCode.OK, Array.Empty<byte>(), _etag, _lastModified));

        var range = request.Headers.Range?.Ranges.SingleOrDefault();
        var start = range?.From ?? 0;
        var end = range?.To ?? -1;
        var ifRange = request.Headers.IfRange?.EntityTag?.ToString();
        byte[] data;
        string etag;
        DateTimeOffset lastModified;
        bool supportsRanges;
        bool shouldDrop;
        int dropAfter;
        Action? onDrop;
        lock (_sync)
        {
            _requests.Add(new RequestObservation(request.Method, range?.From, range?.To, ifRange));
            if (_connectionFailures > 0)
            {
                _connectionFailures--;
                throw new HttpRequestException("Simulated DNS or connection reset.");
            }
            data = _data.ToArray();
            etag = _etag;
            lastModified = _lastModified;
            supportsRanges = _supportsRanges;
            shouldDrop = range is not null && start == _dropRangeStart && _dropCount > 0;
            dropAfter = _dropAfterBytes;
            onDrop = _onDrop;
            if (shouldDrop)
                _dropCount--;
        }

        if (range is null)
            return Task.FromResult(CreateResponse(HttpStatusCode.OK, data, etag, lastModified));

        if (!supportsRanges || (ifRange is not null && !string.Equals(ifRange, etag, StringComparison.Ordinal)))
            return Task.FromResult(CreateResponse(HttpStatusCode.OK, data, etag, lastModified));

        if (start >= data.LongLength)
        {
            var notSatisfiable = new HttpResponseMessage(HttpStatusCode.RequestedRangeNotSatisfiable)
            {
                Content = new ByteArrayContent(Array.Empty<byte>())
            };
            notSatisfiable.Content.Headers.ContentRange = new ContentRangeHeaderValue(data.LongLength);
            notSatisfiable.Headers.ETag = EntityTagHeaderValue.Parse(etag);
            notSatisfiable.Content.Headers.LastModified = lastModified;
            return Task.FromResult(notSatisfiable);
        }

        var last = end < 0 ? data.LongLength - 1 : Math.Min(end, data.LongLength - 1);
        var length = checked((int)(last - start + 1));
        var body = data.AsSpan(checked((int)start), length).ToArray();
        var partialResponse = new HttpResponseMessage(HttpStatusCode.PartialContent)
        {
            Content = shouldDrop
                ? new StreamContent(new FaultAfterBytesStream(body, dropAfter, onDrop))
                : new ByteArrayContent(body)
        };
        partialResponse.Headers.ETag = EntityTagHeaderValue.Parse(etag);
        partialResponse.Content.Headers.ContentRange = new ContentRangeHeaderValue(start, last, data.LongLength);
        partialResponse.Content.Headers.ContentLength = body.LongLength;
        partialResponse.Content.Headers.LastModified = lastModified;
        return Task.FromResult(partialResponse);
    }

    private static HttpResponseMessage CreateResponse(
        HttpStatusCode status,
        byte[] data,
        string etag,
        DateTimeOffset lastModified)
    {
        var response = new HttpResponseMessage(status) { Content = new ByteArrayContent(data) };
        response.Headers.ETag = EntityTagHeaderValue.Parse(etag);
        response.Content.Headers.ContentLength = data.LongLength;
        response.Content.Headers.LastModified = lastModified;
        response.Headers.AcceptRanges.Add("bytes");
        return response;
    }
}

internal sealed record RequestObservation(HttpMethod Method, long? RangeStart, long? RangeEnd, string? IfRange);

internal sealed class FaultAfterBytesStream(byte[] bytes, int failAfterBytes, Action? onFailure) : Stream
{
    private int _position;
    private bool _failed;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => bytes.LongLength;
    public override long Position { get => _position; set => throw new NotSupportedException(); }

    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (!_failed && _position >= failAfterBytes)
        {
            _failed = true;
            onFailure?.Invoke();
            return ValueTask.FromException<int>(new IOException("Simulated Wi-Fi socket interruption."));
        }

        var allowed = !_failed ? Math.Min(buffer.Length, Math.Max(1, failAfterBytes - _position)) : buffer.Length;
        var count = Math.Min(allowed, bytes.Length - _position);
        if (count <= 0)
            return ValueTask.FromResult(0);
        bytes.AsMemory(_position, count).CopyTo(buffer);
        _position += count;
        return ValueTask.FromResult(count);
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();
        return read;
    }

    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

internal sealed class TestFixture : IAsyncDisposable
{
    private readonly bool _deleteWorkspace;
    private readonly HttpClient _client;

    private TestFixture(string root, bool deleteWorkspace, ScriptedHttpHandler handler, ManualClock clock,
        FakeNetworkMonitor network, HttpClient client, DownloadCoordinator coordinator)
    {
        Root = root;
        _deleteWorkspace = deleteWorkspace;
        Handler = handler;
        Clock = clock;
        Network = network;
        _client = client;
        Coordinator = coordinator;
    }

    public string Root { get; }
    public ScriptedHttpHandler Handler { get; }
    public ManualClock Clock { get; }
    public FakeNetworkMonitor Network { get; }
    public DownloadCoordinator Coordinator { get; }

    public static async Task<TestFixture> CreateAsync(
        ScriptedHttpHandler handler,
        ManualClock? clock = null,
        FakeNetworkMonitor? network = null,
        DownloadEngineOptions? options = null,
        string? root = null,
        bool deleteWorkspace = true)
    {
        root ??= Path.Combine(Path.GetTempPath(), "adz-dlp-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        clock ??= new ManualClock();
        network ??= new FakeNetworkMonitor();
        var client = new HttpClient(handler, disposeHandler: false) { Timeout = Timeout.InfiniteTimeSpan };
        var coordinator = new DownloadCoordinator(
            new DownloadQueueStore(Path.Combine(root, "queue.json")),
            network,
            client,
            options ?? TestOptions(),
            clock);
        await coordinator.InitializeAsync();
        return new TestFixture(root, deleteWorkspace, handler, clock, network, client, coordinator);
    }

    public static DownloadEngineOptions TestOptions() => new()
    {
        MaxConcurrentDownloads = 1,
        SegmentSizeBytes = 8,
        CheckpointSizeBytes = 2,
        RequestTimeout = TimeSpan.FromSeconds(2),
        ConnectivityPollInterval = TimeSpan.FromMilliseconds(20),
        RetryDelays =
        [
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(4),
            TimeSpan.FromSeconds(8),
            TimeSpan.FromSeconds(16),
            TimeSpan.FromSeconds(30),
            TimeSpan.FromSeconds(60)
        ]
    };

    public async ValueTask DisposeAsync()
    {
        await Coordinator.DisposeAsync();
        _client.Dispose();
        if (_deleteWorkspace)
        {
            try { if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}

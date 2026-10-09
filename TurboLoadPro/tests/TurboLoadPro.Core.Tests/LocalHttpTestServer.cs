using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace TurboLoadPro.Core.Tests;

internal sealed class LocalHttpTestServer : IAsyncDisposable
{
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly ConcurrentBag<Task> _connections = [];
    private readonly byte[] _content;
    private readonly Task _acceptLoop;
    private int _requestCount;
    private int _interrupted;

    public bool IgnoreRangeRequests { get; init; }
    public bool RejectRangeRequests { get; init; }
    public bool ReturnInvalidContentRange { get; init; }
    public bool InterruptFirstTransferRange { get; init; }
    public int? ErrorStatusCode { get; init; }
    public ConcurrentQueue<(long Start, long End)> RangeRequests { get; } = new();
    public string Url { get; }

    public LocalHttpTestServer(byte[] content)
    {
        _content = content;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        Url = $"http://127.0.0.1:{port}/object.bin?sig=sample-test-token";
        _acceptLoop = AcceptLoopAsync();
    }

    private async Task AcceptLoopAsync()
    {
        try
        {
            while (!_shutdown.IsCancellationRequested)
            {
                var client = await _listener.AcceptTcpClientAsync(_shutdown.Token).ConfigureAwait(false);
                var task = HandleClientAsync(client);
                _connections.Add(task);
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested) { }
        catch (SocketException) when (_shutdown.IsCancellationRequested) { }
    }

    private async Task HandleClientAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.NoDelay = true;
                await using var network = client.GetStream();
                using var reader = new StreamReader(network, Encoding.ASCII, detectEncodingFromByteOrderMarks: false,
                    bufferSize: 4096, leaveOpen: true);
                var requestLine = await reader.ReadLineAsync(_shutdown.Token).ConfigureAwait(false);
                if (requestLine is null) return;
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                while (true)
                {
                    var line = await reader.ReadLineAsync(_shutdown.Token).ConfigureAwait(false);
                    if (string.IsNullOrEmpty(line)) break;
                    var separator = line.IndexOf(':');
                    if (separator > 0) headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
                }

                Interlocked.Increment(ref _requestCount);
                if (ErrorStatusCode is { } error)
                {
                    await WriteErrorAsync(network, error).ConfigureAwait(false);
                    return;
                }

                var hasRange = headers.TryGetValue("Range", out var rangeHeader);
                if (hasRange && RejectRangeRequests)
                {
                    await WriteErrorAsync(network, 405).ConfigureAwait(false);
                    return;
                }
                if (!hasRange || IgnoreRangeRequests)
                {
                    await WriteFullResponseAsync(network).ConfigureAwait(false);
                    return;
                }

                var value = rangeHeader!.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)
                    ? rangeHeader[6..].Split('-', 2) : Array.Empty<string>();
                if (value.Length != 2 || !long.TryParse(value[0], out var start) || !long.TryParse(value[1], out var end) ||
                    start < 0 || end < start || start >= _content.LongLength)
                {
                    await WriteErrorAsync(network, 416).ConfigureAwait(false);
                    return;
                }
                end = Math.Min(end, _content.LongLength - 1);
                RangeRequests.Enqueue((start, end));
                var responseStart = ReturnInvalidContentRange && end > start ? start + 1 : start;
                var responseEnd = ReturnInvalidContentRange && end > start ? end + 1 : end;
                var count = checked((int)(end - start + 1));
                await WriteHeadersAsync(network, 206, count,
                    $"Content-Range: bytes {responseStart}-{responseEnd}/{_content.LongLength}\r\n").ConfigureAwait(false);

                var isProbe = start == 0 && end == 0;
                if (InterruptFirstTransferRange && !isProbe && Interlocked.CompareExchange(ref _interrupted, 1, 0) == 0)
                {
                    var shortCount = Math.Max(1, count / 2);
                    await network.WriteAsync(_content.AsMemory((int)start, shortCount), _shutdown.Token).ConfigureAwait(false);
                    client.Client.LingerState = new LingerOption(true, 0);
                    return;
                }
                await network.WriteAsync(_content.AsMemory((int)start, count), _shutdown.Token).ConfigureAwait(false);
            }
            catch (Exception exception) when (exception is IOException or SocketException or OperationCanceledException or ObjectDisposedException)
            {
                // Deliberate RST/early close cases are expected by the interrupted-stream tests.
            }
        }
    }

    private async Task WriteFullResponseAsync(NetworkStream stream)
    {
        await WriteHeadersAsync(stream, 200, _content.Length, string.Empty).ConfigureAwait(false);
        await stream.WriteAsync(_content, _shutdown.Token).ConfigureAwait(false);
    }

    private static async Task WriteErrorAsync(NetworkStream stream, int status)
    {
        var reason = status switch
        {
            403 => "Forbidden", 404 => "Not Found", 405 => "Method Not Allowed",
            429 => "Too Many Requests", _ => "Error"
        };
        var body = Encoding.UTF8.GetBytes("test error");
        var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {status} {reason}\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(header).ConfigureAwait(false);
        await stream.WriteAsync(body).ConfigureAwait(false);
    }

    private static async Task WriteHeadersAsync(NetworkStream stream, int status, int contentLength, string extraHeaders)
    {
        var header = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {status} {(status == 206 ? "Partial Content" : "OK")}\r\n" +
            $"Content-Length: {contentLength}\r\n" +
            "Accept-Ranges: bytes\r\n" +
            "ETag: \"stable-test-version\"\r\n" +
            "Last-Modified: Wed, 21 Oct 2015 07:28:00 GMT\r\n" +
            "Content-Type: application/octet-stream\r\n" + extraHeaders +
            "Connection: close\r\n\r\n");
        await stream.WriteAsync(header).ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        _listener.Stop();
        try { await _acceptLoop.ConfigureAwait(false); } catch { }
        try { await Task.WhenAll(_connections.ToArray()).ConfigureAwait(false); } catch { }
        _shutdown.Dispose();
    }
}

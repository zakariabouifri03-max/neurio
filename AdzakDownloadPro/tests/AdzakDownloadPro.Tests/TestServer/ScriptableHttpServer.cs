using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AdzakDownloadPro.Tests.TestServer
{
    /// <summary>A single recorded HTTP request.</summary>
    public sealed class RecordedRequest
    {
        public string Method { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
        public string? RangeHeader { get; set; }
        public int ConnectionId { get; set; }
        public DateTimeOffset At { get; set; }

        /// <summary>Body bytes actually sent for this request.</summary>
        public long BodyBytesSent { get; set; }
    }

    /// <summary>Everything the server needs to know about an incoming request.</summary>
    public sealed class RequestContext
    {
        public string Method { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
        public string? RangeHeader { get; set; }
        public int ConnectionId { get; set; }
        public IReadOnlyDictionary<string, string> Headers { get; set; }
            = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Describes how the server should respond.</summary>
    public sealed class ResponseSpec
    {
        public int StatusCode { get; set; } = 200;
        public string? ReasonPhrase { get; set; }
        public Dictionary<string, string> Headers { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public byte[]? Body { get; set; }
        public string? ContentRange { get; set; }

        /// <summary>When >= 0, only this many body bytes are sent before the connection is closed (simulates a dropped connection).</summary>
        public int SendBodyBytesThenClose { get; set; } = -1;

        /// <summary>When > 0, the body is drip-fed at this many bytes per second (simulates a slow link).</summary>
        public int ThrottleBytesPerSecond { get; set; }

        /// <summary>When true, Content-Length is omitted and the body is close-delimited (unknown size).</summary>
        public bool OmitContentLength { get; set; }

        /// <summary>When >= 0, this value is advertised as Content-Length instead of the real body length
        /// (simulates a server that sends more bytes than it declares).</summary>
        public long ContentLengthOverride { get; set; } = -1;

        /// <summary>When > 0, this many bytes of the body are sent at <see cref="ThrottleBytesPerSecond"/> before switching to full speed (simulates slow start on one range).</summary>
        public int SlowStartBytes { get; set; }
    }

    /// <summary>
    /// A scriptable HTTP/1.1 server over a raw <see cref="TcpListener"/> for testing the download engine:
    /// full control over Range handling, status codes, throttling, mid-body drops, redirects and headers,
    /// plus recording of every request for assertions.
    /// </summary>
    public sealed class ScriptableHttpServer : IDisposable
    {
        private readonly TcpListener _listener;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly List<Task> _connectionTasks = new List<Task>();
        private readonly object _gate = new object();
        private readonly List<RecordedRequest> _requests = new List<RecordedRequest>();
        private int _connectionId;
        private int _currentConcurrent;
        private int _maxConcurrent;
        private long _totalBodyBytesSent;

        public ScriptableHttpServer()
        {
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
            _ = AcceptLoopAsync();
        }

        public int Port { get; }

        public string BaseUrl => $"http://127.0.0.1:{Port}";

        /// <summary>Payload served for <see cref="PayloadPath"/>.</summary>
        public byte[] Payload { get; set; } = Array.Empty<byte>();

        public string PayloadPath { get; set; } = "/file.bin";

        /// <summary>Whether the server honours Range requests on the payload.</summary>
        public bool SupportsRanges { get; set; } = true;

        /// <summary>ETag sent with payload responses (null = none).</summary>
        public string? ETag { get; set; } = "\"v1\"";

        /// <summary>When true, a correct X-Checksum-Sha256 header is sent with payload responses.</summary>
        public bool SendCorrectChecksumHeader { get; set; }

        /// <summary>When true, an incorrect X-Checksum-Sha256 header is sent (checksum-mismatch test).</summary>
        public bool SendWrongChecksumHeader { get; set; }

        /// <summary>Content-Disposition file name sent with payload responses (null = none).</summary>
        public string? ContentDispositionFileName { get; set; }

        /// <summary>Paths that answer 302 to <see cref="RedirectTarget"/>.</summary>
        public HashSet<string> RedirectPaths { get; } = new HashSet<string>(StringComparer.Ordinal);

        public string RedirectTarget { get; set; } = "/file.bin";

        /// <summary>Paths that always answer 404.</summary>
        public HashSet<string> MissingPaths { get; } = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>Per-path counter of requests that should fail with 500 before succeeding.</summary>
        public Dictionary<string, int> FailFirstNRequestsWith500 { get; } = new Dictionary<string, int>(StringComparer.Ordinal);

        /// <summary>Per-path counter of requests that should fail with 429 + Retry-After before succeeding.</summary>
        public Dictionary<string, int> FailFirstNRequestsWith429 { get; } = new Dictionary<string, int>(StringComparer.Ordinal);

        /// <summary>When > 0, every payload response body is throttled to this many bytes per second.</summary>
        public int ThrottleBytesPerSecond { get; set; }

        /// <summary>When >= 0, every payload response is cut off after this many body bytes (connection drop).</summary>
        public int DropAfterBodyBytes { get; set; } = -1;

        /// <summary>Range starts (absolute byte offsets) whose responses are throttled to <see cref="StalledRangeThrottleBytesPerSecond"/>.</summary>
        public HashSet<long> StalledRangeStarts { get; } = new HashSet<long>();

        public int StalledRangeThrottleBytesPerSecond { get; set; } = 20 * 1024;

        /// <summary>For a stalled range, only the first N bytes are slow; the rest goes at full speed.</summary>
        public int StalledRangeSlowBytes { get; set; } = 128 * 1024;

        /// <summary>When true, Content-Length is omitted for the payload (unknown size, close-delimited).</summary>
        public bool OmitContentLength { get; set; }

        /// <summary>When true, Range requests are ignored (always 200 with the full body).</summary>
        public bool IgnoreRangeRequests { get; set; }

        /// <summary>Optional custom handler; when it returns non-null, it wins over the built-in behaviour.</summary>
        public Func<RequestContext, ResponseSpec?>? CustomHandler { get; set; }

        // ---- statistics ----

        public IReadOnlyList<RecordedRequest> Requests
        {
            get { lock (_gate) return _requests.ToArray(); }
        }

        public int MaxConcurrentRequests
        {
            get { lock (_gate) return _maxConcurrent; }
        }

        public long TotalBodyBytesSent
        {
            get { lock (_gate) return _totalBodyBytesSent; }
        }

        public void ClearRecordedRequests()
        {
            lock (_gate) _requests.Clear();
        }

        public static byte[] MakePayload(int size, int seed = 1234)
        {
            var payload = new byte[size];
            var rng = new Random(seed);
            rng.NextBytes(payload);
            return payload;
        }

        private async Task AcceptLoopAsync()
        {
            while (!_cts.IsCancellationRequested)
            {
                TcpClient client;
                try
                {
                    client = await _listener.AcceptTcpClientAsync().ConfigureAwait(false);
                }
                catch (Exception)
                {
                    if (_cts.IsCancellationRequested)
                        return;
                    // A single failed accept (e.g. a client that reset the connection before we
                    // accepted it) must never kill the server — keep accepting.
                    try { await Task.Delay(10, _cts.Token).ConfigureAwait(false); }
                    catch (Exception) { return; }
                    continue;
                }
                lock (_gate)
                    _connectionTasks.Add(HandleConnectionAsync(client));
            }
        }

        private async Task HandleConnectionAsync(TcpClient client)
        {
            int connectionId;
            lock (_gate)
            {
                connectionId = ++_connectionId;
                _currentConcurrent++;
                if (_currentConcurrent > _maxConcurrent)
                    _maxConcurrent = _currentConcurrent;
            }

            try
            {
                using (client)
                {
                    client.ReceiveTimeout = 30000;
                    client.SendTimeout = 30000;
                    var stream = client.GetStream();

                    var request = await ReadRequestAsync(stream, _cts.Token).ConfigureAwait(false);
                    if (request == null)
                        return;

                    var spec = BuildResponse(request);

                    // Record the request the moment it arrives, so tests can assert on the
                    // request log deterministically (a response is only fully written after
                    // the engine has already consumed its last byte).
                    RecordedRequest recorded;
                    lock (_gate)
                    {
                        recorded = new RecordedRequest
                        {
                            Method = request.Method,
                            Path = request.Path,
                            RangeHeader = request.RangeHeader,
                            ConnectionId = connectionId,
                            At = DateTimeOffset.UtcNow,
                        };
                        _requests.Add(recorded);
                    }

                    long sent = await WriteResponseAsync(stream, spec, _cts.Token).ConfigureAwait(false);

                    lock (_gate)
                    {
                        recorded.BodyBytesSent = sent;
                        _totalBodyBytesSent += sent;
                    }
                }
            }
            catch (Exception)
            {
                // connection errors are part of the tests (drops etc.)
            }
            finally
            {
                lock (_gate)
                    _currentConcurrent--;
            }
        }

        private static async Task<RequestContext?> ReadRequestAsync(NetworkStream stream, CancellationToken ct)
        {
            var buffer = new MemoryStream();
            var one = new byte[1];
            var sb = new StringBuilder();
            int matched = 0;
            var terminator = new byte[] { (byte)'\r', (byte)'\n', (byte)'\r', (byte)'\n' };

            while (matched < 4)
            {
                int read = await stream.ReadAsync(one, 0, 1, ct).ConfigureAwait(false);
                if (read == 0)
                    return null;
                buffer.WriteByte(one[0]);
                if (one[0] == terminator[matched])
                {
                    matched++;
                }
                else
                {
                    matched = one[0] == (byte)'\r' ? 1 : 0;
                }
                if (buffer.Length > 64 * 1024)
                    return null;
            }

            var text = Encoding.ASCII.GetString(buffer.ToArray());
            var lines = text.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length == 0)
                return null;

            var requestLine = lines[0].Split(' ');
            if (requestLine.Length < 2)
                return null;

            // Match on the path only; query strings are ignored by the built-in behaviour.
            var rawPath = requestLine[1];
            int query = rawPath.IndexOf('?');
            if (query >= 0)
                rawPath = rawPath.Substring(0, query);

            var context = new RequestContext
            {
                Method = requestLine[0],
                Path = rawPath,
                ConnectionId = 0, // set by caller
            };
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in lines.Skip(1))
            {
                int colon = line.IndexOf(':');
                if (colon <= 0)
                    continue;
                var name = line.Substring(0, colon).Trim();
                var value = line.Substring(colon + 1).Trim();
                headers[name] = value;
                if (name.Equals("Range", StringComparison.OrdinalIgnoreCase))
                    context.RangeHeader = value;
            }
            context.Headers = headers;
            return context;
        }

        private ResponseSpec BuildResponse(RequestContext request)
        {
            if (CustomHandler != null)
            {
                var custom = CustomHandler(request);
                if (custom != null)
                    return custom;
            }

            // Redirects
            if (RedirectPaths.Contains(request.Path))
            {
                return new ResponseSpec
                {
                    StatusCode = 302,
                    ReasonPhrase = "Found",
                    Headers = { ["Location"] = RedirectTarget },
                    Body = Array.Empty<byte>(),
                };
            }

            // Missing files
            if (MissingPaths.Contains(request.Path) || (request.Path != PayloadPath && request.Path != "/"))
            {
                return new ResponseSpec
                {
                    StatusCode = 404,
                    ReasonPhrase = "Not Found",
                    Body = Encoding.UTF8.GetBytes("not found"),
                };
            }

            // Scripted failures
            if (FailFirstNRequestsWith500.TryGetValue(request.Path, out int fail500) && fail500 > 0)
            {
                lock (_gate)
                    FailFirstNRequestsWith500[request.Path] = fail500 - 1;
                return new ResponseSpec
                {
                    StatusCode = 500,
                    ReasonPhrase = "Internal Server Error",
                    Body = Encoding.UTF8.GetBytes("boom"),
                };
            }
            if (FailFirstNRequestsWith429.TryGetValue(request.Path, out int fail429) && fail429 > 0)
            {
                lock (_gate)
                    FailFirstNRequestsWith429[request.Path] = fail429 - 1;
                return new ResponseSpec
                {
                    StatusCode = 429,
                    ReasonPhrase = "Too Many Requests",
                    Headers = { ["Retry-After"] = "1" },
                    Body = Encoding.UTF8.GetBytes("slow down"),
                };
            }

            // The payload
            var payload = Payload;
            long? rangeStart = null;
            long? rangeEnd = null;

            if (!IgnoreRangeRequests && request.RangeHeader != null
                && request.RangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
            {
                var rangeValue = request.RangeHeader.Substring("bytes=".Length);
                int dash = rangeValue.IndexOf('-');
                if (dash > 0)
                {
                    if (long.TryParse(rangeValue.Substring(0, dash), out long s))
                        rangeStart = s;
                    var endPart = rangeValue.Substring(dash + 1);
                    if (long.TryParse(endPart, out long e))
                        rangeEnd = e;
                }
            }

            if (rangeStart != null && SupportsRanges)
            {
                long start = rangeStart.Value;
                long end = rangeEnd ?? payload.Length - 1;
                if (end >= payload.Length)
                    end = payload.Length - 1;

                if (start >= payload.Length)
                {
                    return new ResponseSpec
                    {
                        StatusCode = 416,
                        ReasonPhrase = "Range Not Satisfiable",
                        Headers = { ["Content-Range"] = $"bytes */{payload.Length}" },
                        Body = Array.Empty<byte>(),
                    };
                }

                int length = (int)(end - start + 1);
                var body = new byte[length];
                Array.Copy(payload, start, body, 0, length);

                var spec = new ResponseSpec
                {
                    StatusCode = 206,
                    ReasonPhrase = "Partial Content",
                    Body = body,
                    ContentRange = $"bytes {start}-{end}/{payload.Length}",
                };
                AddCommonHeaders(spec, payload.Length);

                // Stalled range simulation (slow start on one specific range).
                if (StalledRangeStarts.Contains(start))
                {
                    spec.ThrottleBytesPerSecond = StalledRangeThrottleBytesPerSecond;
                    spec.SlowStartBytes = StalledRangeSlowBytes;
                }
                return spec;
            }

            // Full body
            var full = new ResponseSpec
            {
                StatusCode = 200,
                ReasonPhrase = "OK",
                Body = payload,
            };
            AddCommonHeaders(full, payload.Length);
            return full;
        }

        private void AddCommonHeaders(ResponseSpec spec, long totalSize)
        {
            if (ETag != null)
                spec.Headers["ETag"] = ETag;
            if (ContentDispositionFileName != null)
                spec.Headers["Content-Disposition"] = $"attachment; filename=\"{ContentDispositionFileName}\"";
            if (SendCorrectChecksumHeader)
                spec.Headers["X-Checksum-Sha256"] = AdzakDownloadPro.Core.Checksum.ComputeSha256Hex(Payload);
            if (SendWrongChecksumHeader)
                spec.Headers["X-Checksum-Sha256"] = AdzakDownloadPro.Core.Checksum.ComputeSha256Hex(Encoding.UTF8.GetBytes("something else entirely"));
            if (OmitContentLength)
                spec.OmitContentLength = true;
            if (ThrottleBytesPerSecond > 0 && spec.ThrottleBytesPerSecond == 0)
                spec.ThrottleBytesPerSecond = ThrottleBytesPerSecond;
            if (DropAfterBodyBytes >= 0)
                spec.SendBodyBytesThenClose = DropAfterBodyBytes;
        }

        private static readonly string[] ReasonPhrases = BuildReasonPhrases();

        private static string[] BuildReasonPhrases()
        {
            var phrases = new string[600];
            phrases[200] = "OK";
            phrases[206] = "Partial Content";
            phrases[301] = "Moved Permanently";
            phrases[302] = "Found";
            phrases[304] = "Not Modified";
            phrases[400] = "Bad Request";
            phrases[401] = "Unauthorized";
            phrases[403] = "Forbidden";
            phrases[404] = "Not Found";
            phrases[408] = "Request Timeout";
            phrases[409] = "Conflict";
            phrases[410] = "Gone";
            phrases[416] = "Range Not Satisfiable";
            phrases[425] = "Too Early";
            phrases[429] = "Too Many Requests";
            phrases[500] = "Internal Server Error";
            phrases[502] = "Bad Gateway";
            phrases[503] = "Service Unavailable";
            phrases[504] = "Gateway Timeout";
            return phrases;
        }

        private static async Task<long> WriteResponseAsync(NetworkStream stream, ResponseSpec spec, CancellationToken ct)
        {
            var reason = spec.ReasonPhrase ?? (spec.StatusCode < ReasonPhrases.Length ? ReasonPhrases[spec.StatusCode] : null) ?? "Status";
            var sb = new StringBuilder();
            sb.Append($"HTTP/1.1 {spec.StatusCode} {reason}\r\n");

            var body = spec.Body ?? Array.Empty<byte>();
            foreach (var header in spec.Headers)
                sb.Append($"{header.Key}: {header.Value}\r\n");
            if (spec.ContentRange != null)
                sb.Append($"Content-Range: {spec.ContentRange}\r\n");
            if (!spec.OmitContentLength)
            {
                long advertised = spec.ContentLengthOverride >= 0 ? spec.ContentLengthOverride : body.Length;
                sb.Append($"Content-Length: {advertised}\r\n");
            }
            sb.Append("Connection: close\r\n");
            sb.Append("\r\n");

            var headerBytes = Encoding.ASCII.GetBytes(sb.ToString());
            await stream.WriteAsync(headerBytes, 0, headerBytes.Length, ct).ConfigureAwait(false);

            long sent = 0;
            int chunk = 16 * 1024;
            int offset = 0;
            int slowRemaining = spec.SlowStartBytes > 0 ? spec.SlowStartBytes : 0;

            while (offset < body.Length)
            {
                ct.ThrowIfCancellationRequested();

                if (spec.SendBodyBytesThenClose >= 0 && sent >= spec.SendBodyBytesThenClose)
                    break; // simulate a dropped connection mid-body

                int size = Math.Min(chunk, body.Length - offset);
                await stream.WriteAsync(body, offset, size, ct).ConfigureAwait(false);
                sent += size;
                offset += size;

                if (spec.SlowStartBytes > 0)
                {
                    // Slow start: the first N bytes go at the throttled speed, the rest at full speed.
                    if (slowRemaining > 0 && spec.ThrottleBytesPerSecond > 0)
                    {
                        int slowChunk = Math.Min(size, slowRemaining);
                        slowRemaining -= slowChunk;
                        await Task.Delay(TimeSpan.FromSeconds(slowChunk / (double)spec.ThrottleBytesPerSecond), ct)
                            .ConfigureAwait(false);
                    }
                }
                else if (spec.ThrottleBytesPerSecond > 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(size / (double)spec.ThrottleBytesPerSecond), ct)
                        .ConfigureAwait(false);
                }
            }

            try { await stream.FlushAsync(ct).ConfigureAwait(false); } catch (Exception) { /* dropped */ }
            return sent;
        }

        public void Dispose()
        {
            _cts.Cancel();
            try { _listener.Stop(); } catch (Exception) { /* ignore */ }
            lock (_gate)
            {
                foreach (var task in _connectionTasks)
                {
                    try { task.Wait(TimeSpan.FromSeconds(2)); } catch (Exception) { /* ignore */ }
                }
            }
            _cts.Dispose();
        }
    }
}

using System.Net;
using System.Net.Http.Headers;
using TurboLoadPro.Core.Services;

namespace TurboLoadPro.Core.Networking;

/// <summary>HTTP transport with explicit, bounded redirect handling and no cookies or credentials.</summary>
public sealed class SafeHttpClient : IDisposable
{
    private const int MaxRedirects = 5;
    private readonly HttpClient _client;

    public SafeHttpClient()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            UseCookies = false,
            ConnectTimeout = TimeSpan.FromSeconds(15),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            MaxConnectionsPerServer = 64
        };
        _client = new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public async Task<RangeProbeResult> ProbeAsync(string url, CancellationToken cancellationToken)
    {
        var uri = UrlPolicy.Validate(url);
        var timer = System.Diagnostics.Stopwatch.StartNew();
        using var probeTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        probeTimeout.CancelAfter(TimeSpan.FromSeconds(60));
        using var response = await SendFollowingRedirectsAsync(uri, current => CreateRequest(current, 0, 0, null), probeTimeout.Token)
            .ConfigureAwait(false);
        timer.Stop();

        var entityTag = response.Headers.ETag?.ToString();
        var lastModified = response.Content.Headers.LastModified;
        var disposition = response.Content.Headers.ContentDisposition;
        var suggestedName = disposition?.FileNameStar ?? disposition?.FileName;

        if (response.StatusCode == HttpStatusCode.PartialContent)
        {
            var range = response.Content.Headers.ContentRange;
            if (range is null || !string.Equals(range.Unit, "bytes", StringComparison.OrdinalIgnoreCase) ||
                range.From != 0 || range.To != 0 || range.Length is not > 0)
                throw new InvalidDataException("The server returned an invalid byte-range probe response.");

            // Read the probe byte so a broken 206 response is not mistaken for range support.
            if (response.Content.Headers.ContentLength is { } probeLength && probeLength != 1)
                throw new InvalidDataException("The server returned an invalid byte-range probe length.");
            await using var stream = await response.Content.ReadAsStreamAsync(probeTimeout.Token).ConfigureAwait(false);
            var probeByte = new byte[1];
            if (await stream.ReadAsync(probeByte.AsMemory(), probeTimeout.Token).ConfigureAwait(false) != 1)
                throw new InvalidDataException("The server returned an empty byte-range probe response.");

            return new RangeProbeResult(true, range.Length, entityTag, lastModified,
                NormalizeSuggestedName(suggestedName), timer.Elapsed);
        }

        if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
        {
            var range = response.Content.Headers.ContentRange;
            if (range?.Length == 0)
                return new RangeProbeResult(false, 0, entityTag, lastModified,
                    NormalizeSuggestedName(suggestedName), timer.Elapsed);
            // Some direct-file servers reject Range rather than ignoring it. A plain GET
            // below decides whether the resource itself is downloadable.
            return new RangeProbeResult(false, null, entityTag, lastModified,
                NormalizeSuggestedName(suggestedName), timer.Elapsed);
        }

        if (response.StatusCode is HttpStatusCode.MethodNotAllowed or HttpStatusCode.NotImplemented)
            return new RangeProbeResult(false, null, entityTag, lastModified,
                NormalizeSuggestedName(suggestedName), timer.Elapsed);

        EnsureSuccess(response);
        if (response.StatusCode != HttpStatusCode.OK)
            throw new InvalidDataException("The server returned an unexpected response to the range probe.");

        return new RangeProbeResult(false, response.Content.Headers.ContentLength,
            entityTag, lastModified, NormalizeSuggestedName(suggestedName), timer.Elapsed);
    }

    public Task<HttpResponseMessage> GetAsync(string url, CancellationToken cancellationToken) =>
        SendFollowingRedirectsAsync(UrlPolicy.Validate(url), current => CreateRequest(current, null, null, null), cancellationToken);

    public Task<HttpResponseMessage> GetRangeAsync(
        string url, long start, long end, string? entityTag, DateTimeOffset? lastModified,
        CancellationToken cancellationToken) =>
        SendFollowingRedirectsAsync(UrlPolicy.Validate(url),
            current => CreateRequest(current, start, end, CreateIfRange(entityTag, lastModified)), cancellationToken);

    public static void EnsureSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        throw new DownloadHttpException(response.StatusCode, GetRetryAfter(response));
    }

    private async Task<HttpResponseMessage> SendFollowingRedirectsAsync(
        Uri initialUri, Func<Uri, HttpRequestMessage> requestFactory, CancellationToken cancellationToken)
    {
        var current = UrlPolicy.Validate(initialUri.ToString());
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            using var request = requestFactory(current);
            HttpResponseMessage response;
            try
            {
                response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new IOException("The server did not respond before the connection timed out.");
            }
            catch (HttpRequestException)
            {
                // Intentionally do not forward the original exception: it may contain a signed URL.
                throw new HttpRequestException("The network connection failed while contacting the download server.");
            }

            if (!IsRedirect(response.StatusCode)) return response;
            var location = response.Headers.Location;
            response.Dispose();
            if (location is null)
                throw new InvalidDataException("The server returned a redirect without a destination.");
            if (hop == MaxRedirects)
                throw new InvalidDataException("The server redirected too many times.");

            var destination = location.IsAbsoluteUri ? location : new Uri(current, location);
            current = UrlPolicy.ValidateRedirect(current, destination);
        }

        throw new InvalidDataException("The server redirected too many times.");
    }

    private static HttpRequestMessage CreateRequest(Uri uri, long? rangeStart, long? rangeEnd, RangeConditionHeaderValue? ifRange)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd("TurboLoadPro/1.0");
        request.Headers.AcceptEncoding.ParseAdd("identity");
        if (rangeStart.HasValue && rangeEnd.HasValue)
            request.Headers.Range = new RangeHeaderValue(rangeStart, rangeEnd);
        if (ifRange is not null)
            request.Headers.IfRange = ifRange;
        return request;
    }

    private static RangeConditionHeaderValue? CreateIfRange(string? entityTag, DateTimeOffset? lastModified)
    {
        if (!string.IsNullOrWhiteSpace(entityTag) && !entityTag.StartsWith("W/", StringComparison.OrdinalIgnoreCase))
        {
            try { return new RangeConditionHeaderValue(EntityTagHeaderValue.Parse(entityTag)); }
            catch (FormatException) { }
        }
        return lastModified.HasValue ? new RangeConditionHeaderValue(lastModified.Value) : null;
    }

    private static bool IsRedirect(HttpStatusCode statusCode) => statusCode is
        HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or HttpStatusCode.RedirectMethod or
        HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;

    private static TimeSpan? GetRetryAfter(HttpResponseMessage response)
    {
        var retryAfter = response.Headers.RetryAfter;
        if (retryAfter?.Delta is { } delta) return delta;
        if (retryAfter?.Date is { } date) return date - DateTimeOffset.UtcNow;
        return null;
    }

    private static string? NormalizeSuggestedName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return FileNamePolicy.FromContentDisposition(raw, "download");
    }

    public void Dispose() => _client.Dispose();
}

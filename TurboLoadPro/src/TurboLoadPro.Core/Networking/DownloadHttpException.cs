using System.Net;

namespace TurboLoadPro.Core.Networking;

public sealed class DownloadHttpException : IOException
{
    public HttpStatusCode StatusCode { get; }
    public TimeSpan? RetryAfter { get; }

    public DownloadHttpException(HttpStatusCode statusCode, TimeSpan? retryAfter = null)
        : base(CreateMessage(statusCode))
    {
        StatusCode = statusCode;
        RetryAfter = retryAfter;
    }

    public bool IsTransient => (int)StatusCode is 408 or 425 or 429 or 500 or 502 or 503 or 504;

    private static string CreateMessage(HttpStatusCode statusCode) => statusCode switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "The server denied this request. The link may be expired or require authorization.",
        HttpStatusCode.NotFound or HttpStatusCode.Gone => "The requested file was not found. Check whether the direct link has expired.",
        HttpStatusCode.TooManyRequests => "The server asked the app to slow down. TurboLoad Pro will honor its retry instructions.",
        _ => $"The server returned HTTP {(int)statusCode} ({statusCode})."
    };
}

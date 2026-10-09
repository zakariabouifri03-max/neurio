using System;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;

namespace AdzakDownloadPro.Core
{
    /// <summary>HTTP parsing/validation helpers shared by the engine and the tests.</summary>
    public static class HttpUtils
    {
        /// <summary>Status codes that are worth retrying (request timeout, too early, too many requests, 5xx).</summary>
        public static bool IsRetryableStatusCode(int code)
            => code == 408 || code == 425 || code == 429 || code >= 500;

        public static bool IsSuccessStatusCode(int code) => code >= 200 && code < 300;

        /// <summary>
        /// Parses a <c>Content-Range</c> header value such as <c>bytes 0-1023/5000</c>,
        /// <c>bytes 0-1023/*</c> or <c>bytes */5000</c>.
        /// </summary>
        public static bool TryParseContentRange(string? value, out long start, out long end, out long total)
        {
            start = -1;
            end = -1;
            total = -1;

            if (string.IsNullOrWhiteSpace(value))
                return false;

            var s = value.Trim();
            if (!s.StartsWith("bytes", StringComparison.OrdinalIgnoreCase))
                return false;
            s = s.Substring(5).Trim();

            int slash = s.IndexOf('/');
            if (slash < 0)
                return false;

            var rangePart = s.Substring(0, slash).Trim();
            var totalPart = s.Substring(slash + 1).Trim();

            if (totalPart != "*")
            {
                if (!long.TryParse(totalPart, NumberStyles.Integer, CultureInfo.InvariantCulture, out total) || total < 0)
                    return false;
            }

            if (rangePart == "*")
                return total >= 0; // "bytes */total" — total only

            int dash = rangePart.IndexOf('-');
            if (dash < 0)
                return false;

            if (!long.TryParse(rangePart.Substring(0, dash).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out start))
                return false;
            if (!long.TryParse(rangePart.Substring(dash + 1).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out end))
                return false;

            return start >= 0 && end >= start;
        }

        /// <summary>
        /// Extracts a file name from a <c>Content-Disposition</c> header value (RFC 6266),
        /// handling quoted values and <c>filename*</c> (RFC 5987). Returns null when absent.
        /// </summary>
        public static string? GetFileNameFromContentDisposition(string? headerValue)
        {
            if (string.IsNullOrWhiteSpace(headerValue))
                return null;

            string? fallback = null;

            foreach (var part in headerValue.Split(';'))
            {
                var trimmed = part.Trim();
                if (trimmed.Length == 0)
                    continue;

                int eq = trimmed.IndexOf('=');
                if (eq < 0)
                    continue;

                var name = trimmed.Substring(0, eq).Trim();
                var rawValue = trimmed.Substring(eq + 1).Trim();

                if (name.Equals("filename*", StringComparison.OrdinalIgnoreCase))
                {
                    // RFC 5987: filename*=UTF-8''%E2%82%AC.txt
                    var decoded = DecodeRfc5987(rawValue);
                    if (!string.IsNullOrEmpty(decoded))
                        return decoded;
                }
                else if (name.Equals("filename", StringComparison.OrdinalIgnoreCase))
                {
                    var decoded = Unquote(rawValue);
                    if (!string.IsNullOrEmpty(decoded))
                        fallback = decoded;
                }
            }

            return fallback;
        }

        /// <summary>Best-effort file name from the last segment of a URL path.</summary>
        public static string GetFileNameFromUrl(Uri uri)
        {
            var path = uri.AbsolutePath;
            int slash = path.LastIndexOf('/');
            var last = slash >= 0 ? path.Substring(slash + 1) : path;
            try
            {
                last = Uri.UnescapeDataString(last);
            }
            catch (UriFormatException)
            {
                // keep the raw segment
            }
            return string.IsNullOrWhiteSpace(last) ? "download" : last;
        }

        // Characters that are invalid in Windows file names. We always strip these (this is a
        // Windows application) instead of relying on Path.GetInvalidFileNameChars(), which is
        // platform-dependent (on Linux it only knows about '/').
        private static readonly char[] WindowsInvalidFileNameChars =
            { '<', '>', ':', '"', '/', '\\', '|', '?', '*' };

        /// <summary>Replaces characters that are invalid in Windows file names and trims the result.</summary>
        public static string SanitizeFileName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name))
                return "download";

            var platformInvalid = System.IO.Path.GetInvalidFileNameChars();
            var sb = new StringBuilder(name.Length);
            foreach (char c in name.Trim())
            {
                bool invalid = c < ' ' || Array.IndexOf(WindowsInvalidFileNameChars, c) >= 0
                    || Array.IndexOf(platformInvalid, c) >= 0;
                sb.Append(invalid ? '_' : c);
            }

            var result = sb.ToString().Trim().Trim('.');
            if (result.Length == 0)
                return "download";
            if (result.Length > 200)
                result = result.Substring(0, 200);
            return result;
        }

        /// <summary>
        /// Returns <paramref name="directory"/>\<paramref name="fileName"/>, appending
        /// <c> (1)</c>, <c> (2)</c>, … before the extension when the file already exists.
        /// </summary>
        public static string GetUniqueFilePath(string directory, string fileName)
        {
            var baseName = System.IO.Path.GetFileNameWithoutExtension(fileName);
            var extension = System.IO.Path.GetExtension(fileName);
            var candidate = System.IO.Path.Combine(directory, fileName);
            int counter = 1;
            while (System.IO.File.Exists(candidate))
            {
                candidate = System.IO.Path.Combine(directory, $"{baseName} ({counter}){extension}");
                counter++;
            }
            return candidate;
        }

        /// <summary>Parses a <c>Retry-After</c> header (delta-seconds or HTTP-date). Returns null when absent/invalid.</summary>
        public static TimeSpan? GetRetryAfter(HttpHeaders headers)
        {
            if (headers == null)
                return null;
            if (!headers.TryGetValues("Retry-After", out var values))
                return null;
            foreach (var value in values)
            {
                if (string.IsNullOrWhiteSpace(value))
                    continue;
                var trimmed = value.Trim();
                if (int.TryParse(trimmed, NumberStyles.Integer, CultureInfo.InvariantCulture, out int seconds) && seconds >= 0)
                    return TimeSpan.FromSeconds(Math.Min(seconds, 3600));
                if (DateTimeOffset.TryParse(trimmed, CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date))
                {
                    var delay = date - DateTimeOffset.UtcNow;
                    if (delay > TimeSpan.Zero)
                        return delay > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : delay;
                }
            }
            return null;
        }

        private static string Unquote(string value)
        {
            if (value.Length >= 2 && value.StartsWith("\"", StringComparison.Ordinal) && value.EndsWith("\"", StringComparison.Ordinal))
                value = value.Substring(1, value.Length - 2);
            // Decode backslash escapes inside quoted strings.
            return value.Replace("\\\"", "\"").Replace("\\\\", "\\");
        }

        private static string? DecodeRfc5987(string value)
        {
            // e.g. UTF-8''%E2%82%AC.txt  or  ''plain.txt
            var unquoted = Unquote(value);
            int firstQuote = unquoted.IndexOf('\'');
            if (firstQuote < 0)
                return null;
            int secondQuote = unquoted.IndexOf('\'', firstQuote + 1);
            if (secondQuote < 0)
                return null;
            // charset = unquoted.Substring(0, firstQuote) — we always decode as UTF-8
            var encoded = unquoted.Substring(secondQuote + 1);
            try
            {
                return Uri.UnescapeDataString(encoded);
            }
            catch (UriFormatException)
            {
                return null;
            }
        }
    }
}

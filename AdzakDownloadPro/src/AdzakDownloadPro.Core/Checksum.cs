using System;
using System.IO;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AdzakDownloadPro.Core
{
    /// <summary>SHA-256 helpers: computation, hex formatting and checksum-header parsing.</summary>
    public static class Checksum
    {
        /// <summary>Computes the SHA-256 of a byte buffer and returns it as lowercase hex.</summary>
        public static string ComputeSha256Hex(byte[] data)
        {
            if (data == null)
                throw new ArgumentNullException(nameof(data));
            using (var sha = SHA256.Create())
                return ToHex(sha.ComputeHash(data));
        }

        /// <summary>Computes the SHA-256 of a file and returns it as lowercase hex.</summary>
        public static string ComputeSha256Hex(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
                return ToHex(sha.ComputeHash(stream));
        }

        /// <summary>Computes the SHA-256 of a stream asynchronously (never loads the whole stream into memory).</summary>
        public static async Task<string> ComputeSha256HexAsync(Stream stream, CancellationToken cancellationToken = default)
        {
            if (stream == null)
                throw new ArgumentNullException(nameof(stream));

            using (var sha = SHA256.Create())
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await stream.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false)) > 0)
                    sha.TransformBlock(buffer, 0, read, null, 0);
                sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                return ToHex(sha.Hash!);
            }
        }

        /// <summary>Lowercase hex string for a hash byte array.</summary>
        public static string ToHex(byte[] hash)
        {
            var sb = new StringBuilder(hash.Length * 2);
            foreach (byte b in hash)
                sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        /// <summary>Case-insensitive comparison of two hex-encoded SHA-256 digests.</summary>
        public static bool Sha256Equals(string? expectedHex, string? actualHex)
        {
            if (string.IsNullOrWhiteSpace(expectedHex) || string.IsNullOrWhiteSpace(actualHex))
                return false;
            return string.Equals(NormalizeHex(expectedHex), NormalizeHex(actualHex), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Extracts an expected SHA-256 (lowercase hex) from response headers, when the server provides one.
        /// Understands:
        /// <list type="bullet">
        /// <item><c>Digest: sha-256=&lt;base64&gt;</c> (RFC 9530; also accepts plain hex after <c>=</c>)</item>
        /// <item><c>X-Checksum-Sha256: &lt;hex&gt;</c> / <c>X-Checksum-Sha-256: &lt;hex&gt;</c></item>
        /// </list>
        /// Returns null when no SHA-256 checksum is advertised.
        /// </summary>
        public static string? GetSha256FromHeaders(HttpHeaders headers)
        {
            if (headers == null)
                return null;

            if (headers.TryGetValues("Digest", out var digests))
            {
                foreach (var digest in digests)
                {
                    var parsed = ParseDigestHeader(digest);
                    if (parsed != null)
                        return parsed;
                }
            }

            foreach (var name in new[] { "X-Checksum-Sha256", "X-Checksum-Sha-256", "X-Sha256", "X-Sha-256" })
            {
                if (headers.TryGetValues(name, out var values))
                {
                    foreach (var value in values)
                    {
                        var hex = NormalizeHex(value);
                        if (IsPlausibleSha256Hex(hex))
                            return hex;
                    }
                }
            }

            return null;
        }

        /// <summary>Parses a <c>Digest</c> header value and returns the SHA-256 as lowercase hex, or null.</summary>
        public static string? ParseDigestHeader(string? digestHeader)
        {
            if (string.IsNullOrWhiteSpace(digestHeader))
                return null;

            // Format: "sha-256=:BASE64=:" (RFC 9530) or "sha-256=BASE64" (older drafts) or "sha-256=HEX".
            foreach (var part in digestHeader.Split(','))
            {
                var trimmed = part.Trim();
                if (!trimmed.StartsWith("sha-256", StringComparison.OrdinalIgnoreCase))
                    continue;

                int eq = trimmed.IndexOf('=');
                if (eq < 0)
                    continue;

                var value = trimmed.Substring(eq + 1).Trim().Trim(':').Trim();
                if (value.Length == 0)
                    continue;

                // Base64 form?
                if (value.Length == 44 && (value.EndsWith("=", StringComparison.Ordinal) || value.EndsWith("==", StringComparison.Ordinal)))
                {
                    try
                    {
                        var bytes = Convert.FromBase64String(value);
                        if (bytes.Length == 32)
                            return ToHex(bytes);
                    }
                    catch (FormatException)
                    {
                        // fall through to hex attempt
                    }
                }

                var hex = NormalizeHex(value);
                if (IsPlausibleSha256Hex(hex))
                    return hex;
            }

            return null;
        }

        private static string NormalizeHex(string hex) => hex.Trim().Trim('"').ToLowerInvariant();

        private static bool IsPlausibleSha256Hex(string hex)
        {
            if (hex.Length != 64)
                return false;
            foreach (char c in hex)
            {
                bool isHex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
                if (!isHex)
                    return false;
            }
            return true;
        }
    }
}

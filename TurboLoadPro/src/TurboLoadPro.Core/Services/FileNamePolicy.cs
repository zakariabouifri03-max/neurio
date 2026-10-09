using System.Text;

namespace TurboLoadPro.Core.Services;

public static class FileNamePolicy
{
    private static readonly HashSet<string> ReservedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    };

    public static string FromUrl(Uri uri)
    {
        var escaped = uri.Segments.LastOrDefault()?.Trim('/') ?? string.Empty;
        var decoded = Uri.UnescapeDataString(escaped);
        return Sanitize(decoded);
    }

    public static string FromContentDisposition(string? candidate, string fallback)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return Sanitize(fallback);
        candidate = candidate.Trim().Trim('"');
        var encodingSeparator = candidate.IndexOf("''", StringComparison.Ordinal);
        if (encodingSeparator >= 0)
            candidate = candidate[(encodingSeparator + 2)..];
        try { candidate = Uri.UnescapeDataString(candidate); }
        catch (UriFormatException) { return Sanitize(fallback); }
        var safe = Sanitize(candidate);
        return safe == "download" ? Sanitize(fallback) : safe;
    }

    public static string Sanitize(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return "download";
        var name = candidate.Trim();
        // A content-disposition name is untrusted. Keep only its last path component.
        name = name.Replace('\\', '/').Split('/').LastOrDefault() ?? string.Empty;
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        const string windowsInvalid = "<>:\"|?*";
        var builder = new StringBuilder(Math.Min(name.Length, 180));
        foreach (var character in name)
        {
            if (char.IsControl(character) || invalid.Contains(character) || windowsInvalid.Contains(character) || character is '/' or '\\') continue;
            builder.Append(character);
        }
        name = builder.ToString().Trim().TrimEnd('.', ' ');
        if (name.Length > 180)
        {
            var extension = Path.GetExtension(name);
            var stemLength = Math.Max(1, 180 - extension.Length);
            name = name[..Math.Min(stemLength, name.Length - extension.Length)] + extension;
        }
        if (string.IsNullOrWhiteSpace(name) || name is "." or "..") name = "download";
        var stem = Path.GetFileNameWithoutExtension(name).TrimEnd('.', ' ');
        if (ReservedNames.Contains(stem)) name = "_" + name;
        return name;
    }

    public static string CreateUniquePath(string directory, string fileName, ISet<string>? reservedPaths = null)
    {
        Directory.CreateDirectory(directory);
        var safeName = Sanitize(fileName);
        var extension = Path.GetExtension(safeName);
        var stem = Path.GetFileNameWithoutExtension(safeName);
        for (var index = 0; ; index++)
        {
            var suffix = index == 0 ? string.Empty : $" ({index})";
            var path = Path.GetFullPath(Path.Combine(directory, stem + suffix + extension));
            if (!File.Exists(path) && !File.Exists(path + ".turbopart") &&
                (reservedPaths is null || !reservedPaths.Contains(path)))
                return path;
        }
    }
}

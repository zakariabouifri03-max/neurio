using System.Text;
using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Services;

namespace TurboLoadPro.Infrastructure;

public sealed class RollingFileTransferLogger(string path) : ITransferLogger
{
    private const long MaximumLogBytes = 1_048_576;
    private readonly object _sync = new();
    private readonly string _path = Path.GetFullPath(path);

    public void Write(string eventName, Guid? downloadId = null, Exception? exception = null)
    {
        try
        {
            lock (_sync)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                if (File.Exists(_path) && new FileInfo(_path).Length > MaximumLogBytes)
                    File.Move(_path, _path + ".1", overwrite: true);
                var status = exception is DownloadHttpException http ? $" http={(int)http.StatusCode}" : string.Empty;
                var type = exception is null ? string.Empty : $" error={exception.GetType().Name}";
                var line = $"{DateTimeOffset.UtcNow:O} event={SafeToken(eventName)} id={downloadId?.ToString("N") ?? "-"}{status}{type}{Environment.NewLine}";
                File.AppendAllText(_path, line, Encoding.UTF8);
            }
        }
        catch
        {
            // Diagnostics must never interrupt a download. URL, path and exception messages are not logged.
        }
    }

    private static string SafeToken(string value)
    {
        var safe = new string(value.Where(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-').Take(64).ToArray());
        return safe.Length == 0 ? "event" : safe;
    }
}

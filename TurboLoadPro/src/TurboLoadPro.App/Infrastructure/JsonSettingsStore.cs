using System.Text.Json;
using System.Text.Json.Serialization;
using TurboLoadPro.Core.Models;

namespace TurboLoadPro.Infrastructure;

public sealed class JsonSettingsStore(string path)
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path = Path.GetFullPath(path);

    public async Task<DownloadSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!File.Exists(_path)) return new DownloadSettings().Normalize();
            try
            {
                await using var input = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read,
                    16 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                var settings = await JsonSerializer.DeserializeAsync<DownloadSettings>(input, Options, cancellationToken)
                    .ConfigureAwait(false);
                return (settings ?? new DownloadSettings()).Normalize();
            }
            catch (JsonException)
            {
                // Preserve a damaged settings file for diagnostics, then safely use defaults.
                var backup = _path + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                try { File.Move(_path, backup, overwrite: false); } catch (IOException) { }
                return new DownloadSettings().Normalize();
            }
            catch (IOException)
            {
                return new DownloadSettings().Normalize();
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SaveAsync(DownloadSettings settings, CancellationToken cancellationToken = default)
    {
        settings.Normalize();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var tempPath = _path + ".tmp";
            await using (var output = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None,
                             16 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(output, settings, Options, cancellationToken).ConfigureAwait(false);
                await output.FlushAsync(cancellationToken).ConfigureAwait(false);
                output.Flush(flushToDisk: true);
            }
            File.Move(tempPath, _path, overwrite: true);
        }
        finally
        {
            _gate.Release();
        }
    }
}

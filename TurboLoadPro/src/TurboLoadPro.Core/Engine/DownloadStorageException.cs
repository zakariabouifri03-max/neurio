namespace TurboLoadPro.Core.Engine;

public sealed class DownloadStorageException(string message, Exception innerException)
    : IOException(message, innerException)
{
}

namespace TurboLoadPro.Core.Services;

/// <summary>Diagnostics deliberately contain IDs, event names and exception types—not URLs or query strings.</summary>
public interface ITransferLogger
{
    void Write(string eventName, Guid? downloadId = null, Exception? exception = null);
}

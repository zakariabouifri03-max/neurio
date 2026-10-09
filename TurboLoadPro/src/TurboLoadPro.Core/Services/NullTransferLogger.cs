namespace TurboLoadPro.Core.Services;

public sealed class NullTransferLogger : ITransferLogger
{
    public void Write(string eventName, Guid? downloadId = null, Exception? exception = null) { }
}

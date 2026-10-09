using TurboLoadPro.Core.Models;

namespace TurboLoadPro.Core.Storage;

public interface IDownloadStore
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(DownloadRecord record, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DownloadRecord>> LoadAllAsync(CancellationToken cancellationToken = default);
}

using TurboLoadPro.ViewModels;

namespace TurboLoadPro.Infrastructure;

public static class Formatters
{
    public static string FormatRate(double bytesPerSecond)
    {
        var bytes = DownloadRowViewModel.FormatBytes((long)Math.Max(0, bytesPerSecond));
        return bytes + "/s";
    }
}

namespace AdzakDownloadPro.Tests;

internal static class Program
{
    private static async Task<int> Main()
    {
        var scenarios = new (string Name, Func<Task> Run)[]
        {
            ("Wi-Fi disconnect during an active download", DownloadEngineScenarios.WiFiDisconnectDuringDownloadAsync),
            ("automatic resume when internet returns after 10 seconds", DownloadEngineScenarios.InternetReturnsAfter10SecondsAsync),
            ("automatic resume when internet returns after 30 seconds", DownloadEngineScenarios.InternetReturnsAfter30SecondsAsync),
            ("automatic resume when internet returns after 60 seconds", DownloadEngineScenarios.InternetReturnsAfter60SecondsAsync),
            ("repeated DNS/connection failures and progressive retry", DownloadEngineScenarios.RepeatedConnectionFailuresAsync),
            ("HTTP Range support and exact byte assembly", DownloadEngineScenarios.ServerSupportsRangeAsync),
            ("server refusing Range and safe full-download fallback", DownloadEngineScenarios.ServerRefusesRangeAsync),
            ("remote file change while paused", DownloadEngineScenarios.RemoteChangesWhilePausedAsync),
            ("close and reopen with explicit resume permission", DownloadEngineScenarios.ApplicationReopensAndResumesAsync),
            ("corrupted and incomplete segment recovery", DownloadEngineScenarios.CorruptAndIncompleteSegmentAsync)
        };

        var failures = 0;
        foreach (var (name, run) in scenarios)
        {
            try
            {
                await run();
                Console.WriteLine($"PASS  {name}");
            }
            catch (Exception exception)
            {
                failures++;
                Console.Error.WriteLine($"FAIL  {name}\n      {exception}");
                var diagnostic = exception.ToString()
                    .Replace("%", "%25", StringComparison.Ordinal)
                    .Replace("\r", "%0D", StringComparison.Ordinal)
                    .Replace("\n", "%0A", StringComparison.Ordinal)
                    .Replace(":", "%3A", StringComparison.Ordinal)
                    .Replace(",", "%2C", StringComparison.Ordinal);
                if (diagnostic.Length > 4000)
                    diagnostic = diagnostic[..4000];
                Console.Error.WriteLine($"::error title=Recovery scenario failed::{diagnostic}");
            }
        }

        Console.WriteLine($"\n{scenarios.Length - failures}/{scenarios.Length} scenarios passed.");
        return failures == 0 ? 0 : 1;
    }
}

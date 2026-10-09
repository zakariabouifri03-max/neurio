using System;
using System.Threading.Tasks;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public static class Program
    {
        public static async Task<int> Main(string[] args)
        {
            var timeout = TimeSpan.FromSeconds(120);
            foreach (var arg in args)
            {
                if (arg.StartsWith("--timeout=", StringComparison.Ordinal))
                {
                    if (int.TryParse(arg.Substring("--timeout=".Length), out int seconds) && seconds > 0)
                        timeout = TimeSpan.FromSeconds(seconds);
                }
            }
            int failures = await TestRunner.RunAllAsync(timeout).ConfigureAwait(false);
            return failures == 0 ? 0 : 1;
        }
    }
}

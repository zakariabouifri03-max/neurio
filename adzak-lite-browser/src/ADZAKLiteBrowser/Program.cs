using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace AdzakLiteBrowser;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Any(a => string.Equals(a, "--smoke-test", StringComparison.OrdinalIgnoreCase)))
        {
            Environment.ExitCode = SmokeTest.Run();
            return;
        }

        // The WebView2 (Chromium) runtime ships with Windows 11 and modern Edge,
        // but check explicitly so users get guidance instead of a crash.
        string? version = null;
        try { version = CoreWebView2Environment.GetAvailableBrowserVersionString(null); }
        catch { /* handled below */ }

        if (string.IsNullOrWhiteSpace(version))
        {
            var answer = MessageBox.Show(
                "ADZAK Lite Browser needs the free Microsoft Edge WebView2 Runtime, which was not found on this PC.\n\n" +
                "Open the official download page now?",
                "WebView2 Runtime missing", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer == DialogResult.Yes)
            {
                try
                {
                    Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/")
                    { UseShellExecute = true });
                }
                catch { }
            }
            return;
        }

        Application.Run(new MainForm());
    }
}

using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AdzakLiteBrowser;

/// <summary>
/// Headless self-check used by CI (and curious users):
///   ADZAKLiteBrowser.exe --smoke-test
/// Creates a real WebView2 environment, loads a local test page, verifies the
/// DOM/title/scripting, exercises the pure-C# pieces (blocklist, address
/// normalization, JSON storage), then writes %TEMP%\adzak-smoke-result.json
/// and exits 0 on success, 1 on failure. No network access is used.
/// </summary>
internal static class SmokeTest
{
    public static int Run()
    {
        var result = new Dictionary<string, object?>
        {
            ["startedUtc"] = DateTime.UtcNow.ToString("o"),
            ["runtimeVersion"] = SafeRuntimeVersion()
        };
        var done = new ManualResetEventSlim(false);
        var exitCode = 1;

        var thread = new Thread(() =>
        {
            try
            {
                Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                // Pure-logic checks (no UI needed).
                result["blocklistBlocksDoubleclick"] = Blocklist.IsBlocked(new Uri("https://ads.doubleclick.net/x.js"));
                result["blocklistAllowsExample"] = !Blocklist.IsBlocked(new Uri("https://example.com/page"));
                result["normalizeSearch"] = MainForm.NormalizeAddressInput("how to boil eggs");
                result["normalizeHost"] = MainForm.NormalizeAddressInput("example.com/docs");
                var probe = DataStore.Load<AppSettings>("settings.json");
                result["settingsLoadOk"] = probe is not null;

                using var form = new Form
                {
                    Width = 480,
                    Height = 320,
                    ShowInTaskbar = false,
                    WindowState = FormWindowState.Minimized
                };
                var webView = new WebView2 { Dock = DockStyle.Fill };
                form.Controls.Add(webView);

                form.Shown += async (_, _) =>
                {
                    try
                    {
                        var userData = Path.Combine(Path.GetTempPath(), "ADZAK-SmokeTest");
                        Directory.CreateDirectory(userData);
                        var env = await CoreWebView2Environment.CreateAsync(null, userData, null);
                        await webView.EnsureCoreWebView2Async(env);
                        var core = webView.CoreWebView2;

                        var navDone = new TaskCompletionSource<bool>();
                        core.NavigationCompleted += (_, e) => navDone.TrySetResult(e.IsSuccess);
                        core.NavigateToString(
                            "<!doctype html><title>ADZAK Smoke OK</title><h1 id='x'>hello</h1>" +
                            "<script>document.title='ADZAK Smoke OK';</script>");

                        var finished = await Task.WhenAny(navDone.Task, Task.Delay(45000));
                        result["navigationCompleted"] = finished == navDone.Task && navDone.Task.Result;
                        result["documentTitle"] = core.DocumentTitle;
                        var scriptResult = await core.ExecuteScriptAsync("document.getElementById('x').textContent");
                        result["domText"] = JsonSerializer.Deserialize<string>(scriptResult);
                        var gpu = await core.ExecuteScriptAsync(
                            "(() => { const c = document.createElement('canvas');" +
                            " const gl = c.getContext('webgl2') || c.getContext('webgl');" +
                            " if (!gl) return 'unavailable';" +
                            " const d = gl.getExtension('WEBGL_debug_renderer_info');" +
                            " return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : 'unknown'; })()");
                        result["webglRenderer"] = JsonSerializer.Deserialize<string>(gpu);

                        exitCode = result["navigationCompleted"] is true &&
                                   result["documentTitle"] as string == "ADZAK Smoke OK" &&
                                   result["blocklistBlocksDoubleclick"] is true &&
                                   result["blocklistAllowsExample"] is true
                            ? 0
                            : 1;
                    }
                    catch (Exception ex)
                    {
                        result["error"] = ex.ToString();
                        exitCode = 1;
                    }
                    finally
                    {
                        result["ok"] = exitCode == 0;
                        WriteResult(result);
                        done.Set();
                        Application.ExitThread();
                    }
                };
                Application.Run(form);
            }
            catch (Exception ex)
            {
                result["error"] = ex.ToString();
                result["ok"] = false;
                WriteResult(result);
                done.Set();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!done.Wait(TimeSpan.FromSeconds(90)))
        {
            result["error"] = "timeout";
            result["ok"] = false;
            WriteResult(result);
            return 1;
        }
        return exitCode;
    }

    private static string? SafeRuntimeVersion()
    {
        try { return CoreWebView2Environment.GetAvailableBrowserVersionString(null); }
        catch { return null; }
    }

    private static void WriteResult(Dictionary<string, object?> result)
    {
        try
        {
            File.WriteAllText(
                Path.Combine(Path.GetTempPath(), "adzak-smoke-result.json"),
                JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}

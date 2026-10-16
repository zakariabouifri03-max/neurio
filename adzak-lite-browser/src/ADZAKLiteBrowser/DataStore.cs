using System.Text.Json;

namespace AdzakLiteBrowser;

/// <summary>
/// Tiny JSON persistence layer. Everything lives in %AppData%\ADZAK Lite Browser
/// and is written via a temp file + replace so a crash cannot corrupt the store.
/// No telemetry, no network: this class only touches the local disk.
/// </summary>
public static class DataStore
{
    private static readonly object Gate = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static string DataFolder { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ADZAK Lite Browser");

    public static string UserDataFolder { get; } = Path.Combine(DataFolder, "WebView2");

    private static string PathFor(string name) => Path.Combine(DataFolder, name);

    public static T Load<T>(string name) where T : class, new()
    {
        lock (Gate)
        {
            try
            {
                var path = PathFor(name);
                if (!File.Exists(path)) return new T();
                return JsonSerializer.Deserialize<T>(File.ReadAllText(path), JsonOptions) ?? new T();
            }
            catch
            {
                return new T(); // corrupt store must never stop the browser from starting
            }
        }
    }

    public static void Save<T>(string name, T value)
    {
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(DataFolder);
                var path = PathFor(name);
                var temp = path + ".tmp";
                File.WriteAllText(temp, JsonSerializer.Serialize(value, JsonOptions));
                File.Copy(temp, path, overwrite: true);
                File.Delete(temp);
            }
            catch
            {
                // Persistence failures (disk full, AV) are non-fatal by design.
            }
        }
    }
}

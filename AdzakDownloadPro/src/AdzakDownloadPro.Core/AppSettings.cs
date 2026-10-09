using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Application settings, persisted as JSON (default:
    /// <c>%LocalAppData%\ADZAK DOWNLOAD PRO\settings.json</c>).
    /// </summary>
    public sealed class AppSettings
    {
        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            Converters = { new JsonStringEnumConverter() },
        };

        public string Theme { get; set; } = "Dark";

        public DownloadMode DefaultMode { get; set; } = DownloadMode.Medium;

        public string DestinationFolder { get; set; } = GetDefaultDestinationFolder();

        public int LowConnections { get; set; } = 1;
        public int MediumConnections { get; set; } = 4;
        public int ProConnections { get; set; } = 8;
        public int MaxConnections { get; set; } = 16;
        public int MaxSimultaneousDownloads { get; set; } = 3;
        public int MaxRetries { get; set; } = 5;
        public int BufferSizeBytes { get; set; } = 64 * 1024;
        public int IdleTimeoutSeconds { get; set; } = 30;
        public int ResponseTimeoutSeconds { get; set; } = 15;
        public long MinSegmentSizeBytes { get; set; } = SegmentPlanner.DefaultMinSegmentSize;
        public bool VerifyChecksums { get; set; } = true;
        public int HistoryCapacity { get; set; } = 500;

        /// <summary>Maps the settings onto engine options.</summary>
        public DownloadEngineOptions ToEngineOptions()
        {
            var options = new DownloadEngineOptions
            {
                LowConnections = LowConnections,
                MediumConnections = MediumConnections,
                ProConnections = ProConnections,
                MaxConnections = MaxConnections,
                MaxSimultaneousDownloads = MaxSimultaneousDownloads,
                MaxRetries = MaxRetries,
                BufferSizeBytes = BufferSizeBytes,
                IdleTimeoutSeconds = IdleTimeoutSeconds,
                ResponseTimeoutSeconds = ResponseTimeoutSeconds,
                MinSegmentSizeBytes = MinSegmentSizeBytes,
                VerifyChecksums = VerifyChecksums,
            };
            options.ValidateAndClamp();
            return options;
        }

        /// <summary>Applies engine-level values back into the settings (used by the settings dialog).</summary>
        public void ApplyEngineOptions(DownloadEngineOptions options)
        {
            LowConnections = options.LowConnections;
            MediumConnections = options.MediumConnections;
            ProConnections = options.ProConnections;
            MaxConnections = options.MaxConnections;
            MaxSimultaneousDownloads = options.MaxSimultaneousDownloads;
            MaxRetries = options.MaxRetries;
            BufferSizeBytes = options.BufferSizeBytes;
            IdleTimeoutSeconds = options.IdleTimeoutSeconds;
            ResponseTimeoutSeconds = options.ResponseTimeoutSeconds;
            MinSegmentSizeBytes = options.MinSegmentSizeBytes;
            VerifyChecksums = options.VerifyChecksums;
        }

        public static AppSettings Load(string filePath)
        {
            try
            {
                if (File.Exists(filePath))
                {
                    var json = File.ReadAllText(filePath);
                    var settings = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
                    if (settings != null)
                    {
                        settings.Validate();
                        return settings;
                    }
                }
            }
            catch (Exception)
            {
                // fall through to defaults
            }
            var fresh = new AppSettings();
            fresh.Validate();
            return fresh;
        }

        public void Save(string filePath)
        {
            Validate();
            var directory = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(directory))
                Directory.CreateDirectory(directory);
            var json = JsonSerializer.Serialize(this, JsonOptions);
            var tempPath = filePath + ".tmp";
            File.WriteAllText(tempPath, json);
            if (File.Exists(filePath))
                File.Delete(filePath);
            File.Move(tempPath, filePath);
        }

        private void Validate()
        {
            if (Theme != "Dark" && Theme != "Light")
                Theme = "Dark";
            if (string.IsNullOrWhiteSpace(DestinationFolder))
                DestinationFolder = GetDefaultDestinationFolder();
            LowConnections = Math.Max(1, LowConnections);
            MediumConnections = Math.Max(1, MediumConnections);
            ProConnections = Math.Max(1, ProConnections);
            MaxConnections = Math.Max(1, MaxConnections);
            MaxSimultaneousDownloads = Math.Max(1, MaxSimultaneousDownloads);
            MaxRetries = Math.Max(0, MaxRetries);
            BufferSizeBytes = Math.Max(4 * 1024, BufferSizeBytes);
            IdleTimeoutSeconds = Math.Max(5, IdleTimeoutSeconds);
            ResponseTimeoutSeconds = Math.Max(3, ResponseTimeoutSeconds);
            MinSegmentSizeBytes = Math.Max(16 * 1024, MinSegmentSizeBytes);
            HistoryCapacity = Math.Max(1, HistoryCapacity);
        }

        /// <summary>Default folder for application data: <c>%LocalAppData%\ADZAK DOWNLOAD PRO</c>.</summary>
        public static string GetAppDataFolder()
        {
            var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(root))
                root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".adzak");
            return Path.Combine(root, "ADZAK DOWNLOAD PRO");
        }

        public static string GetDefaultSettingsPath() => Path.Combine(GetAppDataFolder(), "settings.json");

        public static string GetDefaultHistoryPath() => Path.Combine(GetAppDataFolder(), "history.json");

        private static string GetDefaultDestinationFolder()
        {
            var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            try
            {
                if (Directory.Exists(downloads))
                    return downloads;
            }
            catch (Exception)
            {
                // fall through
            }
            return Path.Combine(GetAppDataFolder(), "Downloads");
        }
    }
}

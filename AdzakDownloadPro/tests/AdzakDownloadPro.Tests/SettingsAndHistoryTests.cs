using System;
using System.IO;
using System.Linq;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public sealed class SettingsAndHistoryTests
    {
        [Fact]
        public void Settings_round_trip_through_disk()
        {
            var dir = TestHelpers.NewTempDir();
            var path = Path.Combine(dir, "settings.json");

            var settings = new AppSettings
            {
                Theme = "Light",
                DefaultMode = DownloadMode.Pro,
                DestinationFolder = dir,
                LowConnections = 1,
                MediumConnections = 6,
                ProConnections = 12,
                MaxConnections = 12,
                MaxSimultaneousDownloads = 5,
                MaxRetries = 7,
                BufferSizeBytes = 128 * 1024,
                IdleTimeoutSeconds = 45,
                ResponseTimeoutSeconds = 20,
                MinSegmentSizeBytes = 512 * 1024,
                VerifyChecksums = false,
                HistoryCapacity = 42,
            };
            settings.Save(path);

            var loaded = AppSettings.Load(path);
            Assert.Equal("Light", loaded.Theme);
            Assert.Equal(DownloadMode.Pro, loaded.DefaultMode);
            Assert.Equal(dir, loaded.DestinationFolder);
            Assert.Equal(1, loaded.LowConnections);
            Assert.Equal(6, loaded.MediumConnections);
            Assert.Equal(12, loaded.ProConnections);
            Assert.Equal(12, loaded.MaxConnections);
            Assert.Equal(5, loaded.MaxSimultaneousDownloads);
            Assert.Equal(7, loaded.MaxRetries);
            Assert.Equal(128 * 1024, loaded.BufferSizeBytes);
            Assert.Equal(45, loaded.IdleTimeoutSeconds);
            Assert.Equal(20, loaded.ResponseTimeoutSeconds);
            Assert.Equal(512 * 1024, loaded.MinSegmentSizeBytes);
            Assert.False(loaded.VerifyChecksums);
            Assert.Equal(42, loaded.HistoryCapacity);
        }

        [Fact]
        public void Settings_defaults_are_sane()
        {
            var settings = new AppSettings();
            Assert.Equal("Dark", settings.Theme);
            Assert.Equal(DownloadMode.Medium, settings.DefaultMode);
            Assert.Equal(1, settings.LowConnections);
            Assert.True(settings.MediumConnections > 1);
            Assert.True(settings.ProConnections >= settings.MediumConnections);
            Assert.True(settings.MaxConnections >= settings.ProConnections);
            Assert.True(settings.MaxSimultaneousDownloads >= 1);
            Assert.True(settings.MaxRetries >= 1);
            Assert.True(settings.BufferSizeBytes >= 4 * 1024);
            Assert.True(settings.VerifyChecksums);
            Assert.False(string.IsNullOrWhiteSpace(settings.DestinationFolder));
        }

        [Fact]
        public void Settings_load_missing_file_returns_defaults()
        {
            var loaded = AppSettings.Load(Path.Combine(TestHelpers.NewTempDir(), "nope.json"));
            Assert.Equal("Dark", loaded.Theme);
            Assert.Equal(DownloadMode.Medium, loaded.DefaultMode);
        }

        [Fact]
        public void Settings_load_corrupt_file_returns_defaults()
        {
            var dir = TestHelpers.NewTempDir();
            var path = Path.Combine(dir, "settings.json");
            File.WriteAllText(path, "{ this is not json !!!");
            var loaded = AppSettings.Load(path);
            Assert.Equal("Dark", loaded.Theme);
        }

        [Fact]
        public void Settings_rejects_unknown_theme()
        {
            var dir = TestHelpers.NewTempDir();
            var path = Path.Combine(dir, "settings.json");
            File.WriteAllText(path, "{ \"Theme\": \"Purple\" }");
            var loaded = AppSettings.Load(path);
            Assert.Equal("Dark", loaded.Theme);
        }

        [Fact]
        public void Engine_options_are_clamped()
        {
            var options = new DownloadEngineOptions
            {
                LowConnections = 0,
                MediumConnections = -3,
                ProConnections = 1000,
                MaxConnections = 2,
                MaxSimultaneousDownloads = 0,
                MaxRetries = -1,
                BufferSizeBytes = 10,
                IdleTimeoutSeconds = 0,
                ResponseTimeoutSeconds = 1,
                MinSegmentSizeBytes = 1,
                AdaptiveStallRatio = 5.0,
            };
            options.ValidateAndClamp();

            Assert.Equal(1, options.LowConnections);
            Assert.Equal(1, options.MediumConnections);
            Assert.Equal(2, options.ProConnections);   // clamped to MaxConnections
            Assert.Equal(2, options.MaxConnections);
            Assert.Equal(1, options.MaxSimultaneousDownloads);
            Assert.Equal(0, options.MaxRetries);
            Assert.Equal(4 * 1024, options.BufferSizeBytes);
            Assert.Equal(5, options.IdleTimeoutSeconds);
            Assert.Equal(3, options.ResponseTimeoutSeconds);
            Assert.Equal(16 * 1024, options.MinSegmentSizeBytes);
            Assert.Equal(0.95, options.AdaptiveStallRatio, 0.0001);
        }

        [Fact]
        public void History_persists_and_reloads()
        {
            var dir = TestHelpers.NewTempDir();
            var path = Path.Combine(dir, "history.json");

            var history = new DownloadHistory(path);
            history.Add(new HistoryEntry
            {
                Id = Guid.NewGuid(),
                Url = "https://example.com/a.zip",
                FileName = "a.zip",
                DestinationPath = dir,
                TotalBytes = 100,
                DownloadedBytes = 100,
                Status = DownloadStatus.Completed,
                Mode = DownloadMode.Pro,
                StartedAt = DateTimeOffset.UtcNow,
                CompletedAt = DateTimeOffset.UtcNow,
                AverageSpeedBytesPerSecond = 1234,
                DurationSeconds = 5,
            });

            var reloaded = new DownloadHistory(path);
            var entries = reloaded.Entries;
            Assert.Equal(1, entries.Count);
            Assert.Equal("a.zip", entries[0].FileName);
            Assert.Equal(DownloadStatus.Completed, entries[0].Status);
            Assert.Equal(DownloadMode.Pro, entries[0].Mode);
            Assert.Equal(1234.0, entries[0].AverageSpeedBytesPerSecond);
        }

        [Fact]
        public void History_is_newest_first()
        {
            var history = new DownloadHistory(Path.Combine(TestHelpers.NewTempDir(), "h.json"));
            history.Add(new HistoryEntry { Id = Guid.NewGuid(), FileName = "first" });
            history.Add(new HistoryEntry { Id = Guid.NewGuid(), FileName = "second" });
            history.Add(new HistoryEntry { Id = Guid.NewGuid(), FileName = "third" });

            var names = history.Entries.Select(e => e.FileName).ToArray();
            Assert.SequenceEqual(new[] { "third", "second", "first" }, names);
        }

        [Fact]
        public void History_capacity_is_enforced()
        {
            var history = new DownloadHistory(Path.Combine(TestHelpers.NewTempDir(), "h.json"), capacity: 3);
            for (int i = 0; i < 10; i++)
                history.Add(new HistoryEntry { Id = Guid.NewGuid(), FileName = $"f{i}" });

            Assert.Equal(3, history.Entries.Count);
            Assert.Equal("f9", history.Entries[0].FileName); // newest kept
            Assert.Equal("f7", history.Entries[2].FileName);
        }

        [Fact]
        public void History_remove_and_clear_work()
        {
            var history = new DownloadHistory(Path.Combine(TestHelpers.NewTempDir(), "h.json"));
            var id1 = Guid.NewGuid();
            var id2 = Guid.NewGuid();
            history.Add(new HistoryEntry { Id = id1, FileName = "a" });
            history.Add(new HistoryEntry { Id = id2, FileName = "b" });

            Assert.True(history.Remove(id1));
            Assert.False(history.Remove(id1));
            Assert.Equal(1, history.Entries.Count);

            history.Clear();
            Assert.Equal(0, history.Entries.Count);
        }

        [Fact]
        public void History_survives_corrupt_file()
        {
            var dir = TestHelpers.NewTempDir();
            var path = Path.Combine(dir, "history.json");
            File.WriteAllText(path, "not json at all");
            var history = new DownloadHistory(path);
            Assert.Equal(0, history.Entries.Count);
            history.Add(new HistoryEntry { Id = Guid.NewGuid(), FileName = "ok" });
            Assert.Equal(1, history.Entries.Count);
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AdzakDownloadPro.Core
{
    /// <summary>One entry in the download history.</summary>
    public sealed class HistoryEntry
    {
        public Guid Id { get; set; }
        public string Url { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public string DestinationPath { get; set; } = string.Empty;
        public long? TotalBytes { get; set; }
        public long DownloadedBytes { get; set; }
        public DownloadStatus Status { get; set; }
        public DownloadMode Mode { get; set; }
        public DateTimeOffset StartedAt { get; set; }
        public DateTimeOffset? CompletedAt { get; set; }
        public double AverageSpeedBytesPerSecond { get; set; }
        public double? DurationSeconds { get; set; }
        public string? ErrorMessage { get; set; }
    }

    /// <summary>
    /// Persistent, thread-safe download history stored as JSON
    /// (default: <c>%LocalAppData%\ADZAK DOWNLOAD PRO\history.json</c>).
    /// </summary>
    public sealed class DownloadHistory
    {
        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            Converters = { new JsonStringEnumConverter() },
        };

        private readonly object _gate = new object();
        private readonly string _filePath;
        private readonly int _capacity;
        private List<HistoryEntry> _entries;

        public DownloadHistory(string filePath, int capacity = 500)
        {
            _filePath = filePath ?? throw new ArgumentNullException(nameof(filePath));
            _capacity = Math.Max(1, capacity);
            _entries = new List<HistoryEntry>();
            Load();
        }

        /// <summary>Raised after any mutation.</summary>
        public event EventHandler? Changed;

        /// <summary>All entries, newest first.</summary>
        public IReadOnlyList<HistoryEntry> Entries
        {
            get
            {
                lock (_gate)
                {
                    var copy = new List<HistoryEntry>(_entries);
                    copy.Reverse();
                    return copy;
                }
            }
        }

        public void Add(HistoryEntry entry)
        {
            if (entry == null)
                throw new ArgumentNullException(nameof(entry));
            lock (_gate)
            {
                _entries.Add(entry);
                while (_entries.Count > _capacity)
                    _entries.RemoveAt(0);
                Save();
            }
            Changed?.Invoke(this, EventArgs.Empty);
        }

        public bool Remove(Guid id)
        {
            lock (_gate)
            {
                int removed = _entries.RemoveAll(e => e.Id == id);
                if (removed > 0)
                    Save();
                return removed > 0;
            }
        }

        public void Clear()
        {
            lock (_gate)
            {
                _entries.Clear();
                Save();
            }
            Changed?.Invoke(this, EventArgs.Empty);
        }

        private void Load()
        {
            try
            {
                if (!File.Exists(_filePath))
                    return;
                var json = File.ReadAllText(_filePath);
                var entries = JsonSerializer.Deserialize<List<HistoryEntry>>(json, JsonOptions);
                if (entries != null)
                    _entries = entries;
            }
            catch (Exception)
            {
                _entries = new List<HistoryEntry>(); // corrupt history — start fresh
            }
        }

        private void Save()
        {
            // Caller holds the lock.
            try
            {
                var directory = Path.GetDirectoryName(_filePath);
                if (!string.IsNullOrEmpty(directory))
                    Directory.CreateDirectory(directory);
                var json = JsonSerializer.Serialize(_entries, JsonOptions);
                var tempPath = _filePath + ".tmp";
                File.WriteAllText(tempPath, json);
                if (File.Exists(_filePath))
                    File.Delete(_filePath);
                File.Move(tempPath, _filePath);
            }
            catch (Exception)
            {
                // History persistence must never crash the app.
            }
        }
    }
}

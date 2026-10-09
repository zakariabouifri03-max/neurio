using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Persists per-download resume metadata (<c>.adzakmeta</c> JSON next to the partial files)
    /// so interrupted downloads can resume after an application restart without re-downloading
    /// byte ranges that are already on disk.
    /// </summary>
    public static class DownloadMetaStore
    {
        public sealed class MetaData
        {
            public Guid Id { get; set; }
            public string Url { get; set; } = string.Empty;
            public string FileName { get; set; } = string.Empty;
            public string FinalFilePath { get; set; } = string.Empty;
            public string DestinationDirectory { get; set; } = string.Empty;
            public long? TotalBytes { get; set; }
            public string? ETag { get; set; }
            public string? ExpectedSha256 { get; set; }
            public List<SegmentMeta> Segments { get; set; } = new List<SegmentMeta>();
        }

        public sealed class SegmentMeta
        {
            public int Index { get; set; }
            public long StartByte { get; set; }
            public long EndByte { get; set; }
            public long DownloadedBytes { get; set; }
            public string TempFilePath { get; set; } = string.Empty;
        }

        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
        };

        public static void Save(DownloadItem item, IReadOnlyList<SegmentState> segments)
        {
            var meta = new MetaData
            {
                Id = item.Id,
                Url = item.Url,
                FileName = item.FileName,
                FinalFilePath = item.FinalFilePath,
                DestinationDirectory = item.DestinationDirectory,
                TotalBytes = item.TotalBytes,
                ETag = item.ETag,
                ExpectedSha256 = item.ExpectedSha256,
            };
            foreach (var s in segments)
            {
                meta.Segments.Add(new SegmentMeta
                {
                    Index = s.Index,
                    StartByte = s.StartByte,
                    EndByte = s.EndByte,
                    DownloadedBytes = s.DownloadedBytes,
                    TempFilePath = s.TempFilePath,
                });
            }

            var tempPath = item.MetaFilePath + ".tmp";
            var json = JsonSerializer.Serialize(meta, JsonOptions);
            File.WriteAllText(tempPath, json);
            if (File.Exists(item.MetaFilePath))
                File.Delete(item.MetaFilePath);
            File.Move(tempPath, item.MetaFilePath);
        }

        public static MetaData? TryLoad(string metaFilePath)
        {
            try
            {
                if (!File.Exists(metaFilePath))
                    return null;
                var json = File.ReadAllText(metaFilePath);
                return JsonSerializer.Deserialize<MetaData>(json, JsonOptions);
            }
            catch (Exception)
            {
                return null; // corrupt meta — the engine will simply start fresh
            }
        }

        /// <summary>
        /// Finds resume metadata in a temp directory that belongs to the same download: same URL,
        /// same final file path (falling back to the file name for metadata written by older
        /// versions), same size and same ETag.
        /// </summary>
        public static MetaData? FindReusable(string tempDirectory, string url, string finalFilePath, string fileName, long? totalBytes, string? etag)
        {
            try
            {
                if (!Directory.Exists(tempDirectory))
                    return null;
                foreach (var path in Directory.GetFiles(tempDirectory, "*.adzakmeta"))
                {
                    var meta = TryLoad(path);
                    if (meta == null)
                        continue;
                    if (!string.Equals(meta.Url, url, StringComparison.Ordinal))
                        continue;
                    if (!string.IsNullOrEmpty(meta.FinalFilePath))
                    {
                        if (!string.Equals(meta.FinalFilePath, finalFilePath, StringComparison.OrdinalIgnoreCase))
                            continue;
                    }
                    else if (!string.Equals(meta.FileName, fileName, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    if (totalBytes != null && meta.TotalBytes != totalBytes)
                        continue;
                    if (!string.IsNullOrEmpty(etag) && !string.IsNullOrEmpty(meta.ETag)
                        && !string.Equals(meta.ETag, etag, StringComparison.Ordinal))
                        continue;
                    return meta;
                }
            }
            catch (Exception)
            {
                // unreadable directory etc. — treat as "nothing to resume"
            }
            return null;
        }
    }
}

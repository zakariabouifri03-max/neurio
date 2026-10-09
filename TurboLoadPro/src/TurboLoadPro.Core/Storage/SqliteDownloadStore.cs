using System.Globalization;
using Microsoft.Data.Sqlite;
using TurboLoadPro.Core.Models;

namespace TurboLoadPro.Core.Storage;

/// <summary>SQLite-backed download history and resumable segment checkpoints.</summary>
public sealed class SqliteDownloadStore : IDownloadStore
{
    private readonly string _connectionString;
    private readonly SemaphoreSlim _writeGate = new(1, 1);

    public SqliteDownloadStore(string databasePath)
    {
        var fullPath = Path.GetFullPath(databasePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = fullPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true
        }.ToString();
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS Downloads (
                Id TEXT NOT NULL PRIMARY KEY,
                Url TEXT NOT NULL,
                FileName TEXT NOT NULL,
                DestinationPath TEXT NOT NULL,
                Status INTEGER NOT NULL,
                Priority INTEGER NOT NULL,
                TotalBytes INTEGER NULL,
                DownloadedBytes INTEGER NOT NULL,
                SpeedBytesPerSecond REAL NOT NULL,
                Connections INTEGER NOT NULL,
                SupportsRanges INTEGER NULL,
                EntityTag TEXT NULL,
                LastModified TEXT NULL,
                Sha256 TEXT NULL,
                Error TEXT NULL,
                CreatedUtc TEXT NOT NULL,
                UpdatedUtc TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_Downloads_Status_Priority_Created
                ON Downloads(Status, Priority DESC, CreatedUtc);
            CREATE TABLE IF NOT EXISTS Segments (
                DownloadId TEXT NOT NULL,
                SegmentIndex INTEGER NOT NULL,
                StartOffset INTEGER NOT NULL,
                EndOffset INTEGER NOT NULL,
                BytesReceived INTEGER NOT NULL,
                PRIMARY KEY(DownloadId, SegmentIndex),
                FOREIGN KEY(DownloadId) REFERENCES Downloads(Id) ON DELETE CASCADE
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task SaveAsync(DownloadRecord record, CancellationToken cancellationToken = default)
    {
        var snapshot = record.Snapshot();
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
            using var transaction = connection.BeginTransaction();
            await using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT INTO Downloads (
                        Id, Url, FileName, DestinationPath, Status, Priority, TotalBytes,
                        DownloadedBytes, SpeedBytesPerSecond, Connections, SupportsRanges,
                        EntityTag, LastModified, Sha256, Error, CreatedUtc, UpdatedUtc)
                    VALUES (
                        $id, $url, $fileName, $destinationPath, $status, $priority, $totalBytes,
                        $downloadedBytes, $speed, $connections, $supportsRanges,
                        $entityTag, $lastModified, $sha256, $error, $createdUtc, $updatedUtc)
                    ON CONFLICT(Id) DO UPDATE SET
                        Url=excluded.Url,
                        FileName=excluded.FileName,
                        DestinationPath=excluded.DestinationPath,
                        Status=excluded.Status,
                        Priority=excluded.Priority,
                        TotalBytes=excluded.TotalBytes,
                        DownloadedBytes=excluded.DownloadedBytes,
                        SpeedBytesPerSecond=excluded.SpeedBytesPerSecond,
                        Connections=excluded.Connections,
                        SupportsRanges=excluded.SupportsRanges,
                        EntityTag=excluded.EntityTag,
                        LastModified=excluded.LastModified,
                        Sha256=excluded.Sha256,
                        Error=excluded.Error,
                        CreatedUtc=excluded.CreatedUtc,
                        UpdatedUtc=excluded.UpdatedUtc;
                    """;
                command.Parameters.AddWithValue("$id", snapshot.Id.ToString("N"));
                command.Parameters.AddWithValue("$url", snapshot.Url);
                command.Parameters.AddWithValue("$fileName", snapshot.FileName);
                command.Parameters.AddWithValue("$destinationPath", snapshot.DestinationPath);
                command.Parameters.AddWithValue("$status", (int)snapshot.Status);
                command.Parameters.AddWithValue("$priority", (int)snapshot.Priority);
                command.Parameters.AddWithValue("$totalBytes", DbValue(snapshot.TotalBytes));
                command.Parameters.AddWithValue("$downloadedBytes", snapshot.DownloadedBytes);
                command.Parameters.AddWithValue("$speed", snapshot.SpeedBytesPerSecond);
                command.Parameters.AddWithValue("$connections", snapshot.Connections);
                command.Parameters.AddWithValue("$supportsRanges", snapshot.SupportsRanges.HasValue
                    ? (object)(snapshot.SupportsRanges.Value ? 1 : 0) : DBNull.Value);
                command.Parameters.AddWithValue("$entityTag", DbValue(snapshot.EntityTag));
                command.Parameters.AddWithValue("$lastModified", snapshot.LastModified?.ToString("O", CultureInfo.InvariantCulture) ?? (object)DBNull.Value);
                command.Parameters.AddWithValue("$sha256", DbValue(snapshot.Sha256));
                command.Parameters.AddWithValue("$error", DbValue(snapshot.Error));
                command.Parameters.AddWithValue("$createdUtc", snapshot.CreatedUtc.ToString("O", CultureInfo.InvariantCulture));
                command.Parameters.AddWithValue("$updatedUtc", snapshot.UpdatedUtc.ToString("O", CultureInfo.InvariantCulture));
                await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using (var removeSegments = connection.CreateCommand())
            {
                removeSegments.Transaction = transaction;
                removeSegments.CommandText = "DELETE FROM Segments WHERE DownloadId=$id;";
                removeSegments.Parameters.AddWithValue("$id", snapshot.Id.ToString("N"));
                await removeSegments.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            foreach (var segment in snapshot.Segments)
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT INTO Segments(DownloadId, SegmentIndex, StartOffset, EndOffset, BytesReceived)
                    VALUES($id, $index, $start, $end, $received);
                    """;
                command.Parameters.AddWithValue("$id", snapshot.Id.ToString("N"));
                command.Parameters.AddWithValue("$index", segment.Index);
                command.Parameters.AddWithValue("$start", segment.Start);
                command.Parameters.AddWithValue("$end", segment.End);
                command.Parameters.AddWithValue("$received", segment.BytesReceived);
                await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            transaction.Commit();
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async Task<IReadOnlyList<DownloadRecord>> LoadAllAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        var records = new List<DownloadRecord>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT Id, Url, FileName, DestinationPath, Status, Priority, TotalBytes,
                       DownloadedBytes, SpeedBytesPerSecond, Connections, SupportsRanges,
                       EntityTag, LastModified, Sha256, Error, CreatedUtc, UpdatedUtc
                FROM Downloads ORDER BY CreatedUtc DESC;
                """;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                records.Add(new DownloadRecord
                {
                    Id = Guid.ParseExact(reader.GetString(0), "N"),
                    Url = reader.GetString(1),
                    FileName = reader.GetString(2),
                    DestinationPath = reader.GetString(3),
                    Status = (DownloadStatus)reader.GetInt32(4),
                    Priority = (DownloadPriority)reader.GetInt32(5),
                    TotalBytes = reader.IsDBNull(6) ? null : reader.GetInt64(6),
                    DownloadedBytes = reader.GetInt64(7),
                    SpeedBytesPerSecond = reader.GetDouble(8),
                    Connections = reader.GetInt32(9),
                    SupportsRanges = reader.IsDBNull(10) ? null : reader.GetInt32(10) != 0,
                    EntityTag = reader.IsDBNull(11) ? null : reader.GetString(11),
                    LastModified = reader.IsDBNull(12) ? null : DateTimeOffset.Parse(reader.GetString(12), CultureInfo.InvariantCulture, DateTimeStyles.None),
                    Sha256 = reader.IsDBNull(13) ? null : reader.GetString(13),
                    Error = reader.IsDBNull(14) ? null : reader.GetString(14),
                    CreatedUtc = DateTimeOffset.Parse(reader.GetString(15), CultureInfo.InvariantCulture, DateTimeStyles.None),
                    UpdatedUtc = DateTimeOffset.Parse(reader.GetString(16), CultureInfo.InvariantCulture, DateTimeStyles.None)
                });
            }
        }

        var byId = records.ToDictionary(record => record.Id.ToString("N"), StringComparer.OrdinalIgnoreCase);
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT DownloadId, SegmentIndex, StartOffset, EndOffset, BytesReceived FROM Segments ORDER BY DownloadId, SegmentIndex;";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (!byId.TryGetValue(reader.GetString(0), out var record)) continue;
                record.Segments.Add(new DownloadSegment
                {
                    Index = reader.GetInt32(1),
                    Start = reader.GetInt64(2),
                    End = reader.GetInt64(3),
                    BytesReceived = reader.GetInt64(4)
                });
            }
        }

        return records;
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(_connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA busy_timeout=5000;";
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static object DbValue(object? value) => value ?? DBNull.Value;
}

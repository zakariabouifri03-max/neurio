//! Persistence for the download list, its resumable state, and the history.

use rusqlite::{params, OptionalExtension, Row};

use super::Database;
use crate::error::{AppError, Result};
use crate::types::{
    ConflictAction, DownloadRecord, DownloadStatus, HistoryEntry, ProgressInfo, SegmentPlan,
    StatsSnapshot,
};

/// Which slice of the history the user is looking at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryScope {
    All,
    Completed,
    Failed,
}

/// Search / filter parameters for the history view.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilter {
    /// Case-insensitive substring matched against filename and URL.
    pub query: Option<String>,
    #[serde(default)]
    pub scope: Option<HistoryScope>,
    /// `newest` (default) or `oldest` by completion time.
    pub sort: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

const DOWNLOAD_COLUMNS: &str = "id, url, final_url, filename, dest_dir, file_path, part_path, status, error, \
     fragmentable, connections, segments, downloaded, total, etag, last_modified, content_type, sha256, \
     created_at, started_at, completed_at, elapsed_secs, position, retry_count, speed_limit_bps, category, \
     on_conflict";

impl Database {
    // -- downloads ------------------------------------------------------------

    pub fn insert_download(&self, record: &DownloadRecord) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO downloads (
                     id, url, final_url, filename, dest_dir, file_path, part_path, status, error,
                     fragmentable, connections, segments, downloaded, total, etag, last_modified,
                     content_type, sha256, created_at, started_at, completed_at, elapsed_secs,
                     position, retry_count, speed_limit_bps, category, on_conflict
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                           ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
                params![
                    record.id,
                    record.url,
                    record.final_url,
                    record.filename,
                    record.dest_dir,
                    record.file_path,
                    record.part_path,
                    record.status.as_str(),
                    record.error,
                    record.fragmentable as i64,
                    record.connections as i64,
                    segments_to_json(&record.segments),
                    record.downloaded as i64,
                    record.total.map(|v| v as i64),
                    record.etag,
                    record.last_modified,
                    record.content_type,
                    record.sha256,
                    record.created_at,
                    record.started_at,
                    record.completed_at,
                    record.elapsed_secs,
                    record.position,
                    record.retry_count as i64,
                    record.speed_limit_bps.map(|v| v as i64),
                    record.category,
                    record.on_conflict.as_str(),
                ],
            )?;
            Ok(())
        })
    }

    /// Full row update — used on state transitions.
    pub fn update_download(&self, record: &DownloadRecord) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "UPDATE downloads SET
                     url = ?2, final_url = ?3, filename = ?4, dest_dir = ?5, file_path = ?6,
                     part_path = ?7, status = ?8, error = ?9, fragmentable = ?10, connections = ?11,
                     segments = ?12, downloaded = ?13, total = ?14, etag = ?15, last_modified = ?16,
                     content_type = ?17, sha256 = ?18, created_at = ?19, started_at = ?20,
                     completed_at = ?21, elapsed_secs = ?22, position = ?23, retry_count = ?24,
                     speed_limit_bps = ?25, category = ?26, on_conflict = ?27
                 WHERE id = ?1",
                params![
                    record.id,
                    record.url,
                    record.final_url,
                    record.filename,
                    record.dest_dir,
                    record.file_path,
                    record.part_path,
                    record.status.as_str(),
                    record.error,
                    record.fragmentable as i64,
                    record.connections as i64,
                    segments_to_json(&record.segments),
                    record.downloaded as i64,
                    record.total.map(|v| v as i64),
                    record.etag,
                    record.last_modified,
                    record.content_type,
                    record.sha256,
                    record.created_at,
                    record.started_at,
                    record.completed_at,
                    record.elapsed_secs,
                    record.position,
                    record.retry_count as i64,
                    record.speed_limit_bps.map(|v| v as i64),
                    record.category,
                    record.on_conflict.as_str(),
                ],
            )?;
            Ok(())
        })
    }

    /// Lightweight status/error update (avoids rewriting the segment plan).
    pub fn update_status(&self, id: &str, status: DownloadStatus, error: Option<&str>) -> Result<()> {
        self.with(|conn| {
            let changed = conn.execute(
                "UPDATE downloads SET status = ?2, error = ?3 WHERE id = ?1",
                params![id, status.as_str(), error],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("download {id}")));
            }
            Ok(())
        })
    }

    /// Persists the resumable runtime state: segment plan, byte counter, active
    /// time, retry counter and terminal markers.
    pub fn checkpoint_download(
        &self,
        id: &str,
        segments: &[SegmentPlan],
        downloaded: u64,
        elapsed_secs: f64,
        retry_count: u32,
        status: DownloadStatus,
        error: Option<&str>,
    ) -> Result<()> {
        self.with(|conn| {
            let changed = conn.execute(
                "UPDATE downloads SET segments = ?2, downloaded = ?3, elapsed_secs = ?4,
                     retry_count = ?5, status = ?6, error = ?7
                 WHERE id = ?1",
                params![
                    id,
                    segments_to_json(segments),
                    downloaded as i64,
                    elapsed_secs,
                    retry_count as i64,
                    status.as_str(),
                    error
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("download {id}")));
            }
            Ok(())
        })
    }

    pub fn get_download(&self, id: &str) -> Result<Option<DownloadRecord>> {
        self.with(|conn| {
            let sql = format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads WHERE id = ?1");
            let mut stmt = conn.prepare(&sql)?;
            let mut rows = stmt.query([id])?;
            match rows.next()? {
                Some(row) => Ok(Some(row_to_download(row)?)),
                None => Ok(None),
            }
        })
    }

    pub fn list_downloads(&self) -> Result<Vec<DownloadRecord>> {
        self.with(|conn| {
            let sql = format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads ORDER BY position ASC, created_at ASC");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], row_to_download)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            Ok(out)
        })
    }

    pub fn delete_download(&self, id: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM downloads WHERE id = ?1", [id])?;
            Ok(())
        })
    }

    /// Removes every finished/cancelled download from the list.
    pub fn delete_finished_downloads(&self) -> Result<Vec<String>> {
        self.with(|conn| {
            let mut ids = Vec::new();
            {
                let mut stmt = conn.prepare(
                    "SELECT id FROM downloads WHERE status IN ('completed', 'cancelled')
                     ORDER BY position ASC, created_at ASC",
                )?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                for row in rows {
                    ids.push(row?);
                }
            }
            conn.execute("DELETE FROM downloads WHERE status IN ('completed', 'cancelled')", [])?;
            Ok(ids)
        })
    }

    pub fn set_position(&self, id: &str, position: i64) -> Result<()> {
        self.with(|conn| {
            conn.execute("UPDATE downloads SET position = ?2 WHERE id = ?1", params![id, position])?;
            Ok(())
        })
    }

    /// Rewrites the whole queue order in one transaction.
    pub fn set_positions(&self, ordered_ids: &[String]) -> Result<()> {
        self.with_tx(|tx| {
            {
                let mut stmt = tx.prepare_cached("UPDATE downloads SET position = ?2 WHERE id = ?1")?;
                for (index, id) in ordered_ids.iter().enumerate() {
                    stmt.execute(params![id, index as i64])?;
                }
            }
            Ok(())
        })
    }

    /// Called once at startup: a download that was live when the process died is
    /// now paused (its partial data is intact, the user decides when to resume).
    pub fn mark_live_downloads_as_paused(&self) -> Result<Vec<String>> {
        self.with(|conn| {
            let mut ids = Vec::new();
            {
                let mut stmt = conn.prepare(
                    "SELECT id FROM downloads WHERE status IN ('connecting', 'downloading', 'retrying')",
                )?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                for row in rows {
                    ids.push(row?);
                }
            }
            if !ids.is_empty() {
                conn.execute(
                    "UPDATE downloads SET status = 'paused', error = NULL
                     WHERE status IN ('connecting', 'downloading', 'retrying')",
                    [],
                )?;
            }
            Ok(ids)
        })
    }

    /// Re-numbers `position` so the queue is dense (0..n-1) after deletions.
    pub fn compact_positions(&self) -> Result<()> {
        let records = self.list_downloads()?;
        let ids: Vec<String> = records.into_iter().map(|r| r.id).collect();
        self.set_positions(&ids)
    }

    pub fn max_position(&self) -> Result<i64> {
        self.with(|conn| {
            let value: Option<i64> = conn
                .query_row("SELECT MAX(position) FROM downloads", [], |row| row.get(0))
                .optional()?
                .flatten();
            Ok(value.unwrap_or(-1))
        })
    }

    // -- history --------------------------------------------------------------

    pub fn insert_history(&self, entry: &HistoryEntry) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO history (id, download_id, url, filename, file_path, file_size, downloaded,
                         status, error, started_at, completed_at, avg_speed_bps, connections, sha256)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                     file_path = excluded.file_path,
                     file_size = excluded.file_size,
                     downloaded = excluded.downloaded,
                     status = excluded.status,
                     error = excluded.error,
                     started_at = excluded.started_at,
                     completed_at = excluded.completed_at,
                     avg_speed_bps = excluded.avg_speed_bps,
                     connections = excluded.connections,
                     sha256 = excluded.sha256",
                params![
                    entry.id,
                    entry.id,
                    entry.url,
                    entry.filename,
                    entry.file_path,
                    entry.total.map(|v| v as i64),
                    entry.downloaded as i64,
                    entry.status.as_str(),
                    entry.error,
                    entry.started_at,
                    entry.completed_at,
                    entry.average_speed_bps,
                    entry.connections as i64,
                    None::<String>,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_history(&self, filter: &HistoryFilter) -> Result<Vec<HistoryEntry>> {
        self.with(|conn| {
            let mut sql = String::from(
                "SELECT id, url, filename, file_path, file_size, downloaded, status, error,
                        started_at, completed_at, avg_speed_bps, connections
                 FROM history WHERE 1 = 1",
            );
            let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            match filter.scope.unwrap_or(HistoryScope::All) {
                HistoryScope::Completed => sql.push_str(" AND status IN ('completed')"),
                HistoryScope::Failed => {
                    sql.push_str(" AND status IN ('failed', 'cancelled', 'corrupt')")
                }
                HistoryScope::All => {}
            }

            if let Some(query) = filter.query.as_deref() {
                let trimmed = query.trim();
                if !trimmed.is_empty() {
                    // Escape LIKE wildcards so a literal '%' cannot match everything.
                    let escaped = trimmed
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_");
                    args.push(Box::new(format!("%{}%", escaped.to_lowercase())));
                    sql.push_str(" AND (lower(filename) LIKE ? ESCAPE '\\' OR lower(url) LIKE ? ESCAPE '\\')");
                    args.push(Box::new(format!("%{}%", escaped.to_lowercase())));
                }
            }

            let descending = !matches!(filter.sort.as_deref(), Some("oldest"));
            sql.push_str(if descending {
                " ORDER BY COALESCE(completed_at, started_at, 0) DESC, rowid DESC"
            } else {
                " ORDER BY COALESCE(completed_at, started_at, 0) ASC, rowid ASC"
            });

            let limit = filter.limit.unwrap_or(500).min(5000) as i64;
            let offset = filter.offset.unwrap_or(0) as i64;
            sql.push_str(" LIMIT ? OFFSET ?");
            args.push(Box::new(limit));
            args.push(Box::new(offset));

            let mut stmt = conn.prepare(&sql)?;
            let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
            let rows = stmt.query_map(refs.as_slice(), row_to_history)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            Ok(out)
        })
    }

    pub fn delete_history(&self, id: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM history WHERE id = ?1", [id])?;
            Ok(())
        })
    }

    pub fn clear_history(&self, scope: HistoryScope) -> Result<u64> {
        self.with(|conn| {
            let sql = match scope {
                HistoryScope::All => "DELETE FROM history",
                HistoryScope::Completed => "DELETE FROM history WHERE status = 'completed'",
                HistoryScope::Failed => {
                    "DELETE FROM history WHERE status IN ('failed', 'cancelled', 'corrupt')"
                }
            };
            let removed = conn.execute(sql, [])? as u64;
            Ok(removed)
        })
    }

    /// Aggregated counters for the dashboard.
    pub fn stats(&self, live: &[ProgressInfo]) -> Result<StatsSnapshot> {
        let (completed, total_rows, total_bytes, avg_speed): (i64, i64, i64, f64) = self.with(|conn| {
            let completed: i64 =
                conn.query_row("SELECT COUNT(*) FROM history WHERE status = 'completed'", [], |r| r.get(0))?;
            let total_rows: i64 = conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))?;
            let total_bytes: i64 = conn.query_row(
                "SELECT COALESCE(SUM(COALESCE(file_size, downloaded)), 0) FROM history WHERE status = 'completed'",
                [],
                |r| r.get(0),
            )?;
            // Average speed over completed downloads that recorded a duration.
            let avg_speed: f64 = conn.query_row(
                "SELECT COALESCE(AVG(avg_speed_bps), 0) FROM history
                 WHERE status = 'completed' AND avg_speed_bps > 0",
                [],
                |r| r.get::<_, f64>(0),
            )?;
            Ok((completed, total_rows, total_bytes, avg_speed))
        })?;

        let mut snapshot = StatsSnapshot {
            completed: completed as u32,
            total_downloads: total_rows as u32,
            total_downloaded_bytes: total_bytes.max(0) as u64,
            average_speed_bps: avg_speed,
            ..Default::default()
        };

        for progress in live {
            match progress.status {
                DownloadStatus::Downloading | DownloadStatus::Connecting => {
                    snapshot.active += 1;
                    snapshot.total_speed_bps += progress.speed_bps.max(0.0);
                }
                DownloadStatus::Retrying => {
                    snapshot.active += 1;
                }
                DownloadStatus::Queued => snapshot.queued += 1,
                DownloadStatus::Paused => snapshot.paused += 1,
                DownloadStatus::Failed | DownloadStatus::Corrupt => snapshot.failed += 1,
                _ => {}
            }
        }
        Ok(snapshot)
    }
}

fn segments_to_json(segments: &[SegmentPlan]) -> String {
    // A serialisation failure here would be a bug in our own types; falling back
    // to a single full-range segment keeps the row usable rather than wiping it.
    serde_json::to_string(segments).unwrap_or_else(|_| "[]".to_string())
}

fn segments_from_json(raw: &str) -> Vec<SegmentPlan> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn row_to_download(row: &Row<'_>) -> rusqlite::Result<DownloadRecord> {
    let segments_raw: String = row.get("segments")?;
    let status_raw: String = row.get("status")?;
    let total: Option<i64> = row.get("total")?;
    let speed_limit: Option<i64> = row.get("speed_limit_bps")?;
    let segments = segments_from_json(&segments_raw);
    let downloaded_stored: i64 = row.get("downloaded")?;
    let computed: u64 = segments.iter().map(|s| s.downloaded).sum();

    Ok(DownloadRecord {
        id: row.get("id")?,
        url: row.get("url")?,
        final_url: row.get("final_url")?,
        filename: row.get("filename")?,
        dest_dir: row.get("dest_dir")?,
        file_path: row.get("file_path")?,
        part_path: row.get("part_path")?,
        status: DownloadStatus::parse(&status_raw),
        error: row.get("error")?,
        fragmentable: row.get::<_, i64>("fragmentable")? != 0,
        connections: row.get::<_, i64>("connections")?.max(1) as u32,
        // The segment plan is the source of truth; the scalar column is a
        // denormalised cache that may lag behind a crashed process.
        downloaded: if computed > 0 { computed } else { downloaded_stored.max(0) as u64 },
        segments,
        total: total.map(|v| v.max(0) as u64),
        etag: row.get("etag")?,
        last_modified: row.get("last_modified")?,
        content_type: row.get("content_type")?,
        sha256: row.get("sha256")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        elapsed_secs: row.get("elapsed_secs")?,
        position: row.get("position")?,
        retry_count: row.get::<_, i64>("retry_count")?.max(0) as u32,
        speed_limit_bps: speed_limit.map(|v| v.max(0) as u64),
        category: row.get("category")?,
        on_conflict: ConflictAction::parse(&row.get::<_, String>("on_conflict")?),
    })
}

fn row_to_history(row: &Row<'_>) -> rusqlite::Result<HistoryEntry> {
    let status_raw: String = row.get("status")?;
    let size: Option<i64> = row.get("file_size")?;
    let downloaded: i64 = row.get("downloaded")?;
    Ok(HistoryEntry {
        id: row.get("id")?,
        url: row.get("url")?,
        filename: row.get("filename")?,
        file_path: row.get("file_path")?,
        status: DownloadStatus::parse(&status_raw),
        total: size.map(|v| v.max(0) as u64).or(Some(downloaded.max(0) as u64)),
        downloaded: downloaded.max(0) as u64,
        error: row.get("error")?,
        created_at: row.get("started_at").unwrap_or(None),
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        average_speed_bps: row.get("avg_speed_bps")?,
        connections: row.get::<_, i64>("connections")?.max(1) as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SegmentPlan;

    fn sample(id: &str) -> DownloadRecord {
        DownloadRecord {
            id: id.to_string(),
            url: "https://example.com/file.zip".into(),
            final_url: "https://example.com/file.zip".into(),
            filename: "file.zip".into(),
            dest_dir: "C:\\Downloads".into(),
            file_path: "C:\\Downloads\\file.zip".into(),
            part_path: "C:\\Downloads\\.swiftload\\file.zip.part".into(),
            status: DownloadStatus::Queued,
            error: None,
            fragmentable: true,
            connections: 4,
            segments: vec![SegmentPlan::new(0, 0, 999)],
            downloaded: 0,
            total: Some(1000),
            etag: Some("\"abc\"".into()),
            last_modified: None,
            content_type: Some("application/zip".into()),
            sha256: None,
            created_at: 1,
            started_at: None,
            completed_at: None,
            elapsed_secs: 0.0,
            position: 0,
            retry_count: 0,
            speed_limit_bps: None,
            category: "archives".into(),
            on_conflict: ConflictAction::Rename,
        }
    }

    #[test]
    fn insert_and_read_back() {
        let db = Database::open_in_memory().unwrap();
        let record = sample("abc123");
        db.insert_download(&record).unwrap();
        let loaded = db.get_download("abc123").unwrap().unwrap();
        assert_eq!(loaded, record);

        let all = db.list_downloads().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn checkpoint_persists_segment_progress() {
        let db = Database::open_in_memory().unwrap();
        let mut record = sample("abc124");
        record.segments = vec![SegmentPlan::new(0, 0, 499), SegmentPlan::new(1, 500, 999)];
        db.insert_download(&record).unwrap();

        let mut segments = record.segments.clone();
        segments[0].downloaded = 500;
        segments[0].done = true;
        db.checkpoint_download(
            &record.id,
            &segments,
            500,
            12.5,
            2,
            DownloadStatus::Paused,
            None,
        )
        .unwrap();

        let loaded = db.get_download(&record.id).unwrap().unwrap();
        assert_eq!(loaded.downloaded, 500);
        assert!(loaded.segments[0].done);
        assert_eq!(loaded.elapsed_secs, 12.5);
        assert_eq!(loaded.retry_count, 2);
        assert_eq!(loaded.status, DownloadStatus::Paused);
    }

    #[test]
    fn startup_marks_live_downloads_paused() {
        let db = Database::open_in_memory().unwrap();
        let mut record = sample("abc125");
        record.status = DownloadStatus::Downloading;
        db.insert_download(&record).unwrap();
        let ids = db.mark_live_downloads_as_paused().unwrap();
        assert_eq!(ids, vec!["abc125".to_string()]);
        assert_eq!(
            db.get_download("abc125").unwrap().unwrap().status,
            DownloadStatus::Paused
        );
        // Idempotent.
        assert!(db.mark_live_downloads_as_paused().unwrap().is_empty());
    }

    #[test]
    fn history_search_and_scope() {
        let db = Database::open_in_memory().unwrap();
        for (id, name, status) in [
            ("h1", "ubuntu.iso", DownloadStatus::Completed),
            ("h2", "debian.iso", DownloadStatus::Failed),
            ("h3", "100%_report.pdf", DownloadStatus::Completed),
        ] {
            db.insert_history(&HistoryEntry {
                id: id.into(),
                url: format!("https://example.com/{name}"),
                filename: name.into(),
                file_path: format!("C:\\Downloads\\{name}"),
                status,
                total: Some(100),
                downloaded: 100,
                error: None,
                created_at: Some(1),
                started_at: Some(1),
                completed_at: Some(2),
                average_speed_bps: 50.0,
                connections: 4,
            })
            .unwrap();
        }

        let completed = db
            .list_history(&HistoryFilter {
                scope: Some(HistoryScope::Completed),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(completed.len(), 2);

        let failed = db
            .list_history(&HistoryFilter {
                scope: Some(HistoryScope::Failed),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].filename, "debian.iso");

        let searched = db
            .list_history(&HistoryFilter {
                query: Some("IS".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(searched.len(), 2);

        // '%' must be treated literally, not as a wildcard.
        let literal = db
            .list_history(&HistoryFilter {
                query: Some("%".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(literal.len(), 1);
        assert_eq!(literal[0].filename, "100%_report.pdf");
    }

    #[test]
    fn stats_aggregate_history_and_live() {
        let db = Database::open_in_memory().unwrap();
        db.insert_history(&HistoryEntry {
            id: "s1".into(),
            url: "https://example.com/a".into(),
            filename: "a".into(),
            file_path: "C:\\a".into(),
            status: DownloadStatus::Completed,
            total: Some(1000),
            downloaded: 1000,
            error: None,
            created_at: Some(1),
            started_at: Some(1),
            completed_at: Some(2),
            average_speed_bps: 200.0,
            connections: 4,
        })
        .unwrap();

        let live = vec![ProgressInfo {
            downloaded: 10,
            total: Some(100),
            speed_bps: 1234.0,
            avg_speed_bps: 1000.0,
            eta_secs: Some(3),
            active_connections: 2,
            total_connections: 4,
            status: DownloadStatus::Downloading,
        }];
        let stats = db.stats(&live).unwrap();
        assert_eq!(stats.completed, 1);
        assert_eq!(stats.active, 1);
        assert_eq!(stats.total_speed_bps, 1234.0);
        assert_eq!(stats.total_downloaded_bytes, 1000);
    }
}

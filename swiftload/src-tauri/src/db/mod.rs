//! Database layer — SQLite via `rusqlite` (bundled SQLite, no system DLL).
//!
//! The connection is intentionally *not* shared across threads with a pool: the
//! whole application funnels every write through a single [`Database`] handle
//! wrapped in a mutex. Download managers are write-light (a handful of rows per
//! second at most) and WAL mode keeps contention invisible, while a single
//! connection removes an entire class of "database is locked" bugs.

pub mod downloads;
pub mod settings;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::error::{AppError, Result};

/// Current schema version. Bump this and add a migration arm in [`migrate`].
pub const SCHEMA_VERSION: i64 = 1;

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    /// Opens (creating if necessary) the database at `path` and applies migrations.
    pub fn open(path: impl AsRef<Path>) -> Result<Database> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Disk(format!("cannot create data directory {parent:?}: {e}")))?;
        }
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        configure(&conn)?;
        migrate(&conn)?;
        Ok(Database {
            conn: Mutex::new(conn),
            path,
        })
    }

    /// In-memory database used by the test-suite.
    pub fn open_in_memory() -> Result<Database> {
        let conn = Connection::open_in_memory()?;
        configure(&conn)?;
        migrate(&conn)?;
        Ok(Database {
            conn: Mutex::new(conn),
            path: PathBuf::from(":memory:"),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Runs `f` with exclusive access to the connection.
    ///
    /// A poisoned mutex is recovered rather than propagated: the underlying
    /// SQLite connection stays usable after a panic in an unrelated query, and
    /// refusing to touch the database would turn a single failure into a
    /// permanently broken application.
    pub(crate) fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let guard = match self.conn.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        f(&guard)
    }

    /// Runs `f` inside an immediate transaction.
    pub(crate) fn with_tx<T>(&self, f: impl FnOnce(&rusqlite::Transaction) -> Result<T>) -> Result<T> {
        let mut guard = match self.conn.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        let tx = guard.transaction()?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    pub fn schema_version(&self) -> Result<i64> {
        self.with(|conn| {
            let v: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            Ok(v)
        })
    }

    /// `PRAGMA integrity_check` — surfaced by Settings → Advanced → Diagnostics.
    pub fn integrity_check(&self) -> Result<String> {
        self.with(|conn| {
            let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
            Ok(result)
        })
    }
}

fn configure(conn: &Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(10))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "mmap_size", 8 * 1024 * 1024_i64)?;
    Ok(())
}

fn migrate(conn: &Connection) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current == SCHEMA_VERSION {
        return Ok(());
    }
    if current > SCHEMA_VERSION {
        return Err(AppError::Server(format!(
            "database schema version {current} is newer than this build supports ({SCHEMA_VERSION})"
        )));
    }

    if current < 1 {
        conn.execute_batch(SCHEMA_V1)?;
    }

    // Future migrations: `if current < 2 { conn.execute_batch(SCHEMA_V2)?; }`

    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

/// Version 1 schema.
///
/// `downloads` holds *resumable state* (one row per download the user can see in
/// the Downloads tab), `history` holds the immutable audit trail shown in the
/// Completed/Failed tabs, `settings` is a key/value table where every value is a
/// JSON document.
const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS downloads (
    id              TEXT    PRIMARY KEY,
    url             TEXT    NOT NULL,
    final_url       TEXT    NOT NULL DEFAULT '',
    filename        TEXT    NOT NULL,
    dest_dir        TEXT    NOT NULL,
    file_path       TEXT    NOT NULL,
    part_path       TEXT    NOT NULL,
    status          TEXT    NOT NULL,
    error           TEXT,
    fragmentable    INTEGER NOT NULL DEFAULT 0,
    connections     INTEGER NOT NULL DEFAULT 1,
    segments        TEXT    NOT NULL DEFAULT '[]',
    downloaded      INTEGER NOT NULL DEFAULT 0,
    total           INTEGER,
    etag            TEXT,
    last_modified   TEXT,
    content_type    TEXT,
    sha256          TEXT,
    created_at      INTEGER NOT NULL,
    started_at      INTEGER,
    completed_at    INTEGER,
    elapsed_secs    REAL    NOT NULL DEFAULT 0,
    position        INTEGER NOT NULL DEFAULT 0,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    speed_limit_bps INTEGER,
    category        TEXT    NOT NULL DEFAULT 'other',
    on_conflict     TEXT    NOT NULL DEFAULT 'rename'
);

CREATE INDEX IF NOT EXISTS idx_downloads_position ON downloads(position);
CREATE INDEX IF NOT EXISTS idx_downloads_status   ON downloads(status);

CREATE TABLE IF NOT EXISTS history (
    id            TEXT    PRIMARY KEY,
    download_id   TEXT    NOT NULL,
    url           TEXT    NOT NULL,
    filename      TEXT    NOT NULL,
    file_path     TEXT    NOT NULL,
    file_size     INTEGER,
    downloaded    INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL,
    error         TEXT,
    started_at    INTEGER,
    completed_at  INTEGER,
    avg_speed_bps REAL    NOT NULL DEFAULT 0,
    connections   INTEGER NOT NULL DEFAULT 1,
    sha256        TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_status       ON history(status);
CREATE INDEX IF NOT EXISTS idx_history_completed_at ON history(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_filename     ON history(filename);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let node = tempfile_dir();
        let path = node.join("swiftload.db");
        {
            let db = Database::open(&path).unwrap();
            assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
            assert_eq!(db.integrity_check().unwrap(), "ok");
        }
        {
            // Re-opening an already-migrated database must not fail.
            let db = Database::open(&path).unwrap();
            assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        }
        let _ = std::fs::remove_dir_all(&node);
    }

    #[test]
    fn settings_roundtrip() {
        let db = Database::open_in_memory().unwrap();
        db.set_setting("theme", &serde_json::json!("dark")).unwrap();
        let value = db.get_setting("theme").unwrap().unwrap();
        assert_eq!(value, serde_json::json!("dark"));
        assert!(db.get_setting("missing").unwrap().is_none());
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("swiftload-db-test-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}

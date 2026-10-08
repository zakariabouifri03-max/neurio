//! `settings` table access — a plain key/value store where each value is a JSON
//! document. Storing one row per setting (instead of a single serialised blob)
//! keeps partial writes cheap and makes the table inspectable with any SQLite
//! browser, as the specification requires.

use serde_json::Value;

use super::Database;
use crate::error::{AppError, Result};

impl Database {
    pub fn get_setting(&self, key: &str) -> Result<Option<Value>> {
        self.with(|conn| {
            let mut stmt = conn.prepare_cached("SELECT value FROM settings WHERE key = ?1")?;
            let mut rows = stmt.query([key])?;
            match rows.next()? {
                Some(row) => {
                    let raw: String = row.get(0)?;
                    match serde_json::from_str::<Value>(&raw) {
                        Ok(value) => Ok(Some(value)),
                        Err(e) => {
                            // Corrupted row: treat as absent so the caller falls
                            // back to the default instead of failing to start.
                            eprintln!("SwiftLoad: ignoring corrupt setting '{key}': {e}");
                            Ok(None)
                        }
                    }
                }
                None => Ok(None),
            }
        })
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<()> {
        let raw = serde_json::to_string(value).map_err(|e| AppError::Server(e.to_string()))?;
        self.with(|conn| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![key, raw],
            )?;
            Ok(())
        })
    }

    pub fn set_settings(&self, entries: &[(String, Value)]) -> Result<()> {
        self.with_tx(|tx| {
            {
                let mut stmt = tx.prepare_cached(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )?;
                for (key, value) in entries {
                    let raw = serde_json::to_string(value).map_err(|e| AppError::Server(e.to_string()))?;
                    stmt.execute(rusqlite::params![key, raw])?;
                }
            }
            Ok(())
        })
    }

    /// All settings as a JSON object (used to snapshot/export configuration).
    pub fn all_settings(&self) -> Result<serde_json::Map<String, Value>> {
        self.with(|conn| {
            let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
            let rows = stmt.query_map([], |row| {
                let key: String = row.get(0)?;
                let raw: String = row.get(1)?;
                Ok((key, raw))
            })?;
            let mut map = serde_json::Map::new();
            for row in rows {
                let (key, raw) = row?;
                if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                    map.insert(key, value);
                }
            }
            Ok(map)
        })
    }

    pub fn delete_setting(&self, key: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
            Ok(())
        })
    }
}

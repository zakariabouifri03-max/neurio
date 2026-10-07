#!/usr/bin/env node
/**
 * Applies db/schema.sql to the SQLite database.
 *
 * Idempotent: every statement is CREATE ... IF NOT EXISTS / INSERT OR IGNORE,
 * and the schema version is recorded in `schema_meta`. The same SQL is the
 * reference for the Postgres deployment path documented in db/schema.sql.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DATABASE_FILE
  ? resolve(root, process.env.DATABASE_FILE)
  : resolve(root, process.env.DATABASE_PATH ?? 'dev.db');

mkdirSync(dirname(dbPath), { recursive: true });
const schema = readFileSync(resolve(root, 'db/schema.sql'), 'utf8');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Split on statement boundaries (the schema keeps procedures/triggers out of scope).
const statements = schema
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter((statement) => statement && !statement.startsWith('--'));

let applied = 0;
for (const statement of statements) {
  try {
    db.exec(`${statement};`);
    applied += 1;
  } catch (error) {
    if (!/already exists/i.test(String(error?.message))) {
      console.error('[migrate] failed:', statement.split('\n')[0]);
      throw error;
    }
  }
}

db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT, applied_at INTEGER);`);
db.prepare('INSERT OR IGNORE INTO schema_meta (key, value, applied_at) VALUES (?,?,?)').run(
  'version',
  '1',
  Date.now(),
);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);

console.log(`[migrate] database: ${dbPath}`);
console.log(`[migrate] statements applied: ${applied}`);
console.log(`[migrate] tables (${tables.length}): ${tables.join(', ')}`);
db.close();

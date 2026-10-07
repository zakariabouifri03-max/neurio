import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Database layer.
 *
 * Uses the SQLite engine built into Node (`node:sqlite`) so the platform runs
 * with zero external services, while every statement stays portable SQL. The
 * query surface here is deliberately tiny — `all/get/run/tx` — and all SQL
 * lives in `src/lib/repo/*`, so swapping in Postgres or MySQL means writing a
 * new driver with the same four methods.
 */

export type Row = Record<string, any>;
export type Params = (string | number | null | Uint8Array)[];

const globalForDb = globalThis as unknown as { __prismDb?: DatabaseSync; __prismDbReady?: boolean };

import { databasePath as resolveDatabasePath } from './data-path.mjs';

/**
 * Absolute path of the SQLite file. Delegates to `data-path.mjs` so the server,
 * the migrate script and the seeder always open the same database.
 */
export function databasePath(): string {
  return resolveDatabasePath();
}

export function db(): DatabaseSync {
  if (globalForDb.__prismDb) return globalForDb.__prismDb;
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -16000;
  `);
  globalForDb.__prismDb = database;
  migrate(database);
  return database;
}

/** Runs db/schema.sql once per process (idempotent DDL). */
export function migrate(database: DatabaseSync = db()): void {
  if (globalForDb.__prismDbReady) return;
  const schemaPath = path.resolve(process.cwd(), 'db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  // Split on semicolons that end a statement (ignores those inside strings).
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));
  for (const statement of statements) {
    try {
      database.exec(statement + ';');
    } catch (err) {
      // FTS5 is optional; everything else must succeed loudly.
      if (statement.includes('fts5')) {
        console.warn('[db] FTS5 unavailable — falling back to LIKE search');
        continue;
      }
      console.error('[db] migration failed on statement:', statement.slice(0, 120));
      throw err;
    }
  }
  applyColumnMigrations(database);
  globalForDb.__prismDbReady = true;
}

/**
 * Lightweight forward migrations for databases created by an older schema.
 * SQLite cannot add a column to an existing table through CREATE TABLE, so new
 * columns are appended here the first time the process boots.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; definition: string }[] = [
  { table: 'users', column: 'is_guest', definition: 'INTEGER NOT NULL DEFAULT 0' },
];

export function applyColumnMigrations(database: DatabaseSync = db()): void {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = database.prepare(`PRAGMA table_info(${migration.table})`).all() as { name: string }[];
    if (columns.some((column) => column.name === migration.column)) continue;
    database.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition};`);
  }
}

/* ------------------------------------------------------------------- queries */

export function all<T = Row>(sql: string, params: Params = []): T[] {
  const stmt = db().prepare(sql);
  try {
    return stmt.all(...(params as any[])) as T[];
  } finally {
    // node:sqlite statements are cheap; finalizing keeps memory flat.
  }
}

export function get<T = Row>(sql: string, params: Params = []): T | undefined {
  return db().prepare(sql).get(...(params as any[])) as T | undefined;
}

export function run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number | bigint } {
  const res = db().prepare(sql).run(...(params as any[]));
  return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
}

export function exec(sql: string): void {
  db().exec(sql);
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export function tx<T>(fn: () => T): T {
  const database = db();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/* ------------------------------------------------------------------ helpers */

export function now(): number {
  return Date.now();
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

/** Builds `?,?,?` placeholders safely (never interpolates user data). */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/** LIKE-safe escaping for user supplied search terms. */
export function likeTerm(term: string): string {
  return `%${String(term).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

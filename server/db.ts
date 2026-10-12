/**
 * SQLite persistence layer.
 *
 * Uses `node:sqlite` (built into Node 22.5+ / Electron 33+), so Neurio ships
 * with **zero native dependencies** — nothing to compile, nothing to download,
 * no post-install network access. The database file lives in the app data
 * directory (Electron userData) and never leaves the machine.
 */
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { logger } from './logger';

const log = logger('db');

/**
 * `node:sqlite` ships with Node 22.5+/Electron 33+. It is loaded through a
 * runtime require so bundlers (Vite/vitest, esbuild) never try to resolve the
 * brand-new builtin themselves.
 */
type SqliteModule = typeof import('node:sqlite');
const runtimeRequire: NodeRequire =
  typeof require === 'function' ? require : createRequire(import.meta.url);
const { DatabaseSync } = runtimeRequire('node:sqlite') as SqliteModule;

export type SqlValue = string | number | bigint | Uint8Array | null;
export type Row = Record<string, SqlValue>;

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/**
 * Migrations are append-only. Never edit a released migration — add a new one.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: `
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE users (
      id             TEXT PRIMARY KEY,
      username       TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      display_name   TEXT NOT NULL,
      password_hash  TEXT NOT NULL,
      password_salt  TEXT NOT NULL,
      password_algo  TEXT NOT NULL DEFAULT 'scrypt',
      avatar_id      TEXT,
      bio            TEXT NOT NULL DEFAULT '',
      custom_status  TEXT,
      status         TEXT NOT NULL DEFAULT 'offline',
      is_bot         INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash   TEXT NOT NULL UNIQUE,
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      device_label TEXT NOT NULL DEFAULT 'Unknown device',
      kind         TEXT NOT NULL DEFAULT 'desktop',
      revoked_at   INTEGER
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);

    CREATE TABLE relationships (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, target_id)
    );
    CREATE INDEX idx_relationships_target ON relationships(target_id, type);

    CREATE TABLE guilds (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      icon_id     TEXT,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE guild_members (
      guild_id  TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname  TEXT,
      joined_at INTEGER NOT NULL,
      UNIQUE(guild_id, user_id)
    );
    CREATE INDEX idx_guild_members_user ON guild_members(user_id);

    CREATE TABLE roles (
      id          TEXT PRIMARY KEY,
      guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      color       INTEGER NOT NULL DEFAULT 0,
      permissions INTEGER NOT NULL DEFAULT 0,
      position    INTEGER NOT NULL DEFAULT 0,
      hoist       INTEGER NOT NULL DEFAULT 0,
      mentionable INTEGER NOT NULL DEFAULT 0,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_roles_guild ON roles(guild_id, position);

    CREATE TABLE member_roles (
      guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id  TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      UNIQUE(guild_id, user_id, role_id)
    );

    CREATE TABLE channels (
      id               TEXT PRIMARY KEY,
      guild_id         TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      type             TEXT NOT NULL,
      topic            TEXT,
      position         INTEGER NOT NULL DEFAULT 0,
      parent_id        TEXT,
      slowmode_seconds INTEGER NOT NULL DEFAULT 0,
      nsfw             INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL,
      last_message_id  TEXT
    );
    CREATE INDEX idx_channels_guild ON channels(guild_id, position);

    CREATE TABLE permission_overwrites (
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      target_id   TEXT NOT NULL,
      target_type TEXT NOT NULL,
      allow       INTEGER NOT NULL DEFAULT 0,
      deny        INTEGER NOT NULL DEFAULT 0,
      UNIQUE(channel_id, target_id)
    );

    CREATE TABLE messages (
      id               TEXT PRIMARY KEY,
      channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content          TEXT NOT NULL DEFAULT '',
      type             TEXT NOT NULL DEFAULT 'default',
      created_at       INTEGER NOT NULL,
      edited_at        INTEGER,
      pinned           INTEGER NOT NULL DEFAULT 0,
      reference_id     TEXT,
      mention_everyone INTEGER NOT NULL DEFAULT 0,
      deleted_at       INTEGER
    );
    CREATE INDEX idx_messages_channel ON messages(channel_id, id DESC);
    CREATE INDEX idx_messages_author ON messages(author_id, id DESC);

    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      message_id UNINDEXED,
      channel_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE message_mentions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL,
      UNIQUE(message_id, user_id)
    );
    CREATE INDEX idx_mentions_user ON message_mentions(user_id);

    CREATE TABLE uploads (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename     TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size         INTEGER NOT NULL,
      storage_key  TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE attachments (
      id          TEXT PRIMARY KEY,
      message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE,
      upload_id   TEXT REFERENCES uploads(id) ON DELETE CASCADE,
      channel_id  TEXT,
      filename    TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size        INTEGER NOT NULL,
      width       INTEGER,
      height      INTEGER,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_attachments_message ON attachments(message_id);

    CREATE TABLE message_reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX idx_reactions_message ON message_reactions(message_id);

    CREATE TABLE dm_recipients (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(channel_id, user_id)
    );
    CREATE INDEX idx_dm_recipients_user ON dm_recipients(user_id);

    CREATE TABLE read_states (
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id           TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      last_read_message_id TEXT,
      mention_count        INTEGER NOT NULL DEFAULT 0,
      last_read_at         INTEGER NOT NULL,
      UNIQUE(user_id, channel_id)
    );

    CREATE TABLE invites (
      code       TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      uses       INTEGER NOT NULL DEFAULT 0,
      max_uses   INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE voice_states (
      user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL,
      guild_id    TEXT,
      session_id  TEXT NOT NULL,
      self_mute   INTEGER NOT NULL DEFAULT 0,
      self_deaf   INTEGER NOT NULL DEFAULT 0,
      self_video  INTEGER NOT NULL DEFAULT 0,
      self_stream INTEGER NOT NULL DEFAULT 0,
      mute        INTEGER NOT NULL DEFAULT 0,
      deaf        INTEGER NOT NULL DEFAULT 0,
      joined_at   INTEGER NOT NULL
    );
    CREATE INDEX idx_voice_channel ON voice_states(channel_id);

    CREATE TABLE calls (
      id         TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id   TEXT,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      started_by TEXT NOT NULL
    );
    CREATE INDEX idx_calls_channel ON calls(channel_id, started_at DESC);

    CREATE TABLE call_participants (
      call_id   TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      left_at   INTEGER,
      UNIQUE(call_id, user_id)
    );

    CREATE TABLE bans (
      guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL,
      reason     TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(guild_id, user_id)
    );
    `,
  },
  {
    version: 2,
    name: 'upload download counters',
    up: `
    ALTER TABLE uploads ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export interface DatabaseOptions {
  /** Path to the .sqlite file, or ':memory:' for tests. */
  file: string;
  /** Quiet mode is used by tests. */
  verbose?: boolean;
}

export class Database {
  readonly file: string;
  readonly raw: import('node:sqlite').DatabaseSync;
  readonly version: number;

  constructor(options: DatabaseOptions) {
    this.file = options.file;
    if (this.file !== ':memory:') {
      mkdirSync(dirname(this.file), { recursive: true });
    }
    this.raw = new DatabaseSync(this.file);
    this.applyPragmas();
    this.version = this.migrate(options.verbose === true);
  }

  private applyPragmas(): void {
    if (this.file !== ':memory:') {
      // WAL keeps reads fast while writes happen and survives crashes.
      this.raw.exec('PRAGMA journal_mode = WAL;');
      this.raw.exec('PRAGMA synchronous = NORMAL;');
    }
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
  }

  private migrate(verbose: boolean): number {
    const current = this.userVersion();
    const pending = MIGRATIONS.filter((m) => m.version > current).sort(
      (a, b) => a.version - b.version,
    );
    for (const migration of pending) {
      const started = Date.now();
      this.raw.exec('BEGIN;');
      try {
        this.raw.exec(migration.up);
        this.raw.exec(`PRAGMA user_version = ${migration.version};`);
        this.raw.exec('COMMIT;');
      } catch (error) {
        this.raw.exec('ROLLBACK;');
        throw new Error(
          `Migration ${migration.version} (${migration.name}) failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (verbose) {
        log.info(`migrated → v${migration.version} (${migration.name}) in ${Date.now() - started}ms`);
      }
    }
    return this.userVersion();
  }

  userVersion(): number {
    const row = this.raw.prepare('PRAGMA user_version;').get() as Row | undefined;
    if (!row) return 0;
    const value = Object.values(row)[0];
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  /** SELECT returning every row. */
  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    return this.raw.prepare(sql).all(...params) as unknown as T[];
  }

  /** SELECT returning the first row (or undefined). */
  get<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.raw.prepare(sql).get(...params) as unknown as T | undefined;
  }

  /** INSERT/UPDATE/DELETE. */
  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const result = this.raw.prepare(sql).run(...params);
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: Number(result.lastInsertRowid ?? 0),
    };
  }

  /** Multi-statement script (no parameters). */
  exec(sql: string): void {
    this.raw.exec(sql);
  }

  #depth = 0;

  /**
   * Run `fn` inside a transaction; rolls back on throw.
   * Re-entrant: a nested call joins the outer transaction instead of issuing a
   * second BEGIN (SQLite does not support nested transactions).
   */
  tx<T>(fn: () => T): T {
    if (this.#depth > 0) {
      this.#depth += 1;
      try {
        return fn();
      } finally {
        this.#depth -= 1;
      }
    }
    this.raw.exec('BEGIN;');
    this.#depth = 1;
    try {
      const result = fn();
      this.raw.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK;');
      } catch {
        /* the transaction may already be gone */
      }
      throw error;
    } finally {
      this.#depth = 0;
    }
  }

  setMeta(key: string, value: string): void {
    this.run(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  getMeta(key: string): string | null {
    const row = this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  close(): void {
    try {
      this.raw.close();
    } catch {
      /* already closed */
    }
  }

  /** Diagnostics for the settings screen. */
  stats(): { file: string; version: number; users: number; messages: number; sizeBytes: number } {
    const count = (table: string): number => {
      const row = this.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
      return Number(row?.c ?? 0);
    };
    let sizeBytes = 0;
    if (this.file !== ':memory:') {
      try {
        sizeBytes = statSync(this.file).size;
      } catch {
        sizeBytes = 0;
      }
    }
    return {
      file: this.file,
      version: this.version,
      users: count('users'),
      messages: count('messages'),
      sizeBytes,
    };
  }
}

export function openDatabase(options: DatabaseOptions): Database {
  const db = new Database(options);
  if (options.verbose) {
    log.info(`opened ${options.file} (schema v${db.version})`);
  }
  return db;
}

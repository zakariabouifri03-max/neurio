import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { SQLInputValue } from './sqlite-types'

/** node:sqlite expects a plain record of primitives for named parameters. */
const toParams = (row: object): Record<string, SQLInputValue> => {
  const out: Record<string, SQLInputValue> = {}
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = value === undefined ? null : (value as SQLInputValue)
  }
  return out
}
import { log } from '../../logger'
import { getPaths } from './paths'

/**
 * Local index database.
 *
 * Primary engine: SQLite through Node's built-in `node:sqlite` (no native
 * module to compile, no electron-rebuild step). If the runtime does not ship
 * it, we transparently fall back to an atomic JSON index so the app keeps
 * working instead of failing to start.
 *
 * The database is an *index*: project bodies live in readable JSON files, so a
 * corrupt index is always rebuildable by scanning the projects directory.
 */

export interface ProjectRow {
  id: string
  name: string
  created_at: number
  updated_at: number
  page_count: number
  width: number
  height: number
  thumbnail_id: string | null
  tags: string
  path: string
  bytes: number
  origin: string
}

export interface TemplateRow {
  id: string
  name: string
  category: string
  width: number
  height: number
  thumbnail_id: string | null
  builtin: number
  tags: string
  path: string
  created_at: number
  updated_at: number
}

export interface AssetRow {
  id: string
  name: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  created_at: number
  storage: string
  path: string | null
}

interface IndexShape {
  projects: ProjectRow[]
  templates: TemplateRow[]
  assets: AssetRow[]
  meta: Record<string, string>
}

type SqliteModule = typeof import('node:sqlite')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 1, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
  thumbnail_id TEXT, tags TEXT NOT NULL DEFAULT '[]', path TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'blank'
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  thumbnail_id TEXT, builtin INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', path TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER, height INTEGER, created_at INTEGER NOT NULL, storage TEXT NOT NULL DEFAULT 'file', path TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
`

export class Database {
  private sqlite: InstanceType<SqliteModule['DatabaseSync']> | null = null
  private jsonIndex: IndexShape | null = null
  readonly engine: 'sqlite' | 'json'

  constructor(private readonly dbFile = getPaths().db, private readonly jsonFile = `${getPaths().db}.json`) {
    const mod = this.tryLoadSqlite()
    if (mod) {
      this.engine = 'sqlite'
    } else {
      this.engine = 'json'
      this.jsonIndex = this.readJsonIndex()
      log.warn('node:sqlite unavailable — using JSON index fallback at', this.jsonFile)
    }
  }

  private tryLoadSqlite(): SqliteModule | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('node:sqlite') as SqliteModule
      const db = new mod.DatabaseSync(this.dbFile)
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA synchronous = NORMAL;')
      db.exec(SCHEMA)
      this.sqlite = db as unknown as InstanceType<SqliteModule['DatabaseSync']>
      return mod
    } catch (error) {
      log.error('SQLite init failed', error)
      return null
    }
  }

  private readJsonIndex(): IndexShape {
    if (existsSync(this.jsonFile)) {
      try {
        return JSON.parse(readFileSync(this.jsonFile, 'utf8')) as IndexShape
      } catch (error) {
        log.error('Corrupt JSON index, starting fresh', error)
      }
    }
    return { projects: [], templates: [], assets: [], meta: {} }
  }

  private flushJson(): void {
    if (this.engine !== 'json' || !this.jsonIndex) return
    const tmp = `${this.jsonFile}.tmp`
    writeFileSync(tmp, JSON.stringify(this.jsonIndex, null, 2), 'utf8')
    renameSync(tmp, this.jsonFile)
  }

  /* ------------------------------ projects ------------------------------ */

  listProjects(): ProjectRow[] {
    if (this.sqlite) {
      return this.sqlite.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as unknown as ProjectRow[]
    }
    return [...(this.jsonIndex?.projects ?? [])].sort((a, b) => b.updated_at - a.updated_at)
  }

  getProject(id: string): ProjectRow | null {
    if (this.sqlite) return (this.sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow) ?? null
    return this.jsonIndex?.projects.find((p) => p.id === id) ?? null
  }

  upsertProject(row: ProjectRow): void {
    if (this.sqlite) {
      this.sqlite
        .prepare(
          `INSERT INTO projects (id,name,created_at,updated_at,page_count,width,height,thumbnail_id,tags,path,bytes,origin)
           VALUES (@id,@name,@created_at,@updated_at,@page_count,@width,@height,@thumbnail_id,@tags,@path,@bytes,@origin)
           ON CONFLICT(id) DO UPDATE SET name=@name,updated_at=@updated_at,page_count=@page_count,width=@width,height=@height,
             thumbnail_id=@thumbnail_id,tags=@tags,path=@path,bytes=@bytes,origin=@origin`
        )
        .run(toParams(row))
      return
    }
    const list = this.jsonIndex?.projects ?? []
    const index = list.findIndex((p) => p.id === row.id)
    if (index === -1) list.push(row)
    else list[index] = row
    if (this.jsonIndex) this.jsonIndex.projects = list
    this.flushJson()
  }

  deleteProject(id: string): void {
    if (this.sqlite) {
      this.sqlite.prepare('DELETE FROM projects WHERE id = ?').run(id)
      return
    }
    if (this.jsonIndex) this.jsonIndex.projects = this.jsonIndex.projects.filter((p) => p.id !== id)
    this.flushJson()
  }

  /* ------------------------------ templates ----------------------------- */

  listTemplates(): TemplateRow[] {
    if (this.sqlite) return this.sqlite.prepare('SELECT * FROM templates ORDER BY category, name').all() as unknown as TemplateRow[]
    return this.jsonIndex?.templates ?? []
  }

  getTemplate(id: string): TemplateRow | null {
    if (this.sqlite) return (this.sqlite.prepare('SELECT * FROM templates WHERE id = ?').get(id) as unknown as TemplateRow) ?? null
    return this.jsonIndex?.templates.find((t) => t.id === id) ?? null
  }

  upsertTemplate(row: TemplateRow): void {
    if (this.sqlite) {
      this.sqlite
        .prepare(
          `INSERT INTO templates (id,name,category,width,height,thumbnail_id,builtin,tags,path,created_at,updated_at)
           VALUES (@id,@name,@category,@width,@height,@thumbnail_id,@builtin,@tags,@path,@created_at,@updated_at)
           ON CONFLICT(id) DO UPDATE SET name=@name,category=@category,width=@width,height=@height,thumbnail_id=@thumbnail_id,
             builtin=@builtin,tags=@tags,path=@path,updated_at=@updated_at`
        )
        .run(toParams(row))
      return
    }
    const list = this.jsonIndex?.templates ?? []
    const index = list.findIndex((t) => t.id === row.id)
    if (index === -1) list.push(row)
    else list[index] = row
    if (this.jsonIndex) this.jsonIndex.templates = list
    this.flushJson()
  }

  deleteTemplate(id: string): void {
    if (this.sqlite) {
      this.sqlite.prepare('DELETE FROM templates WHERE id = ?').run(id)
      return
    }
    if (this.jsonIndex) this.jsonIndex.templates = this.jsonIndex.templates.filter((t) => t.id !== id)
    this.flushJson()
  }

  /* -------------------------------- assets ------------------------------ */

  listAssets(): AssetRow[] {
    if (this.sqlite) return this.sqlite.prepare('SELECT * FROM assets ORDER BY created_at DESC').all() as unknown as AssetRow[]
    return this.jsonIndex?.assets ?? []
  }

  upsertAsset(row: AssetRow): void {
    if (this.sqlite) {
      this.sqlite
        .prepare(
          `INSERT INTO assets (id,name,mime,bytes,width,height,created_at,storage,path)
           VALUES (@id,@name,@mime,@bytes,@width,@height,@created_at,@storage,@path)
           ON CONFLICT(id) DO UPDATE SET name=@name,mime=@mime,bytes=@bytes,width=@width,height=@height,storage=@storage,path=@path`
        )
        .run(toParams(row))
      return
    }
    const list = this.jsonIndex?.assets ?? []
    const index = list.findIndex((a) => a.id === row.id)
    if (index === -1) list.push(row)
    else list[index] = row
    if (this.jsonIndex) this.jsonIndex.assets = list
    this.flushJson()
  }

  deleteAsset(id: string): void {
    if (this.sqlite) {
      this.sqlite.prepare('DELETE FROM assets WHERE id = ?').run(id)
      return
    }
    if (this.jsonIndex) this.jsonIndex.assets = this.jsonIndex.assets.filter((a) => a.id !== id)
    this.flushJson()
  }

  /* --------------------------------- meta ------------------------------- */

  getMeta(key: string): string | null {
    if (this.sqlite) {
      const row = this.sqlite.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
      return row?.value ?? null
    }
    return this.jsonIndex?.meta[key] ?? null
  }

  setMeta(key: string, value: string): void {
    if (this.sqlite) {
      this.sqlite.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
      return
    }
    if (this.jsonIndex) this.jsonIndex.meta[key] = value
    this.flushJson()
  }

  close(): void {
    try {
      this.sqlite?.close()
    } catch {
      /* ignore */
    }
  }
}

let instance: Database | null = null
export const getDatabase = (): Database => {
  if (!instance) instance = new Database()
  return instance
}

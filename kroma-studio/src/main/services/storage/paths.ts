import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface KromaPaths {
  root: string
  projects: string
  assets: string
  templates: string
  fonts: string
  thumbnails: string
  backups: string
  logs: string
  db: string
  settings: string
}

let cached: KromaPaths | null = null

export function getPaths(): KromaPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  cached = {
    root,
    projects: join(root, 'projects'),
    assets: join(root, 'assets'),
    templates: join(root, 'templates'),
    fonts: join(root, 'fonts'),
    thumbnails: join(root, 'thumbnails'),
    backups: join(root, 'backups'),
    logs: join(root, 'logs'),
    db: join(root, 'kroma.sqlite'),
    settings: join(root, 'settings.json')
  }
  return cached
}

export function ensureStorageDirs(): KromaPaths {
  const paths = getPaths()
  for (const dir of [paths.projects, paths.assets, paths.templates, paths.fonts, paths.thumbnails, paths.backups, paths.logs]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}

/** Guards against `..` traversal in ids used to build file names. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

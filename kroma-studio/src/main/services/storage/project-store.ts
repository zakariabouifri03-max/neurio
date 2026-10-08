import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOCUMENT_VERSION } from '../../../shared/constants'
import { createDocument } from '../../../shared/utils/document'
import { newId } from '../../../shared/utils/ids'
import { sanitizeDocument, sanitizeProjectName } from '../../../shared/utils/validation'
import type { CreateProjectInput, Project, ProjectMeta, SaveProjectInput } from '../../../shared/types/project'
import { log } from '../../logger'
import { getDatabase } from './database'
import { ensureStorageDirs, isSafeId } from './paths'
import { getSettingsStore } from './settings-store'
import { resourcePath } from './resources'

const EXT = '.kroma.json'

const toMeta = (row: ReturnType<ReturnType<typeof getDatabase>['listProjects']>[number]): ProjectMeta => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  pageCount: row.page_count,
  width: row.width,
  height: row.height,
  thumbnailId: row.thumbnail_id,
  tags: safeTags(row.tags)
})

function safeTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 12) : []
  } catch {
    return []
  }
}

/**
 * Projects are plain JSON documents (`<id>.kroma.json`) on the local
 * filesystem, indexed in SQLite for fast listing. Writes are atomic
 * (temp file + rename) and previous revisions are rotated into `backups/`.
 */
export class ProjectStore {
  private get dir(): string {
    return ensureStorageDirs().projects
  }

  filePath(id: string): string {
    if (!isSafeId(id)) throw Object.assign(new Error('Invalid project id'), { code: 'INVALID_INPUT' })
    return join(this.dir, `${id}${EXT}`)
  }

  thumbnailPath(id: string): string {
    return join(ensureStorageDirs().thumbnails, `${id}.png`)
  }

  private rebuildIndexFromFilesystem(): void {
    log.info('Rebuilding project index from filesystem')
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith(EXT)) continue
      const path = join(this.dir, entry)
      try {
        const project = JSON.parse(readFileSync(path, 'utf8')) as Project
        const stat = statSync(path)
        this.indexProject(project, path, stat.size)
      } catch (error) {
        log.warn('Skipping unreadable project file', entry, error)
      }
    }
  }

  private indexProject(project: Project, path: string, bytes: number): void {
    const page = project.document?.pages?.[0]
    getDatabase().upsertProject({
      id: project.id,
      name: project.name,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      page_count: project.document?.pages?.length ?? 1,
      width: page?.width ?? 0,
      height: page?.height ?? 0,
      thumbnail_id: existsSync(this.thumbnailPath(project.id)) ? project.id : null,
      tags: JSON.stringify(project.tags ?? []),
      path,
      bytes,
      origin: project.origin ?? 'blank'
    })
  }

  list(): ProjectMeta[] {
    const rows = getDatabase().listProjects()
    if (rows.length === 0) {
      this.rebuildIndexFromFilesystem()
      return getDatabase().listProjects().map(toMeta)
    }
    return rows.map(toMeta)
  }

  read(id: string): Project | null {
    const path = this.filePath(id)
    if (!existsSync(path)) return null
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Project
      const document = sanitizeDocument(raw.document)
      return {
        id,
        name: sanitizeProjectName(raw.name),
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        document,
        assets: Array.isArray(raw.assets) ? raw.assets : [],
        brandKit: raw.brandKit ?? null,
        tags: safeTags(JSON.stringify(raw.tags ?? [])),
        origin: raw.origin,
        sourceId: raw.sourceId ?? null
      }
    } catch (error) {
      log.error('Failed to read project', id, error)
      throw Object.assign(new Error('This project file could not be opened. It may be corrupted.'), { code: 'CORRUPT' })
    }
  }

  create(input: CreateProjectInput): Project {
    const id = newId('pr')
    const now = Date.now()
    const document = input.document ?? createDocument(input.width || 1080, input.height || 1080)
    const project: Project = {
      id,
      name: sanitizeProjectName(input.name, 'Untitled design'),
      createdAt: now,
      updatedAt: now,
      document,
      assets: [],
      brandKit: null,
      tags: input.tags ?? [],
      origin: input.origin ?? 'blank',
      sourceId: input.sourceId ?? null
    }
    const path = this.filePath(id)
    writeFileSync(path, JSON.stringify(project, null, 2), 'utf8')
    this.indexProject(project, path, statSync(path).size)
    return project
  }

  save(input: SaveProjectInput): ProjectMeta {
    const id = input.id
    const path = this.filePath(id)
    const existing = this.read(id)
    const document = sanitizeDocument(input.document)
    if (document.version !== DOCUMENT_VERSION) document.version = DOCUMENT_VERSION

    const project: Project = {
      id,
      name: sanitizeProjectName(input.name ?? existing?.name, 'Untitled design'),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      document,
      assets: input.assets ?? existing?.assets ?? [],
      brandKit: input.brandKit === undefined ? (existing?.brandKit ?? null) : input.brandKit,
      tags: existing?.tags ?? [],
      origin: existing?.origin ?? 'blank',
      sourceId: existing?.sourceId ?? null
    }

    this.rotateBackup(path, id)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(project), 'utf8')
    renameSync(tmp, path)
    this.indexProject(project, path, statSync(path).size)

    if (input.thumbnail?.dataUrl) this.writeThumbnail(id, input.thumbnail.dataUrl)
    return toMeta(getDatabase().getProject(id)!)
  }

  private rotateBackup(path: string, id: string): void {
    if (!existsSync(path)) return
    const keep = getSettingsStore().get().storage.keepBackups
    if (keep <= 0) return
    const dir = ensureStorageDirs().backups
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      const target = join(dir, `${id}.${stamp}${EXT}`)
      const { copyFileSync } = require('node:fs') as typeof import('node:fs')
      copyFileSync(path, target)
      const backups = readdirSync(dir)
        .filter((f) => f.startsWith(`${id}.`))
        .sort()
      for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
        rmSync(join(dir, stale), { force: true })
      }
    } catch (error) {
      log.warn('Backup rotation failed', error)
    }
  }

  writeThumbnail(id: string, dataUrl: string): void {
    try {
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      writeFileSync(this.thumbnailPath(id), Buffer.from(base64, 'base64'))
      const row = getDatabase().getProject(id)
      if (row) getDatabase().upsertProject({ ...row, thumbnail_id: id })
    } catch (error) {
      log.warn('Thumbnail write failed', error)
    }
  }

  duplicate(id: string): ProjectMeta {
    const source = this.read(id)
    if (!source) throw Object.assign(new Error('Project not found'), { code: 'NOT_FOUND' })
    const project = this.create({
      name: `${source.name} copy`,
      width: source.document.pages[0]?.width ?? 1080,
      height: source.document.pages[0]?.height ?? 1080,
      document: structuredClone(source.document),
      tags: source.tags,
      origin: source.origin,
      sourceId: source.id
    })
    if (existsSync(this.thumbnailPath(id))) {
      try {
        const { copyFileSync } = require('node:fs') as typeof import('node:fs')
        copyFileSync(this.thumbnailPath(id), this.thumbnailPath(project.id))
        const row = getDatabase().getProject(project.id)
        if (row) getDatabase().upsertProject({ ...row, thumbnail_id: project.id })
      } catch (error) {
        log.warn('Thumbnail copy failed', error)
      }
    }
    return toMeta(getDatabase().getProject(project.id)!)
  }

  remove(id: string): void {
    const path = this.filePath(id)
    if (existsSync(path)) rmSync(path, { force: true })
    rmSync(this.thumbnailPath(id), { force: true })
    getDatabase().deleteProject(id)
  }

  rename(id: string, name: string): ProjectMeta {
    const row = getDatabase().getProject(id)
    if (!row) throw Object.assign(new Error('Project not found'), { code: 'NOT_FOUND' })
    const project = this.read(id)
    if (!project) throw Object.assign(new Error('Project not found'), { code: 'NOT_FOUND' })
    project.name = sanitizeProjectName(name, project.name)
    project.updatedAt = Date.now()
    const path = this.filePath(id)
    writeFileSync(path, JSON.stringify(project), 'utf8')
    this.indexProject(project, path, statSync(path).size)
    return toMeta(getDatabase().getProject(id)!)
  }

  /** Imports the bundled sample projects on first launch so the app is not empty. */
  seedSamplesIfEmpty(): number {
    if (this.list().length > 0) return 0
    const dir = resourcePath('samples')
    if (!existsSync(dir)) return 0
    let count = 0
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { name?: string; document: unknown; tags?: string[] }
        const document = sanitizeDocument(raw.document)
        const page = document.pages[0]
        this.create({
          name: raw.name ?? 'Sample design',
          width: page.width,
          height: page.height,
          document,
          tags: raw.tags ?? ['sample'],
          origin: 'sample'
        })
        count += 1
      } catch (error) {
        log.warn('Could not import sample', file, error)
      }
    }
    if (count > 0) log.info(`Seeded ${count} sample projects`)
    return count
  }
}

let instance: ProjectStore | null = null
export const getProjectStore = (): ProjectStore => {
  if (!instance) instance = new ProjectStore()
  return instance
}

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TemplateMeta, TemplateRecord } from '../../../shared/types/project'
import { sanitizeDocument, sanitizeProjectName } from '../../../shared/utils/validation'
import { newId } from '../../../shared/utils/ids'
import { log } from '../../logger'
import { getDatabase } from './database'
import { ensureStorageDirs, isSafeId } from './paths'
import { resourcePath } from './resources'

const toMeta = (row: ReturnType<ReturnType<typeof getDatabase>['listTemplates']>[number]): TemplateMeta => ({
  id: row.id,
  name: row.name,
  category: row.category,
  width: row.width,
  height: row.height,
  thumbnailId: row.thumbnail_id,
  builtin: row.builtin === 1,
  tags: safeTags(row.tags),
  description: undefined
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
 * Templates are JSON documents: originals ship in `resources/templates`,
 * user templates live in `<userData>/templates`. Both are indexed in SQLite.
 */
export class TemplateStore {
  constructor() {
    this.indexBuiltins()
  }

  private indexBuiltins(): void {
    const dir = resourcePath('templates')
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const path = join(dir, file)
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as TemplateRecord & { id?: string }
        const id = raw.id ?? file.replace(/\.json$/, '')
        if (!isSafeId(id)) continue
        const existing = getDatabase().getTemplate(id)
        if (existing && existing.builtin === 1) continue
        getDatabase().upsertTemplate({
          id,
          name: raw.name ?? id,
          category: raw.category ?? 'Posters',
          width: raw.width ?? raw.document?.pages?.[0]?.width ?? 1080,
          height: raw.height ?? raw.document?.pages?.[0]?.height ?? 1080,
          thumbnail_id: raw.thumbnailId ?? null,
          builtin: 1,
          tags: JSON.stringify(raw.tags ?? []),
          path,
          created_at: Date.now(),
          updated_at: Date.now()
        })
      } catch (error) {
        log.warn('Could not index template', file, error)
      }
    }
  }

  list(): TemplateMeta[] {
    return getDatabase().listTemplates().map(toMeta)
  }

  read(id: string): TemplateRecord | null {
    const row = getDatabase().getTemplate(id)
    if (!row || !existsSync(row.path)) return null
    try {
      const raw = JSON.parse(readFileSync(row.path, 'utf8')) as TemplateRecord
      return {
        ...toMeta(row),
        name: row.name,
        document: sanitizeDocument(raw.document),
        assets: Array.isArray(raw.assets) ? raw.assets : []
      }
    } catch (error) {
      log.error('Failed to read template', id, error)
      return null
    }
  }

  create(input: { name: string; category: string; document: unknown; thumbnail?: string | null }): TemplateMeta {
    const id = newId('tp')
    const dir = ensureStorageDirs().templates
    const path = join(dir, `${id}.json`)
    const document = sanitizeDocument(input.document)
    const record: TemplateRecord = {
      id,
      name: sanitizeProjectName(input.name, 'Custom template'),
      category: input.category || 'Posters',
      width: document.pages[0]?.width ?? 1080,
      height: document.pages[0]?.height ?? 1080,
      builtin: false,
      tags: ['custom'],
      document,
      assets: []
    }
    writeFileSync(path, JSON.stringify(record), 'utf8')
    getDatabase().upsertTemplate({
      id,
      name: record.name,
      category: record.category,
      width: record.width,
      height: record.height,
      thumbnail_id: input.thumbnail ?? null,
      builtin: 0,
      tags: JSON.stringify(record.tags),
      path,
      created_at: Date.now(),
      updated_at: Date.now()
    })
    return toMeta(getDatabase().getTemplate(id)!)
  }

  remove(id: string): void {
    const row = getDatabase().getTemplate(id)
    if (!row) return
    if (row.builtin === 1) {
      throw Object.assign(new Error('Built-in templates cannot be deleted. Duplicate one to make an editable copy.'), {
        code: 'PROTECTED'
      })
    }
    rmSync(row.path, { force: true })
    getDatabase().deleteTemplate(id)
  }
}

let instance: TemplateStore | null = null
export const getTemplateStore = (): TemplateStore => {
  if (!instance) instance = new TemplateStore()
  return instance
}

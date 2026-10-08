import { KromaError, type FontFamily, type SaveBlobInput, type SystemInfo } from '../../../shared/ipc'
import { DEFAULT_SETTINGS, type AiProviderId, type AppSettings, type PublicSettings } from '../../../shared/types/settings'
import type { AiImageResult, AiTextResult, DesignPlan } from '../../../shared/types/ai'
import type { CreateProjectInput, Project, ProjectMeta, SaveProjectInput, TemplateMeta, TemplateRecord } from '../../../shared/types/project'
import { DOCUMENT_VERSION } from '../../../shared/constants'
import { createDocument } from '../../../shared/utils/document'
import { newId } from '../../../shared/utils/ids'
import { sanitizeDocument } from '../../../shared/utils/validation'
import type { PlatformApi } from './types'

/**
 * Browser preview shim.
 *
 * The product ships as a desktop app; this implementation exists so the exact
 * same renderer can be served by Vite for UI review without Electron. Storage is
 * IndexedDB/localStorage instead of the filesystem, and AI calls are refused
 * because a browser cannot hold provider keys safely.
 */

const DB_NAME = 'kroma-preview'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of ['projects', 'assets', 'templates', 'thumbs']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const request = tx.objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

async function idbAll<T>(store: string): Promise<Array<{ key: string; value: T }>> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const out: Array<{ key: string; value: T }> = []
    const request = tx.objectStore(store).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        out.push({ key: String(cursor.key), value: cursor.value as T })
        cursor.continue()
      } else resolve(out)
    }
    request.onerror = () => reject(request.error)
  })
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const readSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem('kroma.settings')
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    return { ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(raw) as AppSettings) }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

const writeSettings = (settings: AppSettings): void => {
  localStorage.setItem('kroma.settings', JSON.stringify(settings))
}

const toPublic = (settings: AppSettings): PublicSettings => ({
  ...settings,
  ai: {
    routing: settings.ai.routing,
    allowOfflineFallback: settings.ai.allowOfflineFallback,
    requestTimeoutMs: settings.ai.requestTimeoutMs,
    providers: {}
  }
})

const download = (dataUrl: string, fileName: string): void => {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Browser preview cannot hold provider keys safely, so AI calls are refused. */
const noAi = (): never => {
  throw new KromaError('NOT_CONFIGURED', 'AI providers run in the desktop app where keys are stored encrypted. Run `npm run dev` for full AI access.')
}

export const webPlatform: PlatformApi = {
  meta: { isDesktop: false, version: 'preview' },

  projects: {
    async list(): Promise<ProjectMeta[]> {
      const rows = await idbAll<Project>('projects')
      return rows
        .map(({ value }) => ({
          id: value.id,
          name: value.name,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          pageCount: value.document.pages.length,
          width: value.document.pages[0]?.width ?? 0,
          height: value.document.pages[0]?.height ?? 0,
          thumbnailId: null,
          tags: value.tags ?? []
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async create(input: CreateProjectInput): Promise<Project> {
      const now = Date.now()
      const project: Project = {
        id: newId('pr'),
        name: input.name ?? 'Untitled design',
        createdAt: now,
        updatedAt: now,
        document: input.document ?? createDocument(input.width, input.height),
        assets: [],
        brandKit: null,
        tags: input.tags ?? [],
        origin: input.origin ?? 'blank'
      }
      await idbPut('projects', project.id, project)
      return project
    },
    async read(id: string): Promise<Project | null> {
      const project = await idbGet<Project>('projects', id)
      if (!project) return null
      return { ...project, document: sanitizeDocument(project.document) }
    },
    async save(input: SaveProjectInput): Promise<ProjectMeta> {
      const existing = await idbGet<Project>('projects', input.id)
      const document = sanitizeDocument(input.document)
      const project: Project = {
        id: input.id,
        name: input.name ?? existing?.name ?? 'Untitled design',
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        document,
        assets: input.assets ?? existing?.assets ?? [],
        brandKit: input.brandKit ?? existing?.brandKit ?? null,
        tags: existing?.tags ?? [],
        origin: existing?.origin
      }
      await idbPut('projects', project.id, project)
      if (input.thumbnail?.dataUrl) await idbPut('thumbs', project.id, input.thumbnail.dataUrl)
      return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        pageCount: document.pages.length,
        width: document.pages[0]?.width ?? 0,
        height: document.pages[0]?.height ?? 0,
        thumbnailId: null,
        tags: project.tags
      }
    },
    async duplicate(id: string): Promise<ProjectMeta> {
      const source = await idbGet<Project>('projects', id)
      if (!source) throw new KromaError('NOT_FOUND', 'Project not found')
      const copy: Project = { ...structuredClone(source), id: newId('pr'), name: `${source.name} copy`, updatedAt: Date.now() }
      await idbPut('projects', copy.id, copy)
      return this.list().then((list) => list.find((p) => p.id === copy.id)!)
    },
    async remove(id: string): Promise<{ ok: boolean }> {
      await idbDelete('projects', id)
      await idbDelete('thumbs', id)
      return { ok: true }
    },
    async rename(id: string, name: string): Promise<ProjectMeta> {
      const project = await idbGet<Project>('projects', id)
      if (!project) throw new KromaError('NOT_FOUND', 'Project not found')
      project.name = name
      await idbPut('projects', id, project)
      return this.list().then((list) => list.find((p) => p.id === id)!)
    }
  },

  templates: {
    async list(): Promise<TemplateMeta[]> {
      const rows = await idbAll<TemplateRecord>('templates')
      return rows.map(({ value }) => ({
        id: value.id,
        name: value.name,
        category: value.category,
        width: value.width,
        height: value.height,
        builtin: false,
        tags: value.tags ?? []
      }))
    },
    async read(id: string): Promise<TemplateRecord | null> {
      const record = await idbGet<TemplateRecord>('templates', id)
      return record ? { ...record, document: sanitizeDocument(record.document) } : null
    },
    async create(input: { name: string; category: string; document: unknown }): Promise<TemplateMeta> {
      const document = sanitizeDocument(input.document)
      const record: TemplateRecord = {
        id: newId('tp'),
        name: input.name,
        category: input.category,
        width: document.pages[0]?.width ?? 1080,
        height: document.pages[0]?.height ?? 1080,
        builtin: false,
        tags: ['custom'],
        document,
        assets: []
      }
      await idbPut('templates', record.id, record)
      return { id: record.id, name: record.name, category: record.category, width: record.width, height: record.height, builtin: false, tags: record.tags }
    },
    async remove(id: string): Promise<{ ok: boolean }> {
      await idbDelete('templates', id)
      return { ok: true }
    }
  },

  assets: {
    async importFiles(): Promise<never> {
      throw new KromaError('UNSUPPORTED', 'Use drag & drop or paste in the browser preview.')
    },
    async importDataUrl(dataUrl: string, name = 'pasted.png') {
      const id = newId('as')
      await idbPut('assets', id, { id, name, dataUrl, createdAt: Date.now() })
      return { id, name, mime: /^data:([^;]+)/.exec(dataUrl)?.[1] ?? 'image/png', bytes: dataUrl.length, createdAt: Date.now(), storage: 'inline' as const, data: dataUrl }
    },
    async list() {
      const rows = await idbAll<{ id: string; name: string; dataUrl: string; createdAt: number }>('assets')
      return rows.map(({ value }) => ({
        id: value.id,
        name: value.name,
        mime: 'image/png',
        bytes: value.dataUrl.length,
        createdAt: value.createdAt,
        storage: 'inline' as const,
        data: value.dataUrl
      }))
    },
    async remove(id: string) {
      await idbDelete('assets', id)
      return { ok: true }
    }
  },

  fonts: {
    async list(force?: boolean): Promise<FontFamily[]> {
      void force
      return [
        { family: 'Inter', file: 'system', source: 'system' },
        { family: 'Georgia', file: 'system', source: 'system' },
        { family: 'Impact', file: 'system', source: 'system' },
        { family: 'Courier New', file: 'system', source: 'system' },
        { family: 'Arial', file: 'system', source: 'system' }
      ]
    },
    async importFiles(): Promise<FontFamily[]> {
      throw new KromaError('UNSUPPORTED', 'Font import is available in the desktop app.')
    }
  },

  export: {
    async write(input: SaveBlobInput) {
      for (const file of input.files) download(file.dataUrl, file.fileName)
      return { files: input.files.map((f) => ({ path: f.fileName, bytes: f.dataUrl.length })), cancelled: false }
    },
    async chooseDirectory() {
      return null
    }
  },

  dialogs: {
    async openImages() {
      return new Promise<string[]>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/png,image/jpeg,image/webp'
        input.multiple = true
        input.onchange = () => {
          const files = Array.from(input.files ?? [])
          const readers = files.map(
            (file) =>
              new Promise<string>((res) => {
                const reader = new FileReader()
                reader.onload = () => res(String(reader.result))
                reader.readAsDataURL(file)
              })
          )
          void Promise.all(readers).then(resolve)
        }
        input.click()
      })
    },
    async openFonts() {
      return []
    },
    async openSvg() {
      return []
    },
    async readTextFile() {
      return null
    }
  },

  settings: {
    async get() {
      return toPublic(readSettings())
    },
    async update(patch: Partial<AppSettings>) {
      const next = { ...readSettings(), ...patch } as AppSettings
      writeSettings(next)
      return toPublic(next)
    },
    async setKey(): Promise<PublicSettings> {
      throw noAi()
    },
    async clearKey() {
      return toPublic(readSettings())
    },
    async testProvider() {
      return { ok: false, message: 'Available in the desktop app only.' }
    },
    async markFirstRunComplete() {
      const next = { ...readSettings(), firstRunCompleted: true }
      writeSettings(next)
      return toPublic(next)
    },
    async openDataDir() {
      return 'IndexedDB (browser preview)'
    }
  },

  ai: {
    async status() {
      return {
        online: navigator.onLine,
        capabilities: {
          text: { provider: 'offline' as AiProviderId, capability: 'text' as const, configured: true, active: false },
          image: { provider: 'offline' as AiProviderId, capability: 'image' as const, configured: false, active: false },
          background: { provider: 'offline' as AiProviderId, capability: 'background' as const, configured: true, active: false },
          upscale: { provider: 'offline' as AiProviderId, capability: 'upscale' as const, configured: true, active: false }
        },
        anyKeyStored: false
      }
    },
    async providers() {
      return []
    },
    async text(): Promise<AiTextResult> {
      throw noAi()
    },
    async image(): Promise<AiImageResult> {
      throw noAi()
    },
    async removeBackground(): Promise<AiImageResult> {
      throw noAi()
    },
    async upscale(): Promise<AiImageResult> {
      throw noAi()
    },
    async design(): Promise<DesignPlan> {
      throw noAi()
    }
  },

  system: {
    async info(): Promise<SystemInfo> {
      return {
        appVersion: 'preview',
        electronVersion: '-',
        chromeVersion: navigator.userAgent,
        nodeVersion: '-',
        platform: 'web',
        arch: '-',
        dataDir: 'IndexedDB',
        isPackaged: false
      }
    },
    async online() {
      return navigator.onLine
    },
    async openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    async showItem() {},
    async quit() {},
    async minimize() {},
    async maximize() {},
    async close() {},
    onConnectivity(handler) {
      const on = (): void => handler(true)
      const off = (): void => handler(false)
      window.addEventListener('online', on)
      window.addEventListener('offline', off)
      return () => {
        window.removeEventListener('online', on)
        window.removeEventListener('offline', off)
      }
    },
    onMenuAction() {
      return () => {}
    }
  }
}

export const WEB_DOCUMENT_VERSION = DOCUMENT_VERSION

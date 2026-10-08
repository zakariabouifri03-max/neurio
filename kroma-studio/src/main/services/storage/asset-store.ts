import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { LIMITS } from '../../../shared/constants'
import type { AssetRecord } from '../../../shared/types/project'
import { isAcceptedImageMime, mimeFromDataUrl, sanitizeFileName } from '../../../shared/utils/validation'
import { newId } from '../../../shared/utils/ids'
import { log } from '../../logger'
import { getDatabase } from './database'
import { extensionToMime, mimeToExtension, sniffImage } from './image-info'
import { ensureStorageDirs, isSafeId } from './paths'

const toRecord = (row: ReturnType<ReturnType<typeof getDatabase>['listAssets']>[number]): AssetRecord => ({
  id: row.id,
  name: row.name,
  mime: row.mime,
  bytes: row.bytes,
  width: row.width ?? undefined,
  height: row.height ?? undefined,
  createdAt: row.created_at,
  storage: row.storage === 'inline' ? 'inline' : 'file'
})

export class AssetStore {
  constructor() {
    ensureStorageDirs()
  }

  private get dir(): string {
    return ensureStorageDirs().assets
  }

  resolvePath(assetId: string): string | null {
    if (!isSafeId(assetId)) return null
    const row = getDatabase().listAssets().find((a) => a.id === assetId)
    if (!row?.path || !existsSync(row.path)) return null
    return row.path
  }

  private register(buffer: Buffer, name: string, mime: string): AssetRecord {
    const info = sniffImage(buffer)
    const id = newId('as')
    const ext = mimeToExtension[mime] ?? 'bin'
    const target = join(this.dir, `${id}.${ext}`)
    writeFileSync(target, buffer)
    getDatabase().upsertAsset({
      id,
      name: sanitizeFileName(name, `asset.${ext}`),
      mime,
      bytes: buffer.length,
      width: info?.width ?? null,
      height: info?.height ?? null,
      created_at: Date.now(),
      storage: 'file',
      path: target
    })
    return toRecord(getDatabase().listAssets().find((a) => a.id === id)!)
  }

  importFile(source: string): AssetRecord {
    if (!existsSync(source)) throw Object.assign(new Error(`File not found: ${source}`), { code: 'NOT_FOUND' })
    const stat = statSync(source)
    if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'INVALID_INPUT' })
    if (stat.size > LIMITS.MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error(`Unsupported image format. Files must be under ${LIMITS.MAX_UPLOAD_BYTES / 1024 / 1024} MB.`), {
        code: 'TOO_LARGE'
      })
    }
    const ext = extname(source).toLowerCase().replace('.', '')
    const mime = extensionToMime[ext]
    if (!mime || !isAcceptedImageMime(mime)) {
      throw Object.assign(new Error('Unsupported image format. Use PNG, JPG, WEBP, GIF, BMP or AVIF.'), { code: 'INVALID_INPUT' })
    }
    const buffer = readFileSync(source)
    const sniffed = sniffImage(buffer)
    return this.register(buffer, source.split(/[\\/]/).pop() ?? 'image', sniffed?.mime ?? mime)
  }

  importDataUrl(dataUrl: string, name = 'pasted-image.png'): AssetRecord {
    const mime = mimeFromDataUrl(dataUrl)
    if (!isAcceptedImageMime(mime)) {
      throw Object.assign(new Error('Unsupported image format.'), { code: 'INVALID_INPUT' })
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) throw Object.assign(new Error('Empty image data'), { code: 'INVALID_INPUT' })
    if (buffer.length > LIMITS.MAX_UPLOAD_BYTES) throw Object.assign(new Error('Image too large'), { code: 'TOO_LARGE' })
    return this.register(buffer, name, mime!)
  }

  importBuffer(buffer: Buffer, name: string, mime: string): AssetRecord {
    if (!isAcceptedImageMime(mime)) throw Object.assign(new Error('Unsupported image format.'), { code: 'INVALID_INPUT' })
    return this.register(buffer, name, mime)
  }

  list(): AssetRecord[] {
    return getDatabase()
      .listAssets()
      .map(toRecord)
  }

  remove(id: string): void {
    if (!isSafeId(id)) return
    const path = this.resolvePath(id)
    if (path) {
      try {
        rmSync(path, { force: true })
      } catch (error) {
        log.warn('Could not delete asset file', error)
      }
    }
    getDatabase().deleteAsset(id)
  }

  copyToAssets(sourcePath: string): string {
    const id = newId('cp')
    const target = join(this.dir, `${id}${extname(sourcePath)}`)
    copyFileSync(sourcePath, target)
    return target
  }
}

let instance: AssetStore | null = null
export const getAssetStore = (): AssetStore => {
  if (!instance) instance = new AssetStore()
  return instance
}

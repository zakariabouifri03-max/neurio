import { dialog, shell, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { IPC, KromaError } from '../../shared/ipc'
import type { SaveBlobInput } from '../../shared/ipc'
import type { ExportedFile } from '../../shared/types/export'
import { sanitizeFileName } from '../../shared/utils/validation'
import { getSettingsStore } from '../services/storage/settings-store'
import { handle } from './handle'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])

export function registerExportHandlers(getWindow: () => BrowserWindow | null): void {
  handle(IPC.EXPORT_DIRECTORY, async () => {
    const win = getWindow()
    if (!win) throw new KromaError('NO_WINDOW', 'No window available for the save dialog.')
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose export folder',
      defaultPath: getSettingsStore().get().export.lastDirectory ?? undefined,
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handle(IPC.EXPORT_WRITE, async (_event, input) => {
    const payload = input as SaveBlobInput
    if (!payload?.files?.length) throw new KromaError('INVALID_INPUT', 'Nothing to export.')
    const win = getWindow()

    let directory = payload.directory
    let explicitFileName: string | null = null

    if (!directory) {
      if (!win) throw new KromaError('NO_WINDOW', 'No window available for the save dialog.')
      if (payload.files.length === 1) {
        const result = await dialog.showSaveDialog(win, {
          title: 'Export design',
          defaultPath: payload.files[0].fileName,
          filters: [
            { name: 'Images & PDF', extensions: ['png', 'jpg', 'webp', 'pdf'] },
            { name: 'PNG', extensions: ['png'] },
            { name: 'JPEG', extensions: ['jpg'] },
            { name: 'WebP', extensions: ['webp'] },
            { name: 'PDF', extensions: ['pdf'] }
          ]
        })
        if (result.canceled || !result.filePath) return { files: [], cancelled: true }
        directory = result.filePath.replace(/[\\/][^\\/]*$/, '')
        explicitFileName = result.filePath.split(/[\\/]/).pop() ?? null
      } else {
        const result = await dialog.showOpenDialog(win, {
          title: 'Choose export folder',
          buttonLabel: 'Export here',
          properties: ['openDirectory', 'createDirectory']
        })
        if (result.canceled || result.filePaths.length === 0) return { files: [], cancelled: true }
        directory = result.filePaths[0]
      }
    }

    const written: ExportedFile[] = []
    const settings = getSettingsStore()
    try {
      payload.files.forEach((file, index) => {
        const mime = /^data:([^;,]+)/.exec(file.dataUrl)?.[1] ?? ''
        if (!ALLOWED_MIME.has(mime)) throw new KromaError('INVALID_INPUT', 'Unsupported export format.')
        const base64 = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)
        const buffer = Buffer.from(base64, 'base64')
        if (buffer.length === 0) throw new KromaError('UPSTREAM', 'Export failed. Please try again.')
        const name = explicitFileName && payload.files.length === 1 ? explicitFileName : sanitizeFileName(file.fileName, `kroma-${index + 1}`)
        const safe = extname(name) ? name : `${name}${mime === 'image/jpeg' ? '.jpg' : mime === 'application/pdf' ? '.pdf' : mime === 'image/webp' ? '.webp' : '.png'}`
        const target = join(directory!, safe)
        writeFileSync(target, buffer)
        written.push({ path: target, bytes: buffer.length })
      })
      settings.update({ export: { ...settings.get().export, lastDirectory: directory ?? null } })
    } catch (error) {
      if (error instanceof KromaError) throw error
      throw new KromaError('EXPORT_FAILED', 'Export failed. Please try again.', error instanceof Error ? error.message : undefined)
    }

    if (written[0]) void shell.showItemInFolder(written[0].path)
    return { files: written, cancelled: false }
  })
}

import { dialog, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { IPC, KromaError } from '../../shared/ipc'
import { ACCEPTED_FONT_EXTENSIONS, ACCEPTED_SVG_EXTENSIONS, IMAGE_EXTENSIONS_FOR_UPLOAD } from '../../shared/constants'
import { handle } from './handle'

const strip = (ext: string): string => ext.replace('.', '')

export function registerDialogHandlers(getWindow: () => BrowserWindow | null): void {
  const win = (): BrowserWindow => {
    const window = getWindow()
    if (!window) throw new KromaError('NO_WINDOW', 'No window is available for this dialog.')
    return window
  }

  handle(IPC.DIALOG_OPEN_IMAGES, async () => {
    const result = await dialog.showOpenDialog(win(), {
      title: 'Import images',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS_FOR_UPLOAD.map(strip) }]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.DIALOG_OPEN_FONTS, async () => {
    const result = await dialog.showOpenDialog(win(), {
      title: 'Import fonts',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ACCEPTED_FONT_EXTENSIONS.map(strip) }]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.DIALOG_OPEN_SVG, async () => {
    const result = await dialog.showOpenDialog(win(), {
      title: 'Import SVG',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Vector', extensions: ACCEPTED_SVG_EXTENSIONS.map(strip) }]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.DIALOG_READ_TEXT, (_event, path) => {
    const target = String(path)
    const buffer = readFileSync(target)
    if (buffer.length > 2 * 1024 * 1024) throw new KromaError('TOO_LARGE', 'File too large to import as SVG.')
    return { name: target.split(/[\\/]/).pop() ?? 'graphic.svg', text: buffer.toString('utf8') }
  })
}

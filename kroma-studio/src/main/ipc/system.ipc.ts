import { app, shell, type BrowserWindow } from 'electron'
import { IPC, KromaError } from '../../shared/ipc'
import { getAiService } from '../services/ai/AIService'
import { getPaths } from '../services/storage/paths'
import { handle } from './handle'

const ALLOWED_EXTERNAL = /^https?:\/\//i

export function registerSystemHandlers(getWindow: () => BrowserWindow | null): void {
  handle(IPC.SYSTEM_INFO, () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    dataDir: getPaths().root,
    isPackaged: app.isPackaged
  }))

  handle(IPC.SYSTEM_ONLINE, () => getAiService().isOnline())

  handle(IPC.SYSTEM_OPEN_EXTERNAL, async (_event, url) => {
    const target = String(url)
    if (!ALLOWED_EXTERNAL.test(target)) throw new KromaError('INVALID_INPUT', 'Only http(s) links can be opened.')
    await shell.openExternal(target)
  })

  handle(IPC.SYSTEM_SHOW_ITEM, async (_event, path) => {
    await shell.showItemInFolder(String(path))
  })

  handle(IPC.SYSTEM_QUIT, () => {
    app.quit()
  })

  handle(IPC.SYSTEM_MINIMIZE, () => getWindow()?.minimize())
  handle(IPC.SYSTEM_MAXIMIZE, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle(IPC.SYSTEM_CLOSE, () => getWindow()?.close())
}

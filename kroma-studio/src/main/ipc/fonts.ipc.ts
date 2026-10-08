import { IPC } from '../../shared/ipc'
import { getFontService } from '../services/font-service'
import { handle } from './handle'

export function registerFontHandlers(): void {
  handle(IPC.FONTS_LIST, (_event, force) => getFontService().list(force === true))
  handle(IPC.FONTS_IMPORT, (_event, paths) => {
    const list = Array.isArray(paths) ? paths.map(String) : []
    return getFontService().importFiles(list)
  })
}

import type { BrowserWindow } from 'electron'
import { registerAiHandlers } from './ai.ipc'
import { registerAssetHandlers } from './assets.ipc'
import { registerDialogHandlers } from './dialogs.ipc'
import { registerExportHandlers } from './export.ipc'
import { registerFontHandlers } from './fonts.ipc'
import { registerProjectHandlers } from './projects.ipc'
import { registerSettingsHandlers } from './settings.ipc'
import { registerSystemHandlers } from './system.ipc'
import { registerTemplateHandlers } from './templates.ipc'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  registerProjectHandlers()
  registerTemplateHandlers()
  registerAssetHandlers()
  registerFontHandlers()
  registerExportHandlers(getWindow)
  registerDialogHandlers(getWindow)
  registerSettingsHandlers()
  registerAiHandlers()
  registerSystemHandlers(getWindow)
}

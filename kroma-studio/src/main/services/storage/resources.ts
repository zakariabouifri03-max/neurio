import { app } from 'electron'
import { join } from 'node:path'

/**
 * Bundled read-only data (templates, samples, icon sets) ships in `resources/`
 * and is copied next to the executable by electron-builder `extraResources`.
 */
export function resourcePath(...segments: string[]): string {
  if (app.isPackaged) return join(process.resourcesPath, 'resources', ...segments)
  return join(app.getAppPath(), 'resources', ...segments)
}

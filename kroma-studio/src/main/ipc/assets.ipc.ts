import { IPC } from '../../shared/ipc'
import { getAssetStore } from '../services/storage/asset-store'
import { handle } from './handle'

export function registerAssetHandlers(): void {
  const store = () => getAssetStore()

  handle(IPC.ASSETS_IMPORT_FILES, (_event, paths) => {
    const list = Array.isArray(paths) ? paths.map(String) : []
    const imported = []
    const failures = []
    for (const path of list) {
      try {
        imported.push(store().importFile(path))
      } catch (error) {
        failures.push(`${path}: ${error instanceof Error ? error.message : 'failed'}`)
      }
    }
    if (imported.length === 0 && failures.length > 0) {
      throw Object.assign(new Error(failures[0]), { code: 'INVALID_INPUT' })
    }
    return imported
  })

  handle(IPC.ASSETS_IMPORT_DATA_URL, (_event, dataUrl, name) => store().importDataUrl(String(dataUrl), name ? String(name) : undefined))
  handle(IPC.ASSETS_LIST, () => store().list())
  handle(IPC.ASSETS_DELETE, (_event, id) => {
    store().remove(String(id))
    return { ok: true }
  })
}

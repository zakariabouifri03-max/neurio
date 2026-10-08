import { shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AiProviderId, AppSettings } from '../../shared/types/settings'
import { getSettingsStore } from '../services/storage/settings-store'
import { verifyProvider } from '../services/ai/verify'
import { getPaths } from '../services/storage/paths'
import { handle } from './handle'

export function registerSettingsHandlers(): void {
  handle(IPC.SETTINGS_GET, () => getSettingsStore().toPublic())

  handle(IPC.SETTINGS_UPDATE, (_event, patch) => {
    const store = getSettingsStore()
    store.update((patch ?? {}) as Partial<AppSettings>)
    return store.toPublic()
  })

  handle(IPC.SETTINGS_SET_KEY, (_event, provider, key, extra) => {
    const store = getSettingsStore()
    const id = String(provider) as AiProviderId
    const secret = String(key ?? '').trim()
    if (secret.length < 4) throw Object.assign(new Error('That API key looks too short.'), { code: 'INVALID_INPUT' })
    store.setSecret(id, secret, extra as { baseUrl?: string; model?: string; enabled?: boolean } | undefined)
    return store.toPublic()
  })

  handle(IPC.SETTINGS_CLEAR_KEY, (_event, provider) => {
    const store = getSettingsStore()
    store.clearSecret(String(provider) as AiProviderId)
    return store.toPublic()
  })

  handle(IPC.SETTINGS_TEST_PROVIDER, async (_event, provider) => {
    const id = String(provider) as AiProviderId
    const store = getSettingsStore()
    const settings = store.get()
    const key = store.getSecret(id) ?? ''
    if (!key && id !== 'offline' && id !== 'custom') {
      return { ok: false, message: 'No API key saved for this provider yet.' }
    }
    return verifyProvider(id, key, settings.ai.providers[id]?.baseUrl)
  })

  handle(IPC.SETTINGS_FIRST_RUN_DONE, () => {
    const store = getSettingsStore()
    store.update({ firstRunCompleted: true })
    return store.toPublic()
  })

  handle(IPC.SETTINGS_OPEN_DATA_DIR, async () => {
    const dir = getPaths().root
    await shell.openPath(dir)
    return dir
  })
}

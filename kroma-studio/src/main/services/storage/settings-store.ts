import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'
import type { AiProviderId, AppSettings, PublicSettings, ProviderSettings } from '../../../shared/types/settings'
import { log } from '../../logger'
import { getPaths } from './paths'

interface StoredSecret {
  enc: boolean
  v: string
}

interface StoredShape {
  version: number
  settings: AppSettings
  secrets: Partial<Record<AiProviderId, StoredSecret>>
}

const deepMerge = <T>(base: T, patch: unknown): T => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key]
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)
        ? deepMerge(current, value)
        : value
  }
  return out as T
}

/**
 * Settings live in `<userData>/settings.json`. API keys are encrypted with the
 * OS keychain via Electron `safeStorage` and are never returned to the renderer:
 * `toPublic()` only reports whether a key exists.
 */
export class SettingsStore {
  private data: AppSettings
  private secrets: Partial<Record<AiProviderId, StoredSecret>> = {}
  private file: string

  constructor() {
    this.file = getPaths().settings
    this.data = structuredClone(DEFAULT_SETTINGS)
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoredShape
      this.data = deepMerge(structuredClone(DEFAULT_SETTINGS), raw.settings ?? {})
      this.secrets = raw.secrets ?? {}
    } catch (error) {
      log.error('Failed to read settings, resetting to defaults', error)
    }
  }

  private persist(): void {
    const payload: StoredShape = { version: 1, settings: this.data, secrets: this.secrets }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  get(): AppSettings {
    return structuredClone(this.data)
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = deepMerge(this.data, patch)
    this.persist()
    return this.get()
  }

  /** Renderer-safe projection: secrets replaced by presence flags. */
  toPublic(): PublicSettings {
    const base = this.get()
    const providers: PublicSettings['ai']['providers'] = {}
    for (const [id, secret] of Object.entries(this.secrets) as Array<[AiProviderId, StoredSecret]>) {
      providers[id] = { hasKey: Boolean(secret?.v) }
    }
    return {
      ...base,
      ai: {
        routing: base.ai.routing,
        allowOfflineFallback: base.ai.allowOfflineFallback,
        requestTimeoutMs: base.ai.requestTimeoutMs,
        providers
      }
    }
  }

  /* ------------------------------- secrets ------------------------------- */

  getSecret(provider: AiProviderId): string | undefined {
    const stored = this.secrets[provider]
    if (!stored?.v) return undefined
    if (!stored.enc) return stored.v
    try {
      return safeStorage.decryptString(Buffer.from(stored.v, 'base64'))
    } catch (error) {
      log.error(`Could not decrypt key for ${provider} (OS keychain unavailable?)`, error)
      return undefined
    }
  }

  hasSecret(provider: AiProviderId): boolean {
    return Boolean(this.secrets[provider]?.v)
  }

  setSecret(provider: AiProviderId, key: string, extra?: { baseUrl?: string; model?: string; enabled?: boolean }): AppSettings {
    let value = key.trim()
    let enc = false
    try {
      if (safeStorage.isEncryptionAvailable()) {
        value = safeStorage.encryptString(key.trim()).toString('base64')
        enc = true
      }
    } catch (error) {
      log.warn('safeStorage unavailable, storing key obfuscated only', error)
    }
    this.secrets[provider] = { enc, v: value }
    const current = this.data.ai.providers[provider] ?? {}
    this.data.ai.providers[provider] = {
      ...current,
      ...(extra?.baseUrl !== undefined ? { baseUrl: extra.baseUrl } : {}),
      ...(extra?.model !== undefined ? { model: extra.model } : {}),
      enabled: extra?.enabled ?? true
    }
    // Route every capability this provider supports to it, unless already set to a real provider.
    this.data = deepMerge(this.data, { ai: { providers: { [provider]: this.data.ai.providers[provider] } } })
    this.persist()
    return this.get()
  }

  clearSecret(provider: AiProviderId): AppSettings {
    delete this.secrets[provider]
    const routing = { ...this.data.ai.routing }
    for (const capability of Object.keys(routing) as Array<keyof typeof routing>) {
      if (routing[capability] === provider) routing[capability] = 'offline'
    }
    this.data = { ...this.data, ai: { ...this.data.ai, routing, providers: { ...this.data.ai.providers, [provider]: { enabled: false } } } }
    this.persist()
    return this.get()
  }

  providerSettings(provider: AiProviderId): ProviderSettings & { apiKey?: string } {
    return { ...(this.data.ai.providers[provider] ?? {}), apiKey: this.getSecret(provider) }
  }
}

let instance: SettingsStore | null = null
export const getSettingsStore = (): SettingsStore => {
  if (!instance) instance = new SettingsStore()
  return instance
}

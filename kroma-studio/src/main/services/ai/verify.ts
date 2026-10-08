import { KromaError } from '../../../shared/ipc'
import type { AiProviderId } from '../../../shared/types/settings'
import { Http } from './http'
import type { ProviderTestResult } from '../../../shared/ipc'

/** Cheap, read-only calls used by "Test connection" in Settings. */
export async function verifyProvider(id: AiProviderId, key: string, baseUrl?: string): Promise<ProviderTestResult> {
  try {
    switch (id) {
      case 'openai': {
        const base = baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1'
        const data = await Http.json<{ data?: Array<{ id: string }> }>(`${base}/models`, {
          headers: { authorization: `Bearer ${key}` },
          timeoutMs: 20_000
        })
        const models = data.data?.length ?? 0
        return { ok: true, message: models ? `Connected. ${models} models available.` : 'Connected.' }
      }
      case 'custom': {
        if (!baseUrl) return { ok: false, message: 'Set a Base URL for the custom provider first.' }
        await Http.json(`${baseUrl.replace(/\/$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, timeoutMs: 20_000 })
        return { ok: true, message: 'Custom endpoint reachable.' }
      }
      case 'google': {
        const base = baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com'
        const data = await Http.json<{ models?: unknown[] }>(`${base}/v1beta/models?key=${encodeURIComponent(key)}`, { timeoutMs: 20_000 })
        return { ok: true, message: `Connected. ${data.models?.length ?? 0} models available.` }
      }
      case 'stability': {
        const base = baseUrl?.replace(/\/$/, '') || 'https://api.stability.ai'
        const data = await Http.json<{ email?: string }>(`${base}/v1/user/account`, { headers: { authorization: `Bearer ${key}` }, timeoutMs: 20_000 })
        return { ok: true, message: data.email ? `Connected as ${data.email}` : 'Connected.' }
      }
      case 'removebg': {
        const base = baseUrl?.replace(/\/$/, '') || 'https://api.remove.bg'
        const data = await Http.json<{ data?: { attributes?: { credits_charged?: number } } }>(`${base}/v1.0/account`, {
          headers: { 'x-api-key': key },
          timeoutMs: 20_000
        })
        return { ok: true, message: `Connected. Credits charged so far: ${data.data?.attributes?.credits_charged ?? 'unknown'}.` }
      }
      case 'clipdrop':
        return { ok: true, message: 'Key saved. Clipdrop has no free verification endpoint; run a background removal to confirm.' }
      default:
        return { ok: true, message: 'Offline engine needs no key.' }
    }
  } catch (error) {
    if (error instanceof KromaError) return { ok: false, message: error.message }
    return { ok: false, message: error instanceof Error ? error.message : 'Unknown error' }
  }
}

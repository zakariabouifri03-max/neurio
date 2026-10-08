import { KromaError } from '../../../shared/ipc'
import type { AiTextRequest, AiTextResult } from '../../../shared/types/ai'
import type { AiProviderId } from '../../../shared/types/settings'
import { getSettingsStore } from '../storage/settings-store'
import { offlineText } from './offline-text'
import { findTextProvider } from './registry'
import type { ResolvedProvider } from './types'

export class TextGenerator {
  async generate(request: AiTextRequest, preferred?: AiProviderId): Promise<AiTextResult> {
    const settings = getSettingsStore().get().ai
    const store = getSettingsStore()
    const id = preferred ?? settings.routing.text
    const provider = findTextProvider(id)

    if (!provider) {
      if (!settings.allowOfflineFallback) {
        throw new KromaError('NOT_CONFIGURED', 'No AI text provider is configured. Add a key in Settings → AI Providers.', id)
      }
      return { provider: 'offline', variants: offlineText(request), offline: true }
    }

    const resolved: ResolvedProvider = {
      id,
      apiKey: store.getSecret(id),
      baseUrl: settings.providers[id]?.baseUrl,
      model: settings.providers[id]?.model,
      timeoutMs: settings.requestTimeoutMs
    }

    if (!resolved.apiKey && id !== 'custom') {
      if (!settings.allowOfflineFallback) {
        throw new KromaError('NOT_CONFIGURED', 'Add your API key in Settings → AI Providers to use AI text.', id)
      }
      return { provider: 'offline', variants: offlineText(request), offline: true }
    }

    try {
      const variants = await provider.text(request, resolved)
      if (variants.length === 0) throw new KromaError('UPSTREAM', 'The provider returned an empty response.', id)
      return { provider: id, model: resolved.model, variants, offline: false }
    } catch (error) {
      if (error instanceof KromaError && error.code === 'NOT_CONFIGURED' && settings.allowOfflineFallback) {
        return { provider: 'offline', variants: offlineText(request), offline: true }
      }
      throw error
    }
  }
}

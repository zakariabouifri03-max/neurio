import { KromaError } from '../../../shared/ipc'
import type { AiImageResult } from '../../../shared/types/ai'
import type { AiProviderId } from '../../../shared/types/settings'
import { getSettingsStore } from '../storage/settings-store'
import { findBackgroundProvider } from './registry'

export class BackgroundRemover {
  /**
   * `mode: 'local'` is handled in the renderer (canvas + web worker) because it
   * needs pixel access; this class covers the hosted providers.
   */
  async remove(imageDataUrl: string, preferred?: AiProviderId): Promise<AiImageResult> {
    const store = getSettingsStore()
    const settings = store.get().ai
    const id: AiProviderId = preferred && preferred !== 'offline' ? preferred : settings.routing.background
    const provider = findBackgroundProvider(id)
    const apiKey = store.getSecret(id)

    if (!provider || !apiKey) {
      throw new KromaError(
        'NOT_CONFIGURED',
        'AI background removal needs a provider key (remove.bg, Clipdrop, OpenAI or Google). Use the Local engine to run it offline.',
        id
      )
    }
    const result = await provider.background(imageDataUrl, {
      id,
      apiKey,
      baseUrl: settings.providers[id]?.baseUrl,
      model: settings.providers[id]?.model,
      timeoutMs: settings.requestTimeoutMs
    })
    return { provider: id, dataUrl: result.dataUrl, width: result.width, height: result.height, offline: false }
  }
}

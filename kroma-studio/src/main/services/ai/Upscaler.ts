import { KromaError } from '../../../shared/ipc'
import type { AiImageResult, AiUpscaleRequest } from '../../../shared/types/ai'
import type { AiProviderId } from '../../../shared/types/settings'
import { getSettingsStore } from '../storage/settings-store'
import { findUpscaleProvider } from './registry'

export class Upscaler {
  /** Hosted upscaling. `mode: 'local'` uses the renderer's canvas resampler. */
  async upscale(request: AiUpscaleRequest, preferred?: AiProviderId): Promise<AiImageResult> {
    const store = getSettingsStore()
    const settings = store.get().ai
    const id: AiProviderId = preferred && preferred !== 'offline' ? preferred : settings.routing.upscale
    const provider = findUpscaleProvider(id)
    const apiKey = store.getSecret(id)
    if (!provider || !apiKey) {
      throw new KromaError('NOT_CONFIGURED', 'AI upscaling needs a provider key (Clipdrop). The local 2× resampler works offline.', id)
    }
    const result = await provider.upscale(request, {
      id,
      apiKey,
      baseUrl: settings.providers[id]?.baseUrl,
      model: settings.providers[id]?.model,
      timeoutMs: Math.max(settings.requestTimeoutMs, 150_000)
    })
    return { provider: id, dataUrl: result.dataUrl, width: result.width, height: result.height, offline: false }
  }
}

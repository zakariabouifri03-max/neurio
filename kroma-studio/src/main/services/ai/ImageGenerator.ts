import { KromaError } from '../../../shared/ipc'
import type { AiImageRequest, AiImageResult } from '../../../shared/types/ai'
import type { AiProviderId } from '../../../shared/types/settings'
import { ratioToPixels } from './sizes'
import { getSettingsStore } from '../storage/settings-store'
import { findImageProvider } from './registry'

export class ImageGenerator {
  async generate(request: AiImageRequest, preferred?: AiProviderId): Promise<AiImageResult> {
    const store = getSettingsStore()
    const settings = store.get().ai
    const id = preferred ?? settings.routing.image
    const provider = findImageProvider(id)
    const apiKey = store.getSecret(id)

    if (!provider) {
      throw new KromaError(
        'NOT_CONFIGURED',
        'AI image generation needs a provider. Add an OpenAI, Google or Stability key in Settings → AI Providers.',
        id
      )
    }
    if (!apiKey && id !== 'custom') {
      throw new KromaError('NOT_CONFIGURED', 'Add your API key in Settings → AI Providers to generate images.', id)
    }
    if (!request.prompt.trim()) throw new KromaError('INVALID_INPUT', 'Describe the image you want first.')

    const size = ratioToPixels(request.aspectRatio, Math.max(request.width ?? 0, request.height ?? 0) || 1024)
    const result = await provider.image(
      { ...request, width: request.width ?? size.width, height: request.height ?? size.height },
      { id, apiKey, baseUrl: settings.providers[id]?.baseUrl, model: settings.providers[id]?.model, timeoutMs: settings.requestTimeoutMs }
    )
    return { provider: id, model: result.revisedPrompt ? undefined : undefined, ...result, offline: false } as AiImageResult
  }
}

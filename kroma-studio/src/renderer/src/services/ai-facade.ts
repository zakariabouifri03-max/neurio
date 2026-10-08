import type {
  AiImageRequest,
  AiImageResult,
  AiStatus,
  AiTextRequest,
  AiTextResult,
  DesignGeneratorOptions,
  DesignPlan
} from '../../../shared/types/ai'
import type { ProviderDescriptor } from '../../../shared/types/settings'
import { KromaError } from '../../../shared/ipc'
import { platform } from '../platform'

/**
 * Renderer-side facade over the AI layer. It knows nothing about providers or
 * keys — everything goes through the platform bridge to the main process.
 */
class AiFacade {
  private statusCache: { value: AiStatus; at: number } | null = null

  async status(force = false): Promise<AiStatus> {
    if (!force && this.statusCache && Date.now() - this.statusCache.at < 5000) return this.statusCache.value
    const value = await platform.ai.status()
    this.statusCache = { value, at: Date.now() }
    return value
  }

  async providers(): Promise<ProviderDescriptor[]> {
    return platform.ai.providers()
  }

  async text(request: AiTextRequest): Promise<AiTextResult> {
    if (!request.prompt.trim() && !request.sourceText?.trim()) throw new KromaError('INVALID_INPUT', 'Add some text to work with.')
    return platform.ai.text(request)
  }

  async image(request: AiImageRequest): Promise<AiImageResult> {
    if (!request.prompt.trim()) throw new KromaError('INVALID_INPUT', 'Describe the image you want to generate.')
    return platform.ai.image(request)
  }

  async removeBackground(imageDataUrl: string): Promise<AiImageResult> {
    return platform.ai.removeBackground({ imageDataUrl, mode: 'ai' })
  }

  async upscale(imageDataUrl: string, scale: 2 | 3 | 4): Promise<AiImageResult> {
    return platform.ai.upscale({ imageDataUrl, scale })
  }

  async design(options: DesignGeneratorOptions): Promise<DesignPlan> {
    if (!options.prompt.trim()) throw new KromaError('INVALID_INPUT', 'Describe the design you want to generate.')
    return platform.ai.design(options)
  }

  capabilityReady(status: AiStatus, capability: 'text' | 'image' | 'background' | 'upscale'): boolean {
    const entry = status.capabilities[capability]
    return Boolean(entry?.configured && entry?.active)
  }
}

export const ai = new AiFacade()

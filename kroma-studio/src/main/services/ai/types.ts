import type { AiCapability, AiProviderId } from '../../../shared/types/settings'
import type { AiImageRequest, AiTextRequest, AiUpscaleRequest } from '../../../shared/types/ai'

export interface ResolvedProvider {
  id: AiProviderId
  apiKey?: string
  baseUrl?: string
  model?: string
  timeoutMs: number
}

export interface ImageOutput {
  dataUrl: string
  width: number
  height: number
  revisedPrompt?: string
}

/**
 * One interface per capability so a single provider object can implement any
 * subset of them. Swapping a provider means registering another object here —
 * the editor never talks to a concrete vendor SDK.
 */
export interface TextProvider {
  id: AiProviderId
  capabilities: AiCapability[]
  text(request: AiTextRequest, provider: ResolvedProvider): Promise<string[]>
}

export interface ImageProvider {
  id: AiProviderId
  capabilities: AiCapability[]
  image(request: AiImageRequest, provider: ResolvedProvider): Promise<ImageOutput>
}

export interface BackgroundProvider {
  id: AiProviderId
  capabilities: AiCapability[]
  background(imageDataUrl: string, provider: ResolvedProvider): Promise<ImageOutput>
}

export interface UpscaleProvider {
  id: AiProviderId
  capabilities: AiCapability[]
  upscale(request: AiUpscaleRequest, provider: ResolvedProvider): Promise<ImageOutput>
}

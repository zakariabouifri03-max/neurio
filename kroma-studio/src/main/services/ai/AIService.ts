import { net } from 'electron'
import type { AiCapability, AiProviderId } from '../../../shared/types/settings'
import type { AiProviderStatus, AiStatus } from '../../../shared/types/ai'
import type { ProviderDescriptor } from '../../../shared/types/settings'
import { getSettingsStore } from '../storage/settings-store'
import { BackgroundRemover } from './BackgroundRemover'
import { DesignGenerator } from './DesignGenerator'
import { ImageGenerator } from './ImageGenerator'
import { PROVIDER_DESCRIPTORS } from './registry'
import { TextGenerator } from './TextGenerator'
import { Upscaler } from './Upscaler'

/**
 * Single entry point for every AI capability. The renderer only ever sees this
 * facade (through the preload bridge) — never a provider SDK or an API key.
 *
 *   AIService
 *   ├── TextGenerator
 *   ├── ImageGenerator
 *   ├── BackgroundRemover
 *   ├── DesignGenerator
 *   └── Upscaler
 */
export class AIService {
  readonly text = new TextGenerator()
  readonly image = new ImageGenerator()
  readonly background = new BackgroundRemover()
  readonly design = new DesignGenerator()
  readonly upscale = new Upscaler()

  providers(): ProviderDescriptor[] {
    return PROVIDER_DESCRIPTORS
  }

  isOnline(): boolean {
    try {
      return net.isOnline()
    } catch {
      return true
    }
  }

  status(): AiStatus {
    const store = getSettingsStore()
    const settings = store.get().ai
    const online = this.isOnline()
    const capabilities = {} as Record<AiCapability, AiProviderStatus>
    for (const capability of ['text', 'image', 'background', 'upscale'] as AiCapability[]) {
      const provider: AiProviderId = settings.routing[capability] ?? 'offline'
      const configured = provider === 'offline' ? true : Boolean(store.hasSecret(provider)) || provider === 'custom'
      capabilities[capability] = {
        provider,
        capability,
        configured,
        active: configured && (provider === 'offline' || online),
        model: settings.providers[provider]?.model
      }
    }
    return {
      online,
      capabilities,
      anyKeyStored: (['openai', 'google', 'stability', 'removebg', 'clipdrop', 'custom'] as AiProviderId[]).some((id) => store.hasSecret(id))
    }
  }
}

let instance: AIService | null = null
export const getAiService = (): AIService => {
  if (!instance) instance = new AIService()
  return instance
}

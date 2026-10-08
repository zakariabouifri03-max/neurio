import type { ProviderDescriptor } from '../../../shared/types/settings'
import { clipdropProvider } from './providers/clipdrop'
import { customProvider } from './providers/custom'
import { googleProvider } from './providers/google'
import { openaiProvider } from './providers/openai'
import { removeBgProvider } from './providers/removebg'
import { stabilityProvider } from './providers/stability'
import type { BackgroundProvider, ImageProvider, TextProvider, UpscaleProvider } from './types'

/**
 * Provider registry. Adding a vendor = one object here + one descriptor.
 * Nothing else in the app knows which vendor is being used.
 */
export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    capabilities: ['text', 'image', 'background'],
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-image-1', 'dall-e-3'],
    allowBaseUrl: true,
    builtin: true
  },
  {
    id: 'google',
    label: 'Google AI (Gemini / Imagen)',
    capabilities: ['text', 'image', 'background'],
    keyLabel: 'Google AI API key',
    keyPlaceholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-preview-image-generation', 'imagen-4.0-generate-001'],
    allowBaseUrl: true,
    builtin: true
  },
  {
    id: 'stability',
    label: 'Stability AI',
    capabilities: ['image'],
    keyLabel: 'Stability API key',
    keyPlaceholder: 'sk-...',
    helpUrl: 'https://platform.stability.ai/account/keys',
    models: ['core', 'sd3', 'ultra'],
    allowBaseUrl: true,
    builtin: true
  },
  {
    id: 'removebg',
    label: 'remove.bg',
    capabilities: ['background'],
    keyLabel: 'remove.bg API key',
    helpUrl: 'https://www.remove.bg/api',
    models: ['removebg'],
    allowBaseUrl: true,
    builtin: true
  },
  {
    id: 'clipdrop',
    label: 'Clipdrop',
    capabilities: ['background', 'upscale'],
    keyLabel: 'Clipdrop API key',
    helpUrl: 'https://clipdrop.co/apis',
    models: ['clipdrop'],
    allowBaseUrl: true,
    builtin: true
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    capabilities: ['text', 'image'],
    keyLabel: 'API key (optional)',
    keyPlaceholder: 'Optional for local servers',
    models: ['gpt-4o-mini', 'llama3.1', 'qwen2.5'],
    allowBaseUrl: true,
    builtin: true
  },
  {
    id: 'offline',
    label: 'Offline engine (no key)',
    capabilities: ['text', 'background', 'upscale'],
    models: ['local-heuristics'],
    allowBaseUrl: false,
    builtin: true
  }
]

export const TEXT_PROVIDERS: TextProvider[] = [openaiProvider, googleProvider, customProvider]
export const IMAGE_PROVIDERS: ImageProvider[] = [openaiProvider, googleProvider, stabilityProvider, customProvider]
export const BACKGROUND_PROVIDERS: BackgroundProvider[] = [openaiProvider, googleProvider, removeBgProvider, clipdropProvider]
export const UPSCALE_PROVIDERS: UpscaleProvider[] = [clipdropProvider]

export const findTextProvider = (id: string): TextProvider | undefined => TEXT_PROVIDERS.find((p) => p.id === id)
export const findImageProvider = (id: string): ImageProvider | undefined => IMAGE_PROVIDERS.find((p) => p.id === id)
export const findBackgroundProvider = (id: string): BackgroundProvider | undefined => BACKGROUND_PROVIDERS.find((p) => p.id === id)
export const findUpscaleProvider = (id: string): UpscaleProvider | undefined => UPSCALE_PROVIDERS.find((p) => p.id === id)

import type { AiCapability, AiProviderId } from './settings'
import type { DesignDocument, PageBackground, SceneNode } from './document'

export interface AiError {
  code:
    | 'NOT_CONFIGURED'
    | 'INVALID_KEY'
    | 'RATE_LIMITED'
    | 'TIMEOUT'
    | 'NETWORK'
    | 'UPSTREAM'
    | 'INVALID_INPUT'
    | 'UNSUPPORTED'
    | 'UNKNOWN'
  message: string
  provider?: AiProviderId
  details?: string
}

export interface AiProviderStatus {
  provider: AiProviderId
  capability: AiCapability
  configured: boolean
  active: boolean
  model?: string
}

export interface AiStatus {
  online: boolean
  capabilities: Record<AiCapability, AiProviderStatus>
  /** Any provider with a key stored. */
  anyKeyStored: boolean
}

/* ------------------------------ text ------------------------------ */

export type AiTextTask =
  | 'headline'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'professional'
  | 'funny'
  | 'marketing'
  | 'product'
  | 'slogans'
  | 'captions'
  | 'custom'

export interface AiTextRequest {
  task: AiTextTask
  prompt: string
  /** Existing text for rewrite/shorten/expand/tone tasks. */
  sourceText?: string
  count?: number
  tone?: string
  maxLength?: number
  audience?: string
}

export interface AiTextResult {
  provider: AiProviderId
  model?: string
  variants: string[]
  offline: boolean
}

/* ------------------------------ image ------------------------------ */

export type AspectRatio = '1:1' | '4:5' | '16:9' | '9:16' | '3:4' | '4:3' | '2:3' | '3:2' | 'custom'

export interface AiImageRequest {
  prompt: string
  negativePrompt?: string
  aspectRatio: AspectRatio
  width?: number
  height?: number
  style?: string
  transparent?: boolean
  /** Re-generate from an existing image (variation). */
  referenceDataUrl?: string
}

export interface AiImageResult {
  provider: AiProviderId
  model?: string
  /** data:image/png;base64,... */
  dataUrl: string
  width: number
  height: number
  offline: boolean
  revisedPrompt?: string
}

export interface AiBackgroundRemovalRequest {
  imageDataUrl: string
  /** 'ai' uses the configured provider, 'local' uses the built-in heuristic. */
  mode: 'ai' | 'local'
}

export interface AiUpscaleRequest {
  imageDataUrl: string
  scale: 2 | 3 | 4
}

/* --------------------------- design gen --------------------------- */

export interface DesignGeneratorOptions {
  prompt: string
  style: 'modern' | 'vintage' | 'minimal' | 'bold' | 'elegant' | 'playful' | 'retro' | 'corporate' | 'neon'
  palette: 'auto' | 'vibrant' | 'pastel' | 'mono' | 'earth' | 'neon' | 'dark' | 'custom'
  customColors?: string[]
  aspectRatio: AspectRatio
  width?: number
  height?: number
  background: 'solid' | 'gradient' | 'pattern' | 'transparent' | 'image'
  typography: 'auto' | 'serif' | 'sans' | 'display' | 'mono' | 'script'
  complexity: 'simple' | 'balanced' | 'rich'
  useAiImages: boolean
  seed?: number
}

export interface GeneratedElement {
  node: SceneNode
  /** Lets the UI regenerate this single element later. */
  slot: 'headline' | 'subheadline' | 'kicker' | 'body' | 'cta' | 'hero' | 'accent' | 'background' | 'decoration'
  regenerationHint?: string
}

export interface DesignPlan {
  provider: AiProviderId
  offline: boolean
  width: number
  height: number
  palette: string[]
  fonts: { headline: string; body: string }
  elements: GeneratedElement[]
  background: PageBackground
  /** Where a generated hero image belongs (already placed when provided). */
  heroBox?: { x: number; y: number; width: number; height: number } | null
  archetype?: string
  rationale?: string
  seed: number
}

export interface DesignDocumentResult {
  plan: DesignPlan
  document: DesignDocument
}

import { KromaError } from '../../../shared/ipc'
import type { DesignGeneratorOptions, DesignPlan, GeneratedElement } from '../../../shared/types/ai'
import type { ImageNode } from '../../../shared/types/document'
import type { AiProviderId } from '../../../shared/types/settings'
import { CURATED_PALETTES, generatePalette } from '../../../shared/utils/color'
import { createImageNode } from '../../../shared/utils/document'
import { round } from '../../../shared/utils/geometry'
import { sanitizePrompt } from '../../../shared/utils/validation'
import { log } from '../../logger'
import { getSettingsStore } from '../storage/settings-store'
import { ImageGenerator } from './ImageGenerator'
import { TextGenerator } from './TextGenerator'
import { composeLayout, type LayoutCopy } from './layout'
import { extractKeywords, offlineText } from './offline-text'

const FONT_STACKS: Record<DesignGeneratorOptions['typography'], { headline: string; body: string }> = {
  auto: { headline: 'Inter', body: 'Inter' },
  serif: { headline: 'Georgia', body: 'Georgia' },
  sans: { headline: 'Inter', body: 'Inter' },
  display: { headline: 'Impact', body: 'Inter' },
  mono: { headline: 'Courier New', body: 'Courier New' },
  script: { headline: 'Brush Script MT', body: 'Inter' }
}

const KEYWORD_PALETTES: Array<{ words: string[]; palette: string }> = [
  { words: ['halloween', 'spooky', 'ghost', 'witch', 'pumpkin', 'raccoon'], palette: 'halloween' },
  { words: ['neon', 'cyber', 'synthwave', 'night', 'club'], palette: 'neon' },
  { words: ['nature', 'forest', 'eco', 'organic', 'garden'], palette: 'forest' },
  { words: ['summer', 'beach', 'sunset', 'tropical'], palette: 'sunset' },
  { words: ['ocean', 'sea', 'water', 'marine', 'ice'], palette: 'ocean' },
  { words: ['coffee', 'vintage', 'retro', 'leather', 'bakery'], palette: 'earth' },
  { words: ['kids', 'candy', 'party', 'fun', 'toy'], palette: 'candy' },
  { words: ['minimal', 'clean', 'modern', 'tech', 'saas'], palette: 'mono' },
  { words: ['wedding', 'spa', 'beauty', 'baby'], palette: 'pastel' }
]

const hashSeed = (value: string): number => {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * Turns a prompt + options into a real, placed design.
 * Text comes from the configured provider when available, otherwise from the
 * local copy engine, so the feature works with no key and no network.
 */
export class DesignGenerator {
  constructor(
    private readonly text = new TextGenerator(),
    private readonly images = new ImageGenerator()
  ) {}

  async generate(options: DesignGeneratorOptions): Promise<DesignPlan> {
    const prompt = sanitizePrompt(options.prompt)
    if (!prompt) throw new KromaError('INVALID_INPUT', 'Describe the design you want to generate.')

    const seed = options.seed ?? hashSeed(prompt)
    const width = Math.max(64, Math.round(options.width ?? ratioWidth(options.aspectRatio)))
    const height = Math.max(64, Math.round(options.height ?? ratioHeight(options.aspectRatio)))
    const palette = this.resolvePalette(options, prompt, seed)
    const fonts = FONT_STACKS[options.typography] ?? FONT_STACKS.auto
    const keywords = extractKeywords(prompt, 6)

    const copy = await this.buildCopy(prompt, keywords, options)
    const layout = composeLayout({
      width,
      height,
      palette,
      fonts,
      style: options.style,
      complexity: options.complexity,
      background: options.background,
      copy,
      seed
    })

    const elements: GeneratedElement[] = [...layout.nodes]
    let heroFromAi = false

    if (options.useAiImages && layout.heroBox && options.background !== 'transparent') {
      try {
        const box = layout.heroBox
        const image = await this.images.generate({
          prompt: this.heroPrompt(prompt, options, copy.headline),
          aspectRatio: closestRatio(box.width / box.height),
          width: Math.round(box.width),
          height: Math.round(box.height),
          style: options.style
        })
        const node: ImageNode = createImageNode({
          name: 'AI hero image',
          src: image.dataUrl,
          x: round(box.x),
          y: round(box.y),
          width: round(box.width),
          height: round(box.height),
          fit: 'cover'
        })
        heroFromAi = true
        elements.unshift({ slot: 'hero', node, regenerationHint: this.heroPrompt(prompt, options, copy.headline) })
      } catch (error) {
        log.warn('Hero image generation skipped:', error instanceof Error ? error.message : String(error))
      }
    }

    const provider = this.activeProvider()

    return {
      provider,
      offline: provider === 'offline' && !heroFromAi,
      width,
      height,
      palette,
      fonts,
      elements,
      background: layout.background,
      heroBox: layout.heroBox,
      archetype: layout.archetype,
      rationale: `${layout.archetype} layout · ${options.style} style · ${options.complexity} complexity`,
      seed
    }
  }

  /** Which provider is actually serving copy right now (used for UI labelling). */
  private activeProvider(): AiProviderId {
    const store = getSettingsStore()
    const id = store.get().ai.routing.text
    if (id === 'offline') return 'offline'
    return store.hasSecret(id) || id === 'custom' ? id : 'offline'
  }

  private resolvePalette(options: DesignGeneratorOptions, prompt: string, seed: number): string[] {
    if (options.palette === 'custom' && options.customColors?.length) {
      const colors = options.customColors.slice(0, 5)
      while (colors.length < 5) colors.push(colors[colors.length - 1] ?? '#7C5CFF')
      return colors
    }
    if (options.palette !== 'auto') {
      const named = CURATED_PALETTES.find((p) => p.id === options.palette)
      if (named) return [...named.colors]
      return generatePalette(options.palette, seed)
    }
    const lower = prompt.toLowerCase()
    const match = KEYWORD_PALETTES.find((entry) => entry.words.some((w) => lower.includes(w)))
    if (match) {
      const named = CURATED_PALETTES.find((p) => p.id === match.palette)
      if (named) return [...named.colors]
    }
    return generatePalette(String(seed % 97), seed)
  }

  private async buildCopy(prompt: string, keywords: string[], options: DesignGeneratorOptions): Promise<LayoutCopy> {
    const fallback: LayoutCopy = {
      kicker: keywords[0] ?? 'New',
      headline: first(offlineText({ task: 'headline', prompt, count: 1 })),
      subheadline: first(offlineText({ task: 'marketing', prompt, count: 1 })),
      body: first(offlineText({ task: 'product', prompt, count: 1 })),
      cta: first(offlineText({ task: 'slogans', prompt, count: 1 })).split(/[.!]/)[0]
    }

    const settings = getSettingsStore().get().ai
    const routed = settings.routing.text
    if (routed === 'offline') return fallback

    const tasks = [
      { key: 'headline' as const, task: 'headline' as const, prompt },
      { key: 'subheadline' as const, task: 'marketing' as const, prompt: `${prompt}. One line, max 90 characters.` },
      { key: 'body' as const, task: 'product' as const, prompt: `${prompt}. Two sentences, max 220 characters.` },
      { key: 'cta' as const, task: 'slogans' as const, prompt: `${prompt}. Max 3 words.` },
      { key: 'kicker' as const, task: 'slogans' as const, prompt: `${prompt}. One word label.` }
    ]

    const results = await Promise.allSettled(tasks.map((t) => this.text.generate({ task: t.task, prompt: t.prompt, count: 1 })))
    const copy: LayoutCopy = { ...fallback }
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return
      const value = result.value.variants[0]?.trim()
      if (!value) return
      const key = tasks[index].key
      copy[key] = key === 'kicker' ? value.split(/\s+/)[0] ?? copy.kicker : value
    })
    if (options.complexity === 'simple') copy.body = ''
    return copy
  }

  private heroPrompt(prompt: string, options: DesignGeneratorOptions, headline: string): string {
    return `${prompt}. ${options.style} style artwork, ${options.background === 'gradient' ? 'rich gradient lighting' : 'clean composition'}, high detail, no text, no watermark. Concept: ${headline}`
      .slice(0, 900)
  }
}

const first = (values: string[]): string => values[0] ?? ''

function closestRatio(ratio: number): '1:1' | '4:5' | '16:9' | '9:16' | '3:4' | '2:3' | 'custom' {
  if (ratio > 1.6) return '16:9'
  if (ratio > 1.1) return '3:4'
  if (ratio < 0.62) return '9:16'
  if (ratio < 0.9) return '2:3'
  return '1:1'
}

function ratioWidth(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return 1080
  return w >= h ? 1280 : 1080
}
function ratioHeight(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return 1080
  return w >= h ? Math.round((1280 * h) / w) : 1920
}

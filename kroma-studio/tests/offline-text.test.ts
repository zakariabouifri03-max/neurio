import { describe, expect, it } from 'vitest'
import { offlineText, extractKeywords } from '../src/main/services/ai/offline-text'
import type { AiTextTask } from '../src/shared/types/ai'

describe('offline copy engine', () => {
  const tasks: AiTextTask[] = ['headline', 'rewrite', 'shorten', 'expand', 'professional', 'funny', 'marketing', 'product', 'slogans', 'captions']

  it('produces output for every task with no provider configured', () => {
    for (const task of tasks) {
      const variants = offlineText({ task, prompt: 'vintage Halloween t-shirt with a cute raccoon', sourceText: 'Spooky season is here and our new tee is ready for you.', count: 3 })
      expect(variants.length).toBeGreaterThan(0)
      for (const variant of variants) expect(variant.trim().length).toBeGreaterThan(0)
    }
  })

  it('is deterministic for the same input', () => {
    const a = offlineText({ task: 'headline', prompt: 'eco coffee brand', count: 3 })
    const b = offlineText({ task: 'headline', prompt: 'eco coffee brand', count: 3 })
    expect(a).toEqual(b)
  })

  it('varies with the prompt', () => {
    const a = offlineText({ task: 'headline', prompt: 'eco coffee brand', count: 3 })
    const b = offlineText({ task: 'headline', prompt: 'cyberpunk sneaker drop', count: 3 })
    expect(a).not.toEqual(b)
  })

  it('shortens text to the requested length', () => {
    const source = 'This is a fairly long sentence that should be trimmed down to something much shorter.'
    const [short] = offlineText({ task: 'shorten', prompt: '', sourceText: source, maxLength: 20 })
    expect(short.length).toBeLessThanOrEqual(24)
  })

  it('extracts meaningful keywords', () => {
    const keywords = extractKeywords('Create a vintage Halloween t-shirt design with a cute raccoon')
    expect(keywords).toContain('halloween')
    expect(keywords).toContain('raccoon')
    expect(keywords).not.toContain('the')
  })
})

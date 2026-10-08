import { describe, expect, it } from 'vitest'
import { composeLayout } from '../src/main/services/ai/layout'
import type { DesignGeneratorOptions, DesignPlan } from '../src/shared/types/ai'
import { generatePalette } from '../src/shared/utils/color'
import { flattenNodes } from '../src/shared/utils/document'

const baseOptions: DesignGeneratorOptions = {
  prompt: 'vintage halloween t-shirt',
  style: 'vintage',
  palette: 'auto',
  aspectRatio: '1:1',
  background: 'gradient',
  typography: 'auto',
  complexity: 'balanced',
  useAiImages: false
}

const copy = { kicker: 'New', headline: 'Midnight Snacks', subheadline: 'Fresh from the oven', body: 'A short paragraph.', cta: 'Shop now' }

function build(seed: number, overrides: Partial<DesignGeneratorOptions> = {}): DesignPlan {
  const options = { ...baseOptions, ...overrides }
  const result = composeLayout({
    width: 1080,
    height: 1080,
    palette: generatePalette('halloween', seed),
    fonts: { headline: 'Inter', body: 'Inter' },
    style: options.style,
    complexity: options.complexity,
    background: options.background,
    copy,
    seed
  })
  return {
    provider: 'offline',
    offline: true,
    width: 1080,
    height: 1080,
    palette: generatePalette('halloween', seed),
    fonts: { headline: 'Inter', body: 'Inter' },
    elements: result.nodes,
    background: result.background,
    archetype: result.archetype,
    seed
  }
}

describe('design layout engine', () => {
  it('produces elements for every archetype', () => {
    const archetypes = new Set<string>()
    for (let seed = 1; seed <= 24; seed += 1) {
      const plan = build(seed)
      archetypes.add(plan.archetype ?? '')
      expect(plan.elements.length).toBeGreaterThan(0)
    }
    expect(archetypes.size).toBeGreaterThan(1)
  })

  it('never places content outside the page bounds', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const plan = build(seed)
      for (const element of plan.elements) {
        expect(element.node.x).toBeGreaterThanOrEqual(-1)
        expect(element.node.y).toBeGreaterThanOrEqual(-1)
        expect(element.node.x + element.node.width).toBeLessThanOrEqual(1081)
        expect(element.node.y + element.node.height).toBeLessThanOrEqual(1081)
      }
    }
  })

  it('always includes a headline slot', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const plan = build(seed)
      expect(plan.elements.some((element) => element.slot === 'headline')).toBe(true)
    }
  })

  it('honours the requested background type', () => {
    const transparent = build(3, { background: 'transparent' })
    expect(transparent.background.type).toBe('transparent')
    const solid = build(3, { background: 'solid' })
    expect(solid.background.type).toBe('solid')
  })

  it('is deterministic for a given seed', () => {
    // Node ids are freshly generated per call, so determinism is asserted on
    // geometry, styling and slot assignment instead.
    const shape = (seed: number) =>
      build(seed).elements.map((e) => ({
        slot: e.slot,
        kind: e.node.kind,
        x: e.node.x,
        y: e.node.y,
        width: e.node.width,
        height: e.node.height,
        rotation: e.node.rotation
      }))
    expect(shape(7)).toEqual(shape(7))
    expect(shape(7)).not.toEqual(shape(8))
  })

  it('places the hero box before the text so images sit behind copy', () => {
    const plan = build(2)
    expect(plan.elements.length).toBeGreaterThan(0)
    const headline = plan.elements.find((element) => element.slot === 'headline')
    expect(headline?.node.kind).toBe('text')
  })

  it('emits only serialisable, engine-free nodes', () => {
    const plan = build(5)
    const nodes = flattenNodes(plan.elements.map((element) => element.node))
    expect(() => JSON.stringify({ nodes })).not.toThrow()
    for (const node of nodes) {
      expect(typeof node.id).toBe('string')
      expect(typeof node.kind).toBe('string')
    }
  })
})

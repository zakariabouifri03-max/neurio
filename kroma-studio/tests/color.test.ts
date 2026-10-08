import { describe, expect, it } from 'vitest'
import { CURATED_PALETTES, darken, generatePalette, hexToRgb, hslToHex, lighten, mixColors, readableOn, rgbToHex, seededRandom } from '../src/shared/utils/color'

describe('colour utilities', () => {
  it('round-trips hex and rgb', () => {
    expect(rgbToHex(hexToRgb('#7C5CFF'))).toBe('#7C5CFF')
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('picks readable text colour', () => {
    expect(readableOn('#FFFFFF')).toBe('#111111')
    expect(readableOn('#000000')).toBe('#FFFFFF')
  })

  it('mixes and shades', () => {
    expect(mixColors('#000000', '#FFFFFF', 0.5)).toBe('#808080')
    expect(lighten('#000000', 1)).toBe('#FFFFFF')
    expect(darken('#FFFFFF', 1)).toBe('#000000')
  })

  it('converts HSL to hex', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#FF0000')
    expect(hslToHex(120, 1, 0.5)).toBe('#00FF00')
  })

  it('is deterministic for a seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('returns stable curated palettes', () => {
    expect(CURATED_PALETTES.length).toBeGreaterThan(5)
    expect(generatePalette('halloween', 1)).toEqual(CURATED_PALETTES.find((p) => p.id === 'halloween')!.colors)
    const generated = generatePalette('zzz-unknown', 3)
    expect(generated).toHaveLength(5)
    expect(generated[0]).toMatch(/^#[0-9A-F]{6}$/)
  })
})

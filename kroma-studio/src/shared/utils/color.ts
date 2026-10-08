export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  let v = hex.replace('#', '').trim()
  if (v.length === 3 || v.length === 4) v = v.split('').slice(0, 3).map((c) => c + c).join('')
  const n = parseInt(v.slice(0, 6) || '000000', 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export const rgbToHex = ({ r, g, b }: Rgb): string =>
  '#' +
  [r, g, b]
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/** Black or white, whichever is readable on `background`. */
export function readableOn(background: string): string {
  return relativeLuminance(background) > 0.42 ? '#111111' : '#FFFFFF'
}

export function mixColors(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const t = Math.max(0, Math.min(1, amount))
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t })
}

export function lighten(hex: string, amount: number): string {
  return mixColors(hex, '#FFFFFF', amount)
}
export function darken(hex: string, amount: number): string {
  return mixColors(hex, '#000000', amount)
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

/**
 * Deterministic PRNG (mulberry32) so generated palettes and layouts are
 * reproducible from a seed. A plain Lehmer generator is avoided on purpose:
 * with small, sequential seeds its first output is always a tiny fraction,
 * which made every generated design collapse onto the same variant.
 */
export function seededRandom(seed: number): () => number {
  let a = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  if (a === 0) a = 0x6d2b79f5
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360
  const sat = Math.max(0, Math.min(1, s))
  const lig = Math.max(0, Math.min(1, l))
  if (sat === 0) {
    const v = Math.round(lig * 255)
    return rgbToHex({ r: v, g: v, b: v })
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat
  const p = 2 * lig - q
  const conv = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return rgbToHex({ r: conv(hue + 1 / 3) * 255, g: conv(hue) * 255, b: conv(hue - 1 / 3) * 255 })
}

export interface NamedPalette {
  id: string
  label: string
  colors: string[]
}

export const CURATED_PALETTES: NamedPalette[] = [
  { id: 'midnight', label: 'Midnight Bloom', colors: ['#0F1024', '#2B2D63', '#7C5CFF', '#C9B8FF', '#F5F3FF'] },
  { id: 'sunset', label: 'Sunset Drive', colors: ['#1B0B2E', '#7A1E5C', '#F2545B', '#FF9F45', '#FFF3D6'] },
  { id: 'forest', label: 'Forest Ink', colors: ['#081C15', '#1B4332', '#40916C', '#95D5B2', '#F2F7F4'] },
  { id: 'candy', label: 'Candy Pop', colors: ['#FF4FA3', '#FFB347', '#4ECDC4', '#6C5CE7', '#FFF8F0'] },
  { id: 'mono', label: 'Graphite', colors: ['#0B0B0C', '#3A3A3D', '#8A8A8F', '#D6D6DA', '#FFFFFF'] },
  { id: 'earth', label: 'Terracotta', colors: ['#2B1B12', '#7C4A2D', '#C87941', '#E8C39E', '#FBF3E8'] },
  { id: 'neon', label: 'Neon Night', colors: ['#05010F', '#12102A', '#00F0FF', '#FF2EC4', '#F8F8FF'] },
  { id: 'pastel', label: 'Soft Pastel', colors: ['#2A2A35', '#8E9AAF', '#CBC0D3', '#EFD3D7', '#FEEAFA'] },
  { id: 'ocean', label: 'Deep Ocean', colors: ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#F4FBFD'] },
  { id: 'halloween', label: 'Halloween', colors: ['#0B0710', '#2A1B3D', '#FF7B00', '#FFD166', '#F5EFE6'] }
]

export const paletteById = (id: string): NamedPalette => CURATED_PALETTES.find((p) => p.id === id) ?? CURATED_PALETTES[0]

/** Build a palette from a mood keyword + seed. */
export function generatePalette(mood: string, seed = 1): string[] {
  const named = CURATED_PALETTES.find((p) => p.id === mood || p.label.toLowerCase().includes(mood.toLowerCase()))
  if (named) return [...named.colors]
  const rand = seededRandom(seed)
  const baseHue = Math.floor(rand() * 360)
  return [
    hslToHex(baseHue, 0.35, 0.09),
    hslToHex(baseHue + 12, 0.45, 0.25),
    hslToHex(baseHue + 24, 0.75, 0.55),
    hslToHex(baseHue + 48, 0.8, 0.72),
    hslToHex(baseHue + 60, 0.3, 0.95)
  ]
}

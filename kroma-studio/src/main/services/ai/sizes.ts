import type { AspectRatio } from '../../../shared/types/ai'

const GPT_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
const DALLE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const
const IMAGEN_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'] as const

function bucket(width: number, height: number): AspectRatio {
  const r = width / height
  if (r > 1.6) return '16:9'
  if (r > 1.15) return r > 1.4 ? '3:2' : '4:3'
  if (r < 0.62) return '9:16'
  if (r < 0.88) return r < 0.72 ? '2:3' : '3:4'
  return '1:1'
}

/** Pick the closest vendor-supported size for a requested aspect ratio. */
export function sizeForAspectRatio(
  ratio: AspectRatio,
  width?: number,
  height?: number,
  family: 'gpt-image' | 'dall-e' | 'imagen' = 'gpt-image'
): string {
  const effective: AspectRatio = ratio === 'custom' && width && height ? bucket(width, height) : ratio
  if (family === 'imagen') {
    return (IMAGEN_RATIOS as readonly string[]).includes(effective) ? effective : '1:1'
  }
  const allowed = family === 'dall-e' ? DALLE_SIZES : GPT_IMAGE_SIZES
  const table: Record<AspectRatio, [number, number]> = {
    '1:1': [1, 1],
    '4:5': [4, 5],
    '3:4': [3, 4],
    '4:3': [4, 3],
    '2:3': [2, 3],
    '3:2': [3, 2],
    '16:9': [16, 9],
    '9:16': [9, 16],
    custom: [1, 1]
  }
  const target = table[effective] ?? [1, 1]
  const wanted = target[0] / target[1]
  let best: string = allowed[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const size of allowed) {
    const [w, h] = size.split('x').map(Number)
    const diff = Math.abs(w / h - wanted)
    if (diff < bestDiff) {
      bestDiff = diff
      best = size
    }
  }
  return best
}

export const ratioToPixels = (ratio: AspectRatio, base = 1024): { width: number; height: number } => {
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return { width: base, height: base }
  const scale = base / Math.max(w, h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

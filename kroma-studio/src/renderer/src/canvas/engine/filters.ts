import { DEFAULT_IMAGE_FILTERS, type ImageFilters, type ImageNode } from '../../../../shared/types/document'

/**
 * CPU image filter pipeline.
 *
 * Colour operations run once over the pixel buffer; blur and sharpen use
 * separate passes (blur via hardware canvas filter, sharpen via convolution).
 * Results are cached by (source, filter signature, output size) so dragging a
 * slider does not re-run the whole chain for every frame.
 */

export interface FilterCacheEntry {
  canvas: HTMLCanvasElement
  key: string
  bytes: number
  lastUsed: number
}

const cache = new Map<string, FilterCacheEntry>()
let cacheBudgetBytes = 512 * 1024 * 1024

export function setCacheBudget(megabytes: number): void {
  cacheBudgetBytes = Math.max(32, megabytes) * 1024 * 1024
  evictIfNeeded()
}

export function clearFilterCache(): void {
  for (const entry of cache.values()) {
    entry.canvas.width = 0
    entry.canvas.height = 0
  }
  cache.clear()
}

function evictIfNeeded(): void {
  let total = 0
  for (const entry of cache.values()) total += entry.bytes
  if (total <= cacheBudgetBytes) return
  const entries = [...cache.values()].sort((a, b) => a.lastUsed - b.lastUsed)
  for (const entry of entries) {
    if (total <= cacheBudgetBytes * 0.75) break
    entry.canvas.width = 0
    entry.canvas.height = 0
    cache.delete(entry.key)
    total -= entry.bytes
  }
}

export function filterSignature(filters: Partial<ImageFilters> | null | undefined): string {
  if (!filters) return ''
  const merged = { ...DEFAULT_IMAGE_FILTERS, ...filters }
  return [
    merged.brightness.toFixed(2),
    merged.contrast.toFixed(2),
    merged.saturation.toFixed(2),
    merged.blur.toFixed(1),
    merged.grayscale.toFixed(2),
    merged.sepia.toFixed(2),
    merged.invert.toFixed(2),
    merged.sharpen.toFixed(2),
    merged.pixelate.toFixed(0)
  ].join(':')
}

export const hasVisibleFilters = (filters: Partial<ImageFilters> | null | undefined): boolean =>
  Boolean(filters) && filterSignature(filters) !== filterSignature(DEFAULT_IMAGE_FILTERS)

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function colourPass(source: HTMLCanvasElement, filters: ImageFilters): HTMLCanvasElement {
  const target = makeCanvas(source.width, source.height)
  const ctx = target.getContext('2d', { willReadFrequently: true })
  if (!ctx) return source
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, target.width, target.height)
  const data = image.data
  const brightness = filters.brightness * 255
  const contrast = (filters.contrast + 1) ** 2
  const saturation = filters.saturation
  const gray = filters.grayscale
  const sepia = filters.sepia
  const invert = filters.invert

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    if (brightness !== 0) {
      r += brightness
      g += brightness
      b += brightness
    }
    if (contrast !== 1) {
      r = (r - 128) * contrast + 128
      g = (g - 128) * contrast + 128
      b = (b - 128) * contrast + 128
    }
    if (saturation !== 0) {
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const amount = saturation < 0 ? saturation : saturation * 1.5
      r = luminance + (r - luminance) * (1 + amount)
      g = luminance + (g - luminance) * (1 + amount)
      b = luminance + (b - luminance) * (1 + amount)
    }
    if (gray > 0) {
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r += (luminance - r) * gray
      g += (luminance - g) * gray
      b += (luminance - b) * gray
    }
    if (sepia > 0) {
      const sr = r * 0.393 + g * 0.769 + b * 0.189
      const sg = r * 0.349 + g * 0.686 + b * 0.168
      const sb = r * 0.272 + g * 0.534 + b * 0.131
      r += (sr - r) * sepia
      g += (sg - g) * sepia
      b += (sb - b) * sepia
    }
    if (invert > 0) {
      r += (255 - r - r) * invert
      g += (255 - g - g) * invert
      b += (255 - b - b) * invert
    }

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
  }
  ctx.putImageData(image, 0, 0)
  return target
}

function blurPass(source: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  if (radius <= 0) return source
  // Pad so the blur does not fade at the edges.
  const pad = Math.ceil(radius * 3)
  const target = makeCanvas(source.width + pad * 2, source.height + pad * 2)
  const ctx = target.getContext('2d')
  if (!ctx) return source
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(source, pad, pad, source.width, source.height)
  ctx.filter = 'none'
  const cropped = makeCanvas(source.width, source.height)
  const cropCtx = cropped.getContext('2d')
  if (!cropCtx) return target
  cropCtx.drawImage(target, -pad, -pad)
  return cropped
}

function sharpenPass(source: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  if (amount <= 0) return source
  const strength = amount
  const kernel = [0, -strength, 0, -strength, 1 + strength * 4, -strength, 0, -strength, 0]
  return convolve(source, kernel, 1)
}

function convolve(source: HTMLCanvasElement, kernel: number[], divisor: number): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true })
  if (!ctx) return source
  const input = ctx.getImageData(0, 0, source.width, source.height)
  const output = ctx.createImageData(source.width, source.height)
  const w = source.width
  const h = source.height
  const src = input.data
  const dst = output.data
  const side = Math.round(Math.sqrt(kernel.length))
  const half = Math.floor(side / 2)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const out = (y * w + x) * 4
      let r = 0
      let g = 0
      let b = 0
      for (let ky = 0; ky < side; ky += 1) {
        for (let kx = 0; kx < side; kx += 1) {
          const px = Math.min(w - 1, Math.max(0, x + kx - half))
          const py = Math.min(h - 1, Math.max(0, y + ky - half))
          const at = (py * w + px) * 4
          const weight = kernel[ky * side + kx]
          r += src[at] * weight
          g += src[at + 1] * weight
          b += src[at + 2] * weight
        }
      }
      dst[out] = Math.min(255, Math.max(0, r / divisor))
      dst[out + 1] = Math.min(255, Math.max(0, g / divisor))
      dst[out + 2] = Math.min(255, Math.max(0, b / divisor))
      dst[out + 3] = src[out + 3]
    }
  }
  ctx.putImageData(output, 0, 0)
  return source
}

function pixelatePass(source: HTMLCanvasElement, blockSize: number): HTMLCanvasElement {
  const size = Math.max(2, Math.round(blockSize))
  const small = makeCanvas(Math.max(1, Math.floor(source.width / size)), Math.max(1, Math.floor(source.height / size)))
  const smallCtx = small.getContext('2d')
  if (!smallCtx) return source
  smallCtx.imageSmoothingEnabled = false
  smallCtx.drawImage(source, 0, 0, small.width, small.height)
  const target = makeCanvas(source.width, source.height)
  const ctx = target.getContext('2d')
  if (!ctx) return source
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, target.width, target.height)
  return target
}

/** Applies the node filters to a decoded source canvas, with caching. */
export function applyFilters(
  source: HTMLCanvasElement,
  node: Pick<ImageNode, 'id' | 'filters'>,
  targetSize: { width: number; height: number }
): HTMLCanvasElement {
  const filters = { ...DEFAULT_IMAGE_FILTERS, ...(node.filters ?? {}) }
  const signature = filterSignature(filters)
  if (signature === filterSignature(DEFAULT_IMAGE_FILTERS)) return source

  const width = Math.max(1, Math.round(targetSize.width))
  const height = Math.max(1, Math.round(targetSize.height))
  const key = `${node.id}|${source.width}x${source.height}|${width}x${height}|${signature}`
  const hit = cache.get(key)
  if (hit) {
    hit.lastUsed = Date.now()
    return hit.canvas
  }

  let working = source
  if (source.width !== width || source.height !== height) {
    const scaled = makeCanvas(width, height)
    const ctx = scaled.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(source, 0, 0, width, height)
      working = scaled
    }
  }

  if (
    filters.brightness !== 0 ||
    filters.contrast !== 0 ||
    filters.saturation !== 0 ||
    filters.grayscale > 0 ||
    filters.sepia > 0 ||
    filters.invert > 0
  ) {
    working = colourPass(working, filters)
  }
  if (filters.blur > 0) working = blurPass(working, filters.blur)
  if (filters.sharpen > 0) working = sharpenPass(working, filters.sharpen)
  if (filters.pixelate > 0) working = pixelatePass(working, filters.pixelate)

  cache.set(key, { canvas: working, key, bytes: working.width * working.height * 4, lastUsed: Date.now() })
  evictIfNeeded()
  return working
}

/** Applies the same pipeline to a raw data URL (used by background removal etc.). */
export async function applyFiltersToDataUrl(dataUrl: string, filters: Partial<ImageFilters>): Promise<string> {
  const image = await loadImage(dataUrl)
  const source = makeCanvas(image.width, image.height)
  source.getContext('2d')?.drawImage(image, 0, 0)
  const result = applyFilters(source, { id: 'standalone', filters }, { width: image.width, height: image.height })
  return result.toDataURL('image/png')
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image could not be decoded'))
    image.src = src
  })
}

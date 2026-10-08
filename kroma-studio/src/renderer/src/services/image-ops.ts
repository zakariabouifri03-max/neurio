import type { ImageFilters } from '../../../shared/types/document'
import { applyFilters, loadImage, makeCanvas } from '../canvas/engine/filters'
import { imageCache } from '../canvas/engine/image-cache'

export interface RemoveBackgroundOptions {
  tolerance?: number
  smoothEdges?: boolean
  /** Use the configured AI provider instead of the local engine. */
  useAi?: boolean
}

const MAX_WORKING_EDGE = 2400

const decode = async (src: string): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> => {
  const entry = await imageCache.load(src)
  if (entry.status !== 'ready') throw new Error('Image could not be loaded.')
  const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(entry.width, entry.height))
  const canvas = makeCanvas(Math.max(1, entry.width * scale), Math.max(1, entry.height * scale))
  canvas.getContext('2d')?.drawImage(entry.image, 0, 0, canvas.width, canvas.height)
  return { canvas, width: canvas.width, height: canvas.height }
}

export async function removeBackgroundLocal(src: string, options: RemoveBackgroundOptions = {}): Promise<string> {
  const { canvas, width, height } = await decode(src)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not read image pixels.')
  const image = ctx.getImageData(0, 0, width, height)
  const buffer = image.data.buffer as ArrayBuffer

  const worker = new Worker(new URL('../workers/background-removal.worker.ts', import.meta.url), { type: 'module' })
  try {
    const result = await new Promise<{ width: number; height: number; buffer: ArrayBuffer }>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: string; width?: number; height?: number; buffer?: ArrayBuffer; message?: string }>) => {
        const data = event.data
        if (data.type === 'error') reject(new Error(data.message ?? 'Background removal failed'))
        else if (data.buffer) resolve({ width: data.width!, height: data.height!, buffer: data.buffer })
        else reject(new Error('Background removal failed'))
      }
      worker.onerror = (event) => reject(new Error(event.message || 'Background removal worker failed'))
      worker.postMessage(
        {
          type: 'remove-background',
          width,
          height,
          buffer,
          tolerance: options.tolerance ?? 70,
          feather: 0,
          smoothEdges: options.smoothEdges ?? true
        },
        [buffer]
      )
    })
    const output = makeCanvas(result.width, result.height)
    output.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height), 0, 0)
    return output.toDataURL('image/png')
  } finally {
    worker.terminate()
  }
}

/** Hosted removal via the configured provider (falls back to local). */
export async function removeBackgroundAi(src: string): Promise<string> {
  const { platform } = await import('../platform')
  const { canvas, width, height } = await decode(src)
  const dataUrl = canvas.toDataURL('image/png')
  const result = await platform.ai.removeBackground({ imageDataUrl: dataUrl, mode: 'ai' })
  void width
  void height
  return result.dataUrl
}

export async function removeBackground(src: string, options: RemoveBackgroundOptions = {}): Promise<string> {
  if (options.useAi) {
    try {
      return await removeBackgroundAi(src)
    } catch {
      // fall through to local so the button always does something
    }
  }
  return removeBackgroundLocal(src, options)
}

/** Offline upscaling: high-quality canvas resampling (Lanczos-ish via step-down). */
export async function upscaleLocal(src: string, scale: 2 | 3 | 4 = 2): Promise<string> {
  const entry = await imageCache.load(src)
  if (entry.status !== 'ready') throw new Error('Image could not be loaded.')
  const source = makeCanvas(entry.width, entry.height)
  source.getContext('2d')?.drawImage(entry.image, 0, 0)

  const targetWidth = Math.round(source.width * scale)
  const targetHeight = Math.round(source.height * scale)
  const output = makeCanvas(targetWidth, targetHeight)
  const ctx = output.getContext('2d')
  if (!ctx) throw new Error('Could not upscale image.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Progressive doubling produces noticeably cleaner edges than one big step.
  let current = source
  let width = source.width
  let height = source.height
  while (width * 2 <= targetWidth && height * 2 <= targetHeight) {
    const next = makeCanvas(width * 2, height * 2)
    const nextCtx = next.getContext('2d')
    if (!nextCtx) break
    nextCtx.imageSmoothingEnabled = true
    nextCtx.imageSmoothingQuality = 'high'
    nextCtx.drawImage(current, 0, 0, width * 2, height * 2)
    current = next
    width *= 2
    height *= 2
  }
  ctx.drawImage(current, 0, 0, targetWidth, targetHeight)
  return output.toDataURL('image/png')
}

export async function upscaleAi(src: string, scale: 2 | 3 | 4 = 2): Promise<string> {
  const { platform } = await import('../platform')
  const { canvas } = await decode(src)
  const result = await platform.ai.upscale({ imageDataUrl: canvas.toDataURL('image/png'), scale })
  return result.dataUrl
}

export async function upscale(src: string, scale: 2 | 3 | 4 = 2, useAi = false): Promise<string> {
  if (useAi) {
    try {
      return await upscaleAi(src, scale)
    } catch {
      /* fall through */
    }
  }
  return upscaleLocal(src, scale)
}

/** Applies an adjustment list to an image and returns a new data URL. */
export async function applyAdjustments(dataUrl: string, filters: Partial<ImageFilters>): Promise<string> {
  const image = await loadImage(dataUrl)
  const source = makeCanvas(image.width, image.height)
  source.getContext('2d')?.drawImage(image, 0, 0)
  const result = applyFilters(source, { id: 'adjust', filters }, { width: image.width, height: image.height })
  return result.toDataURL('image/png')
}

/** Reads natural dimensions of an image source. */
export async function imageSize(src: string): Promise<{ width: number; height: number }> {
  const entry = await imageCache.load(src)
  return { width: entry.width, height: entry.height }
}

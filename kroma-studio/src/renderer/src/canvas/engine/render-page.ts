import type { DesignDocument, Page } from '../../../../shared/types/document'
import { LIMITS } from '../../../../shared/constants'
import { drawNode, drawPageBackground } from './draw'
import { imageCache } from './image-cache'

export interface RenderPageOptions {
  /** Target pixel size. Defaults to the page size × scale. */
  width?: number
  height?: number
  scale?: number
  transparent?: boolean
  background?: string
}

/**
 * Off-screen page renderer used by export and thumbnails. Unlike the live
 * engine it decodes every image up front, so exports never contain a
 * "Loading…" placeholder.
 */
export async function renderPageToCanvas(page: Page, options: RenderPageOptions = {}): Promise<HTMLCanvasElement> {
  const width = Math.round(options.width ?? page.width * (options.scale ?? 1))
  const height = Math.round(options.height ?? page.height * (options.scale ?? 1))
  if (width > LIMITS.MAX_EXPORT_EDGE || height > LIMITS.MAX_EXPORT_EDGE) {
    throw new Error(`Export size must stay under ${LIMITS.MAX_EXPORT_EDGE} px per side.`)
  }

  const sources: string[] = []
  const collect = (nodes: typeof page.nodes): void => {
    for (const node of nodes) {
      if (node.kind === 'image') sources.push(node.src)
      if (node.kind === 'group') collect(node.children)
    }
  }
  collect(page.nodes)
  if (page.background.imageSrc) sources.push(page.background.imageSrc)
  await imageCache.ensure(sources)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create an export canvas.')

  const scale = width / page.width
  ctx.save()
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (options.transparent) {
    ctx.clearRect(0, 0, page.width, page.height)
  } else if (options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, page.width, page.height)
    drawPageBackground(ctx, page, 1)
  } else {
    drawPageBackground(ctx, page, 1)
  }

  for (const node of page.nodes) {
    drawNode(ctx, node, { scale: 1, skipMissingImages: false })
  }
  ctx.restore()
  return canvas
}

export async function renderDocument(doc: DesignDocument): Promise<HTMLCanvasElement[]> {
  const canvases: HTMLCanvasElement[] = []
  for (const page of doc.pages) canvases.push(await renderPageToCanvas(page))
  return canvases
}

export const canvasToDataUrl = (
  canvas: HTMLCanvasElement,
  mime: 'image/png' | 'image/jpeg' | 'image/webp',
  quality = 0.92
): string => {
  if (mime === 'image/jpeg') {
    // Flatten transparency onto white so JPEG never turns alpha black.
    const flat = document.createElement('canvas')
    flat.width = canvas.width
    flat.height = canvas.height
    const ctx = flat.getContext('2d')
    if (!ctx) return canvas.toDataURL(mime, quality)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, flat.width, flat.height)
    ctx.drawImage(canvas, 0, 0)
    return flat.toDataURL(mime, quality)
  }
  return canvas.toDataURL(mime, quality)
}

export async function renderThumbnail(page: Page, maxSize = 320): Promise<string> {
  const scale = Math.min(1, maxSize / Math.max(page.width, page.height))
  const canvas = await renderPageToCanvas(page, {
    width: Math.max(1, Math.round(page.width * scale)),
    height: Math.max(1, Math.round(page.height * scale))
  })
  return canvasToDataUrl(canvas, 'image/png')
}

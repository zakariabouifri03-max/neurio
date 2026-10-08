import type { GroupNode, ImageNode, Page, SceneNode, ShadowSpec, ShapeNode, SvgNode, TextNode } from '../../../../shared/types/document'
import { degToRad, fitRect } from '../../../../shared/utils/geometry'
import { solid } from '../../../../shared/utils/document'
import { applyFilters, hasVisibleFilters, makeCanvas } from './filters'
import { imageCache } from './image-cache'
import { maskPath, shapePath } from './shapes'
import { drawTextNode, fillToPaint } from './text'

export interface DrawOptions {
  /** Multiply opacity by this value (used for groups). */
  parentOpacity?: number
  /** Draw the node at a specific scale (export uses > 1). */
  scale?: number
  /** Skip images that are not decoded yet (screen preview). */
  skipMissingImages?: boolean
  /** Called for every image needed so exporters can preload. */
  onImageNeeded?: (src: string) => void
}

const shadowToCss = (shadow: ShadowSpec): string =>
  `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px rgba(${hexToRgbTuple(shadow.color)}, ${shadow.opacity})`

function hexToRgbTuple(hex: string): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6)
  const n = parseInt(full || '000000', 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/**
 * Applies the node transform (position, rotation, flip) around its own centre
 * and leaves the local origin at the node's top-left.
 */
export function withNodeTransform(ctx: CanvasRenderingContext2D, node: SceneNode, scale = 1, body: () => void): void {
  ctx.save()
  const x = node.x * scale
  const y = node.y * scale
  const w = node.width * scale
  const h = node.height * scale
  ctx.translate(x + w / 2, y + h / 2)
  if (node.rotation) ctx.rotate(degToRad(node.rotation))
  if (node.flipX || node.flipY) ctx.scale(node.flipX ? -1 : 1, node.flipY ? -1 : 1)
  ctx.translate(-w / 2, -h / 2)
  body()
  ctx.restore()
}

function applyShadow(ctx: CanvasRenderingContext2D, shadow: ShadowSpec | null | undefined): void {
  if (!shadow || shadow.blur <= 0) return
  ctx.shadowColor = `rgba(${hexToRgbTuple(shadow.color)}, ${shadow.opacity})`
  ctx.shadowBlur = shadow.blur
  ctx.shadowOffsetX = shadow.offsetX
  ctx.shadowOffsetY = shadow.offsetY
}

/** Renders a scene node inside an already-transformed context (origin = node box). */
export function drawNode(ctx: CanvasRenderingContext2D, node: SceneNode, options: DrawOptions = {}): void {
  const scale = options.scale ?? 1
  const parentOpacity = options.parentOpacity ?? 1
  if (!node.visible) return

  const width = node.width * scale
  const height = node.height * scale

  withNodeTransform(ctx, node, scale, () => {
    ctx.globalAlpha = node.opacity * parentOpacity
    switch (node.kind) {
      case 'text':
        drawText(ctx, node, width, height, options)
        break
      case 'shape':
        drawShape(ctx, node, width, height)
        break
      case 'image':
        drawImage(ctx, node, width, height, options)
        break
      case 'svg':
        drawSvgPlaceholder(ctx, node, width, height)
        break
      case 'group':
        drawGroup(ctx, node, { ...options, parentOpacity: node.opacity * parentOpacity })
        break
      default:
        break
    }
    ctx.globalAlpha = 1
  })
}

function drawText(ctx: CanvasRenderingContext2D, node: TextNode, width: number, height: number, options: DrawOptions): void {
  const box = { x: 0, y: 0, width, height }
  applyShadow(ctx, node.shadow)
  drawTextNode({ ctx, node, box })
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  void options
}

function drawShape(ctx: CanvasRenderingContext2D, node: ShapeNode, width: number, height: number): void {
  ctx.beginPath()
  shapePath(ctx, node.shape, width, height, node.cornerRadius ?? 0, node.points ?? 5)

  const isStrokeOnly = node.shape === 'line' || (node.fill.type === 'solid' && /^#00000000$|^transparent$/i.test(node.fill.color))
  if (!isStrokeOnly) {
    applyShadow(ctx, node.shadow)
    ctx.fillStyle = fillToPaint(ctx, node.fill, { x: 0, y: 0, width, height })
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }
  if (node.stroke && node.stroke.width > 0) {
    if (node.stroke.dash?.length) ctx.setLineDash(node.stroke.dash.map((d) => d * Math.max(1, node.stroke!.width / 4)))
    ctx.strokeStyle = node.stroke.color
    ctx.lineWidth = node.shape === 'line' ? (node.thickness ?? 4) : node.stroke.width
    ctx.lineJoin = 'round'
    ctx.stroke()
    if (node.stroke.dash?.length) ctx.setLineDash([])
  }
  void shadowToCss
}

function drawImage(ctx: CanvasRenderingContext2D, node: ImageNode, width: number, height: number, options: DrawOptions): void {
  const src = node.src
  options.onImageNeeded?.(src)
  const entry = imageCache.peek(src)
  if (!entry || entry.status === 'loading') {
    options.onImageNeeded?.(src)
    drawImagePlaceholder(ctx, width, height, entry?.status === 'loading')
    return
  }
  if (entry.status === 'error') {
    drawImagePlaceholder(ctx, width, height, false, true)
    return
  }

  const crop = node.crop
  const source = {
    x: crop ? crop.x * entry.width : 0,
    y: crop ? crop.y * entry.height : 0,
    width: crop ? crop.width * entry.width : entry.width,
    height: crop ? crop.height * entry.height : entry.height
  }
  const needsFilter = hasVisibleFilters(node.filters)
  const target = needsFilter
    ? applyFilters(
        rasterizeSource(entry.image, source),
        node,
        { width: Math.max(1, Math.min(entry.width, width * 2)), height: Math.max(1, Math.min(entry.height, height * 2)) }
      )
    : entry.image

  applyShadow(ctx, node.shadow)
  const mask = node.mask && node.mask !== 'none' ? maskPath(node.mask, width, height) : null
  if (mask) {
    ctx.save()
    ctx.clip(mask)
  }

  const fit = fitRect({ width: source.width, height: source.height }, { x: 0, y: 0, width, height }, node.fit)
  if (needsFilter) {
    ctx.drawImage(target, fit.offsetX, fit.offsetY, source.width * fit.scale, source.height * fit.scale)
  } else {
    ctx.drawImage(
      target,
      source.x,
      source.y,
      source.width,
      source.height,
      fit.offsetX,
      fit.offsetY,
      source.width * fit.scale,
      source.height * fit.scale
    )
  }

  if (mask) ctx.restore()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
}

let rasterScratch: HTMLCanvasElement | null = null

/** Crops a decoded image into a canvas so filters can run on it. */
function rasterizeSource(image: HTMLImageElement, source: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const width = Math.max(1, Math.round(source.width))
  const height = Math.max(1, Math.round(source.height))
  if (!rasterScratch || rasterScratch.width < width || rasterScratch.height < height) {
    rasterScratch = makeCanvas(width, height)
  }
  const ctx = rasterScratch.getContext('2d')
  if (!ctx) return makeCanvas(1, 1)
  ctx.clearRect(0, 0, rasterScratch.width, rasterScratch.height)
  ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, width, height)
  return rasterScratch
}

function drawImagePlaceholder(ctx: CanvasRenderingContext2D, width: number, height: number, loading: boolean, error = false): void {
  ctx.save()
  ctx.fillStyle = error ? 'rgba(255,95,122,0.14)' : 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = error ? 'rgba(255,95,122,0.6)' : 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.setLineDash([6, 5])
  ctx.strokeRect(0.5, 0.5, Math.max(1, width - 1), Math.max(1, height - 1))
  ctx.setLineDash([])
  ctx.fillStyle = error ? 'rgba(255,95,122,0.9)' : 'rgba(255,255,255,0.45)'
  ctx.font = `${Math.max(10, Math.min(16, height / 5))}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(error ? 'Image error' : loading ? 'Loading…' : 'Image', width / 2, height / 2)
  ctx.restore()
}

function drawSvgPlaceholder(ctx: CanvasRenderingContext2D, node: SvgNode, width: number, height: number): void {
  const svg = node.svg.replace(/<svg([^>]*)>/i, (_full: string, attrs: string) => {
    const cleaned = attrs.replace(/width\s*=\s*"[^"]*"/i, '').replace(/height\s*=\s*"[^"]*"/i, '')
    return `<svg${cleaned} width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">`
  })
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  const entry = imageCache.peek(url)
  if (!entry || entry.status === 'loading') {
    void imageCache.load(url)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fillRect(0, 0, width, height)
    return
  }
  ctx.drawImage(entry.image, 0, 0, width, height)
}

function drawGroup(ctx: CanvasRenderingContext2D, node: GroupNode, options: DrawOptions): void {
  const scale = options.scale ?? 1
  for (const child of node.children) {
    drawNode(ctx, { ...child, x: child.x, y: child.y }, { ...options, scale, parentOpacity: node.opacity })
  }
}

/** Paints a page background inside an untransformed context. */
export function drawPageBackground(ctx: CanvasRenderingContext2D, page: Page, scale = 1): void {
  const width = page.width * scale
  const height = page.height * scale
  const background = page.background
  if (background.type === 'transparent') return

  if (background.type === 'gradient' && background.gradient) {
    ctx.fillStyle = fillToPaint(ctx, background.gradient, { x: 0, y: 0, width, height })
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (background.imageSrc) {
    const entry = imageCache.peek(background.imageSrc)
    if (entry?.status === 'ready') {
      const fit = fitRect({ width: entry.width, height: entry.height }, { x: 0, y: 0, width, height }, 'cover')
      ctx.globalAlpha = background.imageOpacity ?? 1
      ctx.drawImage(entry.image, fit.offsetX, fit.offsetY, entry.width * fit.scale, entry.height * fit.scale)
      ctx.globalAlpha = 1
      return
    }
    void imageCache.load(background.imageSrc)
  }
  ctx.fillStyle = background.color || '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
}

export const defaultSolid = solid

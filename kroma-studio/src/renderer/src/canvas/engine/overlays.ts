import type { Page, SceneNode } from '../../../../shared/types/document'
import { degToRad } from '../../../../shared/utils/geometry'
import { nodeCorners } from './hit-test'

export interface OverlayStyle {
  accent: string
  accentSoft: string
  guide: string
  handle: string
  handleFill: string
}

export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
  accent: '#7C5CFF',
  accentSoft: 'rgba(124, 92, 255, 0.16)',
  guide: '#FF3D8B',
  handle: '#7C5CFF',
  handleFill: '#FFFFFF'
}

export const HANDLE_SIZE = 8
export const ROTATE_OFFSET = 24

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

export const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate']

/** Handle positions in page space, following rotation. */
export function handlePositions(node: SceneNode): Record<HandleId, { x: number; y: number }> {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const cos = Math.cos(degToRad(node.rotation))
  const sin = Math.sin(degToRad(node.rotation))
  const hw = node.width / 2
  const hh = node.height / 2
  const at = (dx: number, dy: number): { x: number; y: number } => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  })
  return {
    nw: at(-hw, -hh),
    n: at(0, -hh),
    ne: at(hw, -hh),
    e: at(hw, 0),
    se: at(hw, hh),
    s: at(0, hh),
    sw: at(-hw, hh),
    w: at(-hw, 0),
    rotate: at(0, -hh - ROTATE_OFFSET / Math.max(0.2, 1))
  }
}

export function handleAtPoint(node: SceneNode, point: { x: number; y: number }, zoom: number): HandleId | null {
  const positions = handlePositions(node)
  const threshold = HANDLE_SIZE / zoom + 2 / zoom
  // Rotate handle wins when overlapping so it stays reachable.
  for (const id of ['rotate', ...HANDLES.filter((h) => h !== 'rotate')] as HandleId[]) {
    const handle = positions[id]
    if (Math.abs(handle.x - point.x) <= threshold && Math.abs(handle.y - point.y) <= threshold) return id
  }
  return null
}

/** Selection box, handles and rotation grip for one node. */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  zoom: number,
  style: OverlayStyle = DEFAULT_OVERLAY_STYLE,
  options: { showHandles?: boolean; dashed?: boolean } = {}
): void {
  const corners = nodeCorners(node)
  ctx.save()
  ctx.lineWidth = 1.5 / zoom
  ctx.strokeStyle = style.accent
  if (options.dashed) ctx.setLineDash([6 / zoom, 4 / zoom])
  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y)
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])

  if (options.showHandles !== false) {
    const positions = handlePositions(node)
    const size = HANDLE_SIZE / zoom
    // rotation grip line
    ctx.beginPath()
    ctx.moveTo(positions.n.x, positions.n.y)
    ctx.lineTo(positions.rotate.x, positions.rotate.y)
    ctx.stroke()

    for (const id of HANDLES) {
      const handle = positions[id]
      const radius = (id === 'rotate' ? HANDLE_SIZE / 2 : HANDLE_SIZE / 2) / zoom
      ctx.beginPath()
      if (id === 'rotate') {
        ctx.arc(handle.x, handle.y, radius * 1.2, 0, Math.PI * 2)
      } else {
        ctx.rect(handle.x - radius, handle.y - radius, radius * 2, radius * 2)
      }
      ctx.fillStyle = style.handleFill
      ctx.fill()
      ctx.strokeStyle = style.handle
      ctx.lineWidth = 1.5 / zoom
      ctx.stroke()
    }
    void size
  }
  ctx.restore()
}

export function drawHoverOutline(ctx: CanvasRenderingContext2D, node: SceneNode, zoom: number, style: OverlayStyle = DEFAULT_OVERLAY_STYLE): void {
  const corners = nodeCorners(node)
  ctx.save()
  ctx.strokeStyle = style.accentSoft
  ctx.lineWidth = 2 / zoom
  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

export interface SnapGuideLike {
  orientation: 'vertical' | 'horizontal'
  at: number
}

export function drawSnapGuides(ctx: CanvasRenderingContext2D, guides: SnapGuideLike[], page: Page, zoom: number, style: OverlayStyle = DEFAULT_OVERLAY_STYLE): void {
  if (guides.length === 0) return
  ctx.save()
  ctx.strokeStyle = style.guide
  ctx.lineWidth = 1 / zoom
  ctx.setLineDash([4 / zoom, 4 / zoom])
  for (const guide of guides) {
    ctx.beginPath()
    if (guide.orientation === 'vertical') {
      ctx.moveTo(guide.at, -2000)
      ctx.lineTo(guide.at, page.height + 2000)
    } else {
      ctx.moveTo(-2000, guide.at)
      ctx.lineTo(page.width + 2000, guide.at)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export function drawSafeArea(ctx: CanvasRenderingContext2D, page: Page, zoom: number): void {
  if (!page.safeArea) return
  const inset = (Math.min(page.width, page.height) * page.safeArea) / 200
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1 / zoom
  ctx.setLineDash([8 / zoom, 6 / zoom])
  ctx.strokeRect(inset, inset, page.width - inset * 2, page.height - inset * 2)
  ctx.restore()
}

export function drawGrid(ctx: CanvasRenderingContext2D, page: Page, zoom: number, gridSize: number): void {
  const step = gridSize
  if (step <= 0) return
  const minSpacing = 6 / zoom
  let spacing = step
  while (spacing * zoom < minSpacing) spacing *= 2
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1 / zoom
  ctx.beginPath()
  for (let x = 0; x <= page.width; x += spacing) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, page.height)
  }
  for (let y = 0; y <= page.height; y += spacing) {
    ctx.moveTo(0, y)
    ctx.lineTo(page.width, y)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawMarquee(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, zoom: number, style: OverlayStyle = DEFAULT_OVERLAY_STYLE): void {
  ctx.save()
  ctx.fillStyle = style.accentSoft
  ctx.strokeStyle = style.accent
  ctx.lineWidth = 1 / zoom
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

/** Dimension badge shown while resizing. */
export function drawSizeBadge(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  zoom: number,
  text: string
): void {
  const x = node.x + node.width / 2
  const y = node.y + node.height + 14 / zoom
  ctx.save()
  ctx.font = `${12 / zoom}px Inter, sans-serif`
  const metrics = ctx.measureText(text)
  const paddingX = 6 / zoom
  const height = 20 / zoom
  const width = metrics.width + paddingX * 2
  ctx.fillStyle = 'rgba(10,10,16,0.85)'
  ctx.beginPath()
  ctx.roundRect(x - width / 2, y, width, height, 4 / zoom)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + height / 2)
  ctx.restore()
}

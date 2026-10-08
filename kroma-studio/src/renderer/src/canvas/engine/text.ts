import type { FillSpec, StrokeSpec, TextNode } from '../../../../shared/types/document'
import { degToRad } from '../../../../shared/utils/geometry'

export interface TextLine {
  text: string
  width: number
}

export interface TextLayout {
  lines: TextLine[]
  lineHeight: number
  /** Pixel height of the whole block. */
  height: number
  /** Pixel width of the widest line. */
  width: number
}

export interface TextLayoutOptions {
  maxWidth: number
  maxHeight?: number
}

const cache = new Map<string, TextLayout>()
const CACHE_LIMIT = 400

const fontString = (node: TextNode): string =>
  `${node.italic ? 'italic ' : ''}${node.fontWeight} ${node.fontSize}px "${node.fontFamily}", Inter, sans-serif`

function cacheKey(node: TextNode, maxWidth: number): string {
  return [
    node.text,
    node.fontFamily,
    node.fontSize,
    node.fontWeight,
    node.italic ? 'i' : '',
    node.lineHeight,
    node.letterSpacing,
    node.align,
    node.boxMode,
    Math.round(maxWidth)
  ].join('|')
}

function measure(ctx: CanvasRenderingContext2D, text: string, letterSpacing: number): number {
  const base = ctx.measureText(text).width
  return base + (text.length > 1 ? letterSpacing * (text.length - 0) * 1 : 0)
}

/**
 * Lays wrapped text out into lines. Honours explicit newlines, soft wrapping and
 * letter spacing. Results are memoised per node signature because this runs on
 * every frame while a text box is being edited.
 */
export function layoutText(ctx: CanvasRenderingContext2D, node: TextNode, options: TextLayoutOptions): TextLayout {
  const key = cacheKey(node, options.maxWidth)
  const hit = cache.get(key)
  if (hit) return hit

  ctx.save()
  ctx.font = fontString(node)
  const lineHeight = node.fontSize * node.lineHeight
  const spacing = node.letterSpacing
  const paragraphs = node.text.split(/\r?\n/)
  const lines: TextLine[] = []

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push({ text: '', width: 0 })
      continue
    }
    const words = paragraph.split(/(\s+)/).filter((w) => w !== '')
    let current = ''
    for (const word of words) {
      const candidate = current.length === 0 ? word : current + word
      const width = measure(ctx, candidate, spacing)
      if (width > options.maxWidth && current.length > 0 && !/^\s+$/.test(word)) {
        lines.push({ text: current, width: measure(ctx, current, spacing) })
        current = word.trimStart()
      } else {
        current = candidate
      }
    }
    lines.push({ text: current, width: measure(ctx, current, spacing) })
  }

  ctx.restore()

  const layout: TextLayout = {
    lines,
    lineHeight,
    height: lines.length * lineHeight,
    width: lines.reduce((max, line) => Math.max(max, line.width), 0)
  }
  if (cache.size > CACHE_LIMIT) {
    // Keep the cache bounded; first entries are the oldest.
    const keys = [...cache.keys()]
    for (const stale of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT / 2))) cache.delete(stale)
  }
  cache.set(key, layout)
  return layout
}

export function measureTextNode(ctx: CanvasRenderingContext2D, node: TextNode): { width: number; height: number } {
  const layout = layoutText(ctx, node, { maxWidth: node.boxMode === 'grow' ? Number.MAX_SAFE_INTEGER : node.width })
  return { width: Math.ceil(layout.width + Math.abs(node.letterSpacing) * 2), height: Math.ceil(layout.height) }
}

export interface TextDrawContext {
  ctx: CanvasRenderingContext2D
  node: TextNode
  /** Bounding box in the current transform space. */
  box: { x: number; y: number; width: number; height: number }
  /** Draw only up to this line (used while typing grows the box). */
  maxLines?: number
  /** Render for measurement only (skip painting). */
  dry?: boolean
}

export function fillToPaint(ctx: CanvasRenderingContext2D, fill: FillSpec, box: { x: number; y: number; width: number; height: number }): string | CanvasGradient {
  if (fill.type !== 'linear' && fill.type !== 'radial') return fill.color
  const stops = fill.stops && fill.stops.length > 1 ? fill.stops : [{ color: fill.color, offset: 0 }, { color: fill.color, offset: 1 }]
  if (fill.type === 'linear') {
    const angle = degToRad(fill.angle ?? 0)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    // Project the angle onto the box so the gradient always spans it fully.
    const half = (Math.abs(Math.cos(angle)) * box.width + Math.abs(Math.sin(angle)) * box.height) / 2
    const dx = Math.cos(angle) * half
    const dy = Math.sin(angle) * half
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
    for (const stop of stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color)
    return gradient
  }
  const gradient = ctx.createRadialGradient(
    box.x + box.width / 2,
    box.y + box.height / 2,
    0,
    box.x + box.width / 2,
    box.y + box.height / 2,
    Math.max(box.width, box.height) / 2
  )
  for (const stop of stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color)
  return gradient
}

/** Y offset of the first baseline inside `box` for the node's vertical alignment. */
function topFor(node: TextNode, layout: TextLayout, box: { y: number; height: number }): number {
  const blockHeight = layout.lines.length * layout.lineHeight
  switch (node.valign) {
    case 'top':
      return box.y + node.padding
    case 'bottom':
      return box.y + box.height - blockHeight - node.padding + layout.lineHeight * 0.78
    case 'middle':
    default:
      return box.y + (box.height - blockHeight) / 2 + layout.lineHeight * 0.78
  }
}

export function drawTextNode({ ctx, node, box, dry }: TextDrawContext): void {
  if (dry) return
  ctx.save()
  ctx.font = fontString(node)
  ctx.textBaseline = 'alphabetic'
  const layout = layoutText(ctx, node, { maxWidth: box.width - node.padding * 2 })
  const paint = fillToPaint(ctx, node.fill, box)

  const drawLine = (line: TextLine, lineIndex: number, y: number, x: number): void => {
    if (node.stroke && node.stroke.width > 0) {
      applyStroke(ctx, node.stroke, paint)
      strokeLine(ctx, node, line, x, y, lineIndex, layout)
    }
    ctx.fillStyle = paint
    paintLine(ctx, node, line, x, y, lineIndex, layout, 'fill')
  }

  const curve = node.curve ?? { kind: 'none', amount: 40 }
  if (curve.kind === 'none') {
    const top = topFor(node, layout, box)
    layout.lines.forEach((line, index) => {
      const x =
        node.align === 'left'
          ? box.x + node.padding
          : node.align === 'right'
            ? box.x + box.width - node.padding - line.width
            : box.x + (box.width - line.width) / 2
      drawLine(line, index, top + index * layout.lineHeight, x)
    })
  } else {
    drawCurved(ctx, node, layout, box, curve, drawLine)
  }

  if (node.underline || node.strikethrough) {
    const top = topFor(node, layout, box)
    ctx.strokeStyle = paint
    ctx.lineWidth = Math.max(1, node.fontSize / 14)
    layout.lines.forEach((line, index) => {
      const x =
        node.align === 'left'
          ? box.x + node.padding
          : node.align === 'right'
            ? box.x + box.width - node.padding - line.width
            : box.x + (box.width - line.width) / 2
      const y = top + index * layout.lineHeight
      if (node.underline) {
        ctx.beginPath()
        ctx.moveTo(x, y + node.fontSize * 0.12)
        ctx.lineTo(x + line.width, y + node.fontSize * 0.12)
        ctx.stroke()
      }
      if (node.strikethrough) {
        ctx.beginPath()
        ctx.moveTo(x, y - node.fontSize * 0.32)
        ctx.lineTo(x + line.width, y - node.fontSize * 0.32)
        ctx.stroke()
      }
    })
  }

  ctx.restore()
}

function applyStroke(ctx: CanvasRenderingContext2D, stroke: StrokeSpec, paint: string | CanvasGradient): void {
  ctx.strokeStyle = stroke.color === 'auto' ? (typeof paint === 'string' ? paint : '#000000') : stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  if (stroke.dash?.length) ctx.setLineDash(stroke.dash)
}

function paintLine(
  ctx: CanvasRenderingContext2D,
  node: TextNode,
  line: TextLine,
  x: number,
  y: number,
  lineIndex: number,
  layout: TextLayout,
  mode: 'fill' | 'stroke'
): void {
  const spacing = node.letterSpacing
  if (spacing === 0) {
    if (mode === 'fill') ctx.fillText(line.text, x, y)
    else ctx.strokeText(line.text, x, y)
    return
  }
  let cursor = x
  for (const char of line.text) {
    if (mode === 'fill') ctx.fillText(char, cursor, y)
    else ctx.strokeText(char, cursor, y)
    cursor += ctx.measureText(char).width + spacing
  }
  void lineIndex
  void layout
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  node: TextNode,
  line: TextLine,
  x: number,
  y: number,
  lineIndex: number,
  layout: TextLayout
): void {
  paintLine(ctx, node, line, x, y, lineIndex, layout, 'stroke')
  if (ctx.getLineDash().length) ctx.setLineDash([])
}

type CurveSpecLike = { kind: string; amount: number }

/** Places each glyph along a path: arc / wave / valley / circle. */
function drawCurved(
  ctx: CanvasRenderingContext2D,
  node: TextNode,
  layout: TextLayout,
  box: { x: number; y: number; width: number; height: number },
  curve: CurveSpecLike,
  drawLine: (line: TextLine, lineIndex: number, y: number, x: number) => void
): void {
  const amount = (curve.amount ?? 40) / 100
  const top = topFor(node, layout, box)
  layout.lines.forEach((line, index) => {
    const y = top + index * layout.lineHeight
    const chars = [...line.text]
    const totalWidth = chars.reduce((sum, char) => sum + ctx.measureText(char).width + node.letterSpacing, 0)
    let cursor = node.align === 'left' ? box.x + node.padding : node.align === 'right' ? box.x + box.width - node.padding - totalWidth : box.x + (box.width - totalWidth) / 2

    if (curve.kind === 'circle' || curve.kind === 'arc' || curve.kind === 'arcReverse') {
      const direction = curve.kind === 'arcReverse' ? -1 : 1
      const radius = totalWidth / 2 + Math.max(40, (box.width - totalWidth) / 2) * Math.max(0.2, Math.abs(amount))
      const circumference = 2 * Math.PI * radius
      const sweep = (totalWidth / circumference) * Math.PI * 2
      const start = -sweep / 2 - Math.PI / 2
      const cx = cursor + totalWidth / 2
      const cy = y - radius + node.fontSize * 0.35
      let travelled = 0
      for (const char of chars) {
        const charWidth = ctx.measureText(char).width + node.letterSpacing
        const t = totalWidth === 0 ? 0 : travelled / totalWidth
        const angle = start + sweep * t * direction
        ctx.save()
        ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
        ctx.rotate(angle + (direction > 0 ? Math.PI / 2 : -Math.PI / 2))
        ctx.fillText(char, -charWidth / 2, 0)
        ctx.restore()
        travelled += charWidth
      }
      return
    }

    // wave / valley: sinusoidal baseline offset + slight rotation
    const amplitude = node.fontSize * 0.45 * amount * (curve.kind === 'valley' ? -1 : 1)
    let travelled = 0
    for (const char of chars) {
      const charWidth = ctx.measureText(char).width + node.letterSpacing
      const t = totalWidth === 0 ? 0 : travelled / totalWidth
      const offset = Math.sin(t * Math.PI * 2) * amplitude
      const slope = Math.cos(t * Math.PI * 2) * amplitude * 0.08
      ctx.save()
      ctx.translate(cursor + charWidth / 2, y + offset)
      ctx.rotate(slope * 0.12)
      ctx.fillText(char, -charWidth / 2, 0)
      ctx.restore()
      cursor += charWidth
      travelled += charWidth
    }
  })
  void drawLine
}

/** Character index → caret rectangle, used by the inline editor overlay. */
export function caretRect(ctx: CanvasRenderingContext2D, node: TextNode, box: { x: number; y: number; width: number; height: number }, index: number): { x: number; y: number; height: number } {
  ctx.save()
  ctx.font = fontString(node)
  const layout = layoutText(ctx, node, { maxWidth: box.width - node.padding * 2 })
  let remaining = index
  for (let i = 0; i < layout.lines.length; i += 1) {
    const line = layout.lines[i]
    if (remaining <= line.text.length) {
      const before = line.text.slice(0, remaining)
      const offset = ctx.measureText(before).width + node.letterSpacing * remaining
      const lineWidth = line.width
      const x =
        node.align === 'left'
          ? box.x + node.padding + offset
          : node.align === 'right'
            ? box.x + box.width - node.padding - lineWidth + offset
            : box.x + (box.width - lineWidth) / 2 + offset
      const y = topFor(node, layout, box) + i * layout.lineHeight
      ctx.restore()
      return { x, y: y - node.fontSize * 0.82, height: node.fontSize * 1.25 }
    }
    remaining -= line.text.length + 1
  }
  ctx.restore()
  const lastY = topFor(node, layout, box) + Math.max(0, layout.lines.length - 1) * layout.lineHeight
  return { x: box.x + node.padding, y: lastY - node.fontSize * 0.82, height: node.fontSize * 1.25 }
}

/** Hit test a click inside a text box → caret index. */
export function caretIndexFromPoint(ctx: CanvasRenderingContext2D, node: TextNode, box: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): number {
  ctx.save()
  ctx.font = fontString(node)
  const layout = layoutText(ctx, node, { maxWidth: box.width - node.padding * 2 })
  const top = topFor(node, layout, box) - node.fontSize * 0.82
  const lineIndex = Math.max(0, Math.min(layout.lines.length - 1, Math.floor((point.y - top) / layout.lineHeight)))
  const line = layout.lines[lineIndex]
  const startX =
    node.align === 'left'
      ? box.x + node.padding
      : node.align === 'right'
        ? box.x + box.width - node.padding - line.width
        : box.x + (box.width - line.width) / 2
  let index = 0
  let best = { index: 0, distance: Number.POSITIVE_INFINITY }
  let cursor = startX
  for (const char of line.text) {
    const distance = Math.abs(point.x - cursor)
    if (distance < best.distance) best = { index, distance }
    cursor += ctx.measureText(char).width + node.letterSpacing
    index += 1
  }
  if (Math.abs(point.x - cursor) < best.distance) best = { index, distance: Math.abs(point.x - cursor) }
  let offset = best.index
  for (let i = 0; i < lineIndex; i += 1) offset += layout.lines[i].text.length + 1
  ctx.restore()
  return offset
}

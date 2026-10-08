import type { ShapeKind, ShapeNode } from '../../../../shared/types/document'

/** Builds the path for a shape inside a 0,0,w,h box (caller owns beginPath). */
export function shapePath(ctx: CanvasRenderingContext2D | Path2D, kind: ShapeKind, w: number, h: number, radiusPercent = 0, points = 5): void {
  const radius = Math.min(w, h) * (radiusPercent / 100) / 2
  switch (kind) {
    case 'rect':
    case 'pill': {
      const r = kind === 'pill' ? Math.min(w, h) / 2 : Math.min(radius, Math.min(w, h) / 2)
      roundedRect(ctx, 0, 0, w, h, r)
      return
    }
    case 'circle':
    case 'ellipse':
      ctx.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
      return
    case 'triangle':
      polygon(ctx, [[w / 2, 0], [w, h], [0, h]])
      return
    case 'diamond':
      polygon(ctx, [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
      return
    case 'pentagon':
      regularPolygon(ctx, 5, w, h)
      return
    case 'hexagon':
      regularPolygon(ctx, 6, w, h)
      return
    case 'star':
      star(ctx, Math.max(3, Math.min(24, points)), w, h)
      return
    case 'heart':
      heart(ctx, w, h)
      return
    case 'arrow':
      arrow(ctx, w, h)
      return
    case 'line':
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      return
    case 'cross':
      cross(ctx, w, h)
      return
    case 'blob':
      blob(ctx, w, h)
      return
    default:
      roundedRect(ctx, 0, 0, w, h, radius)
  }
}

export function roundedRect(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  if (ctx instanceof Path2D) {
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + w - radius, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
    ctx.lineTo(x + w, y + h - radius)
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
    ctx.lineTo(x + radius, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function polygon(ctx: CanvasRenderingContext2D | Path2D, points: Array<[number, number]>): void {
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}

function regularPolygon(ctx: CanvasRenderingContext2D | Path2D, sides: number, w: number, h: number): void {
  const cx = w / 2
  const cy = h / 2
  const radius = Math.min(w, h) / 2
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function star(ctx: CanvasRenderingContext2D | Path2D, points: number, w: number, h: number): void {
  const cx = w / 2
  const cy = h / 2
  const outer = Math.min(w, h) / 2
  const inner = outer * 0.45
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function heart(ctx: CanvasRenderingContext2D | Path2D, w: number, h: number): void {
  const s = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  ctx.moveTo(cx, cy + s * 0.32)
  ctx.bezierCurveTo(cx - s * 0.5, cy - s * 0.05, cx - s * 0.3, cy - s * 0.5, cx, cy - s * 0.16)
  ctx.bezierCurveTo(cx + s * 0.3, cy - s * 0.5, cx + s * 0.5, cy - s * 0.05, cx, cy + s * 0.32)
  ctx.closePath()
}

function arrow(ctx: CanvasRenderingContext2D | Path2D, w: number, h: number): void {
  const head = Math.min(w * 0.4, h * 0.7)
  ctx.moveTo(0, h * 0.5 - h * 0.16)
  ctx.lineTo(w - head, h * 0.5 - h * 0.16)
  ctx.lineTo(w - head, h * 0.06)
  ctx.lineTo(w, h * 0.5)
  ctx.lineTo(w - head, h * 0.94)
  ctx.lineTo(w - head, h * 0.5 + h * 0.16)
  ctx.lineTo(0, h * 0.5 + h * 0.16)
  ctx.closePath()
}

function cross(ctx: CanvasRenderingContext2D | Path2D, w: number, h: number): void {
  const thickness = Math.min(w, h) * 0.3
  ctx.moveTo(w / 2 - thickness / 2, 0)
  ctx.lineTo(w / 2 + thickness / 2, 0)
  ctx.lineTo(w / 2 + thickness / 2, h / 2 - thickness / 2)
  ctx.lineTo(w, h / 2 - thickness / 2)
  ctx.lineTo(w, h / 2 + thickness / 2)
  ctx.lineTo(w / 2 + thickness / 2, h / 2 + thickness / 2)
  ctx.lineTo(w / 2 + thickness / 2, h)
  ctx.lineTo(w / 2 - thickness / 2, h)
  ctx.lineTo(w / 2 - thickness / 2, h / 2 + thickness / 2)
  ctx.lineTo(0, h / 2 + thickness / 2)
  ctx.lineTo(0, h / 2 - thickness / 2)
  ctx.lineTo(w / 2 - thickness / 2, h / 2 - thickness / 2)
  ctx.closePath()
}

function blob(ctx: CanvasRenderingContext2D | Path2D, w: number, h: number): void {
  const cx = w / 2
  const cy = h / 2
  const rx = w / 2
  const ry = h / 2
  const lobes = 6
  for (let i = 0; i <= lobes * 2; i += 1) {
    const angle = (i / (lobes * 2)) * Math.PI * 2
    const wobble = i % 2 === 0 ? 1 : 0.82
    const x = cx + Math.cos(angle) * rx * wobble
    const y = cy + Math.sin(angle) * ry * wobble
    if (i === 0) ctx.moveTo(x, y)
    else {
      const prevAngle = ((i - 1) / (lobes * 2)) * Math.PI * 2
      const midAngle = (angle + prevAngle) / 2
      const midRadius = 0.95
      ctx.quadraticCurveTo(cx + Math.cos(midAngle) * rx * midRadius * 1.1, cy + Math.sin(midAngle) * ry * midRadius * 1.1, x, y)
    }
  }
  ctx.closePath()
}

/** Masks used by "mask image into shape". */
export function maskPath(kind: string, w: number, h: number): Path2D {
  const path = new Path2D()
  switch (kind) {
    case 'circle':
      path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'rounded':
      roundedRect(path, 0, 0, w, h, Math.min(w, h) * 0.18)
      break
    case 'triangle':
      polygon(path, [[w / 2, 0], [w, h], [0, h]])
      break
    case 'hexagon':
      regularPolygon(path, 6, w, h)
      break
    case 'star':
      star(path, 5, w, h)
      break
    case 'heart':
      heart(path, w, h)
      break
    case 'diamond':
      polygon(path, [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
      break
    default:
      path.rect(0, 0, w, h)
  }
  return path
}

export const shapeLabel = (node: ShapeNode): string => node.shape.charAt(0).toUpperCase() + node.shape.slice(1)

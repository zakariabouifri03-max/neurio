import type { Align, SceneNode } from '../types/document'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
export const round = (value: number, digits = 2): number => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
export const degToRad = (deg: number): number => (deg * Math.PI) / 180

/** Normalise any angle into [0, 360). */
export const normalizeAngle = (deg: number): number => ((deg % 360) + 360) % 360

/** Axis-aligned bounding box of a node, honouring rotation around its centre. */
export function aabbOf(node: Pick<SceneNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Box {
  const rad = degToRad(node.rotation || 0)
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.max(0.01, node.width)
  const h = Math.max(0.01, node.height)
  const bw = w * cos + h * sin
  const bh = w * sin + h * cos
  return { x: node.x + (w - bw) / 2, y: node.y + (h - bh) / 2, width: bw, height: bh }
}

export function bboxOf(nodes: Array<Pick<SceneNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>>): Box | null {
  if (nodes.length === 0) return null
  const boxes = nodes.map(aabbOf)
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y
  }
}

export const boxCenter = (box: Box): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal'
  /** Page-space coordinate of the guide line. */
  at: number
}

export interface SnapOptions {
  threshold: number
  grid?: number | null
  page?: { width: number; height: number } | null
  /** Boxes of everything that is not being dragged. */
  staticBoxes?: Box[]
  /** Boxes of the dragged nodes. */
  movingBoxes: Box[]
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

/**
 * Grid + object + page-centre snapping. Returns the delta that should be
 * applied to the dragged nodes plus the guide lines to draw.
 */
export function computeSnap({ threshold, grid, page, staticBoxes = [], movingBoxes }: SnapOptions): SnapResult {
  if (movingBoxes.length === 0) return { dx: 0, dy: 0, guides: [] }
  const box = bboxOf(movingBoxes as SceneNode[]) as Box
  const guides: SnapGuide[] = []

  const xCandidates: number[] = []
  const yCandidates: number[] = []
  for (const b of staticBoxes) {
    xCandidates.push(b.x, b.x + b.width / 2, b.x + b.width)
    yCandidates.push(b.y, b.y + b.height / 2, b.y + b.height)
  }
  if (page) {
    xCandidates.push(0, page.width / 2, page.width)
    yCandidates.push(0, page.height / 2, page.height)
  }

  let bestDx: number | null = null
  let bestDy: number | null = null
  let bestDxAbs = threshold
  let bestDyAbs = threshold

  const movingXs = [box.x, box.x + box.width / 2, box.x + box.width]
  const movingYs = [box.y, box.y + box.height / 2, box.y + box.height]

  for (const target of xCandidates) {
    for (const mx of movingXs) {
      const delta = target - mx
      if (Math.abs(delta) < bestDxAbs) {
        bestDxAbs = Math.abs(delta)
        bestDx = delta
      }
    }
  }
  for (const target of yCandidates) {
    for (const my of movingYs) {
      const delta = target - my
      if (Math.abs(delta) < bestDyAbs) {
        bestDyAbs = Math.abs(delta)
        bestDy = delta
      }
    }
  }

  const dx = bestDx ?? 0
  const dy = bestDy ?? 0

  if (bestDx !== null) {
    guides.push(
      ...[box.x + dx, box.x + dx + box.width / 2, box.x + dx + box.width]
        .filter((x) => xCandidates.some((c) => Math.abs(c - x) < 0.5))
        .map((x) => ({ orientation: 'vertical' as const, at: round(x) }))
    )
  }
  if (bestDy !== null) {
    guides.push(
      ...[box.y + dy, box.y + dy + box.height / 2, box.y + dy + box.height]
        .filter((y) => yCandidates.some((c) => Math.abs(c - y) < 0.5))
        .map((y) => ({ orientation: 'horizontal' as const, at: round(y) }))
    )
  }

  // Grid snapping applies whenever it is within the threshold; when an object
  // or page snap was also found, the tighter of the two corrections wins.
  let gdx = dx
  let gdy = dy
  if (grid && grid > 0) {
    const snap = (v: number): number => Math.round(v / grid) * grid
    const candidateDx = snap(box.x) - box.x
    const candidateDy = snap(box.y) - box.y
    if (Math.abs(candidateDx) < threshold && (bestDx === null || Math.abs(candidateDx) < Math.abs(dx))) gdx = candidateDx
    if (Math.abs(candidateDy) < threshold && (bestDy === null || Math.abs(candidateDy) < Math.abs(dy))) gdy = candidateDy
    if (candidateDx !== 0 && Math.abs(candidateDx) < threshold) guides.push({ orientation: 'vertical', at: round(box.x + candidateDx) })
    if (candidateDy !== 0 && Math.abs(candidateDy) < threshold) guides.push({ orientation: 'horizontal', at: round(box.y + candidateDy) })
  }

  return { dx: round(gdx), dy: round(gdy), guides }
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Translate nodes so they align against their shared bounding box. */
export function alignNodes(nodes: SceneNode[], mode: AlignMode, container?: Box): SceneNode[] {
  const ref = container ?? bboxOf(nodes)
  if (!ref) return nodes
  return nodes.map((node) => {
    const box = aabbOf(node)
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left':
        dx = ref.x - box.x
        break
      case 'hcenter':
        dx = ref.x + ref.width / 2 - (box.x + box.width / 2)
        break
      case 'right':
        dx = ref.x + ref.width - (box.x + box.width)
        break
      case 'top':
        dy = ref.y - box.y
        break
      case 'vcenter':
        dy = ref.y + ref.height / 2 - (box.y + box.height / 2)
        break
      case 'bottom':
        dy = ref.y + ref.height - (box.y + box.height)
        break
    }
    return { ...node, x: round(node.x + dx), y: round(node.y + dy) }
  })
}

export type DistributeMode = 'horizontal' | 'vertical'

/** Evenly space nodes between the outermost two. */
export function distributeNodes(nodes: SceneNode[], mode: DistributeMode): SceneNode[] {
  if (nodes.length < 3) return nodes
  const axis = mode === 'horizontal' ? 'x' : 'y'
  const size = mode === 'horizontal' ? 'width' : 'height'
  const sorted = [...nodes].sort((a, b) => aabbOf(a)[axis] - aabbOf(b)[axis])
  const first = aabbOf(sorted[0])
  const last = aabbOf(sorted[sorted.length - 1])
  const total = nodes.reduce((acc, n) => acc + aabbOf(n)[size], 0)
  const span = axis === 'x' ? last.x + last.width - first.x : last.y + last.height - first.y
  const gap = (span - total) / (nodes.length - 1)
  let cursor = axis === 'x' ? first.x : first.y
  const updates = new Map<string, number>()
  for (const node of sorted) {
    const box = aabbOf(node)
    updates.set(node.id, round(cursor - box[axis]))
    cursor += box[size] + gap
  }
  return nodes.map((node) =>
    axis === 'x' ? { ...node, x: round(node.x + (updates.get(node.id) ?? 0)) } : { ...node, y: round(node.y + (updates.get(node.id) ?? 0)) }
  )
}

/** Scale/offset that maps `source` into `target` using cover or contain. */
export function fitRect(source: { width: number; height: number }, target: Box, mode: 'cover' | 'contain'): {
  scale: number
  offsetX: number
  offsetY: number
} {
  const ratio = mode === 'cover'
    ? Math.max(target.width / source.width, target.height / source.height)
    : Math.min(target.width / source.width, target.height / source.height)
  return {
    scale: ratio,
    offsetX: (target.width - source.width * ratio) / 2,
    offsetY: (target.height - source.height * ratio) / 2
  }
}

export function resolveAlignment(box: Box, container: Box, align: Align): number {
  switch (align) {
    case 'left':
      return container.x
    case 'right':
      return container.x + container.width - box.width
    case 'center':
    default:
      return container.x + (container.width - box.width) / 2
  }
}

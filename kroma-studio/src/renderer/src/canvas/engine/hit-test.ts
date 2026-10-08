import type { SceneNode } from '../../../../shared/types/document'
import { degToRad } from '../../../../shared/utils/geometry'

export interface Point {
  x: number
  y: number
}

/** Page-space corners of a node (clockwise from top-left). */
export function nodeCorners(node: SceneNode): [Point, Point, Point, Point] {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const cos = Math.cos(degToRad(node.rotation))
  const sin = Math.sin(degToRad(node.rotation))
  const hw = node.width / 2
  const hh = node.height / 2
  const corners: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh]
  ]
  return corners.map(([dx, dy]) => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  })) as [Point, Point, Point, Point]
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function isPointInNode(node: SceneNode, point: Point): boolean {
  if (node.rotation === 0) {
    return point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height
  }
  return pointInPolygon(point, nodeCorners(node))
}

/** Inverse-transform a page point into the node's local box space (0..w, 0..h). */
export function toLocalPoint(node: SceneNode, point: Point): Point {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const dx = point.x - cx
  const dy = point.y - cy
  const cos = Math.cos(degToRad(-node.rotation))
  const sin = Math.sin(degToRad(-node.rotation))
  return {
    x: dx * cos - dy * sin + node.width / 2,
    y: dx * sin + dy * cos + node.height / 2
  }
}

/** Topmost node under a point (children first, last drawn = first hit). */
export function hitTest(nodes: SceneNode[], point: Point, options: { ignoreLocked?: boolean; deep?: boolean } = {}): SceneNode | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    if (!node.visible) continue
    if (node.locked && options.ignoreLocked !== false) continue
    if (node.kind === 'group') {
      const local = toLocalPoint(node, point)
      const child = hitTest(node.children, { x: local.x, y: local.y }, options)
      if (child) {
        if (options.deep) return child
        // Ctrl-click drills into groups; by default the group owns the click.
        return node
      }
      if (isPointInNode(node, point)) return node
      continue
    }
    if (isPointInNode(node, point)) return node
  }
  return null
}

export function hitTestAny(nodes: SceneNode[], point: Point): SceneNode | null {
  return hitTest(nodes, point, { ignoreLocked: false })
}

/** All nodes intersecting a marquee rectangle (page space). */
export function nodesInRect(nodes: SceneNode[], rect: { x: number; y: number; width: number; height: number }): SceneNode[] {
  const out: SceneNode[] = []
  const rectCorners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ]
  const overlaps = (a: Point[], b: Point[]): boolean => {
    for (const axis of [{ x: 'x', y: 'y' }] as const) {
      const aMin = Math.min(...a.map((p) => p[axis.x]))
      const aMax = Math.max(...a.map((p) => p[axis.x]))
      const bMin = Math.min(...b.map((p) => p[axis.x]))
      const bMax = Math.max(...b.map((p) => p[axis.x]))
      if (aMax >= bMin && bMax >= aMin) {
        const aMin2 = Math.min(...a.map((p) => p[axis.y]))
        const aMax2 = Math.max(...a.map((p) => p[axis.y]))
        const bMin2 = Math.min(...b.map((p) => p[axis.y]))
        const bMax2 = Math.max(...b.map((p) => p[axis.y]))
        if (aMax2 >= bMin2 && bMax2 >= aMin2) return true
      }
    }
    return false
  }
  for (const node of nodes) {
    if (!node.visible || node.locked) continue
    if (node.kind === 'group') {
      const hits = nodesInRect(node.children, rect)
      if (hits.length === node.children.length && hits.length > 0) out.push(node)
      else out.push(...hits)
      continue
    }
    if (overlaps(nodeCorners(node), rectCorners)) out.push(node)
  }
  void cross
  return out
}

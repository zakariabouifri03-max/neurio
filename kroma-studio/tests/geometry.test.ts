import { describe, expect, it } from 'vitest'
import { aabbOf, alignNodes, bboxOf, computeSnap, distributeNodes, fitRect, normalizeAngle, round } from '../src/shared/utils/geometry'
import type { SceneNode, ShapeNode } from '../src/shared/types/document'

const node = (partial: Partial<ShapeNode> & { id: string }): ShapeNode => ({
  kind: 'shape',
  name: partial.id,
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  shape: 'rect',
  fill: { type: 'solid', color: '#000000' },
  ...partial
})

describe('geometry', () => {
  it('computes an axis-aligned bounding box for rotated nodes', () => {
    const box = aabbOf({ x: 0, y: 0, width: 100, height: 100, rotation: 90 })
    expect(round(box.width)).toBe(100)
    expect(round(box.height)).toBe(100)

    const skewed = aabbOf({ x: 0, y: 0, width: 100, height: 50, rotation: 90 })
    expect(round(skewed.width)).toBe(50)
    expect(round(skewed.height)).toBe(100)
  })

  it('merges boxes with bboxOf', () => {
    const box = bboxOf([
      { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
      { x: 200, y: 20, width: 50, height: 50, rotation: 0 }
    ])
    expect(box).toEqual({ x: 0, y: 0, width: 250, height: 70 })
  })

  it('normalises angles into [0,360)', () => {
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(450)).toBe(90)
  })

  it('snaps a moving box to a static edge', () => {
    const result = computeSnap({
      threshold: 8,
      page: { width: 1000, height: 1000 },
      staticBoxes: [{ x: 100, y: 100, width: 200, height: 100 }],
      movingBoxes: [{ x: 104, y: 300, width: 100, height: 100 }]
    })
    expect(result.dx).toBe(-4)
  })

  it('snaps to the page centre', () => {
    const result = computeSnap({
      threshold: 10,
      page: { width: 1000, height: 1000 },
      staticBoxes: [],
      movingBoxes: [{ x: 446, y: 100, width: 100, height: 100 }]
    })
    expect(result.dx).toBe(4)
  })

  it('snaps to the grid when closer', () => {
    const result = computeSnap({
      threshold: 10,
      grid: 50,
      page: null,
      staticBoxes: [],
      movingBoxes: [{ x: 47, y: 96, width: 100, height: 100 }]
    })
    expect(result.dx).toBe(3)
    expect(result.dy).toBe(4)
  })

  it('aligns nodes against their shared bounding box', () => {
    const nodes: SceneNode[] = [
      node({ id: 'a', x: 0, y: 0, width: 100, height: 40 }),
      node({ id: 'b', x: 150, y: 60, width: 60, height: 40 })
    ]
    const left = alignNodes(nodes, 'left')
    expect(left.map((item) => item.x)).toEqual([0, 0])

    // The shared bounding box spans 0..210, so right alignment pins both
    // nodes to that edge.
    const right = alignNodes(nodes, 'right')
    expect(right[1].x + right[1].width).toBe(210)
    expect(right[0].x + right[0].width).toBe(210)
  })

  it('distributes nodes evenly', () => {
    const nodes: SceneNode[] = [
      node({ id: 'a', x: 0, y: 0, width: 50, height: 20 }),
      node({ id: 'b', x: 55, y: 0, width: 50, height: 20 }),
      node({ id: 'c', x: 300, y: 0, width: 50, height: 20 })
    ]
    const result = distributeNodes(nodes, 'horizontal')
    const gaps = [result[1].x - (result[0].x + result[0].width), result[2].x - (result[1].x + result[1].width)]
    expect(Math.abs(gaps[0] - gaps[1])).toBeLessThan(1)
  })

  it('fits a source rect cover/contain', () => {
    const cover = fitRect({ width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 200 }, 'cover')
    expect(cover.scale).toBe(4)
    const contain = fitRect({ width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 200 }, 'contain')
    expect(contain.scale).toBe(2)
  })
})

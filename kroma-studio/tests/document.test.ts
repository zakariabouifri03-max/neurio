import { describe, expect, it } from 'vitest'
import {
  addPage,
  createDocument,
  createGroupNode,
  createShapeNode,
  createTextNode,
  duplicateNodes,
  duplicatePage,
  findNode,
  flattenNodes,
  groupSelected,
  movePage,
  removeNodes,
  removePage,
  reorderNodes,
  resizePage,
  ungroupSelected,
  updateNode
} from '../src/shared/utils/document'
import type { ShapeNode, TextNode } from '../src/shared/types/document'

const text = (id: string): TextNode =>
  createTextNode({ id, name: id, text: 'hello', x: 10, y: 20, width: 100, height: 40, fontSize: 20 })

const shape = (id: string): ShapeNode => createShapeNode('rect', { id, name: id, x: 0, y: 0, width: 50, height: 50 })

describe('document utilities', () => {
  it('creates a document with one page', () => {
    const document = createDocument(1080, 1080)
    expect(document.pages).toHaveLength(1)
    expect(document.pages[0].width).toBe(1080)
  })

  it('updates nested nodes immutably', () => {
    const group = createGroupNode([shape('a'), shape('b')])
    const nodes = [group]
    const next = updateNode(nodes, 'a', { x: 999 })
    expect(next).not.toBe(nodes)
    expect(findNode(next, 'a')?.x).toBe(999)
    expect(findNode(nodes, 'a')?.x).not.toBe(999)
  })

  it('removes nodes recursively', () => {
    const group = createGroupNode([shape('a'), shape('b')])
    const next = removeNodes([group, shape('c')], ['a', 'c'])
    expect(flattenNodes(next).map((node) => node.id)).toEqual([group.id, 'b'])
  })

  it('groups and ungroups preserving absolute positions', () => {
    const a = shape('a')
    const b = { ...shape('b'), x: 200, y: 200 }
    const nodes = [a, b]
    const grouped = groupSelected(nodes, ['a', 'b'])
    expect(grouped.groupId).toBeTruthy()
    const group = grouped.nodes.find((node) => node.kind === 'group')
    expect(group?.children).toHaveLength(2)

    const released = group ? ungroupSelected(grouped.nodes, group.id) : null
    const positions = released?.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })) ?? []
    expect(positions).toEqual([
      { id: 'a', x: a.x, y: a.y },
      { id: 'b', x: b.x, y: b.y }
    ])
  })

  it('reorders nodes', () => {
    const nodes = [shape('a'), shape('b'), shape('c')]
    expect(reorderNodes(nodes, 'c', 'front').map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(reorderNodes(nodes, 'c', 'back').map((n) => n.id)).toEqual(['c', 'a', 'b'])
    expect(reorderNodes(nodes, 'a', 'up').map((n) => n.id)).toEqual(['b', 'a', 'c'])
    expect(reorderNodes(nodes, 'c', 'down').map((n) => n.id)).toEqual(['a', 'c', 'b'])
  })

  it('duplicates nodes with fresh ids', () => {
    const copies = duplicateNodes([shape('a')], { x: 10, y: 10 })
    expect(copies[0].id).not.toBe('a')
    expect(copies[0].x).toBe(10)
  })

  it('adds, duplicates, reorders and removes pages', () => {
    let document = createDocument(100, 100)
    document = addPage(document)
    expect(document.pages).toHaveLength(2)

    document = duplicatePage(document, document.pages[0].id)
    expect(document.pages).toHaveLength(3)
    expect(document.pages[1].name).toContain('copy')

    document = movePage(document, document.pages[2].id, -1)
    document = removePage(document, document.pages[0].id)
    expect(document.pages).toHaveLength(2)
  })

  it('never removes the last page', () => {
    const document = createDocument(100, 100)
    expect(removePage(document, document.pages[0].id)).toBe(document)
  })

  it('rescales page contents on resize', () => {
    let document = createDocument(1000, 1000)
    document = { ...document, pages: [{ ...document.pages[0], nodes: [{ ...shape('a'), x: 100, y: 100, width: 200, height: 200 }] }] }
    const resized = resizePage(document.pages[0], 2000, 2000)
    expect(resized.nodes[0].x).toBe(200)
    expect(resized.nodes[0].width).toBe(400)
  })

  it('does not scale text boxes that only grow', () => {
    const node = text('t')
    expect(node.boxMode).toBe('fixed')
  })
})

import { DOCUMENT_VERSION, LIMITS } from '../constants'
import type {
  DesignDocument,
  FillSpec,
  GroupNode,
  ImageNode,
  Page,
  PageBackground,
  SceneNode,
  ShapeKind,
  ShapeNode,
  TextNode
} from '../types/document'
import { DEFAULT_IMAGE_FILTERS, NO_CURVE } from '../types/document'
import { aabbOf, bboxOf, round } from './geometry'
import { newId } from './ids'

export const solid = (color: string): FillSpec => ({ type: 'solid', color })
export const gradient = (stops: Array<{ color: string; offset: number }>, angle = 90): FillSpec => ({
  type: 'linear',
  color: stops[0]?.color ?? '#000000',
  stops,
  angle
})

export const defaultBackground = (color = '#FFFFFF'): PageBackground => ({ type: 'solid', color })

export function createPage(width: number, height: number, name = 'Page 1', background?: PageBackground): Page {
  return {
    id: newId('pg'),
    name,
    width: Math.round(width),
    height: Math.round(height),
    background: background ?? defaultBackground('#FFFFFF'),
    nodes: [],
    safeArea: 0
  }
}

export function createDocument(width: number, height: number, pageName = 'Page 1'): DesignDocument {
  return { version: DOCUMENT_VERSION, pages: [createPage(width, height, pageName)] }
}

export function createTextNode(partial: Partial<TextNode> & { x: number; y: number }): TextNode {
  const base: TextNode = {
    id: newId('tx'),
    kind: 'text',
    name: 'Text',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 420,
    height: 64,
    rotation: 0,
    opacity: 1,
    text: 'Double-click to edit',
    fontFamily: 'Inter',
    fontSize: 44,
    fontWeight: 700,
    italic: false,
    underline: false,
    strikethrough: false,
    align: 'center',
    valign: 'middle',
    letterSpacing: 0,
    lineHeight: 1.15,
    fill: solid('#111111'),
    stroke: null,
    curve: null,
    boxMode: 'fixed',
    padding: 0
  }
  return { ...base, ...partial, fill: partial.fill ?? base.fill }
}

export function createShapeNode(shape: ShapeKind, partial: Partial<ShapeNode> & { x: number; y: number }): ShapeNode {
  const base: ShapeNode = {
    id: newId('sh'),
    kind: 'shape',
    name: shape.charAt(0).toUpperCase() + shape.slice(1),
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    shape,
    fill: solid('#7C5CFF'),
    stroke: null,
    cornerRadius: 0,
    points: shape === 'star' ? 5 : shape === 'hexagon' ? 6 : undefined,
    thickness: shape === 'line' || shape === 'arrow' ? 4 : undefined
  }
  return { ...base, ...partial, fill: partial.fill ?? base.fill }
}

export function createImageNode(partial: Partial<ImageNode> & { x: number; y: number; src: string }): ImageNode {
  const base: ImageNode = {
    id: newId('im'),
    kind: 'image',
    name: 'Image',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    opacity: 1,
    src: partial.src,
    fit: 'cover',
    mask: 'none',
    filters: { ...DEFAULT_IMAGE_FILTERS },
    crop: null
  }
  return { ...base, ...partial, filters: { ...DEFAULT_IMAGE_FILTERS, ...(partial.filters ?? {}) } }
}

export function createGroupNode(children: SceneNode[]): GroupNode {
  const box = bboxOf(children) ?? { x: 0, y: 0, width: 100, height: 100 }
  return {
    id: newId('gr'),
    kind: 'group',
    name: 'Group',
    visible: true,
    locked: false,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
    rotation: 0,
    opacity: 1,
    children: children.map((child) => ({ ...child, x: round(child.x - box.x), y: round(child.y - box.y) }))
  }
}

/* ------------------------------ traversal ------------------------------ */

export interface NodeLocation {
  node: SceneNode
  parent: SceneNode[]
  index: number
}

export function findNodeLocation(nodes: SceneNode[], id: string): NodeLocation | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.id === id) return { node, parent: nodes, index: i }
    if (node.kind === 'group') {
      const inner = findNodeLocation(node.children, id)
      if (inner) return inner
    }
  }
  return null
}

export const findNode = (nodes: SceneNode[], id: string): SceneNode | null => findNodeLocation(nodes, id)?.node ?? null

export function flattenNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = []
  const walk = (list: SceneNode[]): void => {
    for (const node of list) {
      out.push(node)
      if (node.kind === 'group') walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** Immutably replace a node (by id) anywhere in the tree. */
export function updateNode(nodes: SceneNode[], id: string, patch: Partial<SceneNode> | ((n: SceneNode) => SceneNode)): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      const next = typeof patch === 'function' ? patch(node) : { ...node, ...patch }
      return { ...node, ...next } as SceneNode
    }
    if (node.kind === 'group') return { ...node, children: updateNode(node.children, id, patch) } as GroupNode
    return node
  })
}

export function removeNodes(nodes: SceneNode[], ids: string[]): SceneNode[] {
  const set = new Set(ids)
  return nodes
    .filter((node) => !set.has(node.id))
    .map((node) => (node.kind === 'group' ? ({ ...node, children: removeNodes(node.children, ids) } as GroupNode) : node))
}

export function insertNodes(nodes: SceneNode[], additions: SceneNode[], index?: number): SceneNode[] {
  const at = index === undefined ? nodes.length : Math.max(0, Math.min(index, nodes.length))
  return [...nodes.slice(0, at), ...additions, ...nodes.slice(at)]
}

export function replaceNode(nodes: SceneNode[], id: string, replacement: SceneNode): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) return replacement
    if (node.kind === 'group') return { ...node, children: replaceNode(node.children, id, replacement) } as GroupNode
    return node
  })
}

/** Deep-clone nodes with fresh ids (used by duplicate, copy/paste, pages). */
export function duplicateNodes(nodes: SceneNode[], offset = { x: 16, y: 16 }): SceneNode[] {
  const clone = (node: SceneNode): SceneNode => {
    const base = { ...node, id: newId(node.kind.slice(0, 2)) }
    if (node.kind === 'group') {
      return { ...base, children: node.children.map(clone) } as GroupNode
    }
    return base as SceneNode
  }
  return nodes.map((node) => {
    const next = clone(node)
    return { ...next, x: next.x + offset.x, y: next.y + offset.y } as SceneNode
  })
}

export type ReorderMode = 'front' | 'back' | 'up' | 'down'

export function reorderNodes(nodes: SceneNode[], id: string, mode: ReorderMode): SceneNode[] {
  const index = nodes.findIndex((n) => n.id === id)
  if (index === -1) {
    // Might live inside a group.
    return nodes.map((node) => (node.kind === 'group' ? ({ ...node, children: reorderNodes(node.children, id, mode) } as GroupNode) : node))
  }
  const next = [...nodes]
  const [node] = next.splice(index, 1)
  const target = mode === 'front' ? next.length : mode === 'back' ? 0 : mode === 'up' ? Math.min(next.length, index + 1) : Math.max(0, index - 1)
  next.splice(target, 0, node)
  return next
}

export function groupSelected(nodes: SceneNode[], ids: string[]): { nodes: SceneNode[]; groupId: string | null } {
  const selected = ids.filter((id) => nodes.some((n) => n.id === id))
  if (selected.length < 2) return { nodes, groupId: null }
  const members = nodes.filter((n) => selected.includes(n.id))
  const group = createGroupNode(members)
  const kept = nodes.filter((n) => !selected.includes(n.id))
  const firstIndex = nodes.findIndex((n) => n.id === selected[0])
  const next = [...kept.slice(0, Math.max(0, firstIndex)), group, ...kept.slice(Math.max(0, firstIndex))]
  return { nodes: next, groupId: group.id }
}

export function ungroupSelected(nodes: SceneNode[], groupId: string): { nodes: SceneNode[]; releasedIds: string[] } {
  const index = nodes.findIndex((n) => n.id === groupId && n.kind === 'group')
  if (index === -1) {
    const mapped = nodes.map((node) => {
      if (node.kind !== 'group') return node
      const inner = ungroupSelected(node.children, groupId)
      return { ...node, children: inner.nodes } as GroupNode
    })
    return { nodes: mapped, releasedIds: [] }
  }
  const group = nodes[index] as GroupNode
  const released = group.children.map((child) => ({
    ...child,
    x: round(child.x + group.x),
    y: round(child.y + group.y)
  })) as SceneNode[]
  const next = [...nodes.slice(0, index), ...released, ...nodes.slice(index + 1)]
  return { nodes: next, releasedIds: released.map((n) => n.id) }
}

/** Wrap loose top-level nodes into a group while preserving child geometry. */
export function groupFromAbsolute(nodes: SceneNode[], ids: string[]): GroupNode | null {
  const members = nodes.filter((n) => ids.includes(n.id))
  if (members.length === 0) return null
  const group = createGroupNode(members)
  return group
}

/* -------------------------------- pages -------------------------------- */

export function addPage(doc: DesignDocument, page?: Page): DesignDocument {
  if (doc.pages.length >= LIMITS.MAX_PAGES) return doc
  const reference = doc.pages[doc.pages.length - 1]
  const created = page ?? createPage(reference?.width ?? 1080, reference?.height ?? 1080, `Page ${doc.pages.length + 1}`)
  return { ...doc, pages: [...doc.pages, created] }
}

export function duplicatePage(doc: DesignDocument, pageId: string): DesignDocument {
  const index = doc.pages.findIndex((p) => p.id === pageId)
  if (index === -1 || doc.pages.length >= LIMITS.MAX_PAGES) return doc
  const source = doc.pages[index]
  const copy: Page = {
    ...structuredClone(source),
    id: newId('pg'),
    name: `${source.name} copy`,
    nodes: duplicateNodes(source.nodes, { x: 0, y: 0 })
  }
  const pages = [...doc.pages]
  pages.splice(index + 1, 0, copy)
  return { ...doc, pages }
}

export function removePage(doc: DesignDocument, pageId: string): DesignDocument {
  if (doc.pages.length <= 1) return doc
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) }
}

export function movePage(doc: DesignDocument, pageId: string, delta: number): DesignDocument {
  const index = doc.pages.findIndex((p) => p.id === pageId)
  const target = index + delta
  if (index === -1 || target < 0 || target >= doc.pages.length) return doc
  const pages = [...doc.pages]
  const [page] = pages.splice(index, 1)
  pages.splice(target, 0, page)
  return { ...doc, pages }
}

export const getPage = (doc: DesignDocument, pageId?: string | null): Page =>
  doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]

export function resizePage(page: Page, width: number, height: number, rescale = true): Page {
  const sx = rescale ? width / Math.max(1, page.width) : 1
  const sy = rescale ? height / Math.max(1, page.height) : 1
  const scaleNode = (node: SceneNode): SceneNode => {
    if (node.kind === 'group') return { ...node, children: node.children.map(scaleNode) } as SceneNode
    const next = {
      ...node,
      x: round(node.x * sx),
      y: round(node.y * sy),
      width: round(Math.max(1, node.width * sx)),
      height: round(Math.max(1, node.height * sy))
    }
    if (node.kind === 'text') return { ...next, fontSize: Math.max(4, round(node.fontSize * Math.min(sx, sy))) } as SceneNode
    return next as SceneNode
  }
  return { ...page, width: Math.round(width), height: Math.round(height), nodes: page.nodes.map(scaleNode) }
}

/* ------------------------------ node stats ------------------------------ */

export function countNodes(doc: DesignDocument): number {
  return doc.pages.reduce((acc, page) => acc + flattenNodes(page.nodes).length, 0)
}

export function nodeSummary(node: SceneNode): string {
  if (node.kind === 'text') return node.text.replace(/\s+/g, ' ').slice(0, 42) || 'Empty text'
  if (node.kind === 'image') return node.name || 'Image'
  if (node.kind === 'group') return `${node.children.length} layers`
  return node.name
}

export function isNodeSelectable(node: SceneNode): boolean {
  return node.visible && !node.locked
}

export function nodeBounds(node: SceneNode): { x: number; y: number; width: number; height: number } {
  return aabbOf(node)
}

export const curvePresets = NO_CURVE

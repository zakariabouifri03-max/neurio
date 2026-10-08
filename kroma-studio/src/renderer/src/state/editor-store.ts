import { create } from 'zustand'
import { LIMITS } from '../../../shared/constants'
import type { DesignDocument, Page, SceneNode } from '../../../shared/types/document'
import {
  addPage,
  duplicateNodes,
  duplicatePage,
  findNode,
  flattenNodes,
  getPage,
  groupSelected,
  movePage,
  removeNodes,
  removePage,
  reorderNodes,
  resizePage,
  ungroupSelected,
  updateNode
} from '../../../shared/utils/document'
import { clamp, round } from '../../../shared/utils/geometry'
import { newId } from '../../../shared/utils/ids'
import { History, cloneDocument } from './history'

export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

export interface EditorSnapshot {
  document: DesignDocument
  activePageId: string
  selection: string[]
}

export interface EditorState {
  document: DesignDocument | null
  activePageId: string
  selection: string[]
  /** ids being edited inline (text) */
  editingNodeId: string | null
  viewport: Viewport
  zoomMode: 'fit' | 'manual'
  hoverNodeId: string | null

  /* history */
  canUndo: boolean
  canRedo: boolean
  dirty: boolean

  /* actions: lifecycle */
  loadDocument: (document: DesignDocument, pageId?: string) => void
  reset: () => void

  /* actions: pages */
  addPage: (page?: Partial<Page>) => void
  duplicateActivePage: () => void
  deletePage: (pageId: string) => void
  setActivePage: (pageId: string) => void
  reorderPage: (pageId: string, delta: -1 | 1) => void
  renamePage: (pageId: string, name: string) => void
  resizeActivePage: (width: number, height: number, rescale: boolean) => void
  updatePageBackground: (pageId: string, patch: Partial<Page['background']>) => void
  updatePage: (pageId: string, patch: Partial<Page>) => void

  /* actions: nodes */
  addNodes: (nodes: SceneNode[], options?: { select?: boolean; pageId?: string }) => void
  updateNodes: (patches: Array<{ id: string; patch: Partial<SceneNode> }>, options?: { label?: string; coalesceMs?: number }) => void
  replaceNode: (id: string, node: SceneNode, label?: string) => void
  deleteNodes: (ids?: string[]) => void
  duplicateSelection: () => void
  reorderSelection: (mode: 'front' | 'back' | 'up' | 'down') => void
  groupSelection: () => void
  ungroupSelection: () => void
  toggleNodeFlag: (id: string, flag: 'visible' | 'locked') => void
  renameNode: (id: string, name: string) => void

  /* actions: selection */
  select: (ids: string[], mode?: 'replace' | 'toggle' | 'add') => void
  selectAll: () => void
  clearSelection: () => void
  setHover: (id: string | null) => void
  setEditing: (id: string | null) => void

  /* actions: viewport */
  setViewport: (viewport: Partial<Viewport>) => void
  zoomBy: (factor: number, center?: { x: number; y: number }) => void
  setZoom: (zoom: number) => void
  fitToScreen: (viewportSize: { width: number; height: number }, padding?: number) => void

  /* history */
  commit: (label: string, coalesceMs?: number) => void
  undo: () => void
  redo: () => void
  markSaved: () => void

  /* derived helpers */
  activePage: () => Page | null
  selectedNodes: () => SceneNode[]
  nodeById: (id: string) => SceneNode | null
}

const history = new History()

const clampZoom = (zoom: number): number => clamp(zoom, 0.02, 64)

function snapshot(state: Pick<EditorState, 'document' | 'activePageId' | 'selection'>, label: string): HistoryEntryLike | null {
  if (!state.document) return null
  return {
    document: cloneDocument(state.document),
    activePageId: state.activePageId,
    selection: [...state.selection],
    label,
    at: Date.now()
  }
}

type HistoryEntryLike = Parameters<History['push']>[0]

function pushHistory(label: string, coalesceMs = 0): void {
  const state = useEditorStore.getState()
  if (!state.document) return
  const entry = snapshot(state, label)
  if (!entry) return
  history.push(entry, coalesceMs)
  void syncHistoryFlags()
}

async function syncHistoryFlags(): Promise<void> {
  const state = useEditorStore.getState()
  useEditorStore.setState({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    dirty: state.document ? history.isDirty(state.document) : false
  })
}

/**
 * Apply a document mutation, recording an undo entry first.
 * `previous` is the state before the change (captured by the caller).
 */
function mutate(
  updater: (document: DesignDocument) => DesignDocument,
  options: { label: string; coalesceMs?: number; previous: Pick<EditorState, 'document' | 'activePageId' | 'selection'> }
): void {
  const entry = snapshot(options.previous, options.label)
  const current = useEditorStore.getState()
  if (!current.document) return
  const next = updater(current.document)
  if (next === current.document) return
  if (entry) history.push(entry, options.coalesceMs ?? 0)
  useEditorStore.setState({ document: next })
  void syncHistoryFlags()
}

const replacePage = (document: DesignDocument, pageId: string, updater: (page: Page) => Page): DesignDocument => ({
  ...document,
  pages: document.pages.map((page) => (page.id === pageId ? updater(page) : page))
})

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null,
  activePageId: '',
  selection: [],
  editingNodeId: null,
  viewport: { zoom: 1, panX: 0, panY: 0 },
  zoomMode: 'fit',
  hoverNodeId: null,
  canUndo: false,
  canRedo: false,
  dirty: false,

  loadDocument: (document, pageId) => {
    const page = getPage(document, pageId)
    set({ document, activePageId: page.id, selection: [], editingNodeId: null, zoomMode: 'fit' })
    history.reset({
      document: cloneDocument(document),
      activePageId: page.id,
      selection: [],
      label: 'open',
      at: Date.now()
    })
    void syncHistoryFlags()
  },

  reset: () => {
    history.clear()
    set({ document: null, activePageId: '', selection: [], editingNodeId: null, dirty: false, canUndo: false, canRedo: false })
  },

  addPage: (partial) => {
    const previous = get()
    mutate(
      (document) =>
        addPage(
          document,
          partial
            ? ({
                id: newId('pg'),
                name: partial.name ?? `Page ${document.pages.length + 1}`,
                width: partial.width ?? document.pages[0]?.width ?? 1080,
                height: partial.height ?? document.pages[0]?.height ?? 1080,
                background: partial.background ?? { type: 'solid', color: '#FFFFFF' },
                nodes: partial.nodes ?? [],
                safeArea: partial.safeArea ?? 0
              } satisfies Page)
            : undefined
        ),
      { label: 'add page', previous }
    )
    const document = get().document
    if (document) set({ activePageId: document.pages.at(-1)!.id, selection: [] })
  },

  duplicateActivePage: () => {
    const previous = get()
    mutate((document) => duplicatePage(document, previous.activePageId), { label: 'duplicate page', previous })
    const state = get()
    const index = state.document!.pages.findIndex((p) => p.id === previous.activePageId)
    set({ activePageId: state.document!.pages[index + 1]?.id ?? state.activePageId })
  },

  deletePage: (pageId) => {
    const previous = get()
    const current = get().document
    if (!current || current.pages.length <= 1) return
    mutate((document) => removePage(document, pageId), { label: 'delete page', previous })
    const state = get()
    if (state.activePageId === pageId) set({ activePageId: state.document!.pages[0].id, selection: [] })
  },

  setActivePage: (pageId) => {
    if (get().activePageId === pageId) return
    set({ activePageId: pageId, selection: [], editingNodeId: null })
  },

  reorderPage: (pageId, delta) => {
    const previous = get()
    mutate((document) => movePage(document, pageId, delta), { label: 'reorder page', previous })
  },

  renamePage: (pageId, name) => {
    const previous = get()
    mutate((document) => replacePage(document, pageId, (page) => ({ ...page, name })), { label: 'rename page', previous })
  },

  resizeActivePage: (width, height, rescale) => {
    const previous = get()
    const pageId = previous.activePageId
    mutate((document) => replacePage(document, pageId, (page) => resizePage(page, round(width), round(height), rescale)), {
      label: 'resize page',
      previous
    })
  },

  updatePageBackground: (pageId, patch) => {
    const previous = get()
    mutate((document) => replacePage(document, pageId, (page) => ({ ...page, background: { ...page.background, ...patch } })), {
      label: 'page background',
      previous
    })
  },

  updatePage: (pageId, patch) => {
    const previous = get()
    mutate((document) => replacePage(document, pageId, (page) => ({ ...page, ...patch })), { label: 'page settings', previous })
  },

  addNodes: (nodes, options) => {
    if (nodes.length === 0) return
    const previous = get()
    const pageId = options?.pageId ?? previous.activePageId
    mutate(
      (document) =>
        replacePage(document, pageId, (page) => ({
          ...page,
          nodes: [...page.nodes.slice(0, Math.max(0, LIMITS.MAX_NODES_PER_PAGE - nodes.length)), ...nodes]
        })),
      { label: `add ${nodes.length === 1 ? nodes[0].kind : 'objects'}`, previous }
    )
    if (options?.select !== false) set({ selection: nodes.map((n) => n.id) })
  },

  updateNodes: (patches, options) => {
    if (patches.length === 0) return
    const previous = get()
    const pageId = previous.activePageId
    mutate(
      (document) =>
        replacePage(document, pageId, (page) => {
          let nodes = page.nodes
          for (const { id, patch } of patches) nodes = updateNode(nodes, id, patch)
          return { ...page, nodes }
        }),
      { label: options?.label ?? 'edit object', coalesceMs: options?.coalesceMs, previous }
    )
  },

  replaceNode: (id, node, label) => {
    const previous = get()
    const pageId = previous.activePageId
    mutate(
      (document) =>
        replacePage(document, pageId, (page) => ({
          ...page,
          nodes: page.nodes.map((n) => (n.id === id ? node : n))
        })),
      { label: label ?? 'replace object', previous }
    )
  },

  deleteNodes: (ids) => {
    const state = get()
    if (!state.document) return
    const target = ids ?? state.selection
    if (target.length === 0) return
    const previous = state
    const pageId = previous.activePageId
    mutate((document) => replacePage(document, pageId, (page) => ({ ...page, nodes: removeNodes(page.nodes, target) })), {
      label: 'delete',
      previous
    })
    set({ selection: get().selection.filter((id) => !target.includes(id)), editingNodeId: null })
  },

  duplicateSelection: () => {
    const state = get()
    const page = state.activePage()
    if (!page || state.selection.length === 0) return
    const copies = duplicateNodes(page.nodes.filter((n) => state.selection.includes(n.id)))
    state.addNodes(copies)
    set({ selection: copies.map((n) => n.id) })
  },

  reorderSelection: (mode) => {
    const previous = get()
    const pageId = previous.activePageId
    mutate(
      (document) =>
        replacePage(document, pageId, (page) => {
          let nodes = page.nodes
          for (const id of previous.selection) nodes = reorderNodes(nodes, id, mode)
          return { ...page, nodes }
        }),
      { label: `reorder ${mode}`, previous }
    )
  },

  groupSelection: () => {
    const previous = get()
    const pageId = previous.activePageId
    let groupId: string | null = null
    mutate(
      (document) =>
        replacePage(document, pageId, (page) => {
          const result = groupSelected(page.nodes, previous.selection)
          groupId = result.groupId
          return { ...page, nodes: result.nodes }
        }),
      { label: 'group', previous }
    )
    if (groupId) set({ selection: [groupId] })
  },

  ungroupSelection: () => {
    const previous = get()
    const pageId = previous.activePageId
    const released: string[] = []
    mutate(
      (document) =>
        replacePage(document, pageId, (page) => {
          let nodes = page.nodes
          for (const id of previous.selection) {
            const result = ungroupSelected(nodes, id)
            nodes = result.nodes
            released.push(...result.releasedIds)
          }
          return { ...page, nodes }
        }),
      { label: 'ungroup', previous }
    )
    if (released.length) set({ selection: released })
  },

  toggleNodeFlag: (id, flag) => {
    const state = get()
    const node = state.nodeById(id)
    if (!node) return
    state.updateNodes([{ id, patch: { [flag]: !node[flag] } as Partial<SceneNode> }], { label: `${flag} toggle` })
  },

  renameNode: (id, name) => {
    const state = get()
    state.updateNodes([{ id, patch: { name } as Partial<SceneNode> }], { label: 'rename layer' })
  },

  select: (ids, mode = 'replace') => {
    const state = get()
    if (mode === 'replace') {
      set({ selection: ids })
      return
    }
    if (mode === 'toggle') {
      const next = new Set(state.selection)
      for (const id of ids) (next.has(id) ? next.delete(id) : next.add(id))
      set({ selection: [...next] })
      return
    }
    set({ selection: Array.from(new Set([...state.selection, ...ids])) })
  },

  selectAll: () => {
    const page = get().activePage()
    if (!page) return
    set({ selection: page.nodes.filter((n) => n.visible && !n.locked).map((n) => n.id) })
  },

  clearSelection: () => set({ selection: [], editingNodeId: null }),
  setHover: (id) => set({ hoverNodeId: id }),
  setEditing: (id) => set({ editingNodeId: id, selection: id ? [id] : get().selection }),

  setViewport: (viewport) => {
    const current = get().viewport
    set({ viewport: { ...current, ...viewport, zoom: clampZoom(viewport.zoom ?? current.zoom) }, zoomMode: 'manual' })
  },

  setZoom: (zoom) => {
    set({ viewport: { ...get().viewport, zoom: clampZoom(zoom) }, zoomMode: 'manual' })
  },

  zoomBy: (factor) => {
    set({ viewport: { ...get().viewport, zoom: clampZoom(get().viewport.zoom * factor) }, zoomMode: 'manual' })
  },

  fitToScreen: (viewportSize, padding = 96) => {
    const page = get().activePage()
    if (!page || viewportSize.width <= 0 || viewportSize.height <= 0) return
    const zoom = clampZoom(
      Math.min((viewportSize.width - padding) / page.width, (viewportSize.height - padding) / page.height)
    )
    set({
      viewport: {
        zoom,
        panX: viewportSize.width / 2 - (page.width * zoom) / 2,
        panY: viewportSize.height / 2 - (page.height * zoom) / 2
      },
      zoomMode: 'fit'
    })
  },

  commit: (label, coalesceMs) => pushHistory(label, coalesceMs),

  undo: () => {
    const state = get()
    if (!state.document) return
    const current = snapshot(state, 'current')
    if (!current) return
    const previous = history.undo(current)
    if (!previous) return
    set({ document: previous.document, activePageId: previous.activePageId, selection: previous.selection, editingNodeId: null })
    void syncHistoryFlags()
  },

  redo: () => {
    const state = get()
    if (!state.document) return
    const current = snapshot(state, 'current')
    if (!current) return
    const next = history.redo(current)
    if (!next) return
    set({ document: next.document, activePageId: next.activePageId, selection: next.selection, editingNodeId: null })
    void syncHistoryFlags()
  },

  markSaved: () => {
    const state = get()
    if (!state.document) return
    history.markSaved({ document: cloneDocument(state.document), activePageId: state.activePageId, selection: [...state.selection], label: 'saved', at: Date.now() })
    void syncHistoryFlags()
  },

  activePage: () => {
    const state = get()
    if (!state.document) return null
    return getPage(state.document, state.activePageId)
  },

  selectedNodes: () => {
    const state = get()
    const page = state.activePage()
    if (!page) return []
    return flattenNodes(page.nodes).filter((n) => state.selection.includes(n.id))
  },

  nodeById: (id) => {
    const page = get().activePage()
    if (!page) return null
    const direct = findNode(page.nodes, id)
    if (direct) return direct
    return flattenNodes(page.nodes).find((n) => n.id === id) ?? null
  }
}))

export { history as editorHistory }

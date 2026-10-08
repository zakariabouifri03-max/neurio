import { useCallback, useMemo } from 'react'
import type { ImageNode, Page, SceneNode, ShapeKind, ShapeNode, TextNode } from '../../../shared/types/document'
import { DEFAULT_IMAGE_FILTERS, type MaskKind } from '../../../shared/types/document'
import { createImageNode, createShapeNode, createTextNode, duplicateNodes, solid } from '../../../shared/utils/document'
import { alignNodes, bboxOf, distributeNodes, fitRect, round, type AlignMode, type DistributeMode } from '../../../shared/utils/geometry'
import { readableOn } from '../../../shared/utils/color'
import { newId } from '../../../shared/utils/ids'
import { useEditorStore } from '../state/editor-store'
import { useUiStore, notify } from '../state/ui-store'
import { useAppStore } from '../state/app-store'

/**
 * Every canvas mutation that is not a plain property edit lives here so the UI,
 * keyboard shortcuts and the context menu all share one code path.
 */
export function useEditorActions() {
  const page = useCallback((): Page | null => useEditorStore.getState().activePage(), [])

  const centerOfPage = useCallback(
    (width: number, height: number) => {
      const current = page()
      if (!current) return { x: 0, y: 0 }
      return { x: round(current.width / 2 - width / 2), y: round(current.height / 2 - height / 2) }
    },
    [page]
  )

  const addNodes = useCallback((nodes: SceneNode[], select = true) => {
    useEditorStore.getState().addNodes(nodes, { select })
  }, [])

  const addText = useCallback(
    (options?: Partial<TextNode>) => {
      const current = page()
      if (!current) return null
      const fontSize = options?.fontSize ?? Math.max(24, Math.round(Math.min(current.width, current.height) * 0.09))
      const width = options?.width ?? Math.round(current.width * 0.7)
      const at = centerOfPage(width, fontSize * 2)
      const baseColor =
        current.background.type === 'transparent' ? '#FFFFFF' : readableOn(current.background.color || '#FFFFFF')
      const node = createTextNode({
        ...options,
        text: options?.text ?? 'Double-click to edit',
        x: at.x,
        y: at.y,
        width,
        height: Math.max(fontSize * 1.6, options?.height ?? fontSize * 2),
        fontSize,
        fontFamily: options?.fontFamily ?? 'Inter',
        fill: options?.fill ?? solid(baseColor),
        align: options?.align ?? 'center'
      })
      addNodes([node])
      return node
    },
    [addNodes, centerOfPage, page]
  )

  const addShape = useCallback(
    (kind: ShapeKind, options?: Partial<SceneNode>) => {
      const current = page()
      if (!current) return null
      const size = Math.round(Math.min(current.width, current.height) * 0.32)
      const at = centerOfPage(size, size)
      const node = createShapeNode(kind, {
        ...(options as Partial<ShapeNode> | undefined),
        x: at.x,
        y: at.y,
        width: size,
        height: kind === 'line' ? Math.max(4, size * 0.12) : size
      })
      addNodes([node])
      return node
    },
    [addNodes, centerOfPage, page]
  )

  const addImage = useCallback(
    (src: string, natural?: { width: number; height: number }) => {
      const current = page()
      if (!current) return null
      const fit = fitRect(natural ?? { width: 1200, height: 900 }, { x: 0, y: 0, width: current.width * 0.8, height: current.height * 0.8 }, 'contain')
      const width = Math.round(natural ? natural.width * fit.scale : current.width * 0.6)
      const height = Math.round(natural ? natural.height * fit.scale : current.height * 0.6)
      const at = centerOfPage(width, height)
      const node = createImageNode({
        src,
        x: at.x,
        y: at.y,
        width,
        height,
        naturalWidth: natural?.width,
        naturalHeight: natural?.height
      })
      addNodes([node])
      return node
    },
    [addNodes, centerOfPage, page]
  )

  const align = useCallback(
    (mode: AlignMode) => {
      const state = useEditorStore.getState()
      const current = page()
      if (!current || state.selection.length === 0) return
      const selected = current.nodes.filter((node) => state.selection.includes(node.id))
      if (selected.length === 0) return
      const container = selected.length === 1 ? { x: 0, y: 0, width: current.width, height: current.height } : bboxOf(selected) ?? undefined
      const aligned = alignNodes(selected, mode, container)
      state.updateNodes(aligned.map((node) => ({ id: node.id, patch: { x: node.x, y: node.y } })), { label: `align ${mode}` })
    },
    [page]
  )

  const distribute = useCallback(
    (mode: DistributeMode) => {
      const state = useEditorStore.getState()
      const current = page()
      if (!current || state.selection.length < 3) return
      const selected = current.nodes.filter((node) => state.selection.includes(node.id))
      const result = distributeNodes(selected, mode)
      state.updateNodes(result.map((node) => ({ id: node.id, patch: { x: node.x, y: node.y } })), { label: `distribute ${mode}` })
    },
    [page]
  )

  const setMask = useCallback((mask: MaskKind) => {
    const state = useEditorStore.getState()
    state.updateNodes(state.selection.map((id) => ({ id, patch: { mask } as Partial<ImageNode> })), { label: 'mask' })
  }, [])

  const flip = useCallback(
    (axis: 'x' | 'y') => {
      const state = useEditorStore.getState()
      const current = page()
      if (!current) return
      const patches = state.selection
        .map((id) => current.nodes.find((node) => node.id === id))
        .filter((node): node is SceneNode => Boolean(node))
        .map((node) => ({
          id: node.id,
          patch: (axis === 'x' ? { flipX: !node.flipX } : { flipY: !node.flipY }) as Partial<SceneNode>
        }))
      state.updateNodes(patches, { label: `flip ${axis}` })
    },
    [page]
  )

  const resetImageFilters = useCallback(() => {
    const state = useEditorStore.getState()
    state.updateNodes(state.selection.map((id) => ({ id, patch: { filters: { ...DEFAULT_IMAGE_FILTERS } } })), { label: 'reset adjustments' })
  }, [])

  const copy = useCallback(() => {
    const state = useEditorStore.getState()
    const current = page()
    if (!current) return
    const nodes = current.nodes.filter((node) => state.selection.includes(node.id))
    if (nodes.length === 0) return
    useUiStore.getState().setClipboard(nodes)
    notify.info(`Copied ${nodes.length} object${nodes.length > 1 ? 's' : ''}`)
  }, [page])

  const paste = useCallback(() => {
    const clipboard = useUiStore.getState().clipboard as SceneNode[] | null
    if (!clipboard?.length) return
    const copies = duplicateNodes(clipboard, { x: 24, y: 24 })
    useEditorStore.getState().addNodes(copies)
    notify.success(`Pasted ${copies.length} object${copies.length > 1 ? 's' : ''}`)
  }, [])

  const duplicate = useCallback(() => {
    const state = useEditorStore.getState()
    if (state.selection.length === 0) return
    state.duplicateSelection()
  }, [])

  const remove = useCallback(() => {
    const state = useEditorStore.getState()
    if (state.selection.length === 0) return
    state.deleteNodes()
  }, [])

  const group = useCallback(() => {
    const state = useEditorStore.getState()
    if (state.selection.length < 2) {
      notify.warning('Select two or more objects to group them.')
      return
    }
    state.groupSelection()
  }, [])

  const ungroup = useCallback(() => {
    useEditorStore.getState().ungroupSelection()
  }, [])

  const selectAll = useCallback(() => {
    useEditorStore.getState().selectAll()
  }, [])

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const state = useEditorStore.getState()
      const current = page()
      if (!current || state.selection.length === 0) return
      const patches = state.selection
        .map((id) => current.nodes.find((node) => node.id === id))
        .filter((node): node is SceneNode => node !== undefined && !node.locked)
        .map((node) => ({ id: node.id, patch: { x: round(node.x + dx), y: round(node.y + dy) } }))
      if (patches.length) state.updateNodes(patches, { label: 'nudge', coalesceMs: 400 })
    },
    [page]
  )

  const setPageBackground = useCallback((patch: Partial<Page['background']>) => {
    const state = useEditorStore.getState()
    state.updatePageBackground(state.activePageId, patch)
  }, [])

  const toggleSafeArea = useCallback(() => {
    const settings = useAppStore.getState().settings
    void useAppStore
      .getState()
      .updateSettings({ appearance: { ...settings.appearance, showSafeArea: !settings.appearance.showSafeArea } })
  }, [])

  return useMemo(
    () => ({
      addNodes,
      addText,
      addShape,
      addImage,
      align,
      distribute,
      setMask,
      flip,
      resetImageFilters,
      copy,
      paste,
      duplicate,
      remove,
      group,
      ungroup,
      selectAll,
      nudge,
      setPageBackground,
      toggleSafeArea,
      newId
    }),
    [
      addNodes,
      addText,
      addShape,
      addImage,
      align,
      distribute,
      setMask,
      flip,
      resetImageFilters,
      copy,
      paste,
      duplicate,
      remove,
      group,
      ungroup,
      selectAll,
      nudge,
      setPageBackground,
      toggleSafeArea
    ]
  )
}

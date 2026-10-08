import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DesignDocument, SceneNode, TextNode } from '../../../../shared/types/document'
import { Engine, type OverlayStyle } from '../../canvas/engine/Engine'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { useUiStore } from '../../state/ui-store'
import { imageCache } from '../../canvas/engine/image-cache'
import { platform } from '../../platform'
import { notify } from '../../state/ui-store'
import { assetUrl } from '../../../../shared/constants'
import { isSafeDataUrl } from '../../../../shared/utils/validation'
import { createImageNode } from '../../../../shared/utils/document'
import { CanvasContextMenu, type ContextMenuTarget } from './CanvasContextMenu'
import { TextEditorOverlay } from './TextEditorOverlay'
import { EmptyCanvasHint } from './EmptyCanvasHint'

export interface CanvasStageProps {
  document: DesignDocument
  onSave: () => void
  onOpenImage: (paths: string[], at?: { x: number; y: number }) => void
}

const styleFromAccent = (accent: string): OverlayStyle => ({
  accent,
  accentSoft: `${accent}44`,
  guide: '#FF3D8B',
  handle: accent,
  handleFill: '#FFFFFF'
})

export function CanvasStage({ document: doc, onSave, onOpenImage }: CanvasStageProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const fittedFor = useRef<string>('')

  const selection = useEditorStore((state) => state.selection)
  const activePageId = useEditorStore((state) => state.activePageId)
  const editingNodeId = useEditorStore((state) => state.editingNodeId)
  const viewport = useEditorStore((state) => state.viewport)
  const fitRequest = useUiStore((state) => state.fitRequest)
  const imageCacheMb = useAppStore((state) => state.settings.performance.imageCacheSizeMb)

  /** Adds a decoded data URL / asset id as an image node at a page point. */
  const insertImage = useCallback(async (src: string, at: { x: number; y: number }, natural?: { width: number; height: number }) => {
    const page = useEditorStore.getState().activePage()
    if (!page) return
    let width = page.width * 0.6
    let height = page.height * 0.6
    if (natural?.width && natural?.height) {
      const scale = Math.min((page.width * 0.8) / natural.width, (page.height * 0.8) / natural.height)
      width = natural.width * scale
      height = natural.height * scale
    }
    const node = createImageNode({
      src,
      x: Math.round(at.x - width / 2),
      y: Math.round(at.y - height / 2),
      width: Math.round(width),
      height: Math.round(height),
      naturalWidth: natural?.width,
      naturalHeight: natural?.height
    })
    useEditorStore.getState().addNodes([node])
  }, [])

  useLayoutEffect(() => {
    if (!canvasRef.current || !overlayRef.current) return
    const engine = new Engine({
      canvas: canvasRef.current,
      overlay: overlayRef.current,
      onSelectionChange: (ids) => useEditorStore.getState().select(ids),
      onNodesChange: (patches, options) => useEditorStore.getState().updateNodes(patches, options),
      onHoverChange: (id) => useEditorStore.getState().setHover(id),
      onRequestTextEdit: (id) => useEditorStore.getState().setEditing(id),
      onDropFiles: (paths, point) => onOpenImage(paths, point),
      onContextMenu: (point, nodeId) => {
        setContextMenu({ x: 0, y: 0, target: { nodeId, pagePoint: point, pageId: useEditorStore.getState().activePageId } })
      },
      getSettings: () => {
        const appearance = useAppStore.getState().settings.appearance
        return {
          showGrid: appearance.showGrid,
          showGuides: appearance.showGuides,
          showSafeArea: appearance.showSafeArea,
          snapToGrid: appearance.snapToGrid,
          snapToObjects: appearance.snapToObjects,
          gridSize: appearance.gridSize
        }
      },
      getStyle: () => styleFromAccent(useAppStore.getState().settings.appearance.accent)
    })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [onOpenImage])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width, height })
      engineRef.current?.resize(width, height)
    })
    observer.observe(host)
    const rect = host.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
    engineRef.current?.resize(rect.width, rect.height)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    engineRef.current?.setState({
      document: doc,
      pageId: activePageId,
      selection,
      editingNodeId,
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY
    })
  }, [doc, activePageId, selection, editingNodeId, viewport])

  useEffect(() => {
    const state = useEditorStore.getState()
    if (state.zoomMode !== 'fit') return
    const key = `${activePageId}:${Math.round(size.width)}x${Math.round(size.height)}`
    if (fittedFor.current === key || size.width < 40) return
    fittedFor.current = key
    state.fitToScreen(size)
  }, [activePageId, size])

  useEffect(() => {
    if (fitRequest === 0) return
    fittedFor.current = ''
    useEditorStore.getState().fitToScreen(size)
  }, [fitRequest, size])

  useEffect(() => {
    imageCache.setBudget(imageCacheMb)
  }, [imageCacheMb])

  /* ------------------------------- shortcuts ------------------------------ */

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const state = useEditorStore.getState()
      const meta = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (meta && key === 's') {
        event.preventDefault()
        onSave()
        return
      }
      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (meta && key === 'y') {
        event.preventDefault()
        state.redo()
        return
      }
      if (meta && key === 'a') {
        event.preventDefault()
        state.selectAll()
        return
      }
      if (state.editingNodeId) {
        if (event.key === 'Escape') {
          event.preventDefault()
          state.setEditing(null)
        }
        return
      }
      if (event.key === 'Escape') {
        state.clearSelection()
        return
      }
      if (meta && key === 'd') {
        event.preventDefault()
        state.duplicateSelection()
        return
      }
      if (meta && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) state.ungroupSelection()
        else state.groupSelection()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        state.deleteNodes()
        return
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        const page = state.activePage()
        if (!page) return
        const patches = state.selection
          .map((id) => page.nodes.find((node) => node.id === id))
          .filter((node): node is SceneNode => node !== undefined && !node.locked)
          .map((node) => ({ id: node.id, patch: { x: node.x + dx, y: node.y + dy } }))
        if (patches.length) state.updateNodes(patches, { label: 'nudge', coalesceMs: 400 })
      }
    },
    [onSave]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  /* ---------------------------- paste / drop ------------------------------ */

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          void (async () => {
            try {
              const dataUrl = String(reader.result)
              if (!isSafeDataUrl(dataUrl)) throw new Error('Unsupported image format.')
              const asset = await platform.assets.importDataUrl(dataUrl, 'pasted-image.png')
              const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
              const page = useEditorStore.getState().activePage()
              if (!page) return
              await insertImage(
                src,
                { x: page.width / 2, y: page.height / 2 },
                asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined
              )
              notify.success('Pasted image added to canvas')
            } catch (error) {
              notify.error('Could not paste that image', error instanceof Error ? error.message : undefined)
            }
          })()
        }
        reader.readAsDataURL(file)
        return
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [insertImage])

  const editingNode = useMemo<TextNode | null>(() => {
    if (!editingNodeId) return null
    const node = useEditorStore.getState().nodeById(editingNodeId)
    return node && node.kind === 'text' ? node : null
  }, [editingNodeId, doc])

  const activePage = doc.pages.find((page) => page.id === activePageId) ?? doc.pages[0]

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 30%, #14141f 0%, #0a0a11 70%)'
      }}
      onMouseDown={() => setContextMenu(null)}
      onContextMenu={(event) => {
        event.preventDefault()
        const engine = engineRef.current
        const rect = hostRef.current?.getBoundingClientRect()
        if (!engine || !rect) return
        const pagePoint = engine.toPage({ x: event.clientX - rect.left, y: event.clientY - rect.top })
        const hit = engine.nodeAt(pagePoint)
        setContextMenu({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          target: { nodeId: hit?.id ?? null, pageId: activePageId, pagePoint }
        })
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />
      <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, display: 'block', touchAction: 'none' }} />

      {activePage && activePage.nodes.length === 0 ? <EmptyCanvasHint /> : null}
      {editingNode ? <TextEditorOverlay node={editingNode} viewport={viewport} /> : null}
      {contextMenu ? (
        <CanvasContextMenu x={contextMenu.x} y={contextMenu.y} target={contextMenu.target} onClose={() => setContextMenu(null)} />
      ) : null}
    </div>
  )
}

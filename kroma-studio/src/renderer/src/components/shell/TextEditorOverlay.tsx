import { useEffect, useLayoutEffect, useRef } from 'react'
import type { TextNode } from '../../../../shared/types/document'
import { useEditorStore } from '../../state/editor-store'

/**
 * Inline text editing.
 *
 * A transparent contenteditable is placed exactly over the node's on-screen box
 * and styled with the node's font metrics, so what the user types matches the
 * canvas rendering (including line-height, letter spacing and alignment).
 */
export function TextEditorOverlay({
  node,
  viewport
}: {
  node: TextNode
  viewport: { zoom: number; panX: number; panY: number }
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const committed = useRef(false)

  const screenX = node.x * viewport.zoom + viewport.panX
  const screenY = node.y * viewport.zoom + viewport.panY
  const width = node.width * viewport.zoom
  const height = node.height * viewport.zoom

  useLayoutEffect(() => {
    committed.current = false
    const element = ref.current
    if (!element) return
    element.textContent = node.text
    element.focus()
    // Put the caret at the end so typing continues the text.
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [node.id])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (document.activeElement !== element) return
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [viewport.zoom, viewport.panX, viewport.panY])

  useEffect(() => {
    const commit = (): void => {
      const element = ref.current
      if (!element || committed.current) return
      committed.current = true
      const text = element.textContent ?? ''
      const state = useEditorStore.getState()
      const current = state.nodeById(node.id)
      if (current && current.kind === 'text' && current.text === text) {
        state.setEditing(null)
        return
      }
      state.updateNodes([{ id: node.id, patch: { text } as Partial<TextNode> }], { label: 'edit text' })
      state.setEditing(null)
    }
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', commit, { once: true })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousedown', commit)
    }
  }, [node.id])

  const alignMap = { left: 'left', center: 'center', right: 'right' } as const

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label="Edit text"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          useEditorStore.getState().setEditing(null)
          return
        }
        // Keep native shortcuts (bold/italic are handled in the properties panel).
        if ((event.ctrlKey || event.metaKey) && (event.key === 'b' || event.key === 'i' || event.key === 'u')) {
          event.preventDefault()
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={() => {
        const element = ref.current
        if (!element || committed.current) return
        committed.current = true
        const text = element.textContent ?? ''
        const state = useEditorStore.getState()
        const current = state.nodeById(node.id)
        if (current && current.kind === 'text' && current.text !== text) {
          state.updateNodes([{ id: node.id, patch: { text } as Partial<TextNode> }], { label: 'edit text' })
        }
        state.setEditing(null)
      }}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width,
        height,
        outline: '2px solid var(--k-accent)',
        outlineOffset: 1,
        background: 'rgba(124,92,255,0.06)',
        color: node.fill.type === 'solid' ? node.fill.color : node.fill.stops?.[0]?.color ?? node.fill.color,
        fontFamily: `"${node.fontFamily}", Inter, sans-serif`,
        fontSize: node.fontSize * viewport.zoom,
        fontWeight: node.fontWeight,
        fontStyle: node.italic ? 'italic' : 'normal',
        letterSpacing: node.letterSpacing * viewport.zoom,
        lineHeight: `${node.fontSize * node.lineHeight * viewport.zoom}px`,
        textAlign: alignMap[node.align],
        display: 'flex',
        flexDirection: 'column',
        justifyContent: node.valign === 'top' ? 'flex-start' : node.valign === 'bottom' ? 'flex-end' : 'center',
        padding: node.padding * viewport.zoom,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        cursor: 'text',
        borderRadius: 2,
        userSelect: 'text',
        zIndex: 20
      }}
    />
  )
}

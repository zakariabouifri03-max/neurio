import { useEffect, useRef } from 'react'
import {
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Group,
  Ungroup,
  CopyPlus
} from 'lucide-react'
import { useEditorStore } from '../../state/editor-store'

export interface ContextMenuTarget {
  nodeId: string | null
  pageId: string
  pagePoint: { x: number; y: number }
}

interface MenuItem {
  label: string
  icon: typeof Copy
  shortcut?: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export function CanvasContextMenu({
  x,
  y,
  target,
  onClose
}: {
  x: number
  y: number
  target: ContextMenuTarget
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const state = useEditorStore()

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const node = target.nodeId ? state.nodeById(target.nodeId) : null
  const ids = node && !state.selection.includes(node.id) ? [node.id] : state.selection

  const items: MenuItem[] = node
    ? [
        { label: 'Duplicate', icon: CopyPlus, shortcut: 'Ctrl+D', onClick: () => state.duplicateSelection() },
        { label: 'Group', icon: Group, shortcut: 'Ctrl+G', onClick: () => state.groupSelection(), disabled: ids.length < 2 },
        { label: 'Ungroup', icon: Ungroup, shortcut: 'Ctrl+Shift+G', onClick: () => state.ungroupSelection(), disabled: node.kind !== 'group' },
        { label: 'Bring to front', icon: ArrowUpToLine, onClick: () => state.reorderSelection('front') },
        { label: 'Bring forward', icon: ArrowUp, onClick: () => state.reorderSelection('up') },
        { label: 'Send backward', icon: ArrowDown, onClick: () => state.reorderSelection('down') },
        { label: 'Send to back', icon: ArrowDownToLine, onClick: () => state.reorderSelection('back') },
        {
          label: node.locked ? 'Unlock' : 'Lock',
          icon: node.locked ? Unlock : Lock,
          onClick: () => state.toggleNodeFlag(node.id, 'locked')
        },
        {
          label: node.visible ? 'Hide' : 'Show',
          icon: node.visible ? EyeOff : Eye,
          onClick: () => state.toggleNodeFlag(node.id, 'visible')
        },
        { label: 'Copy', icon: Copy, shortcut: 'Ctrl+C', onClick: () => state.select(ids) },
        { label: 'Delete', icon: Trash2, shortcut: 'Del', danger: true, onClick: () => state.deleteNodes(ids) }
      ]
    : [
        { label: 'Select all', icon: Copy, shortcut: 'Ctrl+A', onClick: () => state.selectAll() },
        {
          label: 'Paste',
          icon: CopyPlus,
          shortcut: 'Ctrl+V',
          onClick: () => {
            const clipboard = useEditorStore.getState()
            void clipboard
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))
          }
        }
      ]

  return (
    <div
      ref={ref}
      className="k-panel k-fade-in"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        minWidth: 196,
        padding: 5,
        zIndex: 200,
        boxShadow: 'var(--k-shadow-2)',
        background: 'var(--k-panel-2)'
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
          className="k-row"
          style={{
            width: '100%',
            justifyContent: 'space-between',
            padding: '6px 8px',
            borderRadius: 6,
            border: 0,
            background: 'transparent',
            cursor: item.disabled ? 'default' : 'pointer',
            opacity: item.disabled ? 0.4 : 1,
            color: item.danger ? 'var(--k-danger)' : 'var(--k-text)',
            fontSize: 12.5
          }}
          onMouseEnter={(event) => {
            if (!item.disabled) event.currentTarget.style.background = 'var(--k-panel-3)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent'
          }}
        >
          <span className="k-row" style={{ gap: 8 }}>
            <item.icon size={14} />
            {item.label}
          </span>
          {item.shortcut ? <span className="k-mono" style={{ color: 'var(--k-text-mute)' }}>{item.shortcut}</span> : null}
        </button>
      ))}
    </div>
  )
}

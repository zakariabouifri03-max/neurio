import { useMemo } from 'react'
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Group,
  Ungroup,
  Type,
  Image as ImageIcon,
  Square,
  Layers as LayersIcon
} from 'lucide-react'
import type { SceneNode } from '../../../../shared/types/document'
import { useEditorStore } from '../../state/editor-store'
import { flattenNodes, nodeSummary } from '../../../../shared/utils/document'

const KIND_ICON = {
  text: Type,
  image: ImageIcon,
  shape: Square,
  svg: Square,
  group: LayersIcon
} as const

export function LayersPanel(): JSX.Element {
  const state = useEditorStore()
  const page = state.activePage()
  const nodes = useMemo(() => (page ? [...page.nodes].reverse() : []), [page])

  if (!page) return <div className="k-empty">No page</div>

  return (
    <div className="k-col" style={{ gap: 6, height: '100%' }}>
      <div className="k-row-between">
        <span className="k-section-title">Layers · {flattenNodes(page.nodes).length}</span>
        <div className="k-row" style={{ gap: 2 }}>
          <IconAction icon={Group} label="Group (Ctrl+G)" onClick={() => state.groupSelection()} />
          <IconAction icon={Ungroup} label="Ungroup (Ctrl+Shift+G)" onClick={() => state.ungroupSelection()} />
          <IconAction icon={Trash2} label="Delete" onClick={() => state.deleteNodes()} danger />
        </div>
      </div>
      <div className="k-scroll" style={{ flex: 1, display: 'grid', gap: 2, alignContent: 'start' }}>
        {nodes.length === 0 ? (
          <div className="k-empty">
            <LayersIcon size={16} />
            <span>This page is empty</span>
          </div>
        ) : null}
        {nodes.map((node, index) => (
          <LayerRow
            key={node.id}
            node={node}
            index={index}
            depth={0}
            total={nodes.length}
            selected={state.selection.includes(node.id)}
          />
        ))}
      </div>
    </div>
  )
}

function LayerRow({
  node,
  index,
  depth,
  total,
  selected
}: {
  node: SceneNode
  index: number
  depth: number
  total: number
  selected: boolean
}): JSX.Element {
  const state = useEditorStore()
  const Icon = KIND_ICON[node.kind] ?? Square
  const isFirst = index === 0
  const isLast = index === total - 1

  return (
    <>
      <div
        className="k-row"
        style={{
          gap: 6,
          padding: '5px 6px',
          paddingLeft: 6 + depth * 12,
          borderRadius: 7,
          background: selected ? 'rgb(124 92 255 / 0.18)' : 'transparent',
          border: `1px solid ${selected ? 'var(--k-accent)' : 'transparent'}`,
          cursor: 'pointer'
        }}
        onClick={(event) => state.select([node.id], event.shiftKey || event.metaKey ? 'toggle' : 'replace')}
        onDoubleClick={() => {
          const label = window.prompt('Rename layer', node.name)
          if (label !== null && label.trim()) state.renameNode(node.id, label.trim())
        }}
      >
        <Icon size={13} color={selected ? 'var(--k-accent-2)' : 'var(--k-text-mute)'} style={{ flex: 'none' }} />
        <span className="k-truncate" style={{ flex: 1, fontSize: 12, opacity: node.visible ? 1 : 0.45 }}>
          {nodeSummary(node)}
        </span>
        {node.locked ? <Lock size={11} color="var(--k-text-mute)" /> : null}
        <div className="k-row" style={{ gap: 0, opacity: selected ? 1 : 0.55 }}>
          <IconAction
            icon={isFirst ? ArrowUpToLine : ArrowUp}
            label={isFirst ? 'Bring to front' : 'Bring forward'}
            onClick={() => state.reorderSelection(isFirst ? 'front' : 'up')}
          />
          <IconAction
            icon={isLast ? ArrowDownToLine : ArrowDown}
            label={isLast ? 'Send to back' : 'Send backward'}
            onClick={() => state.reorderSelection(isLast ? 'back' : 'down')}
          />
          <IconAction
            icon={node.visible ? Eye : EyeOff}
            label={node.visible ? 'Hide' : 'Show'}
            onClick={() => state.toggleNodeFlag(node.id, 'visible')}
          />
          <IconAction
            icon={node.locked ? Unlock : Lock}
            label={node.locked ? 'Unlock' : 'Lock'}
            onClick={() => state.toggleNodeFlag(node.id, 'locked')}
          />
        </div>
      </div>
      {node.kind === 'group'
        ? [...node.children]
            .reverse()
            .map((child, childIndex) => (
              <LayerRow
                key={child.id}
                node={child}
                index={childIndex}
                depth={depth + 1}
                total={node.children.length}
                selected={state.selection.includes(child.id)}
              />
            ))
        : null}
    </>
  )
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  danger
}: {
  icon: typeof Eye
  label: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      style={{
        background: 'none',
        border: 0,
        color: danger ? 'var(--k-danger)' : 'var(--k-text-mute)',
        cursor: 'pointer',
        padding: 3,
        borderRadius: 4,
        display: 'grid',
        placeItems: 'center'
      }}
    >
      <Icon size={12} />
    </button>
  )
}

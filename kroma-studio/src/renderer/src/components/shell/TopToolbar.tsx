import {
  Undo2,
  Redo2,
  Save,
  Download,
  Copy,
  Trash2,
  Play,
  Share2,
  ZoomIn,
  ZoomOut,
  Maximize,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Group,
  Ungroup,
  PanelLeft,
  PanelRight
} from 'lucide-react'
import { Button, Tooltip } from '../ui/controls'
import { useEditorStore } from '../../state/editor-store'
import { useUiStore } from '../../state/ui-store'
import { useAppStore } from '../../state/app-store'
import { useEditorActions } from '../../hooks/useEditorActions'

export interface TopToolbarProps {
  projectName: string
  onProjectNameChange: (name: string) => void
  onSave: () => void
}

export function TopToolbar({ projectName, onProjectNameChange, onSave }: TopToolbarProps): JSX.Element {
  const state = useEditorStore()
  const ui = useUiStore()
  const app = useAppStore()
  const actions = useEditorActions()
  const hasSelection = state.selection.length > 0

  return (
    <header
      style={{
        height: 'var(--k-top)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        borderBottom: '1px solid var(--k-line-soft)',
        background: 'var(--k-panel)'
      }}
    >
      <div className="k-row" style={{ gap: 2 }}>
        <Tooltip label="Undo" shortcut="Ctrl+Z">
          <Button variant="ghost" icon={Undo2} disabled={!state.canUndo} onClick={() => state.undo()} title="Undo (Ctrl+Z)" />
        </Tooltip>
        <Tooltip label="Redo" shortcut="Ctrl+Shift+Z">
          <Button variant="ghost" icon={Redo2} disabled={!state.canRedo} onClick={() => state.redo()} title="Redo (Ctrl+Shift+Z)" />
        </Tooltip>
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--k-line)' }} />

      <input
        className="k-input"
        value={projectName}
        onChange={(event) => onProjectNameChange(event.target.value)}
        aria-label="Project name"
        style={{ width: 190, borderColor: 'transparent', background: 'transparent', fontWeight: 600 }}
      />
      <span className={`k-chip ${state.dirty ? 'k-chip--warn' : 'k-chip--ok'}`} title={state.dirty ? 'Unsaved changes' : 'All changes saved'}>
        {state.dirty ? 'Unsaved' : 'Saved'}
      </span>

      <div style={{ flex: 1 }} />

      <div className="k-row" style={{ gap: 2 }}>
        <Tooltip label="Toggle left panel">
          <Button variant="ghost" icon={PanelLeft} active={ui.leftPanelOpen} onClick={() => ui.toggleLeftPanel()} title="Toggle left panel" />
        </Tooltip>
        <Tooltip label="Toggle right panel">
          <Button variant="ghost" icon={PanelRight} active={ui.rightPanelOpen} onClick={() => ui.toggleRightPanel()} title="Toggle right panel" />
        </Tooltip>
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--k-line)' }} />

      {hasSelection ? (
        <div className="k-row" style={{ gap: 2 }}>
          <Button variant="ghost" icon={AlignStartVertical} title="Align left" onClick={() => actions.align('left')} />
          <Button variant="ghost" icon={AlignCenterVertical} title="Align horizontal centre" onClick={() => actions.align('hcenter')} />
          <Button variant="ghost" icon={AlignEndVertical} title="Align right" onClick={() => actions.align('right')} />
          <Button variant="ghost" icon={AlignStartHorizontal} title="Align top" onClick={() => actions.align('top')} />
          <Button variant="ghost" icon={AlignCenterHorizontal} title="Align vertical centre" onClick={() => actions.align('vcenter')} />
          <Button variant="ghost" icon={AlignEndHorizontal} title="Align bottom" onClick={() => actions.align('bottom')} />
          <Button variant="ghost" icon={AlignHorizontalJustifyCenter} title="Distribute horizontally" onClick={() => actions.distribute('horizontal')} />
          <Button variant="ghost" icon={AlignVerticalJustifyCenter} title="Distribute vertically" onClick={() => actions.distribute('vertical')} />
          <div style={{ width: 1, height: 22, background: 'var(--k-line)' }} />
          <Button variant="ghost" icon={Group} title="Group (Ctrl+G)" onClick={() => state.groupSelection()} />
          <Button variant="ghost" icon={Ungroup} title="Ungroup (Ctrl+Shift+G)" onClick={() => state.ungroupSelection()} />
          <Button variant="ghost" icon={Copy} title="Duplicate (Ctrl+D)" onClick={() => state.duplicateSelection()} />
          <Button variant="ghost" icon={Trash2} title="Delete" onClick={() => state.deleteNodes()} />
        </div>
      ) : null}

      <div style={{ flex: 1 }} />

      <div className="k-row" style={{ gap: 2 }}>
        <Button variant="ghost" icon={ZoomOut} title="Zoom out" onClick={() => state.zoomBy(1 / 1.2)} />
        <button
          type="button"
          onClick={() => ui.requestFit()}
          title="Fit to screen"
          style={{
            background: 'transparent',
            border: '1px solid var(--k-line)',
            color: 'var(--k-text-dim)',
            height: 32,
            minWidth: 56,
            borderRadius: 'var(--k-r)',
            cursor: 'pointer',
            fontFamily: 'var(--k-mono)',
            fontSize: 11.5
          }}
        >
          {Math.round(state.viewport.zoom * 100)}%
        </button>
        <Button variant="ghost" icon={ZoomIn} title="Zoom in" onClick={() => state.zoomBy(1.2)} />
        <Button variant="ghost" icon={Maximize} title="Fit to screen" onClick={() => ui.requestFit()} />
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--k-line)' }} />

      <div className="k-row" style={{ gap: 6 }}>
        <Button icon={Play} variant="ghost" onClick={() => ui.openModal('preview')} title="Preview (Ctrl+P)">
          Preview
        </Button>
        <Button icon={Share2} variant="ghost" onClick={() => ui.openModal('export')} title="Share / export">
          Share
        </Button>
        <Button icon={Save} variant="ghost" onClick={onSave} title="Save (Ctrl+S)">
          Save
        </Button>
        <Button icon={Download} variant="primary" onClick={() => ui.openModal('export')} title="Export (Ctrl+E)">
          Export
        </Button>
        <button
          type="button"
          onClick={() => ui.openModal('settings')}
          title={app.online ? 'AI Online' : 'Offline Mode'}
          className={`k-chip ${app.online ? 'k-chip--ok' : 'k-chip--warn'}`}
          style={{ cursor: 'pointer', height: 32 }}
        >
          {app.online ? 'AI Online' : 'Offline Mode'}
        </button>
      </div>
    </header>
  )
}

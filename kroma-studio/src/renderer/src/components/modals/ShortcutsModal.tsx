import { Modal } from '../ui/Modal'
import { Button } from '../ui/controls'

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'File & history',
    items: [
      ['Save design', 'Ctrl + S'],
      ['Export', 'Ctrl + E'],
      ['Preview', 'Ctrl + P'],
      ['Undo', 'Ctrl + Z'],
      ['Redo', 'Ctrl + Shift + Z']
    ]
  },
  {
    title: 'Selection & objects',
    items: [
      ['Select all', 'Ctrl + A'],
      ['Copy', 'Ctrl + C'],
      ['Paste', 'Ctrl + V'],
      ['Duplicate', 'Ctrl + D'],
      ['Delete', 'Delete'],
      ['Group', 'Ctrl + G'],
      ['Ungroup', 'Ctrl + Shift + G'],
      ['Nudge', 'Arrow keys'],
      ['Nudge ×10', 'Shift + Arrows']
    ]
  },
  {
    title: 'Canvas',
    items: [
      ['Zoom', 'Ctrl + Wheel'],
      ['Pan', 'Space + Drag'],
      ['Fit to screen', 'Toolbar ⟛'],
      ['Constrain move', 'Shift + Drag'],
      ['Resize from centre', 'Alt + Drag'],
      ['Rotate in 15° steps', 'Shift + Drag rotate'],
      ['Edit text', 'Double-click'],
      ['Escape selection', 'Esc']
    ]
  }
]

export function ShortcutsModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal
      title="Keyboard shortcuts"
      onClose={onClose}
      width={620}
      footer={<Button variant="primary" onClick={onClose}>Got it</Button>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {GROUPS.map((group) => (
          <div key={group.title} className="k-col" style={{ gap: 4 }}>
            <span className="k-section-title">{group.title}</span>
            {group.items.map(([action, keys]) => (
              <div key={action} className="k-row-between" style={{ padding: '5px 7px', background: 'var(--k-panel-2)', borderRadius: 6 }}>
                <span style={{ fontSize: 11.5 }}>{action}</span>
                <span className="k-mono" style={{ fontSize: 10.5, color: 'var(--k-text-dim)' }}>{keys}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

import { Sparkles, Type, ImageIcon, Shapes } from 'lucide-react'
import { useUiStore } from '../../state/ui-store'
import { useEditorActions } from '../../hooks/useEditorActions'

export function EmptyCanvasHint(): JSX.Element {
  const actions = useEditorActions()
  const setLeftPanel = useUiStore((state) => state.setLeftPanel)

  const items = [
    { icon: Type, label: 'Add text', hint: 'Headings, body, captions', onClick: () => void actions.addText() },
    { icon: Shapes, label: 'Add shapes', hint: 'Lines, badges, frames', onClick: () => setLeftPanel('shapes') },
    { icon: ImageIcon, label: 'Add an image', hint: 'PNG · JPG · WEBP', onClick: () => setLeftPanel('uploads') },
    { icon: Sparkles, label: 'Generate with AI', hint: 'Prompt → full layout', onClick: () => useUiStore.getState().openModal('ai-design') }
  ]

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        zIndex: 5
      }}
    >
      <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className="k-panel"
            style={{
              width: 148,
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'flex-start',
              cursor: 'pointer',
              background: 'rgba(21,21,31,0.92)',
              border: '1px solid var(--k-line)',
              transition: 'transform 120ms var(--k-ease), border-color 120ms'
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.transform = 'translateY(-2px)'
              event.currentTarget.style.borderColor = 'var(--k-accent)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.transform = 'none'
              event.currentTarget.style.borderColor = 'var(--k-line)'
            }}
          >
            <item.icon size={18} color="var(--k-accent-2)" />
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{item.label}</span>
            <span style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

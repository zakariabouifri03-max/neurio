import {
  Sparkles,
  Shapes,
  Type,
  Upload,
  Wand2,
  Palette,
  Square,
  Smile,
  FolderOpen,
  LayoutTemplate,
  Layers,
  Gem
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUiStore, type PanelRoute } from '../../state/ui-store'
import { useAppStore } from '../../state/app-store'

interface RailItem {
  id: PanelRoute
  label: string
  icon: LucideIcon
}

const ITEMS: RailItem[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'ai', label: 'AI Tools', icon: Wand2 },
  { id: 'backgrounds', label: 'Backgrounds', icon: Palette },
  { id: 'shapes', label: 'Shapes', icon: Square },
  { id: 'icons', label: 'Icons', icon: Smile },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'brand', label: 'Brand Kit', icon: Gem },
  { id: 'layers', label: 'Layers', icon: Layers }
]

export function LeftRail(): JSX.Element {
  const active = useUiStore((state) => state.leftPanel)
  const open = useUiStore((state) => state.leftPanelOpen)
  const setLeftPanel = useUiStore((state) => state.setLeftPanel)
  const settings = useAppStore((state) => state.settings)

  return (
    <nav
      style={{
        width: 'var(--k-rail)',
        flex: 'none',
        borderRight: '1px solid var(--k-line-soft)',
        background: 'var(--k-panel)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 2
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: `linear-gradient(135deg, var(--k-accent-2), var(--k-accent))`,
          display: 'grid',
          placeItems: 'center',
          marginBottom: 8,
          boxShadow: '0 6px 18px rgb(124 92 255 / 0.4)'
        }}
        title="Kroma Studio"
      >
        <Sparkles size={17} color="#fff" />
      </div>

      {ITEMS.map((item) => {
        const isActive = open && active === item.id
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onClick={() => setLeftPanel(item.id)}
            style={{
              width: 46,
              padding: '7px 0',
              borderRadius: 9,
              border: 0,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              background: isActive ? 'rgb(124 92 255 / 0.16)' : 'transparent',
              color: isActive ? 'var(--k-accent-2)' : 'var(--k-text-dim)',
              transition: 'background 120ms var(--k-ease), color 120ms'
            }}
          >
            <item.icon size={17} strokeWidth={isActive ? 2.2 : 1.8} />
            <span style={{ fontSize: 8.5, letterSpacing: 0.2, opacity: 0.9 }}>{item.label.split(' ')[0]}</span>
          </button>
        )
      })}

      <div style={{ flex: 1 }} />
      <span
        title={settings.appearance.theme}
        style={{ fontSize: 9, color: 'var(--k-text-mute)', writingMode: 'vertical-rl', letterSpacing: 2 }}
      >
        v0.1
      </span>
    </nav>
  )
}

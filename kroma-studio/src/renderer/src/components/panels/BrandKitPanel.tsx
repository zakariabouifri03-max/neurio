import { useEffect, useState } from 'react'
import { Palette, Plus, Trash2, Type } from 'lucide-react'
import { Button, ColorPicker } from '../ui/controls'
import { useAppStore } from '../../state/app-store'
import { useEditorActions } from '../../hooks/useEditorActions'
import { platform } from '../../platform'
import { notify } from '../../state/ui-store'
import { useEditorStore } from '../../state/editor-store'
import { CURATED_PALETTES } from '../../../../shared/utils/color'

interface BrandKitState {
  colors: string[]
  fonts: string[]
}

const STORAGE_KEY = 'kroma.brandkit'

export function BrandKitPanel(): JSX.Element {
  const [kit, setKit] = useState<BrandKitState>({ colors: CURATED_PALETTES[0].colors.slice(), fonts: ['Inter'] })
  const actions = useEditorActions()
  const fonts = useAppStore((state) => state.fonts)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setKit(JSON.parse(raw) as BrandKitState)
    } catch {
      /* ignore */
    }
  }, [])

  const persist = (next: BrandKitState): void => {
    setKit(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  return (
    <div className="k-col" style={{ gap: 12, height: '100%' }}>
      <section className="k-col" style={{ gap: 8 }}>
        <div className="k-row-between">
          <span className="k-section-title">Brand colours</span>
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() => persist({ ...kit, colors: [...kit.colors, '#7C5CFF'] })}
          >
            Add
          </Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {kit.colors.map((color, index) => (
            <div key={index} className="k-col" style={{ gap: 4, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => applyBrandColor(color)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  persist({ ...kit, colors: kit.colors.filter((_, i) => i !== index) })
                }}
                title="Click to apply to selection · right-click to remove"
                style={{
                  height: 30,
                  borderRadius: 8,
                  border: '1px solid var(--k-line)',
                  background: color,
                  cursor: 'pointer',
                  padding: 0,
                  width: '100%'
                }}
              />
            </div>
          ))}
        </div>
        <ColorPicker
          label="Add custom colour"
          value="#7C5CFF"
          onChange={(color) => persist({ ...kit, colors: [...kit.colors, color] })}
        />
      </section>

      <div className="k-sep" />
      <section className="k-col" style={{ gap: 8 }}>
        <span className="k-section-title">Brand fonts</span>
        <div className="k-col" style={{ gap: 4 }}>
          {kit.fonts.map((font, index) => (
            <div key={font} className="k-row-between" style={{ padding: '5px 8px', background: 'var(--k-panel-2)', borderRadius: 7 }}>
              <span style={{ fontFamily: `"${font}", Inter, sans-serif`, fontSize: 13 }}>{font}</span>
              <button
                type="button"
                onClick={() => persist({ ...kit, fonts: kit.fonts.filter((_, i) => i !== index) })}
                style={iconButtonStyle}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <select
          className="k-select"
          value=""
          onChange={(event) => {
            const value = event.target.value
            if (value && !kit.fonts.includes(value)) persist({ ...kit, fonts: [...kit.fonts, value] })
          }}
        >
          <option value="">Add a font…</option>
          {[...new Set(fonts.map((font) => font.family))].map((family) => (
            <option key={family} value={family}>{family}</option>
          ))}
        </select>
      </section>

      <div className="k-sep" />
      <section className="k-col" style={{ gap: 8 }}>
        <span className="k-section-title">Quick actions</span>
        <Button size="sm" icon={Palette} onClick={() => applyBrandColor(kit.colors[0] ?? '#7C5CFF')}>
          Apply primary colour
        </Button>
        <Button size="sm" icon={Type} onClick={() => actions.addText({ fontFamily: kit.fonts[0] ?? 'Inter' })}>
          Add text in brand font
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void (async () => {
              try {
                await platform.settings.openDataDir()
              } catch {
                notify.info('Brand kit is stored with your app data.')
              }
            })()
          }}
        >
          Open data folder
        </Button>
      </section>

      <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
        The brand kit is saved locally with your workspace. Use it to keep colours and fonts consistent across designs.
      </p>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = { background: 'none', border: 0, color: 'var(--k-text-mute)', cursor: 'pointer', padding: 4 }

/** Paints the current selection with a brand colour. */
function applyBrandColor(color: string): void {
  const state = useEditorStore.getState()
  if (state.selection.length === 0) {
    notify.warning('Select an object first')
    return
  }
  const patches = state.selection.map((id) => {
    const node = state.nodeById(id)
    if (node && (node.kind === 'text' || node.kind === 'shape')) {
      return { id, patch: { fill: { type: 'solid' as const, color } } as never }
    }
    return null
  })
  const clean = patches.filter((patch): patch is { id: string; patch: never } => patch !== null)
  if (clean.length === 0) {
    notify.warning('Select a text or shape object to recolour')
    return
  }
  state.updateNodes(clean, { label: 'brand colour' })
  notify.info('Brand colour applied')
}

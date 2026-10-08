import { useState } from 'react'
import { Check, Droplet } from 'lucide-react'
import { GRADIENT_PRESETS, SOLID_SWATCHES } from '../../lib/catalogs/gradients'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { Button } from '../ui/controls'
import { notify } from '../../state/ui-store'
import { createShapeNode } from '../../../../shared/utils/document'

const PATTERNS: Array<{ id: string; label: string; svg: (color: string) => string }> = [
  {
    id: 'dots',
    label: 'Dots',
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="8" cy="8" r="3" fill="${color}"/><circle cx="28" cy="28" r="3" fill="${color}"/></svg>`
  },
  {
    id: 'lines',
    label: 'Lines',
    svg: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v2H0z" fill="${color}"/></svg>`
  },
  {
    id: 'grid',
    label: 'Grid',
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0 0h40v1H0zM0 0v40h1V0z" fill="${color}"/></svg>`
  },
  {
    id: 'zigzag',
    label: 'Zigzag',
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><path d="M0 10l10-8 10 16 10-16 10 8" fill="none" stroke="${color}" stroke-width="2"/></svg>`
  },
  {
    id: 'cross',
    label: 'Crosses',
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M18 8h4v8h8v4h-8v8h-4v-8H8v-4h8z" fill="${color}"/></svg>`
  },
  {
    id: 'waves',
    label: 'Waves',
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><path d="M0 12q12-12 24 0t24 0" fill="none" stroke="${color}" stroke-width="2"/></svg>`
  }
]

export function BackgroundsPanel(): JSX.Element {
  const state = useEditorStore()
  const page = state.activePage()
  const accent = useAppStore((state) => state.settings.appearance.accent)
  const [tab, setTab] = useState<'solid' | 'gradient' | 'pattern'>('solid')
  const [patternColor, setPatternColor] = useState('#7C5CFF')

  if (!page) return <div className="k-empty">No page selected</div>

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <div className="k-segmented" style={{ width: '100%' }}>
        {(['solid', 'gradient', 'pattern'] as const).map((entry) => (
          <button key={entry} type="button" className={tab === entry ? 'is-active' : ''} onClick={() => setTab(entry)} style={{ flex: 1 }}>
            {entry[0].toUpperCase() + entry.slice(1)}
          </button>
        ))}
      </div>

      <div className="k-scroll" style={{ flex: 1 }}>
        {tab === 'solid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {SOLID_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => state.updatePageBackground(page.id, { type: 'solid', color, gradient: undefined, imageSrc: undefined })}
                style={{
                  aspectRatio: '1',
                  borderRadius: 8,
                  border: page.background.color.toUpperCase() === color ? '2px solid var(--k-accent-2)' : '1px solid var(--k-line)',
                  background: color,
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
          </div>
        ) : null}

        {tab === 'gradient' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  state.updatePageBackground(page.id, {
                    type: 'gradient',
                    gradient: preset.fill,
                    color: preset.fill.stops?.[0]?.color ?? '#000000'
                  })
                }
                className="k-panel"
                style={{ overflow: 'hidden', cursor: 'pointer', padding: 0, border: '1px solid var(--k-line-soft)' }}
              >
                <div
                  style={{
                    height: 54,
                    background: `linear-gradient(${preset.fill.angle ?? 90}deg, ${preset.fill.stops?.[0]?.color}, ${preset.fill.stops?.[1]?.color})`
                  }}
                />
                <div style={{ padding: '5px 7px', fontSize: 11, textAlign: 'left', color: 'var(--k-text-dim)' }}>{preset.label}</div>
              </button>
            ))}
          </div>
        ) : null}

        {tab === 'pattern' ? (
          <>
            <div className="k-row" style={{ gap: 6, marginBottom: 10 }}>
              <Droplet size={14} color="var(--k-text-mute)" />
              <span style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>Pattern colour</span>
              <div style={{ flex: 1 }} />
              {SOLID_SWATCHES.slice(0, 8).map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setPatternColor(color)}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: color,
                    border: patternColor === color ? '2px solid var(--k-accent-2)' : '1px solid var(--k-line)',
                    cursor: 'pointer',
                    padding: 0
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {PATTERNS.map((pattern) => (
                <button
                  key={pattern.id}
                  type="button"
                  onClick={() => {
                    const svg = pattern.svg(patternColor)
                    const encoded = `data:image/svg+xml;base64,${btoa(svg)}`
                    state.updatePageBackground(page.id, { type: 'image', imageSrc: encoded, color: '#0F1024', imageOpacity: 1 })
                    notify.info(`${pattern.label} background applied`)
                  }}
                  className="k-panel"
                  style={{ overflow: 'hidden', cursor: 'pointer', padding: 0, border: '1px solid var(--k-line-soft)' }}
                >
                  <div
                    style={{
                      height: 54,
                      background: '#0F1024',
                      display: 'grid',
                      placeItems: 'center',
                      backgroundImage: `url("data:image/svg+xml;base64,${btoa(pattern.svg(patternColor))}")`
                    }}
                  />
                  <div style={{ padding: '5px 7px', fontSize: 11, textAlign: 'left', color: 'var(--k-text-dim)' }}>{pattern.label}</div>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="k-sep" />
      <div className="k-row" style={{ gap: 6 }}>
        <Button
          size="sm"
          variant={page.background.type === 'transparent' ? 'primary' : 'ghost'}
          icon={Check}
          onClick={() => state.updatePageBackground(page.id, { type: 'transparent', gradient: undefined, imageSrc: undefined })}
        >
          Transparent
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const node = createShapeNode('rect', {
              name: 'Overlay',
              x: 0,
              y: 0,
              width: page.width,
              height: page.height,
              fill: { type: 'linear', color: accent, stops: [{ color: accent, offset: 0 }, { color: '#000000', offset: 1 }], angle: 90 },
              opacity: 0.35
            })
            state.addNodes([node])
          }}
        >
          Add overlay layer
        </Button>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Search, Type, Quote } from 'lucide-react'
import { TEXT_STYLES, buildTextFromStyle } from '../../lib/catalogs/text-styles'
import { useEditorActions } from '../../hooks/useEditorActions'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { uniqueFamilies } from '../../services/fonts'
import { readableOn } from '../../../../shared/utils/color'
import { createTextNode, solid } from '../../../../shared/utils/document'

export function TextPanel(): JSX.Element {
  const actions = useEditorActions()
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<string | null>(null)
  const fonts = useAppStore((state) => state.fonts)
  const page = useEditorStore((state) => state.activePage())
  const families = useMemo(() => uniqueFamilies(fonts), [fonts])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return families.slice(0, 80)
    return families.filter((entry) => entry.toLowerCase().includes(needle)).slice(0, 80)
  }, [families, query])

  const baseColor = page
    ? page.background.type === 'transparent'
      ? '#FFFFFF'
      : readableOn(page.background.color || '#FFFFFF')
    : '#111111'

  const addStyled = (styleId: string): void => {
    const style = TEXT_STYLES.find((entry) => entry.id === styleId)
    if (!style || !page) return
    const width = Math.round(page.width * 0.8)
    const node = buildTextFromStyle(style, {
      x: Math.round(page.width * 0.1),
      y: Math.round(page.height * 0.4),
      width,
      color: style.color ?? baseColor
    })
    actions.addNodes([node])
  }

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button type="button" className="k-btn k-btn--primary" onClick={() => actions.addText()}>
          <Type size={14} /> Add heading
        </button>
        <button
          type="button"
          className="k-btn"
          onClick={() =>
            actions.addText({
              fontSize: page ? Math.max(14, Math.round(page.height * 0.026)) : 24,
              fontWeight: 400,
              text: 'Add a short paragraph of body text here.',
              height: 120
            })
          }
        >
          <Quote size={14} /> Add body text
        </button>
      </div>

      <div className="k-sep" />
      <span className="k-section-title">Text styles</span>
      <div className="k-col" style={{ gap: 6 }}>
        {TEXT_STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            className="k-panel"
            onClick={() => addStyled(style.id)}
            style={{
              padding: '10px 12px',
              textAlign: 'left',
              cursor: 'pointer',
              background: 'var(--k-panel-2)',
              border: '1px solid var(--k-line-soft)'
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--k-text-mute)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {style.label}
            </div>
            <div
              style={{
                fontFamily: `"${style.fontFamily ?? 'Inter'}", Inter, sans-serif`,
                fontSize: Math.min(22, Math.max(12, style.fontSize / 4)),
                fontWeight: style.fontWeight,
                fontStyle: style.italic ? 'italic' : undefined,
                letterSpacing: style.letterSpacing / 4,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {style.preview}
            </div>
          </button>
        ))}
      </div>

      <div className="k-sep" />
      <span className="k-section-title">Fonts</span>
      <div className="k-row" style={{ position: 'relative' }}>
        <Search size={13} color="var(--k-text-mute)" style={{ position: 'absolute', left: 9 }} />
        <input
          className="k-input"
          placeholder={`Search ${families.length} fonts`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ paddingLeft: 26 }}
        />
      </div>
      <div className="k-scroll" style={{ flex: 1, display: 'grid', gap: 4, alignContent: 'start', maxHeight: 260 }}>
        {filtered.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              if (!page) return
              const node = createTextNode({
                name: entry,
                text: 'The quick brown fox',
                x: Math.round(page.width * 0.1),
                y: Math.round(page.height * 0.44),
                width: Math.round(page.width * 0.8),
                height: 70,
                fontFamily: entry,
                fontSize: Math.max(18, Math.round(page.height * 0.05)),
                fill: solid(baseColor)
              })
              actions.addNodes([node])
              setFamily(entry)
            }}
            style={{
              textAlign: 'left',
              padding: '7px 9px',
              borderRadius: 8,
              border: `1px solid ${family === entry ? 'var(--k-accent)' : 'transparent'}`,
              background: family === entry ? 'rgb(124 92 255 / 0.12)' : 'transparent',
              cursor: 'pointer',
              fontFamily: `"${entry}", Inter, sans-serif`,
              fontSize: 15,
              color: 'var(--k-text)'
            }}
          >
            {entry}
          </button>
        ))}
      </div>
    </div>
  )
}

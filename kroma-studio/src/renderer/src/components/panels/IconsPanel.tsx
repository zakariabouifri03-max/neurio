import { useState } from 'react'
import { Search } from 'lucide-react'
import { ICON_CATEGORIES, iconsByCategory, tintSvg } from '../../lib/catalogs/icons'
import { useEditorStore } from '../../state/editor-store'
import { newId } from '../../../../shared/utils/ids'
import type { SceneNode } from '../../../../shared/types/document'
import { notify } from '../../state/ui-store'

export function IconsPanel(): JSX.Element {
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [color, setColor] = useState('#FFFFFF')
  const page = useEditorStore((state) => state.activePage())

  const icons = iconsByCategory(category).filter((icon) => icon.label.toLowerCase().includes(query.trim().toLowerCase()))

  const add = (svg: string, label: string): void => {
    if (!page) return
    const size = Math.round(Math.min(page.width, page.height) * 0.18)
    const node: SceneNode = {
      id: newId('ic'),
      kind: 'svg',
      name: label,
      visible: true,
      locked: false,
      x: Math.round(page.width / 2 - size / 2),
      y: Math.round(page.height / 2 - size / 2),
      width: size,
      height: size,
      rotation: 0,
      opacity: 1,
      svg: tintSvg(svg, color)
    }
    useEditorStore.getState().addNodes([node])
    notify.info(`${label} added`)
  }

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <div className="k-row" style={{ position: 'relative' }}>
        <Search size={13} color="var(--k-text-mute)" style={{ position: 'absolute', left: 9 }} />
        <input
          className="k-input"
          placeholder="Search icons"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ paddingLeft: 26 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {ICON_CATEGORIES.map((entry) => (
          <button
            key={entry}
            type="button"
            className="k-chip"
            onClick={() => setCategory(entry)}
            style={{
              cursor: 'pointer',
              color: category === entry ? 'var(--k-accent-2)' : undefined,
              borderColor: category === entry ? 'var(--k-accent)' : undefined
            }}
          >
            {entry}
          </button>
        ))}
      </div>
      <div className="k-row" style={{ gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>Colour</span>
        {['#FFFFFF', '#000000', '#7C5CFF', '#FF5F7A', '#FFD166', '#38D39F', '#57B8FF'].map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setColor(entry)}
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: entry,
              border: color === entry ? '2px solid var(--k-accent-2)' : '1px solid var(--k-line)',
              cursor: 'pointer',
              padding: 0
            }}
            title={entry}
          />
        ))}
      </div>
      <div className="k-scroll" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, alignContent: 'start' }}>
        {icons.map((icon) => (
          <button
            key={icon.id}
            type="button"
            title={icon.label}
            onClick={() => add(icon.svg, icon.label)}
            className="k-panel"
            style={{
              aspectRatio: '1',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              background: 'var(--k-panel-2)',
              border: '1px solid var(--k-line-soft)',
              color: 'var(--k-text)',
              padding: 8
            }}
            dangerouslySetInnerHTML={{ __html: icon.svg }}
          />
        ))}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Search } from 'lucide-react'
import { ELEMENT_CATALOG, ELEMENT_CATEGORIES, type ElementDef } from '../../lib/catalogs/elements'
import { ICON_CATALOG, ICON_CATEGORIES, iconsByCategory, tintSvg } from '../../lib/catalogs/icons'
import { SHAPE_CATALOG, LINES_AND_ARROWS } from '../../lib/catalogs/shapes'
import { GRADIENT_PRESETS } from '../../lib/catalogs/gradients'
import { useEditorActions } from '../../hooks/useEditorActions'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { notify } from '../../state/ui-store'
import { createShapeNode, createTextNode, solid, gradient as gradientFill } from '../../../../shared/utils/document'
import { newId } from '../../../../shared/utils/ids'
import type { SceneNode } from '../../../../shared/types/document'

export function ElementsPanel(): JSX.Element {
  const [tab, setTab] = useState<'elements' | 'shapes' | 'icons' | 'gradients'>('elements')
  const [query, setQuery] = useState('')
  const [iconCategory, setIconCategory] = useState<string>('All')
  const [elementCategory, setElementCategory] = useState<string>('badges')
  const actions = useEditorActions()
  const accent = useAppStore((state) => state.settings.appearance.accent)

  const page = useEditorStore((state) => state.activePage())

  const dropElement = (element: ElementDef): void => {
    if (!page) return
    const size = Math.round(Math.min(page.width, page.height) * 0.34)
    const nodes = element.build({ width: size, height: size, accent })
    // Centre the group on the page.
    const offsetX = Math.round(page.width / 2 - size / 2)
    const offsetY = Math.round(page.height / 2 - size / 2)
    const positioned = nodes.map((node) => ({ ...node, x: node.x + offsetX, y: node.y + offsetY }))
    const group: SceneNode = {
      id: newId('gr'),
      kind: 'group',
      name: element.label,
      visible: true,
      locked: false,
      x: offsetX,
      y: offsetY,
      width: size,
      height: size,
      rotation: 0,
      opacity: 1,
      children: positioned.map((node) => ({ ...node, x: node.x - offsetX, y: node.y - offsetY }))
    }
    actions.addNodes([group])
  }

  const dropShape = (svg: string, label: string): void => {
    if (!page) return
    const size = Math.round(Math.min(page.width, page.height) * 0.3)
    const node: SceneNode = {
      id: newId('sv'),
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
      svg: tintSvg(svg, accent)
    }
    actions.addNodes([node])
  }

  const dropIcon = (svg: string, label: string, color = accent): void => {
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
    actions.addNodes([node])
  }

  const dropGradient = (stops: Array<{ color: string; offset: number }>, angle: number): void => {
    if (!page) return
    const node = createShapeNode('rect', {
      name: 'Gradient panel',
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
      fill: gradientFill(stops, angle)
    })
    actions.addNodes([node])
  }

  const filteredIcons = iconsByCategory(iconCategory).filter((icon) =>
    icon.label.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <div className="k-segmented" style={{ width: '100%' }}>
        {(['elements', 'shapes', 'icons', 'gradients'] as const).map((entry) => (
          <button key={entry} type="button" className={tab === entry ? 'is-active' : ''} onClick={() => setTab(entry)} style={{ flex: 1 }}>
            {entry[0].toUpperCase() + entry.slice(1)}
          </button>
        ))}
      </div>

      {tab !== 'gradients' ? (
        <div className="k-row" style={{ position: 'relative' }}>
          <Search size={13} color="var(--k-text-mute)" style={{ position: 'absolute', left: 9 }} />
          <input
            className="k-input"
            placeholder={tab === 'icons' ? 'Search icons' : 'Search'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ paddingLeft: 26 }}
          />
        </div>
      ) : null}

      <div className="k-scroll" style={{ flex: 1 }}>
        {tab === 'elements' ? (
          <>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {ELEMENT_CATEGORIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="k-chip"
                  onClick={() => setElementCategory(entry.id)}
                  style={{
                    cursor: 'pointer',
                    color: elementCategory === entry.id ? 'var(--k-accent-2)' : undefined,
                    borderColor: elementCategory === entry.id ? 'var(--k-accent)' : undefined
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ELEMENT_CATALOG.filter((element) => element.category === elementCategory).map((element) => {
                const preview = element.build({ width: 120, height: 120, accent })
                return (
                  <button
                    key={element.id}
                    type="button"
                    className="k-panel"
                    onClick={() => dropElement(element)}
                    style={{ padding: 8, cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)' }}
                    title={`Add ${element.label}`}
                  >
                    <ElementPreview nodes={preview} />
                    <div style={{ fontSize: 11, marginTop: 6, color: 'var(--k-text-dim)' }}>{element.label}</div>
                  </button>
                )
              })}
            </div>
          </>
        ) : null}

        {tab === 'shapes' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {SHAPE_CATALOG.map((shape) => (
                <button
                  key={shape.label}
                  type="button"
                  onClick={() => dropShape(shape.svg, shape.label)}
                  title={shape.label}
                  className="k-panel"
                  style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)', color: 'var(--k-text)' }}
                  dangerouslySetInnerHTML={{ __html: shape.svg }}
                />
              ))}
            </div>
            <div className="k-sep" />
            <span className="k-section-title">Lines &amp; arrows</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}>
              {LINES_AND_ARROWS.map((line) => (
                <button
                  key={line.label}
                  type="button"
                  onClick={() => dropShape(line.svg, line.label)}
                  title={line.label}
                  className="k-panel"
                  style={{ aspectRatio: '2', display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)', color: 'var(--k-text)' }}
                  dangerouslySetInnerHTML={{ __html: line.svg }}
                />
              ))}
            </div>
          </>
        ) : null}

        {tab === 'icons' ? (
          <>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {ICON_CATEGORIES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="k-chip"
                  onClick={() => setIconCategory(entry)}
                  style={{
                    cursor: 'pointer',
                    color: iconCategory === entry ? 'var(--k-accent-2)' : undefined,
                    borderColor: iconCategory === entry ? 'var(--k-accent)' : undefined
                  }}
                >
                  {entry}
                </button>
              ))}
            </div>
            <div className="k-row" style={{ gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>Colour</span>
              {['#FFFFFF', '#7C5CFF', '#FF5F7A', '#FFD166', '#38D39F', '#000000'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    const first = filteredIcons[0]
                    if (first) dropIcon(first.svg, first.label, color)
                  }}
                  style={{ width: 16, height: 16, borderRadius: 4, background: color, border: '1px solid var(--k-line)', cursor: 'pointer', padding: 0 }}
                  title={`Add icon in ${color}`}
                />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
              {filteredIcons.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  onClick={() => dropIcon(icon.svg, icon.label)}
                  title={icon.label}
                  className="k-panel"
                  style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)', color: 'var(--k-text)' }}
                  dangerouslySetInnerHTML={{ __html: icon.svg }}
                />
              ))}
            </div>
          </>
        ) : null}

        {tab === 'gradients' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => dropGradient(preset.fill.stops ?? [], preset.fill.angle ?? 90)}
                className="k-panel"
                style={{ overflow: 'hidden', cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)', padding: 0 }}
              >
                <div
                  style={{
                    height: 56,
                    background: `linear-gradient(${preset.fill.angle ?? 90}deg, ${preset.fill.stops?.[0]?.color}, ${preset.fill.stops?.[1]?.color})`
                  }}
                />
                <div style={{ padding: '5px 7px', fontSize: 11, textAlign: 'left', color: 'var(--k-text-dim)' }}>{preset.label}</div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
        {ICON_CATALOG.length} original icons · every element is generated in code.
      </p>
    </div>
  )
}

/** Renders a tiny live preview of a composite element definition. */
function ElementPreview({ nodes }: { nodes: SceneNode[] }): JSX.Element {
  const box = nodes.reduce(
    (acc, node) => ({
      x: Math.min(acc.x, node.x),
      y: Math.min(acc.y, node.y),
      width: Math.max(acc.width, node.x + node.width),
      height: Math.max(acc.height, node.y + node.height)
    }),
    { x: 0, y: 0, width: 1, height: 1 }
  )
  return (
    <div style={{ position: 'relative', height: 64, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: box.width, height: box.height, transform: `translate(${-box.x}px, ${-box.y}px)` }}>
        {nodes.slice(0, 24).map((node) => (
          <div
            key={node.id}
            style={
              node.kind === 'shape'
                ? {
                    position: 'absolute',
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    background: node.fill.type === 'solid' ? node.fill.color : `linear-gradient(${node.fill.angle ?? 90}deg, ${node.fill.stops?.[0]?.color}, ${node.fill.stops?.[1]?.color})`,
                    border: node.stroke ? `${node.stroke.width}px solid ${node.stroke.color}` : undefined,
                    borderRadius: node.shape === 'circle' ? '50%' : node.cornerRadius ? `${node.cornerRadius}%` : 2,
                    clipPath:
                      node.shape === 'triangle'
                        ? 'polygon(50% 0, 100% 100%, 0 100%)'
                        : node.shape === 'hexagon'
                          ? 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)'
                          : node.shape === 'star'
                            ? 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)'
                            : node.shape === 'diamond'
                              ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'
                              : node.shape === 'arrow'
                                ? 'polygon(0 32%, 60% 32%, 60% 6%, 100% 50%, 60% 94%, 60% 68%, 0 68%)'
                                : undefined,
                    opacity: node.opacity
                  }
                : {
                    position: 'absolute',
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    color: (node as { fill?: { color?: string } }).fill?.color,
                    fontSize: (node as { fontSize?: number }).fontSize,
                    fontWeight: (node as { fontWeight?: number }).fontWeight,
                    letterSpacing: (node as { letterSpacing?: number }).letterSpacing,
                    textAlign: (node as { align?: string }).align as never,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }
            }
          >
            {node.kind === 'text' ? node.text : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export const addSampleCaption = (): void => {
  const state = useEditorStore.getState()
  const page = state.activePage()
  if (!page) return
  const node = createTextNode({
    name: 'Caption',
    text: 'Your caption here',
    x: Math.round(page.width * 0.1),
    y: Math.round(page.height * 0.82),
    width: Math.round(page.width * 0.8),
    height: 48,
    fontSize: 24,
    fill: solid('#FFFFFF')
  })
  state.addNodes([node])
  notify.info('Caption added')
}

import { SHAPE_CATALOG } from '../../lib/catalogs/shapes'
import { useEditorActions } from '../../hooks/useEditorActions'
import type { ShapeKind } from '../../../../shared/types/document'

export function ShapesPanel(): JSX.Element {
  const actions = useEditorActions()
  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <span className="k-section-title">Shapes</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {SHAPE_CATALOG.map((shape) => (
          <button
            key={shape.label}
            type="button"
            onClick={() => actions.addShape(shape.kind as ShapeKind)}
            className="k-panel"
            title={`Add ${shape.label}`}
            style={{
              aspectRatio: '1',
              display: 'grid',
              placeItems: 'center',
              gap: 4,
              cursor: 'pointer',
              background: 'var(--k-panel-2)',
              border: '1px solid var(--k-line-soft)',
              color: 'var(--k-text)',
              padding: 6
            }}
          >
            <span dangerouslySetInnerHTML={{ __html: shape.svg }} style={{ display: 'grid', placeItems: 'center', width: 22, height: 22 }} />
            <span style={{ fontSize: 10, color: 'var(--k-text-mute)' }}>{shape.label}</span>
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
        Shapes are editable objects — change fill, gradient, outline, shadow and corner radius in the properties panel.
      </p>
    </div>
  )
}

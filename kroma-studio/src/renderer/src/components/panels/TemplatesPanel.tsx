import { useEffect, useMemo, useState } from 'react'
import { Search, Sparkles, Trash2, BookmarkPlus } from 'lucide-react'
import type { TemplateMeta } from '../../../../shared/types/project'
import { TEMPLATE_CATEGORIES } from '../../../../shared/constants'
import { Button } from '../ui/controls'
import { platform } from '../../platform'
import { useEditorStore } from '../../state/editor-store'
import { useUiStore, notify } from '../../state/ui-store'
import { assetUrl } from '../../../../shared/constants'
import { duplicateNodes } from '../../../../shared/utils/document'
import { sanitizeDocument } from '../../../../shared/utils/validation'

export function TemplatesPanel(): JSX.Element {
  const [category, setCategory] = useState<string>('All')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<TemplateMeta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        setItems(await platform.templates.list())
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((template) => {
      if (category !== 'All' && template.category !== category) return false
      if (!needle) return true
      return template.name.toLowerCase().includes(needle) || template.tags?.some((tag) => tag.toLowerCase().includes(needle))
    })
  }, [items, category, query])

  const applyTemplate = async (template: TemplateMeta): Promise<void> => {
    try {
      const record = await platform.templates.read(template.id)
      if (!record) {
        notify.error('That template could not be opened.')
        return
      }
      const document = sanitizeDocument(record.document)
      useEditorStore.getState().loadDocument(document)
      notify.success(`Opened “${template.name}”`, 'Edit anything — it is now your design.')
      useUiStore.getState().setLeftPanel('elements')
    } catch (error) {
      notify.error('Template could not be opened', error instanceof Error ? error.message : undefined)
    }
  }

  const deleteTemplate = async (template: TemplateMeta): Promise<void> => {
    try {
      await platform.templates.remove(template.id)
      setItems(await platform.templates.list())
      void useUiStore.getState().toast('success', `Deleted “${template.name}”`)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Template could not be deleted')
    }
  }

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <div className="k-row" style={{ gap: 6 }}>
        <div className="k-row" style={{ flex: 1, position: 'relative' }}>
          <Search size={13} color="var(--k-text-mute)" style={{ position: 'absolute', left: 9 }} />
          <input
            className="k-input"
            placeholder="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ paddingLeft: 26 }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {['All', ...TEMPLATE_CATEGORIES].map((entry) => (
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

      <div className="k-scroll" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
        {loading ? <div className="k-empty">Loading templates…</div> : null}
        {!loading && filtered.length === 0 ? (
          <div className="k-empty" style={{ gridColumn: '1 / -1' }}>
            <Sparkles size={18} />
            <span>No templates match yet</span>
            <span style={{ fontSize: 11 }}>Save your own design as a template from the File menu.</span>
          </div>
        ) : null}
        {filtered.map((template) => (
          <div
            key={template.id}
            className="k-panel"
            style={{ overflow: 'hidden', cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)' }}
            onClick={() => void applyTemplate(template)}
            onMouseEnter={(event) => (event.currentTarget.style.borderColor = 'var(--k-accent)')}
            onMouseLeave={(event) => (event.currentTarget.style.borderColor = 'var(--k-line-soft)')}
          >
            <div
              className="k-checker"
              style={{
                height: 92,
                display: 'grid',
                placeItems: 'center',
                background: template.thumbnailId ? `center / cover no-repeat url(${assetUrl(template.thumbnailId)})` : 'var(--k-panel-3)'
              }}
            >
              {!template.thumbnailId ? <Sparkles size={16} color="var(--k-text-mute)" /> : null}
            </div>
            <div style={{ padding: '7px 8px' }}>
              <div className="k-truncate" style={{ fontSize: 12, fontWeight: 600 }}>{template.name}</div>
              <div className="k-row-between" style={{ marginTop: 2 }}>
                <span style={{ fontSize: 10.5, color: 'var(--k-text-mute)' }}>
                  {template.width}×{template.height}
                </span>
                {!template.builtin ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void deleteTemplate(template)
                    }}
                    style={{ background: 'none', border: 0, color: 'var(--k-text-mute)', cursor: 'pointer', padding: 0 }}
                    title="Delete template"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : (
                  <span className="k-chip" style={{ height: 16, fontSize: 9.5 }}>built-in</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <SaveAsTemplateRow onSaved={() => void platform.templates.list().then(setItems)} />
    </div>
  )
}

function SaveAsTemplateRow({ onSaved }: { onSaved: () => void }): JSX.Element {
  const document = useEditorStore((state) => state.document)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('Posters')

  return (
    <details style={{ borderTop: '1px solid var(--k-line-soft)', paddingTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--k-text-dim)' }}>
        <BookmarkPlus size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
        Save current design as template
      </summary>
      <div className="k-col" style={{ gap: 6, marginTop: 8 }}>
        <input className="k-input" placeholder="Template name" value={name} onChange={(event) => setName(event.target.value)} />
        <select className="k-select" value={category} onChange={(event) => setCategory(event.target.value)}>
          {TEMPLATE_CATEGORIES.map((entry) => (
            <option key={entry} value={entry}>{entry}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="primary"
          disabled={!document || !name.trim()}
          onClick={() => {
            void (async () => {
              try {
                if (!document) return
                // Strip ids so the template never collides with the project.
                const clone = {
                  ...structuredClone(document),
                  pages: document.pages.map((page) => ({ ...page, nodes: duplicateNodes(page.nodes, { x: 0, y: 0 }) }))
                }
                await platform.templates.create({ name: name.trim(), category, document: clone })
                setName('')
                onSaved()
                notify.success('Template saved')
              } catch (error) {
                notify.error('Could not save template', error instanceof Error ? error.message : undefined)
              }
            })()
          }}
        >
          Save template
        </Button>
      </div>
    </details>
  )
}

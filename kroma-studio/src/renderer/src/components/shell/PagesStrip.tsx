import { useState } from 'react'
import { Plus, Copy, Trash2, ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { useEditorStore } from '../../state/editor-store'
import { useUiStore } from '../../state/ui-store'
import { notify } from '../../state/ui-store'
import { renderThumbnail } from '../../canvas/engine/render-page'

export function PagesStrip(): JSX.Element {
  const document = useEditorStore((state) => state.document)
  const activePageId = useEditorStore((state) => state.activePageId)
  const open = useUiStore((state) => state.pagesOpen)
  const togglePages = useUiStore((state) => state.togglePages)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (!document) return <></>

  const ensureThumb = (pageId: string): void => {
    if (thumbs[pageId]) return
    const page = document.pages.find((entry) => entry.id === pageId)
    if (!page) return
    void (async () => {
      try {
        const dataUrl = await renderThumbnail(page, 160)
        setThumbs((current) => ({ ...current, [pageId]: dataUrl }))
      } catch {
        /* thumbnails are best-effort */
      }
    })()
  }

  return (
    <div
      style={{
        height: open ? 'var(--k-pages)' : 34,
        flex: 'none',
        borderTop: '1px solid var(--k-line-soft)',
        background: 'var(--k-panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        overflowX: 'auto'
      }}
    >
      <button
        type="button"
        onClick={togglePages}
        title={open ? 'Hide pages' : 'Show pages'}
        className="k-row"
        style={{ background: 'none', border: 0, color: 'var(--k-text-dim)', cursor: 'pointer', gap: 5, flex: 'none' }}
      >
        <Layers size={13} />
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{document.pages.length} pages</span>
        {open ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--k-line)', flex: 'none' }} />

      <div className="k-row" style={{ gap: 8, flex: 'none' }}>
        {document.pages.map((page, index) => {
          const isActive = page.id === activePageId
          ensureThumb(page.id)
          return (
            <div
              key={page.id}
              onClick={() => useEditorStore.getState().setActivePage(page.id)}
              onDoubleClick={() => {
                setRenaming(page.id)
                setDraft(page.name)
              }}
              style={{
                width: 62,
                height: 62,
                borderRadius: 9,
                border: `2px solid ${isActive ? 'var(--k-accent)' : 'var(--k-line)'}`,
                background: thumbs[page.id] ? `center / cover no-repeat url(${thumbs[page.id]})` : 'var(--k-panel-2)',
                cursor: 'pointer',
                position: 'relative',
                flex: 'none'
              }}
              title={`${page.name} — ${page.width}×${page.height}`}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -1,
                  fontSize: 9.5,
                  textAlign: 'center',
                  background: 'rgba(8,8,14,0.78)',
                  borderBottomLeftRadius: 7,
                  borderBottomRightRadius: 7,
                  padding: '1px 2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {renaming === page.id ? '…' : page.name}
              </span>
              {isActive ? (
                <div className="k-row" style={{ position: 'absolute', top: 2, right: 2, gap: 1 }}>
                  <button
                    type="button"
                    title="Duplicate page"
                    onClick={(event) => {
                      event.stopPropagation()
                      useEditorStore.getState().duplicateActivePage()
                    }}
                    style={pageButtonStyle}
                  >
                    <Copy size={10} />
                  </button>
                  {document.pages.length > 1 ? (
                    <button
                      type="button"
                      title="Delete page"
                      onClick={(event) => {
                        event.stopPropagation()
                        useEditorStore.getState().deletePage(page.id)
                      }}
                      style={{ ...pageButtonStyle, color: 'var(--k-danger)' }}
                    >
                      <Trash2 size={10} />
                    </button>
                  ) : null}
                  {index > 0 ? (
                    <button
                      type="button"
                      title="Move left"
                      onClick={(event) => {
                        event.stopPropagation()
                        useEditorStore.getState().reorderPage(page.id, -1)
                      }}
                      style={pageButtonStyle}
                    >
                      <ChevronLeft size={10} />
                    </button>
                  ) : null}
                  {index < document.pages.length - 1 ? (
                    <button
                      type="button"
                      title="Move right"
                      onClick={(event) => {
                        event.stopPropagation()
                        useEditorStore.getState().reorderPage(page.id, 1)
                      }}
                      style={pageButtonStyle}
                    >
                      <ChevronRight size={10} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => {
            useEditorStore.getState().addPage()
            notify.info('Page added')
          }}
          title="Add page"
          style={{
            width: 62,
            height: 62,
            borderRadius: 9,
            border: '1px dashed var(--k-line)',
            background: 'transparent',
            color: 'var(--k-text-dim)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            flex: 'none'
          }}
        >
          <Plus size={16} />
        </button>
      </div>

      {renaming ? (
        <input
          autoFocus
          className="k-input"
          style={{ width: 150, height: 26 }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim()) useEditorStore.getState().renamePage(renaming, draft.trim())
            setRenaming(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            if (event.key === 'Escape') setRenaming(null)
          }}
        />
      ) : null}
    </div>
  )
}

const pageButtonStyle: React.CSSProperties = {
  background: 'rgba(8,8,14,0.75)',
  border: 0,
  color: 'var(--k-text-dim)',
  cursor: 'pointer',
  padding: 2,
  borderRadius: 4,
  display: 'grid',
  placeItems: 'center'
}

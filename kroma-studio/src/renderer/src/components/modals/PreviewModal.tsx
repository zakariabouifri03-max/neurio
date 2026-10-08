import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/controls'
import { useEditorStore } from '../../state/editor-store'
import { renderPageToCanvas } from '../../canvas/engine/render-page'

export function PreviewModal({ onClose }: { onClose: () => void }): JSX.Element {
  const document = useEditorStore((state) => state.document)
  const activePageId = useEditorStore((state) => state.activePageId)
  const [index, setIndex] = useState(() => Math.max(0, document?.pages.findIndex((page) => page.id === activePageId) ?? 0))
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  const pages = useMemo(() => document?.pages ?? [], [document])
  const page = pages[index]

  useEffect(() => {
    if (!page) return
    let cancelled = false
    setBusy(true)
    void (async () => {
      try {
        const canvas = await renderPageToCanvas(page, { width: Math.min(1600, page.width), height: Math.round((Math.min(1600, page.width) / page.width) * page.height) })
        if (!cancelled) setDataUrl(canvas.toDataURL('image/png'))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  return (
    <Modal
      title="Preview"
      subtitle={page ? `${page.name} · ${page.width} × ${page.height}` : undefined}
      onClose={onClose}
      width={880}
      footer={
        <>
          <Button variant="ghost" icon={ChevronLeft} disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
            Previous
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" icon={ChevronRight} disabled={index >= pages.length - 1} onClick={() => setIndex((value) => Math.min(pages.length - 1, value + 1))}>
            Next
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close preview
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        {busy ? (
          <span className="k-row" style={{ gap: 8, color: 'var(--k-text-dim)' }}>
            <Loader2 size={14} className="k-spin" /> Rendering preview…
          </span>
        ) : null}
        {!busy && dataUrl ? (
          <img
            src={dataUrl}
            alt={page?.name ?? 'Preview'}
            className="k-checker"
            style={{ maxWidth: '100%', maxHeight: '58vh', borderRadius: 8, border: '1px solid var(--k-line)', objectFit: 'contain' }}
          />
        ) : null}
      </div>
      <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--k-text-mute)', marginTop: 10 }}>
        Page {index + 1} of {pages.length} · press ← / → to navigate
      </p>
    </Modal>
  )
}

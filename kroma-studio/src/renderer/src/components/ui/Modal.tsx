import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './controls'

export interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** Blocks closing while an operation is running. */
  busy?: boolean
}

export function Modal({ title, subtitle, onClose, children, footer, width = 560, busy }: ModalProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,12,0.66)',
        backdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 500,
        animation: 'k-fade 140ms var(--k-ease)'
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className="k-panel"
        role="dialog"
        aria-modal="true"
        style={{
          width,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 64px)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--k-shadow-3)',
          outline: 'none',
          background: 'var(--k-panel)'
        }}
      >
        <header
          className="k-row-between"
          style={{ padding: '14px 16px', borderBottom: '1px solid var(--k-line-soft)' }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 650 }}>{title}</div>
            {subtitle ? <div style={{ fontSize: 12, color: 'var(--k-text-dim)' }}>{subtitle}</div> : null}
          </div>
          <Button icon={X} variant="ghost" onClick={onClose} disabled={busy} title="Close" />
        </header>
        <div className="k-scroll" style={{ padding: 16, overflowY: 'auto' }}>
          {children}
        </div>
        {footer ? (
          <footer className="k-row" style={{ padding: '12px 16px', borderTop: '1px solid var(--k-line-soft)', justifyContent: 'flex-end' }}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

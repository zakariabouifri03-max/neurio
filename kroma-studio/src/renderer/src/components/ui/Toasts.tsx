import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'
import { useUiStore } from '../../state/ui-store'

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
} as const

const COLORS = {
  success: 'var(--k-ok)',
  error: 'var(--k-danger)',
  warning: 'var(--k-warn)',
  info: 'var(--k-info)'
} as const

export function Toasts(): JSX.Element {
  const toasts = useUiStore((state) => state.toasts)
  const dismiss = useUiStore((state) => state.dismissToast)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 900,
        pointerEvents: 'none',
        maxWidth: 520
      }}
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div
            key={toast.id}
            className="k-panel k-fade-in"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              pointerEvents: 'auto',
              boxShadow: 'var(--k-shadow-2)',
              borderColor: COLORS[toast.kind],
              background: 'var(--k-panel-2)',
              minWidth: 280
            }}
          >
            <Icon size={16} color={COLORS[toast.kind]} style={{ marginTop: 1, flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{toast.message}</div>
              {toast.details ? (
                <div style={{ fontSize: 11, color: 'var(--k-text-mute)', marginTop: 3, wordBreak: 'break-word' }}>{toast.details}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              style={{ background: 'none', border: 0, color: 'var(--k-text-mute)', cursor: 'pointer', padding: 0 }}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

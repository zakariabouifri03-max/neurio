'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, Loader2 } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';
export type Toast = { id: string; kind: ToastKind; title: string; description?: string; duration?: number };

type ToastApi = {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  loading: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
  update: (id: string, patch: Partial<Toast>) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      counter += 1;
      const id = `toast_${counter}`;
      setToasts((list) => [...list.slice(-4), { ...toast, id }]);
      if (toast.kind !== 'loading') {
        window.setTimeout(() => dismiss(id), toast.duration ?? (toast.kind === 'error' ? 6000 : 3200));
      }
      return id;
    },
    [dismiss],
  );

  const update = useCallback((id: string, patch: Partial<Toast>) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.kind && patch.kind !== 'loading') {
      window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
    }
  }, []);

  const value = useMemo<ToastApi>(
    () => ({
      toasts,
      push,
      dismiss,
      update,
      success: (title, description) => push({ kind: 'success', title, description }),
      error: (title, description) => push({ kind: 'error', title, description }),
      info: (title, description) => push({ kind: 'info', title, description }),
      loading: (title, description) => push({ kind: 'loading', title, description }),
    }),
    [toasts, push, dismiss, update],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 z-[9999] flex w-full flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:w-auto sm:items-end sm:px-0"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
            className="animate-pop-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-pop)]"
          >
            <span className="mt-0.5 shrink-0">
              {toast.kind === 'success' && <CheckCircle2 size={18} className="text-[var(--accent)]" />}
              {toast.kind === 'error' && <AlertTriangle size={18} className="text-[var(--danger)]" />}
              {toast.kind === 'info' && <Info size={18} className="text-[var(--brand)]" />}
              {toast.kind === 'loading' && <Loader2 size={18} className="animate-spin text-[var(--brand)]" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--text)]">{toast.title}</p>
              {toast.description && <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">{toast.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded-md p-1 text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

import { useEffect } from 'react';
import { useEditor } from '../store/editorStore';
import { Icons } from './Icons';
import { clsx } from 'clsx';

/**
 * Toasts.
 *
 * Errors are always human-readable and always offer a way forward. A toast that
 * says "FFmpeg exited with code 1" is a bug in whatever produced it.
 */

const STYLES = {
  info: { border: 'border-ink-700', accent: 'text-accent', Icon: Icons.Info },
  success: { border: 'border-brand-500/50', accent: 'text-brand-300', Icon: Icons.Check },
  warning: { border: 'border-accent-warm/50', accent: 'text-accent-warm', Icon: Icons.Warning },
  error: { border: 'border-accent-danger/50', accent: 'text-accent-danger', Icon: Icons.Warning },
} as const;

const AUTO_DISMISS_MS = { info: 4000, success: 3500, warning: 8000, error: 0 } as const;

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} id={toast.id} kind={toast.kind} title={toast.title} message={toast.message} actions={toast.actions} />
      ))}
    </div>
  );
}

interface ToastCardProps {
  id: string;
  kind: keyof typeof STYLES;
  title: string;
  message?: string;
  actions?: { label: string; run: () => void }[];
}

function ToastCard({ id, kind, title, message, actions }: ToastCardProps) {
  const dismissToast = useEditor((s) => s.dismissToast);
  const style = STYLES[kind];
  const timeout = AUTO_DISMISS_MS[kind];

  useEffect(() => {
    if (timeout <= 0) return;
    const timer = window.setTimeout(() => dismissToast(id), timeout);
    return () => window.clearTimeout(timer);
  }, [id, timeout, dismissToast]);

  return (
    <div
      className={clsx('panel pointer-events-auto p-2.5 border animate-slide-in', style.border)}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <div className="flex items-start gap-2">
        <style.Icon size={15} className={clsx('mt-0.5 shrink-0', style.accent)} />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-ink-100 leading-snug">{title}</p>
          {message && <p className="text-[11px] text-ink-400 mt-0.5 leading-relaxed whitespace-pre-wrap">{message}</p>}
          {actions && actions.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  className="btn h-6 px-2 text-[10px]"
                  onClick={() => {
                    action.run();
                    dismissToast(id);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="text-ink-500 hover:text-ink-200 shrink-0" onClick={() => dismissToast(id)} aria-label="Dismiss">
          <Icons.Close size={13} />
        </button>
      </div>
    </div>
  );
}

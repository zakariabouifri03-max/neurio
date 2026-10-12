/** Bottom-right toast stack for errors and confirmations. */
import { useStore } from '../lib/store';
import { useShallow } from 'zustand/react/shallow';

export function Toasts() {
  const { toasts, dismissToast } = useStore(useShallow((state) => ({ toasts: state.toasts, dismissToast: state.dismissToast })));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-tone={toast.tone}>
          <span>{toast.message}</span>
          <button className="icon-button tiny" onClick={() => dismissToast(toast.id)} title="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

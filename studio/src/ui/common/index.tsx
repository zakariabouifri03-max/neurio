import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Diamond, Search, Star, X } from 'lucide-react';
import { useUI } from '@/core/uiStore';

export function Modal({ title, children, footer, onClose, wide, icon }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; icon?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog">
        <div className="modal-header">
          {icon}
          <span style={{ flex: 1 }}>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, actions, id }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode; id?: string }) {
  const key = `neurio.sec.${id || title}`;
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === '1';
  });
  return (
    <div className="section">
      <div
        className="section-title"
        onClick={() => {
          setOpen(!open);
          localStorage.setItem(key, open ? '0' : '1');
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </span>
        {actions && (
          <span className="actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  format?: (v: number) => string;
  /** keyframe button state */
  kf?: { has: boolean; on: boolean; toggle: () => void };
  unit?: string;
  defaultValue?: number;
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, kf, unit, defaultValue }: SliderProps) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (format ? format(value) : String(Math.round(value * 100) / 100));
  return (
    <div className="slider-row">
      <span
        className={`lbl ${kf?.has ? 'keyed' : ''}`}
        title={`${label}${defaultValue !== undefined ? ' — double-click to reset' : ''}`}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      >
        {label}
      </span>
      <input type="range" min={min} max={max} step={step} value={isFinite(value) ? value : 0} onChange={(e) => onChange(parseFloat(e.target.value))} onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)} />
      <input
        type="text"
        inputMode="decimal"
        className="num"
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = parseFloat(text);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            setText(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(null);
        }}
        title={unit}
      />
      {kf ? (
        <button className={`kf-btn ${kf.has ? 'has' : ''} ${kf.on ? 'on' : ''}`} onClick={kf.toggle} title={kf.on ? 'Remove keyframe at playhead' : kf.has ? 'Add keyframe at playhead' : 'Enable keyframes'}>
          <Diamond />
        </button>
      ) : (
        <span style={{ width: 18 }} />
      )}
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="row" style={{ cursor: 'pointer' }} title={hint}>
      <span className="lbl" style={{ width: 'auto', flex: 1 }}>
        {label}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="row">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColorRow({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return (
    <div className="row">
      <label>{label}</label>
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
      <input type="text" value={value ?? ''} placeholder={allowNone ? 'none' : ''} onChange={(e) => onChange(e.target.value || (allowNone ? null : '#ffffff'))} style={{ width: 90, fontFamily: 'var(--mono)', fontSize: 11 }} />
      {allowNone && value && (
        <button className="icon-btn sm" onClick={() => onChange(null)} title="Remove">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Search />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange, all }: { items: T[]; value: T | null; onChange: (v: T | null) => void; all?: string }) {
  return (
    <div className="chips scroll">
      {all && (
        <button className={`chip ${value === null ? 'active' : ''}`} onClick={() => onChange(null)}>
          {all}
        </button>
      )}
      {items.map((i) => (
        <button key={i} className={`chip ${value === i ? 'active' : ''}`} onClick={() => onChange(i)}>
          {i}
        </button>
      ))}
    </div>
  );
}

export function FavButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      className={`fav ${on ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={on ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Star fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => t.kind !== 'progress' && dismiss(t.id)}>
          <div className="dot" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{t.title}</div>
            {t.message && <div className="m">{t.message}</div>}
            {t.kind === 'progress' && (
              <div className="progress">
                <div style={{ width: `${Math.round((t.progress ?? 0) * 100)}%` }} />
              </div>
            )}
          </div>
          {t.kind !== 'progress' && (
            <button className="icon-btn sm" onClick={() => dismiss(t.id)}>
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ({ label: string; shortcut?: string; onClick: () => void; disabled?: boolean; danger?: boolean } | 'sep')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const style: React.CSSProperties = { left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - items.length * 30 - 20) };
  return (
    <div className="ctx-menu" style={style} ref={ref}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <div className="sep" key={i} />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            style={it.danger ? { color: '#fda4af' } : undefined}
            onClick={() => {
              it.onClick();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

export function useDropFiles(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        if (e.dataTransfer.files?.length) {
          e.preventDefault();
          setOver(false);
          onFiles(Array.from(e.dataTransfer.files));
        }
      },
    },
  };
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

export function Spinner() {
  return <div className="spinner" />;
}

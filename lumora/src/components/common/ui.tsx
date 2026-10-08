import React from 'react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 94vw)` } : undefined} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <input
        className="input"
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {suffix ? <span className="muted">{suffix}</span> : null}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  display
}: {
  value: number;
  onChange: (n: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  display?: string;
}) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label" style={{ margin: 0 }}>
          {label}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {display ?? Math.round(value * 100) / 100}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
      />
    </div>
  );
}

export function ColorInput({
  value,
  onChange,
  allowTransparent
}: {
  value: string;
  onChange: (v: string) => void;
  allowTransparent?: boolean;
}) {
  const safe = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#000000';
  return (
    <div className="row">
      <input type="color" value={safe} onChange={(e) => onChange(e.target.value)} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {allowTransparent ? (
        <button className="btn sm" title="Transparent" onClick={() => onChange('transparent')}>
          ⌀
        </button>
      ) : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="muted" style={{ padding: '18px 4px', textAlign: 'center', fontSize: 12 }}>
      {text}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row muted" style={{ fontSize: 12 }}>
      <span
        style={{
          width: 13,
          height: 13,
          border: '2px solid var(--line)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          display: 'inline-block',
          animation: 'spin 0.8s linear infinite'
        }}
      />
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      {label ?? 'Working…'}
    </div>
  );
}

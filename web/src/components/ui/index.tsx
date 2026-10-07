'use client';

/**
 * Prism design system primitives.
 *
 * One consistent implementation per pattern (button, input, modal, menu, toast…)
 * so spacing, focus rings, motion and keyboard behaviour are identical
 * everywhere in the product.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Loader2, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { contrastRatio, contrastRating, parseColor, toHex, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, mix, withAlpha, isDark, CURATED_PALETTES } from '@/engine/color';

/* ------------------------------------------------------------------ button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', className)}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active,
  size = 34,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: string; active?: boolean; size?: number }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center justify-center rounded-[9px] border transition',
        active
          ? 'border-transparent bg-[var(--brand)] text-white'
          : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------- input */

export function Field({
  label,
  hint,
  error,
  children,
  className,
  suffix,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
  suffix?: ReactNode;
}) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">{label}</span>}
      <span className="relative block">
        {children}
        {suffix && <span className="absolute inset-y-0 end-2 flex items-center text-[11px] text-[var(--text-faint)]">{suffix}</span>}
      </span>
      {error ? <span className="mt-1 block text-[11px] text-[var(--danger)]">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-[var(--text-faint)]">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('field', className)} {...rest} />;
}

export function TextArea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('field resize-none', className)} {...rest} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="field ps-9 pe-8"
        aria-label={placeholder ?? 'Search'}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-faint)] hover:text-[var(--text)]"
          aria-label="Clear search"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  label,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  label?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => {
    setText(String(Math.round(value * 100) / 100));
  }, [value]);

  const commit = (raw: string) => {
    let next = Number(raw);
    if (!isFinite(next)) next = value;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(next);
    setText(String(Math.round(next * 100) / 100));
  };

  return (
    <div className={clsx('relative', className)}>
      <input
        value={text}
        aria-label={label}
        inputMode="decimal"
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            commit(String(value + (event.shiftKey ? step * 10 : step)));
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            commit(String(value - (event.shiftKey ? step * 10 : step)));
          }
        }}
        className="field pe-7 text-center"
      />
      {suffix && <span className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-faint)]">{suffix}</span>}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  suffix = '',
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--bg-active)] accent-[var(--brand)]"
        style={{ accentColor: 'var(--brand)' }}
      />
      <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">
        {Math.round(value * 100) / 100}
        {suffix}
      </span>
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  label?: string;
}) {
  return (
    <div className={clsx('relative', className)}>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as T)}
        className="field cursor-pointer appearance-none pe-7"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="tablist"
      className={clsx('inline-flex items-center gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-panel-2)] p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          title={option.title}
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'flex items-center justify-center rounded-[7px] font-medium transition',
            size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-8 px-3 text-[12px]',
            value === option.value
              ? 'bg-[var(--bg-elevated)] text-[var(--text)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition',
        checked ? 'bg-[var(--brand)]' : 'bg-[var(--bg-active)]',
      )}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
        style={{ left: checked ? 18 : 2 }}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div
        className="animate-fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        className="animate-pop-in relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-panel)]"
        style={{ maxWidth: width }}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
            <h2 className="text-[14px] font-semibold text-[var(--text)]">{title}</h2>
            <IconButton icon={<X size={16} />} label="Close" onClick={onClose} />
          </div>
        )}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------------- popover */

export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  width = 240,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className="animate-pop-in absolute z-[800] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-pop)]"
          style={{
            width,
            top: side === 'bottom' ? 'calc(100% + 6px)' : undefined,
            bottom: side === 'top' ? 'calc(100% + 6px)' : undefined,
            left: align === 'start' ? 0 : align === 'end' ? 'auto' : '50%',
            right: align === 'end' ? 0 : undefined,
            transform: align === 'center' ? 'translateX(-50%)' : undefined,
          }}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  active,
  danger,
  shortcut,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition',
        danger ? 'text-[var(--danger)] hover:bg-[rgba(255,92,92,.12)]' : 'text-[var(--text)] hover:bg-[var(--bg-hover)]',
        active && 'bg-[var(--bg-hover)]',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {icon && <span className="flex w-4 shrink-0 items-center justify-center text-[var(--text-muted)]">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="kbd">{shortcut}</span>}
    </button>
  );
}

/* -------------------------------------------------------------- color picker */

export function ColorPicker({
  value,
  onChange,
  label,
  allowAlpha = true,
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  allowAlpha?: boolean;
}) {
  const color = parseColor(value);
  const alpha = color.a ?? 1;
  const [mode, setMode] = useState<'swatch' | 'hex' | 'hsl'>('swatch');
  const [hexText, setHexText] = useState(toHex(color));
  const [hsl, setHsl] = useState(() => rgbToHsl(color));

  useEffect(() => {
    setHexText(value.startsWith('#') ? value : toHex(parseColor(value)));
    setHsl(rgbToHsl(parseColor(value)));
  }, [value]);

  const commitHex = (raw: string) => {
    const next = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9a-f]{6}$/i.test(next) || /^#[0-9a-f]{8}$/i.test(next)) onChange(next);
  };

  const commitHsl = (patch: Partial<typeof hsl>) => {
    const next = { ...hsl, ...patch };
    setHsl(next);
    onChange(toHex(hslToRgb(next)));
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-2">
        <div
          className="h-8 w-8 shrink-0 rounded-lg border border-[var(--border)]"
          style={{
            backgroundImage:
              'linear-gradient(45deg, #3a3a4a 25%, transparent 25%, transparent 75%, #3a3a4a 75%), linear-gradient(45deg, #3a3a4a 25%, transparent 25%, transparent 75%, #3a3a4a 75%)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 4px 4px',
          }}
        >
          <div className="h-full w-full rounded-lg" style={{ background: withAlpha(toHex(color), alpha) }} />
        </div>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'swatch', label: 'Swatches' },
            { value: 'hex', label: 'HEX' },
            { value: 'hsl', label: 'HSL' },
          ]}
        />
      </div>

      {mode === 'swatch' && (
        <div className="space-y-2">
          {CURATED_PALETTES.slice(0, 8).map((palette) => (
            <div key={palette.name} className="flex gap-1">
              {palette.colors.map((colorValue) => (
                <button
                  key={colorValue}
                  type="button"
                  title={colorValue}
                  onClick={() => onChange(colorValue)}
                  className={clsx(
                    'h-6 flex-1 rounded-md border transition hover:scale-[1.06]',
                    toHex(parseColor(value)).toLowerCase() === colorValue.toLowerCase()
                      ? 'border-white ring-2 ring-[var(--brand)]'
                      : 'border-black/20',
                  )}
                  style={{ background: colorValue }}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {mode === 'hex' && (
        <div className="space-y-2">
          <TextInput value={hexText} onChange={(event) => setHexText(event.target.value)} onBlur={(event) => commitHex(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && commitHex((event.target as HTMLInputElement).value)} placeholder="#6C5CE7" />
          <div className="flex gap-1">
            {['#000000', '#ffffff', '#6C5CE7', '#00B894', '#FD79A8', '#FDCB6E', '#0984E3', '#E17055', '#2D3436', 'transparent'].map((swatch) => (
              <button
                key={swatch}
                type="button"
                title={swatch}
                onClick={() => onChange(swatch)}
                className="h-6 flex-1 rounded-md border border-black/20"
                style={{ background: swatch === 'transparent' ? 'repeating-conic-gradient(#888 0% 25%, #fff 0% 50%) 50% / 8px 8px' : swatch }}
              />
            ))}
          </div>
        </div>
      )}

      {mode === 'hsl' && (
        <div className="space-y-2">
          <Slider label="Hue" value={Math.round(hsl.h)} min={0} max={360} onChange={(h) => commitHsl({ h })} suffix="°" />
          <Slider label="Saturation" value={Math.round(hsl.s * 100)} min={0} max={100} onChange={(s) => commitHsl({ s: s / 100 })} suffix="%" />
          <Slider label="Lightness" value={Math.round(hsl.l * 100)} min={0} max={100} onChange={(l) => commitHsl({ l: l / 100 })} suffix="%" />
        </div>
      )}

      {allowAlpha && (
        <div className="mt-2">
          <Slider label="Opacity" value={Math.round(alpha * 100)} min={0} max={100} onChange={(a) => onChange(withAlpha(toHex(color), a / 100))} suffix="%" />
        </div>
      )}

      {label && <ContrastChecker color={value} />}
    </div>
  );
}

export function ContrastChecker({ color }: { color: string }) {
  const [against, setAgainst] = useState('#ffffff');
  const ratio = contrastRatio(color, against);
  const rating = contrastRating(ratio);
  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Contrast</span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{
            background: rating === 'Fail' ? 'rgba(255,92,92,.16)' : 'rgba(0,184,148,.16)',
            color: rating === 'Fail' ? '#ff8080' : 'var(--accent)',
          }}
        >
          {rating} · {ratio.toFixed(2)}:1
        </span>
      </div>
      <div className="mb-2 flex h-8 items-center justify-center rounded" style={{ background: against, color }}>
        <span className="text-[12px] font-semibold">Aa sample text</span>
      </div>
      <div className="flex items-center gap-1">
        {['#ffffff', '#000000', '#12121a', '#f5f6f8'].map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => setAgainst(swatch)}
            className={clsx('h-5 flex-1 rounded border', against === swatch ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]' : 'border-black/20')}
            style={{ background: swatch }}
          />
        ))}
      </div>
    </div>
  );
}

export function ColorSwatch({ color, onClick, size = 20, title }: { color: string; onClick?: () => void; size?: number; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? color}
      onClick={onClick}
      className="rounded-md border border-black/25 transition hover:scale-110"
      style={{ background: color, width: size, height: size }}
    />
  );
}

/* ------------------------------------------------------------- misc pieces */

export function Section({
  title,
  children,
  action,
  dense,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  dense?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1.5 text-left">
          {open ? <ChevronDown size={13} className="text-[var(--text-faint)]" /> : <ChevronRight size={13} className="text-[var(--text-faint)]" />}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">{title}</span>
        </button>
        {action}
      </div>
      {open && <div className={clsx('px-3 pb-3', dense && 'space-y-1.5')}>{children}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-[var(--text-faint)]">{icon}</div>}
      <p className="text-[13px] font-semibold text-[var(--text)]">{title}</p>
      {description && <p className="max-w-[260px] text-[12px] leading-relaxed text-[var(--text-muted)]">{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-[var(--brand)]" />;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="w-full">
      {label && <div className="mb-1 flex justify-between text-[11px] text-[var(--text-muted)]"><span>{label}</span><span>{Math.round(value)}%</span></div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-active)]">
        <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function Chip({ children, active, onClick, icon }: { children: ReactNode; active?: boolean; onClick?: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'chip shrink-0 transition',
        active && 'border-transparent bg-[var(--brand)] text-white',
        !active && 'hover:border-[var(--border-strong)] hover:text-[var(--text)]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Tooltip({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-[900] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text)] opacity-0 shadow-[var(--shadow-pop)] transition group-hover/tt:opacity-100">
        {tip}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export { Check };

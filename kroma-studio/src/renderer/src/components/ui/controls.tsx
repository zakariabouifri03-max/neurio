import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { hexToRgb, hslToHex, readableOn, rgbToHex } from '../../../../shared/utils/color'
import { clamp } from '../../../../shared/utils/geometry'

/* --------------------------------- Button -------------------------------- */

export interface ButtonProps {
  children?: ReactNode
  icon?: LucideIcon
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  active?: boolean
  title?: string
  className?: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit'
}

export function Button({ children, icon: Icon, variant = 'default', size = 'md', disabled, active, title, className, onClick, type = 'button' }: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'k-btn',
        variant === 'primary' && 'k-btn--primary',
        variant === 'ghost' && 'k-btn--ghost',
        variant === 'danger' && 'k-btn--danger',
        size === 'sm' && 'k-btn--sm',
        active && 'is-active',
        !children && 'k-btn--icon',
        className
      )}
    >
      {Icon ? <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2} /> : null}
      {children}
    </button>
  )
}

/* ------------------------------- IconButton ------------------------------- */

export interface IconButtonProps {
  icon: LucideIcon
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  size?: number
  variant?: 'default' | 'ghost' | 'danger' | 'primary'
}

export function IconButton({ icon: Icon, label, onClick, active, disabled, size = 15, variant = 'ghost' }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx('k-btn k-btn--icon', variant === 'ghost' ? 'k-btn--ghost' : '', variant === 'danger' ? 'k-btn--danger' : '', variant === 'primary' ? 'k-btn--primary' : '', active && 'is-active')}
    >
      <Icon size={size} strokeWidth={2} />
    </button>
  )
}

/* ---------------------------------- Field -------------------------------- */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): JSX.Element {
  return (
    <div className="k-field">
      <label>{label}</label>
      {children}
      {hint ? <span style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>{hint}</span> : null}
    </div>
  )
}

/* ------------------------------ NumberInput ------------------------------ */

export interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  precision?: number
  disabled?: boolean
  ariaLabel?: string
}

/** Numeric field with drag-to-scrub, unit suffix and clamped commit. */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, min = -100000, max = 100000, step = 1, suffix, precision = 2, disabled, ariaLabel },
  ref
) {
  const [draft, setDraft] = useState<string | null>(null)
  const dragRef = useRef<{ startY: number; startValue: number; active: boolean } | null>(null)

  const display = draft ?? (Number.isFinite(value) ? String(Number(value.toFixed(precision))) : '0')

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw.replace(/[^\d.\-+eE]/g, ''))
      setDraft(null)
      if (!Number.isFinite(parsed)) return
      onChange(clamp(Number(parsed.toFixed(precision)), min, max))
    },
    [max, min, onChange, precision]
  )

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--k-bg-2)',
        border: '1px solid var(--k-line)',
        borderRadius: 'var(--k-r)',
        height: 32,
        paddingRight: suffix ? 26 : 8
      }}
    >
      {suffix ? (
        <span
          style={{
            width: 22,
            textAlign: 'center',
            color: 'var(--k-text-mute)',
            fontSize: 11,
            cursor: 'ew-resize',
            userSelect: 'none',
            touchAction: 'none'
          }}
          onPointerDown={(event) => {
            dragRef.current = { startY: event.clientX, startValue: value, active: true }
            ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag?.active) return
            const delta = event.clientX - drag.startY
            onChange(clamp(Number((drag.startValue + delta * step).toFixed(precision)), min, max))
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
        >
          {suffix}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-label={ariaLabel}
        disabled={disabled}
        value={display}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit((event.target as HTMLInputElement).value)
            ;(event.target as HTMLInputElement).blur()
          } else if (event.key === 'Escape') {
            setDraft(null)
            ;(event.target as HTMLInputElement).blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const direction = event.key === 'ArrowUp' ? 1 : -1
            const multiplier = event.shiftKey ? 10 : 1
            onChange(clamp(Number((value + step * direction * multiplier).toFixed(precision)), min, max))
            setDraft(null)
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          background: 'transparent',
          color: 'var(--k-text)',
          outline: 'none',
          padding: '0 8px',
          fontFamily: 'var(--k-mono)',
          fontSize: 12
        }}
      />
    </div>
  )
})

/* --------------------------------- Slider -------------------------------- */

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  format
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  format?: (value: number) => string
}): JSX.Element {
  const id = useId()
  return (
    <div className="k-field">
      {label ? (
        <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{label}</span>
          <span style={{ color: 'var(--k-text-dim)', fontFamily: 'var(--k-mono)' }}>{format ? format(value) : value}</span>
        </label>
      ) : null}
      <input
        id={id}
        className="k-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

/* --------------------------------- Toggle -------------------------------- */

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }): JSX.Element {
  return (
    <button
      type="button"
      className="k-row-between"
      onClick={() => onChange(!checked)}
      style={{ background: 'none', border: 0, padding: '4px 0', cursor: 'pointer', width: '100%' }}
    >
      {label ? <span style={{ fontSize: 12.5 }}>{label}</span> : null}
      <span className={clsx('k-switch', checked && 'is-on')} />
    </button>
  )
}

/* ------------------------------- Segmented ------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon; title?: string }>
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="k-segmented">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            title={option.title ?? option.label}
            className={clsx(value === option.value && 'is-active')}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={13} /> : option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------ ColorSwatch ------------------------------ */

const SWATCHES = [
  '#FFFFFF', '#F5F3FF', '#C9B8FF', '#7C5CFF', '#4B2FD6', '#0F1024', '#000000',
  '#FF5F7A', '#FF7B00', '#FFD166', '#38D39F', '#00B4D8', '#57B8FF', '#FF2EC4',
  '#8B5A2B', '#C87941', '#E8C39E', '#40916C', '#1B4332', '#95D5B2'
]

export interface ColorPickerProps {
  value: string
  onChange: (value: string) => void
  allowTransparent?: boolean
  label?: string
}

export function ColorPicker({ value, onChange, allowTransparent, label }: ColorPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const safe = /^#([0-9a-f]{6})$/i.test(value) ? value : value === 'transparent' ? '#000000' : '#7C5CFF'
  const rgb = hexToRgb(safe)

  return (
    <div ref={ref} style={{ position: 'relative' }} className="k-field">
      {label ? <label>{label}</label> : null}
      <div className="k-row" style={{ gap: 6 }}>
        <button
          type="button"
          className="k-swatch k-checker"
          style={{ background: value === 'transparent' ? 'transparent' : value, borderColor: 'var(--k-line)' }}
          onClick={() => setOpen((v) => !v)}
          title={value}
        />
        <input
          className="k-input"
          style={{ flex: 1, fontFamily: 'var(--k-mono)', fontSize: 12, textTransform: 'uppercase' }}
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </div>
      {open ? (
        <div
          className="k-panel k-fade-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            padding: 10,
            width: 232,
            boxShadow: 'var(--k-shadow-3)',
            background: 'var(--k-panel)'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                title={color}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  border: color.toUpperCase() === value.toUpperCase() ? '2px solid var(--k-accent-2)' : '1px solid var(--k-line)',
                  background: color,
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
          </div>
          <div className="k-sep" />
          <div className="k-row" style={{ gap: 6 }}>
            {(['r', 'g', 'b'] as const).map((channel) => (
              <label key={channel} className="k-row" style={{ gap: 4, flex: 1 }}>
                <span style={{ fontSize: 11, color: 'var(--k-text-mute)', textTransform: 'uppercase' }}>{channel}</span>
                <input
                  className="k-input"
                  style={{ height: 26, fontFamily: 'var(--k-mono)', fontSize: 11, padding: '0 6px' }}
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[channel]}
                  onChange={(event) => {
                    const next = { ...rgb, [channel]: clamp(Number(event.target.value), 0, 255) }
                    onChange(rgbToHex(next).toUpperCase())
                  }}
                />
              </label>
            ))}
          </div>
          <div className="k-row" style={{ gap: 6, marginTop: 8 }}>
            <input
              className="k-slider"
              style={{ flex: 1 }}
              type="range"
              min={0}
              max={360}
              value={hueOf(safe)}
              onChange={(event) => onChange(hslToHexSafe(Number(event.target.value), 0.7, 0.55))}
              aria-label="Hue"
            />
            {allowTransparent ? (
              <button type="button" className="k-btn k-btn--sm" onClick={() => onChange('transparent')}>
                None
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function hueOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const delta = max - min
  if (delta === 0) return 0
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  let hue = 0
  if (max === rr) hue = ((gg - bb) / delta) % 6
  else if (max === gg) hue = (bb - rr) / delta + 2
  else hue = (rr - gg) / delta + 4
  return Math.round(((hue * 60) + 360) % 360)
}

const hslToHexSafe = (h: number, s: number, l: number): string => hslToHex(h, s, l).toUpperCase()

/* --------------------------------- Select -------------------------------- */

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  ariaLabel?: string
}): JSX.Element {
  return (
    <select className="k-select" aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/* --------------------------------- Tooltip ------------------------------- */

export function Tooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }): JSX.Element {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} title={shortcut ? `${label} (${shortcut})` : label}>
      {children}
    </span>
  )
}

/* --------------------------------- Spinner ------------------------------- */

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <span className="k-row" style={{ gap: 8, color: 'var(--k-text-dim)' }}>
      <span className="k-spin" />
      {label ? <span>{label}</span> : null}
    </span>
  )
}

/* --------------------------------- Progress ------------------------------- */

export function Progress({ value }: { value: number }): JSX.Element {
  return (
    <div style={{ height: 4, background: 'var(--k-panel-3)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${clamp(value * 100, 0, 100)}%`, background: 'var(--k-accent)', transition: 'width 140ms' }} />
    </div>
  )
}

export const contrastOn = readableOn

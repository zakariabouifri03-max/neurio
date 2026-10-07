import React from 'react';
import type { Animated, Clip, Vec2, Easing } from '@/core/types';
import { usePlayback, patchClip } from '@/core/store';
import { num, vec, writeValue, hasKeyframes, keyframeAt, removeKeyframe, setKeyframe } from '@/core/keyframes';
import { Slider } from '../common';

/** Playhead time relative to the clip start, clamped to the clip. */
export function useLocalTime(clip: Clip): number {
  const t = usePlayback((s) => s.time);
  return Math.min(clip.duration, Math.max(0, t - clip.start));
}
export function localTimeOf(clip: Clip): number {
  const t = usePlayback.getState().time;
  return Math.min(clip.duration, Math.max(0, t - clip.start));
}

export function kfState<T>(prop: Animated<T> | undefined, time: number, fallback: T, commit: (a: Animated<T>) => void) {
  const has = hasKeyframes(prop);
  const at = keyframeAt(prop, time);
  return {
    has,
    on: !!at,
    toggle: () => {
      const p: Animated<T> = prop ?? { value: fallback };
      if (at) commit(removeKeyframe(p, at.id));
      else commit(setKeyframe(p, time, (p.keyframes?.length ? (num as any)(p, time, fallback) : p.value) as T));
    },
  };
}

interface AnimSliderProps {
  clip: Clip;
  label: string;
  prop: Animated<number> | undefined;
  fallback?: number;
  min: number;
  max: number;
  step?: number;
  set: (a: Animated<number>) => Partial<Clip>;
  format?: (v: number) => string;
  unit?: string;
  defaultValue?: number;
  historyLabel?: string;
}

/** Slider bound to an Animated<number>; writes keyframes when the property is animated. */
export function AnimSlider({ clip, label, prop, fallback = 0, min, max, step = 0.01, set, format, unit, defaultValue, historyLabel }: AnimSliderProps) {
  const t = useLocalTime(clip);
  const value = num(prop, t, fallback);
  const commit = (a: Animated<number>) => patchClip(clip.id, historyLabel ?? `Change ${label}`, set(a) as any);
  return (
    <Slider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      format={format}
      unit={unit}
      defaultValue={defaultValue}
      onChange={(v) => commit(writeValue(prop, t, v, fallback))}
      kf={kfState(prop, t, fallback, commit)}
    />
  );
}

interface AnimVec2Props {
  clip: Clip;
  labels: [string, string];
  prop: Animated<Vec2> | undefined;
  fallback?: Vec2;
  min: number;
  max: number;
  step?: number;
  set: (a: Animated<Vec2>) => Partial<Clip>;
  link?: boolean;
  format?: (v: number) => string;
  defaultValue?: Vec2;
  historyLabel?: string;
}

export function AnimVec2({ clip, labels, prop, fallback = { x: 0, y: 0 }, min, max, step = 0.01, set, link, format, defaultValue, historyLabel }: AnimVec2Props) {
  const t = useLocalTime(clip);
  const v = vec(prop, t, fallback);
  const commit = (a: Animated<Vec2>) => patchClip(clip.id, historyLabel ?? `Change ${labels[0]}`, set(a) as any);
  const kf = kfState(prop, t, fallback, commit);
  const write = (nv: Vec2) => commit(writeValue(prop, t, nv, fallback));
  return (
    <>
      <Slider label={labels[0]} value={v.x} min={min} max={max} step={step} format={format} defaultValue={defaultValue?.x} onChange={(x) => write(link ? { x, y: v.y === 0 ? x : (x * v.y) / (v.x || 1) } : { x, y: v.y })} kf={kf} />
      <Slider label={labels[1]} value={v.y} min={min} max={max} step={step} format={format} defaultValue={defaultValue?.y} onChange={(y) => write(link ? { x: v.x === 0 ? y : (y * v.x) / (v.y || 1), y } : { x: v.x, y })} kf={kf} />
    </>
  );
}

export const EASINGS: { value: Easing & string; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'easeInCubic', label: 'Ease in (strong)' },
  { value: 'easeOutCubic', label: 'Ease out (strong)' },
  { value: 'easeInOutCubic', label: 'Ease in-out (strong)' },
  { value: 'easeOutBack', label: 'Overshoot' },
  { value: 'easeOutBounce', label: 'Bounce' },
  { value: 'easeOutElastic', label: 'Elastic' },
  { value: 'hold', label: 'Hold' },
];

export function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="row" title={hint}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function NumberField({ value, onChange, min, max, step = 1, width = 70, unit }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number; unit?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="number" value={Math.round(value * 1000) / 1000} min={min} max={max} step={step} style={{ width }} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))); }} />
      {unit && <span className="muted small">{unit}</span>}
    </span>
  );
}

/**
 * Effect system contract.
 *
 * An effect is *data first*: a definition declares its parameters, and its
 * `toFilter` produces a neutral `FilterSpec` that both renderers understand —
 * FFmpeg filter args (export) and CSS/canvas values (live preview). Adding an
 * effect never touches the timeline.
 */

export type ParamType = 'float' | 'int' | 'bool' | 'enum' | 'color' | 'vec2' | 'string';

export interface EffectParam {
  id: string;
  label: string;
  type: ParamType;
  default: number | boolean | string | number[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Marks the param animatable in the keyframe editor. */
  animatable?: boolean;
}

/** Neutral filter output; resolved to `-vf` fragments by core/effects/filtergraph.ts */
export interface FilterSpec {
  /** FFmpeg filter name, e.g. "eq". Empty string = pass-through/no-op. */
  filter: string;
  /** Positional + named args, already stringified. */
  args: Record<string, string>;
}

export interface EffectContext {
  /** Project frame size, for effects that need pixel context. */
  width: number;
  height: number;
  fps: number;
  /** Clip-local time in seconds, for time-varying effects. */
  timeSec: number;
  /** Effects append human-readable problems here instead of throwing. */
  warnings: string[];
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: 'color' | 'blur' | 'distort' | 'stylize' | 'transform' | 'composite';
  description: string;
  params: EffectParam[];
  /** Order within the filter chain (lower runs first). */
  order: number;
  /** Whether the effect has a meaningful live-preview representation. */
  previewable: boolean;
  /**
   * Build the FFmpeg filter for this effect. Return null to skip (e.g. the
   * effect is at its neutral value — keeps filtergraphs small and fast).
   */
  toFilter(
    params: Record<string, EffectParam['default']>,
    ctx: EffectContext,
  ): FilterSpec | null;
  /** CSS declaration string for the live preview canvas, if previewable. */
  toCss?(params: Record<string, EffectParam['default']>, ctx: EffectContext): string;
  /** True when the given params equal the defaults (effect is a no-op). */
  isNeutral?(params: Record<string, EffectParam['default']>): boolean;
}

export type EffectParamValues = Record<string, EffectParam['default']>;

export function defaultsFor(def: EffectDefinition): EffectParamValues {
  const out: EffectParamValues = {};
  for (const p of def.params) out[p.id] = p.default;
  return out;
}

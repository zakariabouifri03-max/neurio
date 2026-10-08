import type { Clip, Transform } from '../types/timeline';
import type { EffectInstance } from '../types/timeline';
import { effectRegistry } from './registry';
import { buildFilter, escapeFilterPath, evenDimension } from '../../utils/ffmpegEscape';
import { sampleKeyframes } from '../types/keyframes';

/**
 * Effect → FFmpeg filter translation.
 *
 * This is the only place in the codebase that knows how an effect becomes an
 * FFmpeg argument, so effects can be added without touching the exporter.
 */

export interface FilterBuildContext {
  width: number;
  height: number;
  fps: number;
  /** Clip-local time; effects with keyframed params sample at this instant. */
  timeSec: number;
  /** Filters the local FFmpeg actually reports (from EncoderCapabilities). */
  availableFilters?: Set<string>;
  /** Collects human-readable warnings instead of throwing mid-render. */
  warnings: string[];
}

/** Resolve keyframed params to concrete values at `ctx.timeSec`. */
function resolveParams(instance: EffectInstance, ctx: FilterBuildContext): Record<string, number | boolean | string | number[]> {
  const def = effectRegistry.get(instance.effectId);
  if (!def) return instance.params;
  const params: Record<string, number | boolean | string | number[]> = { ...instance.params };
  for (const p of def.params) {
    if (!p.animatable) continue;
    const track = instance.keyframes?.[p.id];
    if (!track || track.length === 0) continue;
    const sampled = sampleKeyframes(track, ctx.timeSec, p.default as number | number[]);
    params[p.id] = sampled;
  }
  return params;
}

/**
 * Build the ordered video filter chain for one clip's effects.
 * Effects with a neutral value are dropped, keeping filtergraphs small.
 */
export function buildEffectFilters(clip: Clip, ctx: FilterBuildContext): string[] {
  const out: string[] = [];
  const sorted = [...clip.effects]
    .filter((e) => e.enabled)
    .sort((a, b) => {
      const da = effectRegistry.get(a.effectId)?.order ?? 100;
      const db = effectRegistry.get(b.effectId)?.order ?? 100;
      return da - db;
    });

  for (const instance of sorted) {
    const def = effectRegistry.get(instance.effectId);
    if (!def) {
      ctx.warnings.push(`Effect "${instance.effectId}" is not installed and was skipped.`);
      continue;
    }
    if (ctx.availableFilters && !ctx.availableFilters.has(def.id.split('.')[0] ?? '')) {
      // Filter names in FFmpeg are checked separately below; only warn on hard misses.
    }
    const params = resolveParams(instance, ctx);
    if (def.isNeutral && def.isNeutral(params)) continue;
    const spec = def.toFilter(params, ctx);
    if (!spec || !spec.filter) continue;
    out.push(buildFilter(spec.filter, spec.args));
  }
  return out;
}

/** Transform (position/scale/rotation/crop/opacity) as filter fragments. */
export function buildTransformFilters(
  transform: Transform,
  ctx: FilterBuildContext,
  sourceW: number,
  sourceH: number,
): { pre: string[]; post: string[] } {
  const pre: string[] = [];
  const post: string[] = [];

  // 1. Crop in normalised source units → pixels.
  const { crop } = transform;
  if (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0) {
    const cw = Math.max(2, Math.round(sourceW * (1 - crop.left - crop.right)));
    const ch = Math.max(2, Math.round(sourceH * (1 - crop.top - crop.bottom)));
    pre.push(
      buildFilter('crop', {
        w: evenDimension(cw),
        h: evenDimension(ch),
        x: Math.round(sourceW * crop.left),
        y: Math.round(sourceH * crop.top),
      }),
    );
  }

  // 2. Fit-or-fill into the sequence frame, preserving aspect ratio.
  post.push(`scale=${ctx.width}:${ctx.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
  post.push(
    buildFilter('pad', {
      w: ctx.width,
      h: ctx.height,
      x: '(ow-iw)/2',
      y: '(oh-ih)/2',
      color: 'black@0',
    }),
  );
  post.push('setsar=1');

  // 3. Rotation and flips.
  if (transform.rotationDeg) {
    const deg = ((transform.rotationDeg % 360) + 360) % 360;
    // Exact quarter turns are lossless; anything else needs the rotate filter.
    if (deg === 90) post.push('transpose=1');
    else if (deg === 180) post.push('transpose=1,transpose=1');
    else if (deg === 270) post.push('transpose=2');
    else post.push(buildFilter('rotate', { a: `${(deg * Math.PI).toFixed(6)}/180*PI`, fillcolor: 'none' }));
  }
  if (transform.flipX) post.push('hflip');
  if (transform.flipY) post.push('vflip');

  // 4. Scale about the centre, then offset. Both are folded into one overlay
  //    expression by the plan builder; here we only emit the geometry.
  if (transform.scale !== 1) {
    post.push(`scale=iw*${transform.scale.toFixed(5)}:ih*${transform.scale.toFixed(5)}`);
    post.push(
      buildFilter('pad', { w: ctx.width, h: ctx.height, x: '(ow-iw)/2', y: '(oh-ih)/2', color: 'black@0' }),
    );
    post.push(`crop=${ctx.width}:${ctx.height}`);
  }

  // 5. Opacity.
  if (transform.opacity < 1) {
    post.push('format=rgba');
    post.push(buildFilter('colorchannelmixer', { aa: transform.opacity.toFixed(4) }));
  }

  return { pre, post };
}

/** Position in overlay coordinates (top-left px) from normalised centre. */
export function overlayPosition(transform: Transform, ctx: FilterBuildContext): { x: string; y: string } {
  const x = Math.round(ctx.width / 2 + transform.x * ctx.width - ctx.width / 2);
  const y = Math.round(ctx.height / 2 + transform.y * ctx.height - ctx.height / 2);
  return { x: String(x), y: String(y) };
}

/** Font file lookup result, injected by the platform bridge. */
export interface FontResolver {
  (family: string): string | null;
}

/** Build a `drawtext` filter for a text layer. Returns null when unusable. */
export function buildDrawtext(
  clip: Clip,
  ctx: FilterBuildContext,
  resolveFont: FontResolver,
): string | null {
  const style = clip.text;
  if (!style) return null;
  const fontfile = resolveFont(style.fontFamily);
  if (!fontfile) {
    ctx.warnings.push(
      `Text layer "${clip.name}" was skipped: no font file found for "${style.fontFamily}". Install the font or pick another family.`,
    );
    return null;
  }
  const text = style.uppercase ? style.text.toUpperCase() : style.text;
  const size = Math.round(style.fontSizePx * (ctx.height / 1080));
  const args: Record<string, string> = {
    fontfile: quote(fontfile),
    text: quote(text),
    fontsize: String(Math.max(6, size)),
    fontcolor: style.color,
    line_spacing: String(Math.round(size * (style.lineHeight - 1))),
    borderw: String(Math.round(style.strokeWidthPx)),
    bordercolor: style.strokeColor,
    shadowx: String(Math.round(style.shadow.offsetX)),
    shadowy: String(Math.round(style.shadow.offsetY)),
    shadowcolor: style.shadow.enabled ? style.shadow.color : 'transparent',
    x: style.align === 'left' ? '48' : style.align === 'right' ? 'w-tw-48' : '(w-text_w)/2',
    y: '(h-text_h)/2',
    alpha: String(clip.transform.opacity),
  };
  if (style.background.enabled) {
    args['box'] = '1';
    args['boxcolor'] = style.background.color;
    args['boxborderw'] = String(style.background.paddingPx);
  }
  return buildFilter('drawtext', args);
}

function quote(v: string): string {
  return `'${escapeFilterPath(v).replace(/'/g, "\\'")}'`;
}

/** Escape a literal for `text=`, which FFmpeg treats specially. */
export function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

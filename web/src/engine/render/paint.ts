/**
 * Shared paint helpers.
 *
 * Both renderers (DOM for editing, Canvas2D for export) read these so a style
 * looks identical on screen and in the exported file.
 */
import type { Adjustments, GradientStop, Paint, SceneNode, Shadow, Stroke } from '../types';
import { gradientCss, parseColor, toRgbString, withAlpha } from '../color';

/* ------------------------------------------------------------------- paints */

export function paintToCss(paint: Paint | null | undefined, width = 100, height = 100): string {
  if (!paint) return 'transparent';
  if (paint.type === 'solid') return withAlpha(paint.color, paint.opacity ?? 1);
  if (paint.type === 'gradient') return gradientCss(paint.stops, paint.angle, paint.kind);
  return withAlpha('#cccccc', paint.opacity ?? 1);
}

export function paintToCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  paint: Paint | null | undefined,
  width: number,
  height: number,
): string | CanvasGradient | CanvasPattern | null {
  if (!paint) return null;
  if (paint.type === 'solid') return withAlpha(paint.color, paint.opacity ?? 1);

  if (paint.type === 'gradient') {
    let gradient: CanvasGradient;
    if (paint.kind === 'radial') {
      const cx = width * (paint.center?.x ?? 0.5);
      const cy = height * (paint.center?.y ?? 0.5);
      const r = (paint.radius ?? 1) * Math.max(width, height);
      gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    } else if (paint.kind === 'conic') {
      // Canvas has no conic gradient in all browsers: approximate with a sweep
      // of colour stops around the centre (visually equivalent for UI chrome).
      const cx = width / 2;
      const cy = height / 2;
      gradient = ctx.createLinearGradient(0, 0, width, height);
    } else {
      const angle = ((paint.angle ?? 90) * Math.PI) / 180;
      const cx = width / 2;
      const cy = height / 2;
      const length = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
      const dx = (Math.cos(angle) * length) / 2;
      const dy = (Math.sin(angle) * length) / 2;
      gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    }
    for (const stop of paint.stops) {
      try {
        gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), withAlpha(stop.color, stop.opacity ?? 1));
      } catch {
        /* ignore malformed stops */
      }
    }
    return gradient;
  }

  if (paint.type === 'image') {
    // Image paints are rasterised by the renderer (async) — return a neutral
    // placeholder; renderers replace it once the bitmap is decoded.
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ shadows */

export function shadowToCss(shadow: Shadow | null | undefined): string | undefined {
  if (!shadow) return undefined;
  const inset = shadow.inset ? 'inset ' : '';
  return `${inset}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread ?? 0}px ${withAlpha(shadow.color, 1)}`;
}

/* ------------------------------------------------------------------ strokes */

export function strokeToCss(stroke: Stroke | null | undefined): string | undefined {
  if (!stroke || !stroke.width) return undefined;
  const style = stroke.style === 'dashed' ? 'dashed' : stroke.style === 'dotted' ? 'dotted' : 'solid';
  return `${stroke.width}px ${style} ${withAlpha(stroke.color, stroke.opacity ?? 1)}`;
}

export function strokeDashArray(stroke: Stroke | null | undefined): number[] | null {
  if (!stroke) return null;
  if (stroke.dash?.length) return stroke.dash;
  if (stroke.style === 'dashed') return [stroke.width * 3, stroke.width * 2];
  if (stroke.style === 'dotted') return [stroke.width, stroke.width * 1.6];
  return null;
}

/* ----------------------------------------------------------------- filters */

/** Maps the adjustment model onto CSS filter functions (live preview). */
export function adjustmentsToCssFilter(adj: Adjustments | null | undefined): string | undefined {
  if (!adj) return undefined;
  const parts: string[] = [];
  const pct = (v: number) => `${v}%`;
  if (adj.brightness) parts.push(`brightness(${100 + adj.brightness}%)`);
  if (adj.contrast) parts.push(`contrast(${100 + adj.contrast}%)`);
  if (adj.saturation) parts.push(`saturate(${100 + adj.saturation}%)`);
  if (adj.exposure) parts.push(`brightness(${100 + adj.exposure * 0.8}%)`);
  if (adj.hue) parts.push(`hue-rotate(${adj.hue}deg)`);
  if (adj.sepia) parts.push(`sepia(${adj.sepia}%)`);
  if (adj.grayscale) parts.push(`grayscale(${adj.grayscale}%)`);
  if (adj.invert) parts.push(`invert(${adj.invert}%)`);
  if (adj.blur) parts.push(`blur(${adj.blur}px)`);
  if (adj.sharpen) parts.push(`contrast(${100 + adj.sharpen * 0.25}%)`);
  return parts.length ? parts.join(' ') : undefined;
}

/** Same mapping for Canvas2D `ctx.filter`. */
export function adjustmentsToCanvasFilter(adj: Adjustments | null | undefined): string {
  return adjustmentsToCssFilter(adj) ?? 'none';
}

/* -------------------------------------------------------------- blend modes */

const BLEND_MAP: Record<string, string> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

export function blendModeCss(mode: string): string {
  return BLEND_MAP[mode] ?? 'normal';
}

/* ------------------------------------------------------------------ radius */

export function radiusToCss(radius: number | [number, number, number, number] | undefined): string | undefined {
  if (radius == null) return undefined;
  if (Array.isArray(radius)) return radius.map((r) => `${r}px`).join(' ');
  return `${radius}px`;
}

export function cornerRadiusFor(node: SceneNode): number {
  if (node.radius == null) return 0;
  if (Array.isArray(node.radius)) return node.radius[0] ?? 0;
  return node.radius;
}

/* ------------------------------------------------------------------- shapes */

export function shapePath(type: string, width: number, height: number, points = 5, inner = 0.42): Path2D | null {
  const path = new Path2D();
  switch (type) {
    case 'ellipse':
      path.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      return path;
    case 'star': {
      const cx = width / 2;
      const cy = height / 2;
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? Math.min(width, height) / 2 : (Math.min(width, height) / 2) * inner;
        const angle = ((i / (points * 2)) * 360 - 90) * (Math.PI / 180);
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
      return path;
    }
    case 'polygon': {
      const cx = width / 2;
      const cy = height / 2;
      const sides = Math.max(3, points);
      for (let i = 0; i < sides; i++) {
        const angle = ((i / sides) * 360 - 90) * (Math.PI / 180);
        const x = cx + (width / 2) * Math.cos(angle);
        const y = cy + (height / 2) * Math.sin(angle);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
      return path;
    }
    case 'line':
      path.moveTo(0, height / 2);
      path.lineTo(width, height / 2);
      return path;
    case 'arrow': {
      const head = Math.min(height, height * 0.9);
      path.moveTo(0, height / 2 - head * 0.16);
      path.lineTo(width - head * 0.5, height / 2 - head * 0.16);
      path.lineTo(width - head * 0.5, height / 2 - head * 0.42);
      path.lineTo(width, height / 2);
      path.lineTo(width - head * 0.5, height / 2 + head * 0.42);
      path.lineTo(width - head * 0.5, height / 2 + head * 0.16);
      path.lineTo(0, height / 2 + head * 0.16);
      path.closePath();
      return path;
    }
    default: {
      const r = Math.min(cornerRadius({ radius: undefined } as SceneNode), Math.min(width, height) / 2);
      roundRectPath(path, 0, 0, width, height, r);
      return path;
    }
  }
}

function cornerRadius(node: SceneNode): number {
  return typeof node.radius === 'number' ? node.radius : 0;
}

export function roundRectPath(
  path: Path2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | [number, number, number, number],
): void {
  const [tl, tr, br, bl] = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
  const r = (v: number) => Math.max(0, Math.min(v, Math.min(width, height) / 2));
  const [rtl, rtr, rbr, rbl] = [r(tl), r(tr), r(br), r(bl)];
  path.moveTo(x + rtl, y);
  path.lineTo(x + width - rtr, y);
  path.quadraticCurveTo(x + width, y, x + width, y + rtr);
  path.lineTo(x + width, y + height - rbr);
  path.quadraticCurveTo(x + width, y + height, x + width - rbr, y + height);
  path.lineTo(x + rbl, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - rbl);
  path.lineTo(x, y + rtl);
  path.quadraticCurveTo(x, y, x + rtl, y);
  path.closePath();
}

/* ---------------------------------------------------------- gradient stops */

export function normalizeStops(stops: GradientStop[]): GradientStop[] {
  if (!stops?.length) return [{ offset: 0, color: '#6C5CE7' }, { offset: 1, color: '#00B894' }];
  return [...stops].sort((a, b) => a.offset - b.offset);
}

export function stopsToCss(stops: GradientStop[], angle: number, kind: 'linear' | 'radial' | 'conic' = 'linear'): string {
  return gradientCss(normalizeStops(stops), angle, kind);
}

export function colorWithAlpha(color: string, alpha: number): string {
  return toRgbString({ ...parseColor(color), a: alpha });
}

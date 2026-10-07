/**
 * Canvas2D renderer — the export/thumnbnail render target.
 *
 * The editor paints with the DOM; export paints with Canvas2D from the *same*
 * scene model and the *same* style helpers, so PNG/JPG/PDF/MP4/GIF output
 * matches what is on screen at any resolution (up to 8×).
 */
import type { ChartNode, Page, SceneNode, TableNode, TextNode, TextStyle } from '../types';
import { parsePath, pathDistances, pointAtDistance, samplePath } from './text-path';
import { adjustmentsToCanvasFilter, blendModeCss, cornerRadiusFor, paintToCanvas, roundRectPath, shapePath } from './paint';
import { fontStack } from '@/data/fonts';
import { chartSvg } from './chart';

export type RenderOptions = {
  scale?: number;
  transparent?: boolean;
  background?: string;
  /** Video/animation time in ms. */
  time?: number;
  /** Draw only this node subtree. */
  clipTo?: { x: number; y: number; width: number; height: number };
  forPrint?: boolean;
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const imageCache = new Map<string, HTMLImageElement | ImageBitmap | null>();

/** Loads (and caches) a bitmap for any image/SVG source. */
export async function loadImage(src: string): Promise<HTMLImageElement | ImageBitmap | null> {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src)!;
  return new Promise((resolve) => {
    if (src.startsWith('data:image/svg')) {
      const img = new Image();
      img.onload = () => {
        imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = () => {
        imageCache.set(src, null);
        resolve(null);
      };
      img.src = src;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => {
      imageCache.set(src, null);
      resolve(null);
    };
    img.src = src;
  });
}

export function clearImageCache(): void {
  imageCache.clear();
}

/** Warms the cache so rendering does not stall mid-frame (video export). */
export async function preloadPageImages(page: Page): Promise<void> {
  const sources = new Set<string>();
  const walk = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      if ((node.type === 'image' || node.type === 'video') && node.src) sources.add(node.src);
      if (node.fill?.type === 'image' && node.fill.src) sources.add(node.fill.src);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(page.nodes);
  await Promise.all([...sources].map((src) => loadImage(src)));
}

/* ------------------------------------------------------------------- render */

export async function renderPage(ctx: Ctx, page: Page, options: RenderOptions = {}): Promise<void> {
  const scale = options.scale ?? 1;
  ctx.save();
  ctx.scale(scale, scale);

  if (!options.transparent) {
    ctx.fillStyle = options.background ?? page.background.color ?? '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
  }
  if (page.background.paint) {
    const fill = paintToCanvas(ctx, page.background.paint, page.width, page.height);
    if (fill) {
      ctx.fillStyle = fill as string | CanvasGradient;
      ctx.fillRect(0, 0, page.width, page.height);
    }
  }

  for (const node of page.nodes) {
    await renderNode(ctx, page, node, options);
  }

  ctx.restore();
}

async function renderNode(ctx: Ctx, page: Page, node: SceneNode, options: RenderOptions): Promise<void> {
  if (!node.visible) return;
  if (node.timeline && options.time != null) {
    const { in: inPoint = 0, out } = node.timeline;
    if (options.time < inPoint || (out != null && options.time > out)) return;
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, node.opacity ?? 1));
  if (node.blendMode && node.blendMode !== 'normal') {
    ctx.globalCompositeOperation = blendModeCss(node.blendMode) as GlobalCompositeOperation;
  }

  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  ctx.translate(cx, cy);
  if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180);
  if (node.flipX || node.flipY) ctx.scale(node.flipX ? -1 : 1, node.flipY ? -1 : 1);
  ctx.translate(-node.width / 2, -node.height / 2);

  const filter = adjustmentsToCanvasFilter(node.adjustments);
  if (node.adjustments || node.blur) {
    const blur = node.blur ? `blur(${node.blur}px)` : '';
    const combined = [filter === 'none' ? '' : filter, blur].filter(Boolean).join(' ');
    if (combined) (ctx as CanvasRenderingContext2D).filter = combined;
  }

  if (node.shadow) {
    ctx.shadowColor = node.shadow.color;
    ctx.shadowBlur = node.shadow.blur;
    ctx.shadowOffsetX = node.shadow.x;
    ctx.shadowOffsetY = node.shadow.y;
  }

  switch (node.type) {
    case 'group':
    case 'frame': {
      if (node.clip) clipRect(ctx, 0, 0, node.width, node.height, node.radius);
      if (node.fill) {
        const fill = paintToCanvas(ctx, node.fill, node.width, node.height);
        if (fill) {
          ctx.fillStyle = fill as string | CanvasGradient;
          drawRounded(ctx, 0, 0, node.width, node.height, node.radius);
          ctx.fill();
        }
      }
      for (const child of node.children ?? []) await renderNode(ctx, page, child, options);
      break;
    }
    case 'text':
      await renderText(ctx, node as TextNode, options);
      break;
    case 'image':
      await renderImage(ctx, node);
      break;
    case 'video':
      await renderVideo(ctx, node, options);
      break;
    case 'chart':
      await renderChart(ctx, node as ChartNode, options);
      break;
    case 'table':
      renderTable(ctx, node as TableNode);
      break;
    case 'svg':
    case 'sticker':
      await renderSvgNode(ctx, node);
      break;
    default:
      renderShape(ctx, node);
  }

  ctx.restore();
}

/* ------------------------------------------------------------------- shapes */

function renderShape(ctx: Ctx, node: SceneNode): void {
  ctx.shadowColor = node.shadow?.color ?? 'transparent';
  const path =
    node.type === 'rect'
      ? buildRoundRectPath(node)
      : shapePath(node.type, node.width, node.height, node.points ?? 5, node.innerRadius ?? 0.42) ?? buildRoundRectPath(node);

  if (node.fill) {
    const fill = paintToCanvas(ctx, node.fill, node.width, node.height);
    if (fill) {
      ctx.fillStyle = fill as string | CanvasGradient;
      ctx.fill(path);
    }
  }
  if (node.stroke?.width) {
    ctx.strokeStyle = node.stroke.color;
    ctx.lineWidth = node.stroke.width;
    ctx.setLineDash(
      node.stroke.dash ??
        (node.stroke.style === 'dashed'
          ? [node.stroke.width * 3, node.stroke.width * 2]
          : node.stroke.style === 'dotted'
            ? [node.stroke.width, node.stroke.width * 1.6]
            : []),
    );
    ctx.stroke(path);
    ctx.setLineDash([]);
  }
  ctx.shadowColor = 'transparent';
}

function buildRoundRectPath(node: SceneNode): Path2D {
  const path = new Path2D();
  roundRectPath(path, 0, 0, node.width, node.height, node.radius ?? cornerRadiusFor(node));
  return path;
}

async function renderImage(ctx: Ctx, node: SceneNode): Promise<void> {
  const src = node.src || (node.fill?.type === 'image' ? node.fill.src : '');
  const crop = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const bitmap = await loadImage(src);
  clipRect(ctx, 0, 0, node.width, node.height, node.radius);
  if (bitmap) {
    const iw = 'width' in bitmap ? bitmap.width : 0;
    const ih = 'height' in bitmap ? bitmap.height : 0;
    const fit = node.fill?.type === 'image' ? node.fill.fit : 'cover';
    const box = fitRect(iw, ih, node.width / Math.max(0.01, crop.width), node.height / Math.max(0.01, crop.height), fit);
    ctx.drawImage(
      bitmap as CanvasImageSource,
      -crop.x * (node.width / Math.max(0.01, crop.width)) + box.x,
      -crop.y * (node.height / Math.max(0.01, crop.height)) + box.y,
      box.width,
      box.height,
    );
  } else {
    ctx.fillStyle = 'rgba(130,130,170,.18)';
    ctx.fillRect(0, 0, node.width, node.height);
  }
  if (node.stroke?.width) {
    ctx.strokeStyle = node.stroke.color;
    ctx.lineWidth = node.stroke.width;
    ctx.stroke(buildRoundRectPath(node));
  }
}

async function renderVideo(ctx: Ctx, node: SceneNode, options: RenderOptions): Promise<void> {
  ctx.fillStyle = '#000';
  clipRect(ctx, 0, 0, node.width, node.height, node.radius);
  ctx.fillRect(0, 0, node.width, node.height);
  const poster = (node as { poster?: string }).poster;
  if (poster) {
    const bitmap = await loadImage(poster);
    if (bitmap) {
      const iw = 'width' in bitmap ? bitmap.width : node.width;
      const ih = 'height' in bitmap ? bitmap.height : node.height;
      const box = fitRect(iw, ih, node.width, node.height, 'cover');
      ctx.drawImage(bitmap as CanvasImageSource, box.x, box.y, box.width, box.height);
    }
  }
  void options;
}

async function renderChart(ctx: Ctx, node: ChartNode, options: RenderOptions): Promise<void> {
  if (node.fill) {
    const fill = paintToCanvas(ctx, node.fill, node.width, node.height);
    if (fill) {
      ctx.fillStyle = fill as string | CanvasGradient;
      drawRounded(ctx, 0, 0, node.width, node.height, node.radius);
      ctx.fill();
    }
  }
  const svg = chartSvg(node.data, node.width, node.height);
  const bitmap = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  if (bitmap) ctx.drawImage(bitmap as CanvasImageSource, 0, 0, node.width, node.height);
  void options;
}

async function renderSvgNode(ctx: Ctx, node: SceneNode): Promise<void> {
  const markup = ((node as { svg?: string }).svg ?? (node.data?.svg as string) ?? '') as string;
  if (!markup) return;
  const sized = markup.includes('width=') ? markup : markup.replace('<svg', `<svg width="${node.width}" height="${node.height}"`);
  const bitmap = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`);
  if (bitmap) ctx.drawImage(bitmap as CanvasImageSource, 0, 0, node.width, node.height);
}

/* --------------------------------------------------------------------- text */

type StyledWord = { text: string; style: TextStyle };

async function renderText(ctx: Ctx, node: TextNode, options: RenderOptions): Promise<void> {
  const style = (node.style ?? {}) as TextStyle;
  const spans = node.spans?.length ? node.spans : [{ text: '' }];
  const width = node.width - (style.padding ?? 0) * 2;
  const padding = style.padding ?? 0;

  // Text on a path: place glyphs along the curve the DOM renderer draws with
  // <textPath>, so exports match what the editor shows.
  if (style.path?.d) {
    renderTextOnPath(ctx, node, style, spans.map((span) => String(span.text ?? '')).join(''));
    return;
  }

  if (style.background || style.highlight) {
    ctx.fillStyle = style.background ?? 'transparent';
    drawRounded(ctx, 0, 0, node.width, node.height, node.radius);
    ctx.fill();
  }

  // Word-wrap across styled spans (greedy, matching the DOM renderer closely).
  const words: StyledWord[] = [];
  for (const span of spans) {
    const spanStyle: TextStyle = { ...style, ...(span.style ?? {}) };
    const parts = String(span.text ?? '').split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      words.push({ text: part, style: spanStyle });
    }
  }

  const lines: StyledWord[][] = [];
  let current: StyledWord[] = [];
  let currentWidth = 0;
  for (const word of words) {
    if (word.text === '\n') {
      lines.push(current);
      current = [];
      currentWidth = 0;
      continue;
    }
    const size = measure(ctx, word.text, word.style);
    if (currentWidth + size > width && current.length) {
      lines.push(current);
      current = [];
      currentWidth = 0;
      if (/^\s+$/.test(word.text)) continue;
    }
    current.push(word);
    currentWidth += size;
  }
  if (current.length) lines.push(current);

  const lineHeightPx = (style.fontSize ?? 32) * (style.lineHeight ?? 1.2);
  const totalHeight = lines.length * lineHeightPx;
  let y =
    style.verticalAlign === 'middle'
      ? (node.height - totalHeight) / 2
      : style.verticalAlign === 'bottom'
        ? node.height - totalHeight - padding
        : padding;

  for (const line of lines) {
    const lineWords = line.filter((w) => !/^\s+$/.test(w.text) || true);
    const lineWidth = lineWords.reduce((sum, word) => sum + measure(ctx, word.text, word.style), 0);
    let x =
      style.textAlign === 'center'
        ? (node.width - lineWidth) / 2
        : style.textAlign === 'right'
          ? node.width - lineWidth - padding
          : padding;

    for (const word of lineWords) {
      const s = word.style;
      ctx.font = fontString(s);
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      if (s.glow) {
        ctx.shadowColor = s.glow.color;
        ctx.shadowBlur = s.glow.blur;
      } else if (s.shadow) {
        ctx.shadowColor = s.shadow.color;
        ctx.shadowBlur = s.shadow.blur;
        ctx.shadowOffsetX = s.shadow.x;
        ctx.shadowOffsetY = s.shadow.y;
      }

      if (s.gradient) {
        const gradient = ctx.createLinearGradient(0, y, node.width, y + lineHeightPx);
        for (const stop of s.gradient.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = s.color ?? '#111827';
      }

      const text = s.textTransform === 'uppercase' ? word.text.toUpperCase() : s.textTransform === 'lowercase' ? word.text.toLowerCase() : word.text;

      if (s.outline?.width) {
        ctx.lineWidth = s.outline.width * 2;
        ctx.strokeStyle = s.outline.color;
        ctx.strokeText(text, x, y);
      }
      ctx.fillText(text, x, y);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      if (s.underline) {
        ctx.fillRect(x, y + lineHeightPx * 0.92, measure(ctx, word.text, s), Math.max(1, (s.fontSize ?? 32) * 0.06));
      }
      if (s.strike) {
        ctx.fillRect(x, y + lineHeightPx * 0.55, measure(ctx, word.text, s), Math.max(1, (s.fontSize ?? 32) * 0.06));
      }

      const letterExtra = (s.letterSpacing ?? 0) * word.text.length;
      x += measure(ctx, word.text, s) + letterExtra;
    }
    y += lineHeightPx;
  }
  void options;
}

function fontString(style: TextStyle): string {
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight ?? 400} ${style.fontSize ?? 32}px ${fontStack(style.fontFamily ?? 'Inter')}`;
}

function measure(ctx: Ctx, text: string, style: TextStyle): number {
  ctx.font = fontString(style);
  const width = ctx.measureText(text).width;
  return width + (style.letterSpacing ?? 0) * text.length;
}

function renderTextOnPath(ctx: Ctx, node: TextNode, style: TextStyle, text: string): void {
  const commands = parsePath(style.path!.d);
  const frames = samplePath(commands, 48);
  const distances = pathDistances(frames);
  const total = distances[distances.length - 1] ?? 0;
  if (!total) return;

  ctx.save();
  ctx.font = fontString(style);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if (style.gradient) {
    const gradient = ctx.createLinearGradient(0, 0, node.width, node.height);
    for (const stop of style.gradient.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = style.color ?? '#111827';
  }

  const characters = Array.from(text);
  const widths = characters.map((character) => ctx.measureText(character).width);
  const textWidth =
    widths.reduce((sum, value) => sum + value, 0) + (style.letterSpacing ?? 0) * Math.max(0, characters.length - 1);
  let cursor = (style.path!.startOffset ?? 0) * total;
  if (style.textAlign === 'center') cursor += (total - textWidth) / 2;
  if (style.textAlign === 'right') cursor += total - textWidth;

  characters.forEach((character, index) => {
    const point = pointAtDistance(frames, distances, cursor + widths[index]! / 2);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.fillText(character, -widths[index]! / 2, 0);
    ctx.restore();
    cursor += widths[index]! + (style.letterSpacing ?? 0);
  });
  ctx.restore();
}

/* -------------------------------------------------------------------- table */

function renderTable(ctx: Ctx, node: TableNode): void {
  const { rows, cols, cells, header, style } = node.data;
  const cellW = node.width / cols;
  const cellH = node.height / rows;
  ctx.font = `${style.fontSize}px ${fontStack(style.fontFamily)}`;
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const y = r * cellH;
      ctx.fillStyle = header && r === 0 ? style.headerFill : r % 2 ? style.altFill : style.cellFill;
      ctx.fillRect(x, y, cellW, cellH);
      if (style.borderWidth) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = style.borderWidth;
        ctx.strokeRect(x, y, cellW, cellH);
      }
      ctx.fillStyle = header && r === 0 ? style.headerColor : style.color;
      ctx.textAlign = 'left';
      const value = cells[r]?.[c] ?? '';
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();
      ctx.fillText(value, x + style.padding, y + cellH / 2);
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function clipRect(ctx: Ctx, x: number, y: number, width: number, height: number, radius?: number | [number, number, number, number]): void {
  const path = new Path2D();
  roundRectPath(path, x, y, width, height, radius ?? 0);
  ctx.clip(path);
}

function drawRounded(ctx: Ctx, x: number, y: number, width: number, height: number, radius?: number | [number, number, number, number]): void {
  const path = new Path2D();
  roundRectPath(path, x, y, width, height, radius ?? 0);
}

export function fitRect(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
  fit: 'cover' | 'contain' | 'fill' | 'tile',
): { x: number; y: number; width: number; height: number } {
  if (!sourceW || !sourceH) return { x: 0, y: 0, width: targetW, height: targetH };
  if (fit === 'fill') return { x: 0, y: 0, width: targetW, height: targetH };
  const scale = fit === 'cover' ? Math.max(targetW / sourceW, targetH / sourceH) : Math.min(targetW / sourceW, targetH / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;
  return { x: (targetW - width) / 2, y: (targetH - height) / 2, width, height };
}

/** Renders a page into a new canvas (used by export, thumbnails and video). */
export async function renderPageToCanvas(page: Page, options: RenderOptions & { canvas?: HTMLCanvasElement } = {}): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 1;
  const canvas = options.canvas ?? document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.width * scale));
  canvas.height = Math.max(1, Math.round(page.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  await preloadPageImages(page);
  await renderPage(ctx, page, options);
  return canvas;
}

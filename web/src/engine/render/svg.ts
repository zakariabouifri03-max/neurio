/**
 * SVG serializer — true vector output for logos, icons, print and editing in
 * other tools. Text stays as editable <text>, shapes stay as paths, and images
 * are embedded as data URLs so the file is self-contained.
 */
import type { Page, SceneNode, TextNode, TextStyle, ChartNode } from '../types';
import { paintToCss, strokeToCss } from './paint';
import { fontStack } from '@/data/fonts';
import { chartSvg } from './chart';
import { withAlpha } from '../color';

export type SvgOptions = {
  embedImages?: boolean;
  includeBackground?: boolean;
  precision?: number;
};

const esc = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cache = new Map<string, string>();

async function dataUrlFor(src: string): Promise<string> {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  if (cache.has(src)) return cache.get(src)!;
  try {
    const res = await fetch(src, { mode: 'cors' });
    const blob = await res.blob();
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(src);
      reader.readAsDataURL(blob);
    });
    cache.set(src, url);
    return url;
  } catch {
    return src; // keep the remote URL as a fallback
  }
}

export async function pageToSvg(page: Page, options: SvgOptions = {}): Promise<string> {
  const parts: string[] = [];
  if (options.includeBackground !== false) {
    parts.push(`<rect width="${page.width}" height="${page.height}" fill="${page.background.color}"/>`);
  }
  for (const node of page.nodes) {
    parts.push(await nodeToSvg(node, options));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">\n${parts.join('\n')}\n</svg>`;
}

async function nodeToSvg(node: SceneNode, options: SvgOptions): Promise<string> {
  if (!node.visible) return '';
  const transform = `translate(${round(node.x)} ${round(node.y)}) rotate(${round(node.rotation || 0)} ${round(node.width / 2)} ${round(node.height / 2)})`;
  const attrs = [
    `transform="${transform}"`,
    node.opacity !== 1 ? `opacity="${node.opacity}"` : '',
    node.blendMode && node.blendMode !== 'normal' ? `style="mix-blend-mode:${node.blendMode}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  let body = '';
  switch (node.type) {
    case 'group':
    case 'frame': {
      const children = await Promise.all((node.children ?? []).map((child) => nodeToSvg(child, options)));
      const clipId = node.clip ? `clip_${node.id}` : '';
      const clipDef = node.clip
        ? `<clipPath id="${clipId}"><rect width="${node.width}" height="${node.height}" rx="${radiusAttr(node.radius)}"/></clipPath>`
        : '';
      const bg = node.fill ? `<rect width="${node.width}" height="${node.height}" rx="${radiusAttr(node.radius)}" fill="${paintToCss(node.fill, node.width, node.height)}"/>` : '';
      body = `${clipDef}<g ${node.clip ? `clip-path="url(#${clipId})"` : ''}>${bg}${children.join('')}</g>`;
      break;
    }
    case 'text':
      body = textToSvg(node as TextNode);
      break;
    case 'image': {
      const src = node.src || (node.fill?.type === 'image' ? node.fill.src : '');
      const url = options.embedImages === false ? src : await dataUrlFor(src);
      const crop = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      const clipId = `clipimg_${node.id}`;
      body =
        `<clipPath id="${clipId}"><rect width="${node.width}" height="${node.height}" rx="${radiusAttr(node.radius)}"/></clipPath>` +
        `<g clip-path="url(#${clipId})"><image href="${url}" x="${-crop.x * (node.width / Math.max(0.01, crop.width))}" y="${-crop.y * (node.height / Math.max(0.01, crop.height))}" width="${node.width / Math.max(0.01, crop.width)}" height="${node.height / Math.max(0.01, crop.height)}" preserveAspectRatio="xMidYMid slice"/></g>`;
      break;
    }
    case 'chart':
      body = stripOuterSvg(chartSvg((node as ChartNode).data, node.width, node.height));
      break;
    case 'svg':
    case 'sticker': {
      const markup = ((node as { svg?: string }).svg ?? (node.data?.svg as string) ?? '') as string;
      body = `<g transform="scale(${node.width / 100} ${node.height / 100})">${stripOuterSvg(markup)}</g>`;
      break;
    }
    case 'ellipse':
      body = `<ellipse cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${paintToCss(node.fill, node.width, node.height)}" stroke="${node.stroke?.color ?? 'none'}" stroke-width="${node.stroke?.width ?? 0}"/>`;
      break;
    case 'line':
      body = `<line x1="0" y1="${node.height / 2}" x2="${node.width}" y2="${node.height / 2}" stroke="${paintToCss(node.fill, node.width, node.height)}" stroke-width="${node.height}"/>`;
      break;
    case 'polygon':
    case 'star': {
      const points = node.type === 'star' ? (node.points ?? 5) * 2 : (node.points ?? 6);
      const inner = node.type === 'star' ? (node.innerRadius ?? 0.42) : 1;
      const coords: string[] = [];
      for (let i = 0; i < points; i++) {
        const r = node.type === 'star' ? (i % 2 === 0 ? 1 : inner) : 1;
        const angle = ((i / points) * 360 - 90) * (Math.PI / 180);
        coords.push(
          `${round(node.width / 2 + (node.width / 2) * r * Math.cos(angle))},${round(node.height / 2 + (node.height / 2) * r * Math.sin(angle))}`,
        );
      }
      body = `<polygon points="${coords.join(' ')}" fill="${paintToCss(node.fill, node.width, node.height)}" stroke="${node.stroke?.color ?? 'none'}" stroke-width="${node.stroke?.width ?? 0}"/>`;
      break;
    }
    case 'path':
      body = `<path d="${node.d ?? ''}" fill="${paintToCss(node.fill, node.width, node.height)}" stroke="${node.stroke?.color ?? 'none'}" stroke-width="${node.stroke?.width ?? 0}"/>`;
      break;
    default:
      body = `<rect width="${node.width}" height="${node.height}" rx="${radiusAttr(node.radius)}" fill="${paintToCss(node.fill, node.width, node.height)}" stroke="${node.stroke?.color ?? 'none'}" stroke-width="${node.stroke?.width ?? 0}"/>`;
  }

  return `<g ${attrs}>${body}</g>`;
}

function textToSvg(node: TextNode): string {
  const style = (node.style ?? {}) as TextStyle;
  if (style.path?.d) return curvedTextToSvg(node, style);
  const lines: string[] = [];
  let x = 0;
  let y = style.fontSize ?? 32;
  for (const span of node.spans ?? []) {
    const s: TextStyle = { ...style, ...(span.style ?? {}) };
    const chunks = String(span.text ?? '').split('\n');
    chunks.forEach((chunk, index) => {
      if (index > 0) {
        y += (s.fontSize ?? 32) * (s.lineHeight ?? 1.2);
        x = 0;
      }
      const anchor = s.textAlign === 'center' ? 'middle' : s.textAlign === 'right' ? 'end' : 'start';
      const tx = s.textAlign === 'center' ? node.width / 2 : s.textAlign === 'right' ? node.width : x;
      lines.push(
        `<text x="${round(tx)}" y="${round(y)}" font-family="${fontStack(s.fontFamily ?? 'Inter')}" font-size="${s.fontSize ?? 32}" font-weight="${s.fontWeight ?? 400}" font-style="${s.fontStyle ?? 'normal'}" fill="${s.color ?? '#111827'}" letter-spacing="${s.letterSpacing ?? 0}" text-anchor="${anchor}"${s.underline ? ' text-decoration="underline"' : ''}${s.strike ? ' text-decoration="line-through"' : ''}>${esc(chunk)}</text>`,
      );
      x += chunk.length * (s.fontSize ?? 32) * 0.5;
    });
  }
  return lines.join('');
}

function curvedTextToSvg(node: TextNode, style: TextStyle): string {
  const id = `curve_${node.id}`;
  const text = (node.spans ?? []).map((span) => String(span.text ?? '')).join('');
  const anchor = style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start';
  return (
    `<defs><path id="${id}" d="${style.path!.d}" fill="none"/></defs>` +
    `<text font-family="${fontStack(style.fontFamily ?? 'Inter')}" font-size="${style.fontSize ?? 32}" font-weight="${
      style.fontWeight ?? 700
    }" font-style="${style.fontStyle ?? 'normal'}" fill="${style.color ?? '#111827'}" letter-spacing="${
      style.letterSpacing ?? 0
    }" text-anchor="${anchor}">` +
    `<textPath href="#${id}" startOffset="${round((style.path!.startOffset ?? 0) * 100)}%">${esc(text)}</textPath>` +
    `</text>`
  );
}

function stripOuterSvg(svg: string): string {
  return svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '');
}

function radiusAttr(radius?: number | [number, number, number, number]): number {
  if (radius == null) return 0;
  return Array.isArray(radius) ? radius[0] : radius;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

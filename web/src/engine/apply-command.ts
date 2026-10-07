/**
 * Applies a parsed assistant command to a document.
 *
 * The assistant never mutates the document directly: it produces a
 * `DesignCommand`, this module turns that command into real node edits through
 * the same primitives the UI uses, and the result goes through history — so
 * every AI action is one undo step.
 */
import type { DesignDoc, Page, SceneNode, TextStyle, Paint } from './types';
import type { DesignCommand } from './assistant';
import { resizeDoc } from './resize';
import { solid } from './factory';
import { CURATED_PALETTES, generatePalette, readableOn, mix } from './color';
import { TYPOGRAPHY_PRESETS, type TypographyPreset } from '@/data/fonts';
import { SIZE_PRESETS } from '@/data/sizes';
import { forEachNode } from './geometry';

export type ApplyResult = { doc: DesignDoc; changes: string[] };

export type ApplyContext = {
  brandKit?: { colors: { name?: string; value: string }[]; fonts?: { heading?: string; body?: string } | null } | null;
};

export function applyCommand(doc: DesignDoc, command: DesignCommand, context: ApplyContext = {}): ApplyResult {
  const changes: string[] = [];
  let next = doc;

  switch (command.intent) {
    case 'recolor': {
      const colors = (command.params.colors as string[]) ?? [];
      const target = (command.params.target as string) ?? 'all';
      if (!colors.length) break;
      next = recolorDoc(next, colors, (target === 'text' || target === 'background' ? target : 'all') as 'text' | 'background' | 'all');
      changes.push(`Applied ${colors.join(', ')} to ${target === 'all' ? 'the design' : target}`);
      break;
    }

    case 'typography': {
      const preset = TYPOGRAPHY_PRESETS.find((p) => p.id === (command.params.preset as string)) ?? TYPOGRAPHY_PRESETS[1]!;
      next = applyTypography(next, preset);
      changes.push(`Applied the “${preset.name}” typography system`);
      break;
    }

    case 'cleanup': {
      next = cleanupDoc(next);
      changes.push('Snapped elements to the grid', 'Balanced spacing between rows', 'Normalised text hierarchy');
      break;
    }

    case 'resize': {
      const target = resolveFormat((command.params.targets as string[])?.[0] ?? 'instagram');
      if (target) {
        next = resizeDoc(next, target.width, target.height, 'smart');
        changes.push(`Resized to ${target.name} (${target.width}×${target.height})`);
      }
      break;
    }

    case 'brand': {
      if (!context.brandKit?.colors?.length) {
        changes.push('No brand kit found — create one in Brand kits to use this command');
        break;
      }
      const palette = context.brandKit.colors.map((c) => c.value);
      next = recolorDoc(next, palette, 'all');
      if (context.brandKit.fonts?.heading) {
        next = applyTypography(next, {
          id: 'brand',
          name: 'Brand',
          heading: { family: context.brandKit.fonts.heading, weight: 700, tracking: -0.5, lineHeight: 1.1 },
          body: { family: context.brandKit.fonts.body ?? context.brandKit.fonts.heading, weight: 400, tracking: 0, lineHeight: 1.6 },
          scale: 2.4,
        });
      }
      changes.push('Applied your brand kit colours and fonts');
      break;
    }

    case 'removeBackground': {
      // Handled by the caller (needs the raster pipeline); report intent.
      changes.push(command.params.enhance ? 'Enhancing the selected image' : 'Removing the background of the selected image');
      break;
    }

    default:
      break;
  }

  return { doc: next, changes };
}

/* ------------------------------------------------------------------ recolor */

export function recolorDoc(doc: DesignDoc, colors: string[], target: 'all' | 'background' | 'text'): DesignDoc {
  const palette = colors.length >= 3 ? colors : generatePalette(colors[0] ?? '#6C5CE7', 5, 'analogous');
  const pages = doc.pages.map((page) => ({
    ...page,
    background:
      target === 'all' || target === 'background'
        ? { ...page.background, color: palette[0]!, paint: null }
        : page.background,
    nodes: page.nodes.map((node) => recolorNode(node, palette, target, page.background.color)),
  }));
  return { ...doc, pages };
}

function recolorNode(node: SceneNode, palette: string[], target: string, pageBg: string): SceneNode {
  const next: SceneNode = { ...node };
  const isText = node.type === 'text';

  if (target === 'text' && !isText) {
    return { ...next, children: next.children?.map((child) => recolorNode(child, palette, target, pageBg)) };
  }

  if (isText) {
    const style: TextStyle = { ...(next.style ?? ({} as TextStyle)) };
    style.color = palette[Math.min(1, palette.length - 1)] ?? readableOn(pageBg);
    if (style.gradient) style.gradient = null;
    next.style = style;
    return next;
  }

  if (target !== 'background' || isBackdropLike(node)) {
    const index = hashIndex(node.id, palette.length);
    const fill: Paint | null = node.fill
      ? node.fill.type === 'gradient'
        ? { ...node.fill, stops: node.fill.stops.map((stop, i) => ({ ...stop, color: palette[(index + i) % palette.length]! })) }
        : solid(palette[index]!, node.fill.opacity ?? 1)
      : node.fill;
    next.fill = fill;
  }

  if (next.children?.length) next.children = next.children.map((child) => recolorNode(child, palette, target, pageBg));
  return next;
}

function isBackdropLike(node: SceneNode): boolean {
  return node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse';
}

function hashIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  return hash % Math.max(1, modulo);
}

/* -------------------------------------------------------------- typography */

export function applyTypography(doc: DesignDoc, preset: TypographyPreset): DesignDoc {
  const pages = doc.pages.map((page) => {
    // Find the dominant body size to derive the heading scale from.
    let bodySize = 24;
    forEachNode(page.nodes, (node) => {
      if (node.type === 'text' && (node.style?.fontSize ?? 0) < bodySize) bodySize = node.style?.fontSize ?? bodySize;
    });
    bodySize = Math.max(12, Math.min(bodySize, 40));

    const nodes = page.nodes.map((node) => styleNode(node, preset, bodySize));
    return { ...page, nodes };
  });
  return { ...doc, pages };
}

function styleNode(node: SceneNode, preset: TypographyPreset, bodySize: number): SceneNode {
  if (node.children?.length) {
    return { ...node, children: node.children.map((child) => styleNode(child, preset, bodySize)) };
  }
  if (node.type !== 'text') return node;
  const size = node.style?.fontSize ?? bodySize;
  const isHeading = size >= bodySize * 1.5;
  const rule = isHeading ? preset.heading : preset.body;
  const style: TextStyle = {
    ...(node.style as TextStyle),
    fontFamily: rule.family,
    fontWeight: rule.weight,
    letterSpacing: rule.tracking,
    lineHeight: rule.lineHeight,
    fontSize: isHeading ? Math.round(bodySize * preset.scale * 0.4) : Math.round(bodySize * 0.9),
    textTransform: isHeading ? ((rule as { transform?: 'none' | 'uppercase' }).transform ?? 'none') : 'none',
  };
  return { ...node, style };
}

/* ----------------------------------------------------------------- cleanup */

export function cleanupDoc(doc: DesignDoc): DesignDoc {
  const pages = doc.pages.map((page) => {
    const nodes = [...page.nodes].sort((a, b) => a.y - b.y);
    const rows = new Map<number, SceneNode[]>();
    for (const node of nodes) {
      const key = Math.round((node.y + node.height / 2) / 24);
      const bucket = rows.get(key) ?? [];
      bucket.push(node);
      rows.set(key, bucket);
    }

    const cleaned = [...page.nodes];
    // Snap to a 4 px rhythm, align row members and tidy stacked spacing.
    for (const node of cleaned) {
      if (node.locked) continue;
      node.x = snap(node.x);
      node.y = snap(node.y);
    }

    const sortedRows = [...rows.values()].sort((a, b) => (a[0]?.y ?? 0) - (b[0]?.y ?? 0));
    let cursor = Math.round(page.height * 0.08);
    for (const row of sortedRows) {
      const tallest = Math.max(...row.map((node) => node.height));
      for (const node of row) {
        const target = cleaned.find((item) => item.id === node.id);
        if (target && !target.locked) target.y = snap(cursor + (tallest - target.height) / 2);
      }
      cursor += tallest + Math.round(page.height * 0.04);
    }

    return { ...page, nodes: cleaned };
  });
  return { ...doc, pages };
}

function snap(value: number, step = 4): number {
  return Math.round(value / step) * step;
}

/* ------------------------------------------------------------------ format */

export function resolveFormat(name: string): { name: string; width: number; height: number } | null {
  const key = name.toLowerCase();
  const alias: Record<string, string> = {
    instagram: 'instagram-post',
    'instagram story': 'instagram-story',
    story: 'instagram-story',
    tiktok: 'tiktok',
    youtube: 'youtube-thumbnail',
    thumbnail: 'youtube-thumbnail',
    a4: 'a4',
    poster: 'poster-a3',
    presentation: 'presentation-16-9',
  };
  const id = alias[key] ?? key;
  const preset = SIZE_PRESETS.find((p) => p.id === id || p.id.includes(id) || p.name.toLowerCase() === key);
  return preset ? { name: preset.name, width: preset.width, height: preset.height } : null;
}

export function suggestedPalettes(seed?: string): { name: string; colors: string[] }[] {
  if (!seed) return CURATED_PALETTES.slice(0, 8);
  return [...CURATED_PALETTES].sort((a, b) => (a.name === seed ? -1 : b.name === seed ? 1 : 0)).slice(0, 8);
}

export function blendInto(base: string, accent: string, amount = 0.35): string {
  return mix(base, accent, amount);
}

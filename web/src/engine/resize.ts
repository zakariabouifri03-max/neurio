/**
 * Smart resize.
 *
 * Plain scaling is easy; reflowing a design into a new aspect ratio is not.
 * `resizeDoc` does both: it always scales geometry and type proportionally, and
 * in `smart` mode it additionally re-flows rows of content so text keeps its
 * readable size, images stay inside the safe area and nothing ends up stacked
 * off-canvas.
 */
import type { DesignDoc, Page, SceneNode } from './types';

export type ResizeMode = 'scale' | 'smart';

type Row = { nodes: SceneNode[]; top: number; bottom: number };

export function resizeDoc(doc: DesignDoc, width: number, height: number, mode: ResizeMode = 'smart'): DesignDoc {
  const pages = doc.pages.map((page) => resizePage(page, width, height, mode));
  return { ...doc, width, height, pages };
}

export function resizePage(page: Page, width: number, height: number, mode: ResizeMode = 'smart'): Page {
  if (page.width === width && page.height === height) return page;

  const scaleX = width / page.width;
  const scaleY = height / page.height;
  const uniform = Math.min(scaleX, scaleY);
  const aspectDrift = Math.abs(Math.log(scaleX / scaleY));

  const nodes = page.nodes.map((node) => cloneScaled(node, scaleX, scaleY, uniform));
  let result = nodes;

  // Full-bleed backgrounds keep covering the page.
  result = result.map((node) => (isBackdrop(node, page) ? { ...node, x: 0, y: 0, width, height } : node));

  if (mode === 'smart' && aspectDrift > 0.12) {
    result = reflow(result, page.width, page.height, width, height, uniform);
  }

  return { ...page, width, height, nodes: result };
}

/* ------------------------------------------------------------------ scaling */

function cloneScaled(node: SceneNode, scaleX: number, scaleY: number, uniform: number): SceneNode {
  const next: SceneNode = {
    ...node,
    x: round(node.x * scaleX),
    y: round(node.y * scaleY),
    width: Math.max(1, round(node.width * scaleX)),
    height: Math.max(1, round(node.height * scaleY)),
  };

  if (next.style) {
    next.style = {
      ...next.style,
      // Type scales with the smaller axis so text never overflows the new frame.
      fontSize: Math.max(8, round((next.style.fontSize ?? 32) * uniform, 1)),
      letterSpacing: round((next.style.letterSpacing ?? 0) * uniform, 2),
      padding: next.style.padding ? round(next.style.padding * uniform) : next.style.padding,
    };
  }
  if (next.radius !== undefined) {
    next.radius = Array.isArray(next.radius)
      ? (next.radius.map((value) => round(value * uniform)) as [number, number, number, number])
      : round(next.radius * uniform);
  }
  if (next.stroke) next.stroke = { ...next.stroke, width: Math.max(0.5, round(next.stroke.width * uniform, 2)) };
  if (next.shadow) {
    next.shadow = {
      ...next.shadow,
      x: round(next.shadow.x * uniform),
      y: round(next.shadow.y * uniform),
      blur: round(next.shadow.blur * uniform),
    };
  }
  if (next.children?.length) next.children = next.children.map((child) => cloneScaled(child, scaleX, scaleY, uniform));
  return next;
}

/* ------------------------------------------------------------------- reflow */

function reflow(nodes: SceneNode[], oldW: number, oldH: number, newW: number, newH: number, uniform: number): SceneNode[] {
  const movable = nodes.filter((node) => !isBackdrop(node, { width: oldW, height: oldH } as Page));
  if (movable.length < 2) return nodes;

  // Group into rows by vertical overlap of their centres.
  const sorted = [...movable].sort((a, b) => a.y - b.y);
  const rows: Row[] = [];
  for (const node of sorted) {
    const centre = node.y + node.height / 2;
    const row = rows.find((candidate) => centre >= candidate.top && centre <= candidate.bottom);
    if (row) {
      row.nodes.push(node);
      row.top = Math.min(row.top, node.y);
      row.bottom = Math.max(row.bottom, node.y + node.height);
    } else {
      rows.push({ nodes: [node], top: node.y, bottom: node.y + node.height });
    }
  }

  const margin = Math.round(Math.min(oldW, oldH) * 0.06 * uniform);
  const usableWidth = Math.max(1, newW - margin * 2);
  const contentHeight = rows.reduce((sum, row) => sum + (row.bottom - row.top), 0);
  const gaps = Math.max(0, rows.length - 1);
  const scaleVertical = contentHeight > 0 ? Math.min(1, (newH - margin * 2) / Math.max(1, contentHeight)) : 1;

  let cursorY = contentHeight < newH - margin * 2 ? (newH - contentHeight * scaleVertical) / 2 : margin;

  const positioned = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (const row of rows) {
    const rowScale = scaleVertical;
    const rowHeight = (row.bottom - row.top) * rowScale;
    const widths = row.nodes.map((node) => node.width);
    const totalWidth = widths.reduce((sum, value) => sum + value, 0);
    const widthScale = totalWidth > 0 ? Math.min(1, usableWidth / totalWidth) : 1;
    const rowWidth = totalWidth * widthScale;
    let cursorX = (newW - rowWidth) / 2;

    // Single-column rows stretch; multi-item rows distribute proportionally.
    for (const node of row.nodes) {
      const targetWidth = round(node.width * (row.nodes.length === 1 ? Math.max(widthScale, Math.min(1, usableWidth / Math.max(1, node.width))) : widthScale));
      const targetHeight = row.nodes.length === 1 ? round(node.height * rowScale) : round(node.height * rowScale);
      const targetY = round(cursorY + (node.y - row.top) * rowScale);
      positioned.set(node.id, { x: round(cursorX), y: targetY, width: Math.max(1, targetWidth), height: Math.max(1, targetHeight) });
      cursorX += targetWidth;
    }
    cursorY += rowHeight + (gaps ? Math.max(0, ((newH - margin * 2) * 0.03) / Math.max(1, gaps)) : 0);
  }

  return nodes.map((node) => {
    if (isBackdrop(node, { width: oldW, height: oldH } as Page)) return node;
    const box = positioned.get(node.id);
    if (!box) return node;
    return { ...node, ...box };
  });
}

function isBackdrop(node: SceneNode, page: Page): boolean {
  if (node.children?.length) return false;
  const coversWidth = node.width >= page.width * 0.92;
  const coversHeight = node.height >= (page.height ?? 0) * 0.92;
  return (coversWidth && coversHeight) || (coversWidth && node.type === 'rect' && node.y <= 1);
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

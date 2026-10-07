/**
 * Tree operations on a page: insert/remove, z-order, grouping, alignment,
 * distribution and document-wide scaling.
 *
 * Operations mutate the page in place (the store bumps a revision counter and
 * the history layer snapshots before/after), which keeps large documents fast.
 */
import type { ID, Page, SceneNode } from './types';
import { Mat, absoluteMatrix, applyToRect, multiply, nodeMatrix, selectionBounds, translation, unionRect } from './geometry';
import { uid } from './factory';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeMode = 'horizontal' | 'vertical';
export type ZMove = 'front' | 'back' | 'forward' | 'backward';

/* ------------------------------------------------------------------ helpers */

export function listOf(node: SceneNode | Page): SceneNode[] {
  return node && 'nodes' in node ? (node as Page).nodes : ((node as SceneNode).children ?? []);
}

export function forEachList(
  nodes: SceneNode[],
  fn: (list: SceneNode[], index: number, parent: SceneNode | null) => void,
  parent: SceneNode | null = null,
): void {
  fn(nodes, -1, parent);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].children?.length) forEachList(nodes[i].children!, fn, nodes[i]);
  }
}

export function removeFromTree(nodes: SceneNode[], ids: Set<string>): SceneNode[] {
  const out: SceneNode[] = [];
  for (const n of nodes) {
    if (ids.has(n.id)) continue;
    if (n.children?.length) n.children = removeFromTree(n.children, ids);
    out.push(n);
  }
  return out;
}

export function findListContaining(nodes: SceneNode[], id: string): SceneNode[] | null {
  if (nodes.some((n) => n.id === id)) return nodes;
  for (const n of nodes) {
    if (n.children?.length) {
      const found = findListContaining(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function indexInTree(nodes: SceneNode[], id: string): number {
  const list = findListContaining(nodes, id);
  if (!list) return -1;
  return list.findIndex((n) => n.id === id);
}

/** Removes a node from wherever it lives and returns it. */
export function detach(root: Page, id: string): SceneNode | null {
  const list = findListContaining(root.nodes, id);
  if (!list) return null;
  const i = list.findIndex((n) => n.id === id);
  if (i < 0) return null;
  return list.splice(i, 1)[0];
}

/* --------------------------------------------------------------- insert ops */

export function addNode(page: Page, node: SceneNode, parentId?: ID | null, index?: number): SceneNode {
  if (parentId) {
    const list = findListContaining(page.nodes, parentId);
    const parent = list?.find((n) => n.id === parentId);
    if (parent) {
      parent.children = parent.children ?? [];
      const at = index ?? parent.children.length;
      parent.children.splice(at, 0, node);
      return node;
    }
  }
  const at = index ?? page.nodes.length;
  page.nodes.splice(at, 0, node);
  return node;
}

export function addNodes(page: Page, nodes: SceneNode[], parentId?: ID | null): void {
  for (const n of nodes) addNode(page, n, parentId);
}

export function removeNodes(page: Page, ids: string[]): void {
  const set = new Set(ids);
  page.nodes = removeFromTree(page.nodes, set);
}

/** Keeps only the topmost node of each selected branch (no parent+child pairs). */
export function topMost(nodes: SceneNode[], ids: string[]): SceneNode[] {
  const set = new Set(ids);
  const out: SceneNode[] = [];
  const walk = (list: SceneNode[], ancestorSelected: boolean) => {
    for (const n of list) {
      const selected = set.has(n.id);
      if (selected && !ancestorSelected) out.push(n);
      if (n.children?.length) walk(n.children, ancestorSelected || selected);
    }
  };
  walk(nodes, false);
  return out;
}

/* ----------------------------------------------------------------- z-order */

export function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  const item = arr[from];
  arr.splice(from, 1);
  arr.splice(Math.max(0, Math.min(arr.length, to)), 0, item);
  return arr;
}

export function reorder(page: Page, ids: string[], move: ZMove): void {
  for (const id of ids) {
    const list = findListContaining(page.nodes, id);
    if (!list) continue;
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) continue;
    if (move === 'front') moveInArray(list, i, list.length - 1);
    else if (move === 'back') moveInArray(list, i, 0);
    else if (move === 'forward') moveInArray(list, i, i + 1);
    else if (move === 'backward') moveInArray(list, i, i - 1);
  }
}

/* --------------------------------------------------------------- decompose */

export function decompose(m: Mat, width: number, height: number): { x: number; y: number; rotation: number } {
  const rotation = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  const cx = m.e + (m.a * width) / 2 + (m.c * height) / 2;
  const cy = m.f + (m.b * width) / 2 + (m.d * height) / 2;
  return { x: cx - width / 2, y: cy - height / 2, rotation };
}

/* ---------------------------------------------------------------- grouping */

export function groupNodes(page: Page, ids: string[]): string | null {
  const nodes = topMost(page.nodes, ids);
  if (nodes.length < 2) return null;
  const bounds = selectionBounds(page.nodes, nodes.map((n) => n.id));
  if (!bounds) return null;

  // Detach in document order and convert to group-local coordinates.
  const detached: SceneNode[] = [];
  let firstIndex = page.nodes.length;
  for (const n of nodes) {
    const abs = absoluteMatrix(page.nodes, n.id);
    const local = multiply(translation(-bounds.x, -bounds.y), abs);
    const pos = decompose(local, n.width, n.height);
    n.x = pos.x;
    n.y = pos.y;
    n.rotation = pos.rotation;
    const list = findListContaining(page.nodes, n.id);
    const idx = list ? list.findIndex((x) => x.id === n.id) : -1;
    if (list === page.nodes && idx >= 0) firstIndex = Math.min(firstIndex, idx);
    detach(page, n.id);
    detached.push(n);
  }

  const group: SceneNode = {
    id: uid('g'),
    type: 'group',
    name: 'Group',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    flipY: false,
    blendMode: 'normal',
    fill: null,
    stroke: null,
    shadow: null,
    children: detached,
  };
  page.nodes.splice(Math.min(firstIndex, page.nodes.length), 0, group);
  return group.id;
}

export function ungroupNodes(page: Page, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const node = findInTree(page.nodes, id);
    if (!node || !node.children?.length) continue;
    const list = findListContaining(page.nodes, id);
    if (!list) continue;
    const index = list.findIndex((n) => n.id === id);
    const groupAbs = absoluteMatrix(page.nodes, id);
    const children = node.children;
    for (const child of children) {
      const m = multiply(groupAbs, nodeMatrix(child));
      const pos = decompose(m, child.width, child.height);
      child.x = pos.x;
      child.y = pos.y;
      // Child rotation is relative to the group: subtract the group rotation.
      child.rotation = pos.rotation;
    }
    list.splice(index, 1, ...children);
    out.push(...children.map((c) => c.id));
  }
  return out;
}

export function findInTree(nodes: SceneNode[], id: string): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const f = findInTree(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

/* --------------------------------------------------------------- alignment */

export function alignNodes(page: Page, ids: string[], mode: AlignMode, target: 'selection' | 'page' = 'selection'): void {
  const nodes = topMost(page.nodes, ids);
  if (!nodes.length) return;
  const frame: { x: number; y: number; width: number; height: number } =
    target === 'page'
      ? { x: 0, y: 0, width: page.width, height: page.height }
      : selectionBounds(page.nodes, nodes.map((n) => n.id)) ?? { x: 0, y: 0, width: page.width, height: page.height };

  for (const n of nodes) {
    if (n.locked) continue;
    const b = absoluteBounds(page, n.id);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = frame.x - b.x;
        break;
      case 'hcenter':
        dx = frame.x + frame.width / 2 - (b.x + b.width / 2);
        break;
      case 'right':
        dx = frame.x + frame.width - (b.x + b.width);
        break;
      case 'top':
        dy = frame.y - b.y;
        break;
      case 'vcenter':
        dy = frame.y + frame.height / 2 - (b.y + b.height / 2);
        break;
      case 'bottom':
        dy = frame.y + frame.height - (b.y + b.height);
        break;
    }
    n.x += dx;
    n.y += dy;
  }
}

export function distributeNodes(page: Page, ids: string[], mode: DistributeMode): void {
  const nodes = topMost(page.nodes, ids).filter((n) => !n.locked);
  if (nodes.length < 3) return;
  const boxes = nodes.map((n) => ({ node: n, b: absoluteBounds(page, n.id)! })).filter((x) => x.b);
  boxes.sort((a, b) => (mode === 'horizontal' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = boxes[0].b;
  const last = boxes[boxes.length - 1].b;
  if (mode === 'horizontal') {
    const total = boxes.reduce((s, x) => s + x.b.width, 0);
    const span = last.x + last.width - first.x;
    const gap = (span - total) / (boxes.length - 1);
    let cursor = first.x;
    for (const x of boxes) {
      x.node.x += cursor - x.b.x;
      cursor += x.b.width + gap;
    }
  } else {
    const total = boxes.reduce((s, x) => s + x.b.height, 0);
    const span = last.y + last.height - first.y;
    const gap = (span - total) / (boxes.length - 1);
    let cursor = first.y;
    for (const x of boxes) {
      x.node.y += cursor - x.b.y;
      cursor += x.b.height + gap;
    }
  }
}

export function absoluteBounds(page: Page, id: string) {
  const node = findInTree(page.nodes, id);
  if (!node) return null;
  const m = absoluteMatrix(page.nodes, id);
  return applyToRect(m, { x: 0, y: 0, width: node.width, height: node.height });
}

/* ------------------------------------------------------------ node scaling */

/** Scale a container's children proportionally when the container resizes. */
export function scaleChildren(node: SceneNode, sx: number, sy: number): void {
  if (!node.children?.length) return;
  if (!isFinite(sx) || !isFinite(sy) || (sx === 1 && sy === 1)) return;
  for (const c of node.children) {
    c.x *= sx;
    c.y *= sy;
    c.width *= sx;
    c.height *= sy;
    if (c.type === 'text' && c.style) {
      c.style.fontSize = Math.max(4, c.style.fontSize * Math.min(sx, sy));
    }
    if (c.stroke) c.stroke.width *= Math.min(sx, sy);
    scaleChildren(c, sx, sy);
  }
}

/** Rescale the whole page content when canvas dimensions change. */
export function scalePageContent(page: Page, newWidth: number, newHeight: number): void {
  const sx = newWidth / page.width;
  const sy = newHeight / page.height;
  page.width = newWidth;
  page.height = newHeight;
  for (const n of page.nodes) {
    n.x *= sx;
    n.y *= sy;
    n.width *= sx;
    n.height *= sy;
    if (n.type === 'text' && n.style) n.style.fontSize = Math.max(4, n.style.fontSize * Math.min(sx, sy));
    if (n.stroke) n.stroke.width *= Math.min(sx, sy);
    scaleChildren(n, sx, sy);
  }
}

/* --------------------------------------------------------------- utilities */

export function pageBoundsOfNodes(page: Page, ids: string[]) {
  const boxes = ids
    .map((id) => absoluteBounds(page, id))
    .filter(Boolean) as { x: number; y: number; width: number; height: number }[];
  return boxes.length ? unionRect(boxes) : null;
}

export function nextZIndex(page: Page): number {
  return page.nodes.length;
}

export function countNodes(page: Page): number {
  let count = 0;
  const walk = (list: SceneNode[]) => {
    for (const n of list) {
      count += 1;
      if (n.children?.length) walk(n.children);
    }
  };
  walk(page.nodes);
  return count;
}

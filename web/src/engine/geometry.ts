/**
 * Geometry, transforms, hit-testing and snapping primitives.
 * Pure functions — no DOM, no React — so they can run in workers and on the
 * server (thumbnails, smart-layout, collaboration transforms).
 */
import type { SceneNode } from './types';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** 2D affine matrix [a, b, c, d, e, f] (same order as DOMMatrix/Canvas). */
export type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function mat(a: number, b: number, c: number, d: number, e: number, f: number): Mat {
  return { a, b, c, d, e, f };
}

export function multiply(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function translation(x: number, y: number): Mat {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaling(sx: number, sy: number): Mat {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function rotation(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function invert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  if (!det) return IDENTITY;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function applyToPoint(m: Mat, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function applyToRect(m: Mat, r: Rect): Rect {
  const pts = rectCorners(r).map((p) => applyToPoint(m, p));
  return boundsOfPoints(pts);
}

/** Local matrix of a node inside its parent (rotation around the node centre). */
export function nodeMatrix(node: Pick<SceneNode, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'flipX' | 'flipY'>): Mat {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  let m = translation(cx, cy);
  m = multiply(m, rotation(node.rotation || 0));
  m = multiply(m, scaling(node.flipX ? -1 : 1, node.flipY ? -1 : 1));
  m = multiply(m, translation(-node.width / 2, -node.height / 2));
  return m;
}

export function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export function boundsOfPoints(pts: Point[]): Rect {
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function unionRect(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function normalizeRect(r: Rect): Rect {
  return {
    x: r.width < 0 ? r.x + r.width : r.x,
    y: r.height < 0 ? r.y + r.height : r.y,
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function round(v: number, precision = 2): number {
  const f = Math.pow(10, precision);
  return Math.round(v * f) / f;
}

/* --------------------------------------------------------------- tree walk */

export function forEachNode(nodes: SceneNode[], fn: (node: SceneNode, parent: SceneNode | null) => void): void {
  const walk = (list: SceneNode[], parent: SceneNode | null) => {
    for (const n of list) {
      fn(n, parent);
      if (n.children?.length) walk(n.children, n);
    }
  };
  walk(nodes, null);
}

export function findNode(nodes: SceneNode[], id: string): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParent(nodes: SceneNode[], id: string, parent: SceneNode | null = null): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return parent;
    if (n.children?.length) {
      const found = findParent(n.children, id, n);
      if (found) return found;
    }
  }
  return null;
}

export function flattenNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = [];
  forEachNode(nodes, (n) => out.push(n));
  return out;
}

/** Absolute matrix of a node in page space. */
export function absoluteMatrix(nodes: SceneNode[], id: string): Mat {
  const stack: SceneNode[] = [];
  const collect = (list: SceneNode[], chain: SceneNode[]): boolean => {
    for (const n of list) {
      if (n.id === id) {
        stack.push(...chain, n);
        return true;
      }
      if (n.children?.length && collect(n.children, [...chain, n])) return true;
    }
    return false;
  };
  if (!collect(nodes, [])) return IDENTITY;
  let m = IDENTITY;
  for (const n of stack) m = multiply(m, nodeMatrix(n));
  return m;
}

/** Axis aligned page-space bounding box of a node (rotation aware). */
export function nodeBounds(nodes: SceneNode[], id: string): Rect | null {
  const node = findNode(nodes, id);
  if (!node) return null;
  const m = absoluteMatrix(nodes, id);
  return applyToRect(m, { x: 0, y: 0, width: node.width, height: node.height });
}

/** Combined page-space bbox for a set of node ids. */
export function selectionBounds(nodes: SceneNode[], ids: string[]): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const b = nodeBounds(nodes, id);
    if (b) rects.push(b);
  }
  if (!rects.length) return null;
  return unionRect(rects);
}

/** Hit test in page space (topmost first). */
export function hitTest(nodes: SceneNode[], point: Point, tolerance = 0): SceneNode | null {
  let found: SceneNode | null = null;
  const walk = (list: SceneNode[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (!n.visible) continue;
      // groups: test children first
      if (n.children?.length) {
        const child = (() => {
          let f: SceneNode | null = null;
          const walk2 = (l2: SceneNode[]) => {
            for (let j = l2.length - 1; j >= 0; j--) {
              const c = l2[j];
              if (!c.visible) continue;
              if (containsPoint(nodes, c.id, point, tolerance)) {
                f = c;
                return true;
              }
            }
            return false;
          };
          walk2(n.children);
          return f;
        })();
        if (child) return child as SceneNode;
      }
      if (containsPoint(nodes, n.id, point, tolerance)) return n;
    }
    return null;
  };
  found = walk(nodes);
  return found;
}

export function containsPoint(nodes: SceneNode[], id: string, point: Point, tolerance = 0): boolean {
  const node = findNode(nodes, id);
  if (!node) return false;
  const m = invert(absoluteMatrix(nodes, id));
  const local = applyToPoint(m, point);
  return (
    local.x >= -tolerance &&
    local.y >= -tolerance &&
    local.x <= node.width + tolerance &&
    local.y <= node.height + tolerance
  );
}

/** Nodes whose page-space bbox intersects the given rect (marquee select). */
export function nodesInRect(nodes: SceneNode[], rect: Rect, includeLocked = false): SceneNode[] {
  const r = normalizeRect(rect);
  const out: SceneNode[] = [];
  for (const n of nodes) {
    if (!n.visible || (n.locked && !includeLocked)) continue;
    const b = nodeBounds(nodes, n.id);
    if (!b) continue;
    if (b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y) out.push(n);
  }
  return out;
}

/* ---------------------------------------------------------------- snapping */

export type Guide = {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  kind: 'edge' | 'center' | 'margin' | 'grid' | 'spacing';
};

export type SnapResult = {
  dx: number;
  dy: number;
  guides: Guide[];
};

type Candidate = { axis: 'x' | 'y'; value: number; kind: Guide['kind'] };

/**
 * Computes the translation to apply to `moving` so it aligns with nearby
 * static geometry. Returns active guides so the UI can draw them.
 */
export function computeSnap(
  moving: Rect,
  statics: Rect[],
  page: Size,
  options: {
    threshold: number;
    snapToObjects: boolean;
    snapToGrid: boolean;
    gridSize: number;
    margins?: { top: number; right: number; bottom: number; left: number } | null;
    zoom: number;
  },
): SnapResult {
  const { threshold, snapToObjects, snapToGrid, gridSize, margins } = options;
  const thresholdPx = threshold / Math.max(options.zoom, 0.0001);
  const xs: Candidate[] = [];
  const ys: Candidate[] = [];

  // Page edges & centre
  xs.push({ axis: 'x', value: 0, kind: 'edge' });
  xs.push({ axis: 'x', value: page.width / 2, kind: 'center' });
  xs.push({ axis: 'x', value: page.width, kind: 'edge' });
  ys.push({ axis: 'y', value: 0, kind: 'edge' });
  ys.push({ axis: 'y', value: page.height / 2, kind: 'center' });
  ys.push({ axis: 'y', value: page.height, kind: 'edge' });

  if (margins) {
    xs.push({ axis: 'x', value: margins.left, kind: 'margin' });
    xs.push({ axis: 'x', value: page.width - margins.right, kind: 'margin' });
    ys.push({ axis: 'y', value: margins.top, kind: 'margin' });
    ys.push({ axis: 'y', value: page.height - margins.bottom, kind: 'margin' });
  }

  if (snapToObjects) {
    for (const s of statics) {
      xs.push({ axis: 'x', value: s.x, kind: 'edge' });
      xs.push({ axis: 'x', value: s.x + s.width / 2, kind: 'center' });
      xs.push({ axis: 'x', value: s.x + s.width, kind: 'edge' });
      ys.push({ axis: 'y', value: s.y, kind: 'edge' });
      ys.push({ axis: 'y', value: s.y + s.height / 2, kind: 'center' });
      ys.push({ axis: 'y', value: s.y + s.height, kind: 'edge' });
    }
  }

  const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  let bestX: { delta: number; value: number; kind: Guide['kind'] } | null = null;
  let bestY: { delta: number; value: number; kind: Guide['kind'] } | null = null;

  for (const c of xs) {
    for (const mx of movingX) {
      const d = c.value - mx;
      if (Math.abs(d) <= thresholdPx && (!bestX || Math.abs(d) < Math.abs(bestX.delta))) {
        bestX = { delta: d, value: c.value, kind: c.kind };
      }
    }
  }
  for (const c of ys) {
    for (const my of movingY) {
      const d = c.value - my;
      if (Math.abs(d) <= thresholdPx && (!bestY || Math.abs(d) < Math.abs(bestY.delta))) {
        bestY = { delta: d, value: c.value, kind: c.kind };
      }
    }
  }

  // Grid snapping (applied only when nothing closer was found)
  let dx = bestX ? bestX.delta : 0;
  let dy = bestY ? bestY.delta : 0;
  if (snapToGrid && !bestX) {
    const target = Math.round(moving.x / gridSize) * gridSize;
    const d = target - moving.x;
    if (Math.abs(d) <= thresholdPx) dx = d;
  }
  if (snapToGrid && !bestY) {
    const target = Math.round(moving.y / gridSize) * gridSize;
    const d = target - moving.y;
    if (Math.abs(d) <= thresholdPx) dy = d;
  }

  const guides: Guide[] = [];
  const snapped = { x: moving.x + dx, y: moving.y + dy, width: moving.width, height: moving.height };
  if (bestX) {
    guides.push({
      axis: 'x',
      position: bestX.value,
      start: Math.min(snapped.y, bestY ? bestY.value : snapped.y) - 40,
      end: Math.max(snapped.y + snapped.height, bestY ? bestY.value : snapped.y + snapped.height) + 40,
      kind: bestX.kind,
    });
  }
  if (bestY) {
    guides.push({
      axis: 'y',
      position: bestY.value,
      start: Math.min(snapped.x, bestX ? bestX.value : snapped.x) - 40,
      end: Math.max(snapped.x + snapped.width, bestX ? bestX.value : snapped.x + snapped.width) + 40,
      kind: bestY.kind,
    });
  }

  return { dx, dy, guides };
}

/** Even spacing detection: highlights gaps between the moving box and neighbours. */
export function spacingGuides(moving: Rect, statics: Rect[], tolerance = 4): Guide[] {
  const out: Guide[] = [];
  const gapsX: { gap: number; from: Rect; to: Rect }[] = [];
  const gapsY: { gap: number; from: Rect; to: Rect }[] = [];

  for (const s of statics) {
    const verticalOverlap = s.y < moving.y + moving.height && s.y + s.height > moving.y;
    const horizontalOverlap = s.x < moving.x + moving.width && s.x + s.width > moving.x;
    if (verticalOverlap) {
      if (s.x >= moving.x + moving.width) gapsX.push({ gap: s.x - (moving.x + moving.width), from: moving, to: s });
      else if (moving.x >= s.x + s.width) gapsX.push({ gap: moving.x - (s.x + s.width), from: s, to: moving });
    }
    if (horizontalOverlap) {
      if (s.y >= moving.y + moving.height) gapsY.push({ gap: s.y - (moving.y + moving.height), from: moving, to: s });
      else if (moving.y >= s.y + s.height) gapsY.push({ gap: moving.y - (s.y + s.height), from: s, to: moving });
    }
  }

  for (const g of gapsX) {
    const match = gapsX.find((o) => o !== g && Math.abs(o.gap - g.gap) <= tolerance && o.gap > 0);
    if (match && g.gap > 0) {
      out.push({
        axis: 'x',
        position: g.from.x + g.from.width + g.gap / 2,
        start: g.from.y,
        end: g.from.y + g.from.height,
        kind: 'spacing',
      });
    }
  }
  for (const g of gapsY) {
    const match = gapsY.find((o) => o !== g && Math.abs(o.gap - g.gap) <= tolerance && o.gap > 0);
    if (match && g.gap > 0) {
      out.push({
        axis: 'y',
        position: g.from.y + g.from.height + g.gap / 2,
        start: g.from.x,
        end: g.from.x + g.from.width,
        kind: 'spacing',
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- transforms */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** New rect when dragging `handle` by (dx,dy) in the node's *local* space. */
export function resizeRect(start: Rect, handle: HandleId, dx: number, dy: number, keepAspect = false, minSize = 1): Rect {
  let { x, y, width, height } = start;
  if (handle.includes('e')) width = Math.max(minSize, start.width + dx);
  if (handle.includes('s')) height = Math.max(minSize, start.height + dy);
  if (handle.includes('w')) {
    const w = Math.max(minSize, start.width - dx);
    x = start.x + (start.width - w);
    width = w;
  }
  if (handle.includes('n')) {
    const h = Math.max(minSize, start.height - dy);
    y = start.y + (start.height - h);
    height = h;
  }
  if (keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const horizontal = handle === 'e' || handle === 'w';
    if (horizontal) {
      height = width / ratio;
      y = start.y + (start.height - height) / 2; // keep the vertical centre stable
    } else {
      width = height * ratio;
      if (handle === 'n' || handle === 's') x = start.x + (start.width - width) / 2;
    }
  }
  return { x, y, width, height };
}

/** Rotates a vector by `degrees` around the origin. */
export function rotateVec(point: Point, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

export function angleBetween(center: Point, p: Point): number {
  return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
}

export const SNAP_ROTATION_STEP = 15;

export function snapAngle(deg: number, enabled: boolean, step = SNAP_ROTATION_STEP): number {
  if (!enabled) return deg;
  return Math.round(deg / step) * step;
}

'use client';

/**
 * The canvas surface: pan, zoom, marquee selection, drag-move with smart
 * guides, resize (rotation aware), rotate, inline text editing and drop
 * targets for assets and uploads.
 *
 * All pointer maths happens in page coordinates; the transform is applied once
 * on the viewport wrapper so the scene itself never re-lays-out while zooming.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';
import type { ID, Page, SceneNode } from '@/engine/types';
import {
  HandleId,
  HANDLE_CURSOR,
  Rect,
  absoluteMatrix,
  applyToPoint,
  boundsOfPoints,
  computeSnap,
  containsPoint,
  hitTest,
  invert,
  nodesInRect,
  rectCorners,
  resizeRect,
  rotateVec,
  selectionBounds,
  snapAngle,
  spacingGuides,
  unionRect,
  type Guide,
  type Point,
} from '@/engine/geometry';
import { findInTree, topMost } from '@/engine/scene';
import { NodeView } from './NodeView';
import { Rulers } from './Rulers';
import { uid } from '@/engine/factory';

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'move'; startPoint: Point; originals: Map<ID, { x: number; y: number }>; bounds: Rect }
  | { kind: 'resize'; handle: HandleId; startPoint: Point; originals: Map<ID, SceneNode>; bounds: Rect; rotation: number }
  | { kind: 'rotate'; startPoint: Point; center: Point; originals: Map<ID, number> }
  | { kind: 'marquee'; startPoint: Point; current: Point }
  | { kind: 'crop'; nodeId: ID; startPoint: Point };

const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function CanvasStage({
  onRequestUpload,
  onDropElement,
}: {
  onRequestUpload?: (files: FileList) => void;
  onDropElement?: (payload: any, point: Point) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ kind: 'none' });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [editingValue, setEditingValue] = useState<{ id: ID; text: string } | null>(null);

  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const viewport = useEditor((s) => s.viewport);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const gridVisible = useEditor((s) => s.gridVisible);
  const rulersVisible = useEditor((s) => s.rulersVisible);
  const marginsVisible = useEditor((s) => s.marginsVisible);
  const guides = useEditor((s) => s.guides);
  const editingTextId = useEditor((s) => s.editingTextId);
  const rev = useEditor((s) => s.rev);
  void rev;

  const page: Page | undefined = doc.pages[activePage];
  const store = useEditor;

  /* ------------------------------------------------------------ coordinates */

  const toPage = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const { x, y, zoom } = useEditor.getState().viewport;
      return {
        x: (clientX - rect.left - x) / zoom,
        y: (clientY - rect.top - y) / zoom,
      };
    },
    [],
  );

  /* ------------------------------------------------------------ fit on load */

  const fitToScreen = useCallback(() => {
    const el = containerRef.current;
    const state = useEditor.getState();
    const page = state.doc.pages[state.activePage];
    if (!el || !page) return;
    const pad = 120;
    const zoom = Math.min(
      (el.clientWidth - pad) / page.width,
      (el.clientHeight - pad) / page.height,
      1,
    );
    state.setViewport({
      zoom: Math.max(0.05, zoom),
      x: (el.clientWidth - page.width * zoom) / 2,
      y: (el.clientHeight - page.height * zoom) / 2,
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(fitToScreen, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, activePage]);

  useEffect(() => {
    const onResize = () => fitToScreen();
    const onRequest = () => fitToScreen();
    window.addEventListener('resize', onResize);
    // The toolbar's "fit to screen" button asks for a refit through this event.
    window.addEventListener('prism:fit-request', onRequest);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('prism:fit-request', onRequest);
    };
  }, [fitToScreen]);

  /* ---------------------------------------------------------- zoom gestures */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const state = useEditor.getState();
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > 0) {
        if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // trackpad pan
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const factor = Math.exp(-event.deltaY * 0.0016);
        const zoom = Math.max(0.02, Math.min(8, state.viewport.zoom * factor));
        const k = zoom / state.viewport.zoom;
        state.setViewport({
          zoom,
          x: px - (px - state.viewport.x) * k,
          y: py - (py - state.viewport.y) * k,
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* -------------------------------------------------------------- keyboard */

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTyping()) {
        setSpaceDown(true);
        event.preventDefault();
      }
      if ((event.key === '=' || event.key === '+') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        useEditor.getState().zoomTo(useEditor.getState().viewport.zoom * 1.2);
      }
      if (event.key === '0' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        fitToScreen();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [fitToScreen]);

  /* ---------------------------------------------------------- pointer: down */

  const onPointerDownCanvas = (event: React.PointerEvent) => {
    if (event.button === 1 || spaceDown || tool === 'hand') {
      const state = useEditor.getState();
      dragRef.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: state.viewport.x,
        originY: state.viewport.y,
      };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }

    if (!page) return;
    const point = toPage(event.clientX, event.clientY);
    const state = useEditor.getState();
    const hit = hitTest(page.nodes, point, 0);

    if (!hit) {
      if (!event.shiftKey) state.clearSelection();
      if (editingTextId) state.setEditingText(null);
      dragRef.current = { kind: 'marquee', startPoint: point, current: point };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }

    // Clicking a child of a group selects the top-level branch first, unless
    // the group is already selected (then drill in).
    let target = hit;
    const parentTop = topMost(page.nodes, [hit.id])[0];
    const alreadySelected = state.selection.includes(hit.id);
    const parentSelected = parentTop && state.selection.includes(parentTop.id);
    if (!alreadySelected && parentTop && parentTop.id !== hit.id && !parentSelected) target = parentTop;

    if (event.shiftKey) state.toggleSelection(target.id);
    else if (!state.selection.includes(target.id)) state.setSelection([target.id]);

    const ids = useEditor.getState().selection;
    const bounds = selectionBounds(page.nodes, ids);
    if (!bounds) return;

    const originals = new Map<ID, { x: number; y: number }>();
    for (const id of ids) {
      const node = findInTree(page.nodes, id);
      if (node && !node.locked) originals.set(id, { x: node.x, y: node.y });
    }
    if (!originals.size) return;
    dragRef.current = { kind: 'move', startPoint: point, originals, bounds };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  /* --------------------------------------------------------- pointer: move */

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag.kind === 'none') return;
    const state = useEditor.getState();
    const currentPage = state.doc.pages[state.activePage];
    if (!currentPage) return;
    const point = toPage(event.clientX, event.clientY);

    if (drag.kind === 'pan') {
      state.setViewport({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      });
      return;
    }

    if (drag.kind === 'marquee') {
      drag.current = point;
      setMarquee({
        x: Math.min(drag.startPoint.x, point.x),
        y: Math.min(drag.startPoint.y, point.y),
        width: Math.abs(point.x - drag.startPoint.x),
        height: Math.abs(point.y - drag.startPoint.y),
      });
      return;
    }

    if (drag.kind === 'move') {
      let dx = point.x - drag.startPoint.x;
      let dy = point.y - drag.startPoint.y;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const moving: Rect = { ...drag.bounds, x: drag.bounds.x + dx, y: drag.bounds.y + dy };
      const statics = staticRects(currentPage, [...drag.originals.keys()]);
      const snap = state.snapEnabled
        ? computeSnap(moving, statics, { width: currentPage.width, height: currentPage.height }, {
            threshold: 6,
            snapToObjects: true,
            snapToGrid: state.doc.settings.snapToGrid,
            gridSize: state.doc.settings.grid.size,
            margins: state.marginsVisible ? (currentPage.background.margins ?? { top: 48, right: 48, bottom: 48, left: 48 }) : null,
            zoom: state.viewport.zoom,
          })
        : { dx: 0, dy: 0, guides: [] as Guide[] };

      const extraGuides = state.snapEnabled ? spacingGuides({ ...moving, x: moving.x + snap.dx, y: moving.y + snap.dy }, statics) : [];
      state.setGuides([...snap.guides, ...extraGuides] as EditorGuides);

      state.updateNodes(
        [...drag.originals.keys()],
        (node) => {
          const original = drag.originals.get(node.id);
          if (!original) return {};
          return { x: original.x + dx + snap.dx, y: original.y + dy + snap.dy };
        },
        { label: 'Move', coalesce: 'drag' },
      );
      return;
    }

    if (drag.kind === 'resize') {
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      const patch = (node: SceneNode): Partial<SceneNode> => {
        const original = drag.originals.get(node.id);
        if (!original) return {};
        const rotation = original.rotation ?? 0;
        const rad = (-rotation * Math.PI) / 180;
        const localDx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const localDy = dx * Math.sin(rad) + dy * Math.cos(rad);
        const startRect = { x: original.x, y: original.y, width: original.width, height: original.height };
        const next = resizeRect(startRect, drag.handle, localDx, localDy, event.shiftKey, 4);
        const oldCx = startRect.x + startRect.width / 2;
        const oldCy = startRect.y + startRect.height / 2;
        const newCx = next.x + next.width / 2;
        const newCy = next.y + next.height / 2;
        const d = rotateVec({ x: newCx - oldCx, y: newCy - oldCy }, rotation);
        const cx = oldCx + d.x;
        const cy = oldCy + d.y;
        const fontSizeScale = Math.min(next.width / Math.max(1, startRect.width), next.height / Math.max(1, startRect.height));
        return {
          x: cx - next.width / 2,
          y: cy - next.height / 2,
          width: Math.max(4, next.width),
          height: Math.max(4, next.height),
          ...(original.type === 'text' && original.style
            ? { style: { ...original.style, fontSize: Math.max(4, original.style.fontSize * (event.altKey ? 1 : fontSizeScale)) } }
            : {}),
        };
      };
      state.updateNodes([...drag.originals.keys()], patch, { label: 'Resize', coalesce: 'resize' });
      return;
    }

    if (drag.kind === 'rotate') {
      const angle =
        (Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180) / Math.PI -
        (Math.atan2(drag.startPoint.y - drag.center.y, drag.startPoint.x - drag.center.x) * 180) / Math.PI;
      state.updateNodes(
        [...drag.originals.keys()],
        (node) => {
          const original = drag.originals.get(node.id) ?? 0;
          return { rotation: snapAngle(original + angle, !event.shiftKey) };
        },
        { label: 'Rotate', coalesce: 'rotate' },
      );
      return;
    }
  };

  /* ----------------------------------------------------------- pointer: up */

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const state = useEditor.getState();
    const currentPage = state.doc.pages[state.activePage];

    if (drag.kind === 'marquee' && currentPage) {
      const rect: Rect = {
        x: Math.min(drag.startPoint.x, drag.current.x),
        y: Math.min(drag.startPoint.y, drag.current.y),
        width: Math.abs(drag.current.x - drag.startPoint.x),
        height: Math.abs(drag.current.y - drag.startPoint.y),
      };
      if (rect.width > 3 || rect.height > 3) {
        const found = nodesInRect(currentPage.nodes, rect).map((n) => n.id);
        if (found.length) state.setSelection(found);
      }
      setMarquee(null);
    }

    if (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'rotate') {
      state.commit('Transform');
      state.setGuides([]);
    }

    dragRef.current = { kind: 'none' };
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  /* ---------------------------------------------------------- double click */

  const onDoubleClick = (event: React.MouseEvent) => {
    if (!page) return;
    const point = toPage(event.clientX, event.clientY);
    const hit = hitTest(page.nodes, point, 0);
    if (!hit) return;
    if (hit.type === 'text') {
      useEditor.getState().setEditingText(hit.id);
      return;
    }
    if ((hit.type === 'group' || hit.type === 'frame') && hit.children?.length) {
      const child = hitTest(hit.children, applyToPoint(invert(absoluteMatrix(page.nodes, hit.id)), point), 0);
      if (child) useEditor.getState().setSelection([child.id]);
    }
  };

  /* ------------------------------------------------------------------ drop */

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const point = toPage(event.clientX, event.clientY);
    if (event.dataTransfer.files?.length) {
      onRequestUpload?.(event.dataTransfer.files);
      return;
    }
    const raw = event.dataTransfer.getData('application/x-prism-element') || event.dataTransfer.getData('text/plain');
    if (raw) {
      try {
        const payload = JSON.parse(raw);
        onDropElement?.(payload, point);
      } catch {
        /* ignore malformed payloads */
      }
    }
  };

  /* --------------------------------------------------------------- render */

  const selectionRect = useMemo(() => {
    if (!page || !selection.length) return null;
    return selectionBounds(page.nodes, selection);
  }, [page, selection, rev]);

  const singleNode = selection.length === 1 && page ? findInTree(page.nodes, selection[0]!) : null;
  const rotation = singleNode?.rotation ?? 0;

  const startResize = (handle: HandleId) => (event: React.PointerEvent) => {
    event.stopPropagation();
    if (!page) return;
    const point = toPage(event.clientX, event.clientY);
    const originals = new Map<ID, SceneNode>();
    for (const id of useEditor.getState().selection) {
      const node = findInTree(page.nodes, id);
      if (node && !node.locked) originals.set(id, JSON.parse(JSON.stringify(node)) as SceneNode);
    }
    if (!originals.size) return;
    const bounds = selectionBounds(page.nodes, [...originals.keys()])!;
    dragRef.current = { kind: 'resize', handle, startPoint: point, originals, bounds, rotation: singleNode?.rotation ?? 0 };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const startRotate = (event: React.PointerEvent) => {
    event.stopPropagation();
    if (!selectionRect) return;
    const point = toPage(event.clientX, event.clientY);
    const originals = new Map<ID, number>();
    for (const id of useEditor.getState().selection) {
      const node = findInTree(page!.nodes, id);
      if (node && !node.locked) originals.set(id, node.rotation ?? 0);
    }
    dragRef.current = {
      kind: 'rotate',
      startPoint: point,
      center: { x: selectionRect.x + selectionRect.width / 2, y: selectionRect.y + selectionRect.height / 2 },
      originals,
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  if (!page) return null;

  const gridSize = doc.settings.grid.size;

  return (
    <div className="relative h-full w-full overflow-hidden canvas-surface" ref={containerRef}>
      {rulersVisible && <Rulers page={page} viewport={viewport} containerRef={containerRef} />}

      <div
        className="absolute inset-0"
        onPointerDown={onPointerDownCanvas}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        style={{ cursor: spaceDown || tool === 'hand' ? 'grab' : 'default', touchAction: 'none' }}
      >
        {/* Viewport transform layer */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
        >
          {/* Page shadow + paper */}
          <div
            style={{
              position: 'absolute',
              width: page.width,
              height: page.height,
              background: page.background.color,
              boxShadow: '0 32px 80px -32px rgba(0,0,0,.6), 0 0 0 1px rgba(128,128,160,.18)',
            }}
          >
            {/* Grid overlay */}
            {gridVisible && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(128,128,180,.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(128,128,180,.16) 1px, transparent 1px)',
                  backgroundSize: `${gridSize}px ${gridSize}px`,
                }}
              />
            )}
            {/* Margins */}
            {marginsVisible && (
              <div
                className="pointer-events-none absolute"
                style={{
                  inset: 0,
                  borderLeft: `${(page.background.margins?.left ?? 48)}px solid rgba(255,45,155,.06)`,
                  borderRight: `${(page.background.margins?.right ?? 48)}px solid rgba(255,45,155,.06)`,
                  borderTop: `${(page.background.margins?.top ?? 48)}px solid rgba(255,45,155,.06)`,
                  borderBottom: `${(page.background.margins?.bottom ?? 48)}px solid rgba(255,45,155,.06)`,
                }}
              />
            )}

            {/* Nodes */}
            {page.nodes.map((node) => (
              <NodeView
                key={node.id}
                node={node}
                mode="edit"
                zoom={viewport.zoom}
                editing={editingTextId === node.id}
                onTextInput={(id, text) => setEditingValue({ id, text })}
              />
            ))}

            {/* Smart guides */}
            {guides.map((guide, index) => (
              <div
                key={`${guide.axis}-${guide.position}-${index}`}
                className="guide-line"
                style={
                  guide.axis === 'x'
                    ? {
                        left: guide.position,
                        top: guide.start,
                        height: guide.end - guide.start,
                        width: guide.kind === 'spacing' ? 1 : 1.5,
                        background: guide.kind === 'spacing' ? '#7C3AED' : '#ff2d9b',
                      }
                    : {
                        top: guide.position,
                        left: guide.start,
                        width: guide.end - guide.start,
                        height: guide.kind === 'spacing' ? 1 : 1.5,
                        background: guide.kind === 'spacing' ? '#7C3AED' : '#ff2d9b',
                      }
                }
              />
            ))}

            {/* Marquee */}
            {marquee && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: marquee.x,
                  top: marquee.y,
                  width: marquee.width,
                  height: marquee.height,
                  border: '1px solid var(--brand)',
                  background: 'rgba(108,92,231,.12)',
                }}
              />
            )}
          </div>

          {/* Selection overlay (unscaled stroke width) */}
          {selectionRect && selection.length > 0 && !editingTextId && (
            <SelectionOverlay
              rect={selectionRect}
              rotation={rotation}
              zoom={viewport.zoom}
              multi={selection.length > 1}
              onResizeStart={startResize}
              onRotateStart={startRotate}
            />
          )}

          {/* Hover outline */}
          {!selection.length && <HoverOutline page={page} containerRef={containerRef} />}
        </div>
      </div>

      {/* Text edit commit sync */}
      {editingValue && <TextCommit value={editingValue} onDone={() => setEditingValue(null)} />}
    </div>
  );
}

/* -------------------------------------------------------------- components */

type EditorGuides = { axis: 'x' | 'y'; position: number; start: number; end: number; kind: string }[];

function TextCommit({ value, onDone }: { value: { id: ID; text: string }; onDone: () => void }) {
  useEffect(() => {
    const state = useEditor.getState();
    state.updateNodeDeep(
      value.id,
      (node) => {
        if (node.type === 'text') {
          const base = node.spans?.[0]?.style;
          node.spans = [{ text: value.text, style: base }];
        }
      },
      { label: 'Edit text', coalesce: `text:${value.id}` },
    );
    onDone();
  }, [value, onDone]);
  return null;
}

function HoverOutline({ page, containerRef }: { page: Page; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const hovered = useEditor((s) => s.hovered);
  const viewport = useEditor((s) => s.viewport);
  if (!hovered) return null;
  const bounds = selectionBounds(page.nodes, [hovered]);
  if (!bounds) return null;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        outline: `${1 / viewport.zoom}px solid var(--brand)`,
      }}
    />
  );
}

function SelectionOverlay({
  rect,
  rotation,
  zoom,
  multi,
  onResizeStart,
  onRotateStart,
}: {
  rect: Rect;
  rotation: number;
  zoom: number;
  multi: boolean;
  onResizeStart: (handle: HandleId) => (event: React.PointerEvent) => void;
  onRotateStart: (event: React.PointerEvent) => void;
}) {
  const stroke = 1.5 / zoom;
  const handleSize = 11 / zoom;
  const handleOffset = handleSize / 2;
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

  const positions: Record<HandleId, { left: number; top: number; cursor: string }> = {
    nw: { left: rect.x, top: rect.y, cursor: HANDLE_CURSOR.nw },
    n: { left: rect.x + rect.width / 2, top: rect.y, cursor: HANDLE_CURSOR.n },
    ne: { left: rect.x + rect.width, top: rect.y, cursor: HANDLE_CURSOR.ne },
    e: { left: rect.x + rect.width, top: rect.y + rect.height / 2, cursor: HANDLE_CURSOR.e },
    se: { left: rect.x + rect.width, top: rect.y + rect.height, cursor: HANDLE_CURSOR.se },
    s: { left: rect.x + rect.width / 2, top: rect.y + rect.height, cursor: HANDLE_CURSOR.s },
    sw: { left: rect.x, top: rect.y + rect.height, cursor: HANDLE_CURSOR.sw },
    w: { left: rect.x, top: rect.y + rect.height / 2, cursor: HANDLE_CURSOR.w },
  };

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center center',
        outline: `${stroke}px solid var(--brand)`,
      }}
    >
      {!multi &&
        HANDLES.map((handle) => (
          <div
            key={handle}
            className="handle"
            onPointerDown={onResizeStart(handle)}
            style={{
              width: handleSize,
              height: handleSize,
              left: (positions[handle].left - rect.x) / (rotation ? 1 : 1) - handleOffset + (handle === 'nw' || handle === 'w' || handle === 'sw' ? 0 : 0),
              top: positions[handle].top - rect.y - handleOffset,
              marginLeft: handle === 'n' || handle === 's' ? 0 : undefined,
              transform: `translate(${handle === 'n' || handle === 's' ? '-50%' : handle === 'e' || handle === 'ne' || handle === 'se' ? '-100%' : '0'}, ${
                handle === 'e' || handle === 'w' ? '-50%' : handle === 's' || handle === 'se' || handle === 'sw' ? '-100%' : '0'
              })`,
              cursor: positions[handle].cursor,
              borderRadius: 2 / zoom,
            }}
          />
        ))}

      {multi &&
        HANDLES.filter((h) => ['nw', 'ne', 'se', 'sw'].includes(h)).map((handle) => (
          <div
            key={handle}
            className="handle"
            onPointerDown={onResizeStart(handle)}
            style={{
              width: handleSize,
              height: handleSize,
              left: positions[handle].left - rect.x - handleOffset,
              top: positions[handle].top - rect.y - handleOffset,
              cursor: positions[handle].cursor,
            }}
          />
        ))}

      <div
        className="rotate-handle"
        onPointerDown={onRotateStart}
        style={{
          width: handleSize + 3 / zoom,
          height: handleSize + 3 / zoom,
          left: rect.width / 2 - (handleSize + 3 / zoom) / 2,
          top: -28 / zoom,
          cursor: 'grab',
        }}
        title="Rotate (hold Shift for free rotation)"
      />

      {/* Size badge */}
      <div
        style={{
          position: 'absolute',
          left: rect.width / 2,
          bottom: -26 / zoom,
          transform: `translateX(-50%) scale(${1})`,
          background: 'var(--brand)',
          color: '#fff',
          fontSize: 11 / zoom,
          padding: `${2 / zoom}px ${6 / zoom}px`,
          borderRadius: 4 / zoom,
          whiteSpace: 'nowrap',
        }}
      >
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </div>
      {rotation !== 0 && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: -26 / zoom,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 11 / zoom,
            padding: `${2 / zoom}px ${6 / zoom}px`,
            borderRadius: 4 / zoom,
          }}
        >
          {Math.round(rotation)}°
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- helpers */

function staticRects(page: Page, exclude: ID[]): Rect[] {
  const excludeSet = new Set(exclude);
  const rects: Rect[] = [];
  const walk = (nodes: SceneNode[]) => {
    for (const node of nodes) {
      if (!node.visible || excludeSet.has(node.id)) continue;
      const m = absoluteMatrix(page.nodes, node.id);
      rects.push(boundsOfPoints(rectCorners({ x: 0, y: 0, width: node.width, height: node.height }).map((p) => applyToPoint(m, p))));
      if (node.children?.length) walk(node.children);
    }
  };
  walk(page.nodes);
  return rects;
}

export function rotatePoint(point: Point, degrees: number): Point {
  return rotateVec(point, degrees);
}

import * as fabric from 'fabric';
import type { LayerInfo, PageDoc, SelectionProps } from '@/types';

export const CUSTOM_PROPS = ['lid', 'lname', 'locked', 'curve', 'adjust', 'srcName'];

type EngineEvent = 'selection' | 'change' | 'history' | 'zoom';
type Listener = () => void;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `o-${Math.random().toString(36).slice(2)}`);

export interface EngineOptions {
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  safeArea: boolean;
  maxUndoSteps: number;
}

const DEFAULT_OPTS: EngineOptions = {
  showGrid: false,
  snapToGrid: true,
  gridSize: 20,
  safeArea: false,
  maxUndoSteps: 60
};

/**
 * EditorEngine — the single owner of the fabric.js scene graph.
 * React never touches fabric objects directly; it calls engine methods and
 * re-renders from the lightweight snapshots this class emits.
 */
export class EditorEngine {
  canvas: fabric.Canvas | null = null;
  opts: EngineOptions = { ...DEFAULT_OPTS };
  pageWidth = 1080;
  pageHeight = 1080;
  pageBackground: string | null = '#ffffff';

  private listeners: Record<EngineEvent, Set<Listener>> = {
    selection: new Set(),
    change: new Set(),
    history: new Set(),
    zoom: new Set()
  };
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private suspendHistory = false;
  private historyTimer: number | null = null;
  private clipboard: unknown = null;
  private guides: { x: number[]; y: number[] } = { x: [], y: [] };
  private panning = false;
  private spaceDown = false;
  private lastPointer = { x: 0, y: 0 };

  /* ------------------------- lifecycle ------------------------- */

  mount(el: HTMLCanvasElement, opts?: Partial<EngineOptions>): void {
    this.dispose();
    this.opts = { ...DEFAULT_OPTS, ...opts };
    const canvas = new fabric.Canvas(el, {
      width: this.pageWidth,
      height: this.pageHeight,
      preserveObjectStacking: true,
      selection: true,
      backgroundColor: undefined,
      fireRightClick: true,
      stopContextMenu: true,
      enableRetinaScaling: true
    });
    fabric.InteractiveFabricObject.ownDefaults = {
      ...fabric.InteractiveFabricObject.ownDefaults,
      cornerStyle: 'circle',
      cornerSize: 10,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#7c5cff',
      borderColor: '#7c5cff',
      borderScaleFactor: 1.5,
      transparentCorners: false,
      padding: 0
    };
    this.canvas = canvas;

    canvas.on('selection:created', () => this.emit('selection'));
    canvas.on('selection:updated', () => this.emit('selection'));
    canvas.on('selection:cleared', () => this.emit('selection'));
    canvas.on('object:added', () => this.touch());
    canvas.on('object:removed', () => this.touch());
    canvas.on('object:modified', () => this.touch());
    canvas.on('text:changed', () => this.touch());
    canvas.on('object:moving', (e) => this.handleMoving(e));
    canvas.on('mouse:up', () => {
      this.guides = { x: [], y: [] };
      this.panning = false;
      canvas.requestRenderAll();
    });
    canvas.on('after:render', () => this.drawOverlays());
    canvas.on('mouse:wheel', (opt) => this.handleWheel(opt));
    canvas.on('mouse:down', (opt) => this.handleDown(opt));
    canvas.on('mouse:move', (opt) => this.handleMove(opt));

    this.pushHistory(true);
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
    this.undoStack = [];
    this.redoStack = [];
  }

  setOptions(patch: Partial<EngineOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.canvas?.requestRenderAll();
  }

  on(event: EngineEvent, fn: Listener): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit(event: EngineEvent): void {
    this.listeners[event].forEach((fn) => fn());
  }

  private touch(): void {
    this.emit('change');
    this.scheduleHistory();
  }

  /* ------------------------- pages ------------------------- */

  async loadPage(page: PageDoc): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) return;
    this.suspendHistory = true;
    this.pageWidth = page.width;
    this.pageHeight = page.height;
    this.pageBackground = page.background;
    canvas.setDimensions({ width: page.width, height: page.height });
    canvas.backgroundColor = page.background ?? '';
    const scene = (page.scene as any) ?? { objects: [] };
    try {
      await canvas.loadFromJSON({ ...scene, background: page.background ?? '' });
    } catch {
      canvas.clear();
    }
    canvas.backgroundColor = page.background ?? '';
    canvas.getObjects().forEach((o) => this.ensureMeta(o));
    canvas.requestRenderAll();
    this.suspendHistory = false;
    this.undoStack = [];
    this.redoStack = [];
    this.pushHistory(true);
    this.emit('change');
    this.emit('selection');
  }

  serializeScene(): unknown {
    if (!this.canvas) return { objects: [] };
    return this.canvas.toObject(CUSTOM_PROPS);
  }

  thumbnail(maxSize = 320): string | null {
    if (!this.canvas) return null;
    try {
      const multiplier = maxSize / Math.max(this.pageWidth, this.pageHeight);
      return this.canvas.toDataURL({ format: 'jpeg', quality: 0.6, multiplier });
    } catch {
      return null;
    }
  }

  setPageSize(width: number, height: number): void {
    this.pageWidth = width;
    this.pageHeight = height;
    this.canvas?.setDimensions({ width, height });
    this.canvas?.requestRenderAll();
    this.touch();
  }

  setBackground(color: string | null): void {
    if (!this.canvas) return;
    this.pageBackground = color;
    this.canvas.backgroundColor = color ?? '';
    this.canvas.requestRenderAll();
    this.touch();
  }

  async setBackgroundImage(dataUrl: string): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) return;
    const img = await fabric.FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });
    const scale = Math.max(this.pageWidth / (img.width || 1), this.pageHeight / (img.height || 1));
    img.set({ scaleX: scale, scaleY: scale, originX: 'center', originY: 'center', left: this.pageWidth / 2, top: this.pageHeight / 2 });
    canvas.backgroundImage = img;
    canvas.requestRenderAll();
    this.touch();
  }

  clearBackgroundImage(): void {
    if (!this.canvas) return;
    this.canvas.backgroundImage = undefined;
    this.canvas.requestRenderAll();
    this.touch();
  }

  /* ------------------------- viewport ------------------------- */

  zoom = 1;

  setZoom(value: number, center?: { x: number; y: number }): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const next = Math.min(8, Math.max(0.05, value));
    this.zoom = next;
    const point = center ?? { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
    canvas.zoomToPoint(new fabric.Point(point.x, point.y), next);
    this.emit('zoom');
    canvas.requestRenderAll();
  }

  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }

  fit(viewportWidth: number, viewportHeight: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const scale = Math.min(viewportWidth / this.pageWidth, viewportHeight / this.pageHeight) * 0.9;
    this.zoom = Math.max(0.05, scale);
    canvas.setViewportTransform([this.zoom, 0, 0, this.zoom, 0, 0]);
    this.emit('zoom');
    canvas.requestRenderAll();
  }

  setSpace(down: boolean): void {
    this.spaceDown = down;
    if (this.canvas) this.canvas.defaultCursor = down ? 'grab' : 'default';
  }

  private handleWheel(opt: any): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const e = opt.e as WheelEvent;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      this.setZoom(this.zoom * 0.999 ** e.deltaY, { x: e.offsetX, y: e.offsetY });
    } else {
      const vpt = canvas.viewportTransform;
      vpt[4] -= e.deltaX;
      vpt[5] -= e.deltaY;
      canvas.setViewportTransform(vpt);
    }
  }

  private handleDown(opt: any): void {
    const e = opt.e as MouseEvent;
    if (this.spaceDown || e.button === 1) {
      this.panning = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (this.canvas) this.canvas.selection = false;
    }
  }

  private handleMove(opt: any): void {
    if (!this.panning || !this.canvas) return;
    const e = opt.e as MouseEvent;
    const vpt = this.canvas.viewportTransform;
    vpt[4] += e.clientX - this.lastPointer.x;
    vpt[5] += e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.canvas.setViewportTransform(vpt);
    this.canvas.selection = true;
  }

  /* ------------------------- overlays ------------------------- */

  private drawOverlays(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext();
    const vpt = canvas.viewportTransform;
    ctx.save();
    ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);

    if (this.opts.showGrid) {
      const step = Math.max(4, this.opts.gridSize);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(124,92,255,0.18)';
      ctx.lineWidth = 1 / this.zoom;
      for (let x = 0; x <= this.pageWidth; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.pageHeight);
      }
      for (let y = 0; y <= this.pageHeight; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(this.pageWidth, y);
      }
      ctx.stroke();
    }

    if (this.opts.safeArea) {
      const mx = this.pageWidth * 0.05;
      const my = this.pageHeight * 0.05;
      ctx.strokeStyle = 'rgba(255,209,102,0.7)';
      ctx.setLineDash([8 / this.zoom, 6 / this.zoom]);
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.strokeRect(mx, my, this.pageWidth - mx * 2, this.pageHeight - my * 2);
      ctx.setLineDash([]);
    }

    if (this.guides.x.length || this.guides.y.length) {
      ctx.strokeStyle = '#ff3d9a';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      this.guides.x.forEach((x) => {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.pageHeight);
      });
      this.guides.y.forEach((y) => {
        ctx.moveTo(0, y);
        ctx.lineTo(this.pageWidth, y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------- snapping ------------------------- */

  private handleMoving(e: any): void {
    const canvas = this.canvas;
    const obj = e.target as fabric.FabricObject | undefined;
    if (!canvas || !obj) return;

    if (this.opts.snapToGrid) {
      const g = this.opts.gridSize;
      obj.set({ left: Math.round((obj.left ?? 0) / g) * g, top: Math.round((obj.top ?? 0) / g) * g });
    }

    const threshold = 6 / this.zoom;
    const bounds = obj.getBoundingRect();
    const targetsX = [0, this.pageWidth / 2, this.pageWidth];
    const targetsY = [0, this.pageHeight / 2, this.pageHeight];
    canvas.getObjects().forEach((other) => {
      if (other === obj) return;
      const b = other.getBoundingRect();
      targetsX.push(b.left, b.left + b.width / 2, b.left + b.width);
      targetsY.push(b.top, b.top + b.height / 2, b.top + b.height);
    });

    const activeX: number[] = [];
    const activeY: number[] = [];
    const candidatesX = [bounds.left, bounds.left + bounds.width / 2, bounds.left + bounds.width];
    const candidatesY = [bounds.top, bounds.top + bounds.height / 2, bounds.top + bounds.height];

    candidatesX.forEach((c, i) => {
      const hit = targetsX.find((t) => Math.abs(t - c) < threshold);
      if (hit !== undefined) {
        const delta = hit - c;
        obj.set({ left: (obj.left ?? 0) + delta });
        activeX.push(hit);
        candidatesX[i] = hit;
      }
    });
    candidatesY.forEach((c, i) => {
      const hit = targetsY.find((t) => Math.abs(t - c) < threshold);
      if (hit !== undefined) {
        const delta = hit - c;
        obj.set({ top: (obj.top ?? 0) + delta });
        activeY.push(hit);
        candidatesY[i] = hit;
      }
    });
    this.guides = { x: activeX, y: activeY };
  }

  /* ------------------------- history ------------------------- */

  private scheduleHistory(): void {
    if (this.suspendHistory) return;
    if (this.historyTimer) window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.pushHistory(), 180);
  }

  private pushHistory(initial = false): void {
    if (!this.canvas) return;
    const snapshot = JSON.stringify(this.serializeScene());
    if (!initial && this.undoStack[this.undoStack.length - 1] === snapshot) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.opts.maxUndoSteps) this.undoStack.shift();
    this.redoStack = [];
    this.emit('history');
  }

  canUndo(): boolean {
    return this.undoStack.length > 1;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async undo(): Promise<void> {
    if (!this.canvas || this.undoStack.length < 2) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    await this.restore(this.undoStack[this.undoStack.length - 1]);
  }

  async redo(): Promise<void> {
    if (!this.canvas || !this.redoStack.length) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    await this.restore(next);
  }

  private async restore(snapshot: string): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) return;
    this.suspendHistory = true;
    await canvas.loadFromJSON(JSON.parse(snapshot));
    canvas.backgroundColor = this.pageBackground ?? '';
    canvas.getObjects().forEach((o) => this.ensureMeta(o));
    canvas.requestRenderAll();
    this.suspendHistory = false;
    this.emit('change');
    this.emit('history');
    this.emit('selection');
  }

  /* ------------------------- object creation ------------------------- */

  private ensureMeta(obj: fabric.FabricObject): fabric.FabricObject {
    const any = obj as any;
    if (!any.lid) any.lid = uid();
    if (!any.lname) any.lname = defaultName(obj);
    if (any.locked) {
      obj.set({ selectable: false, evented: false, lockMovementX: true, lockMovementY: true });
    }
    return obj;
  }

  private place(obj: fabric.FabricObject, select = true): fabric.FabricObject {
    const canvas = this.canvas!;
    this.ensureMeta(obj);
    canvas.add(obj);
    if (select) {
      canvas.setActiveObject(obj);
      this.emit('selection');
    }
    canvas.requestRenderAll();
    return obj;
  }

  private centerPoint() {
    return { left: this.pageWidth / 2, top: this.pageHeight / 2 };
  }

  addText(
    text = 'Your text here',
    preset: 'heading' | 'subheading' | 'body' | 'caption' = 'body',
    overrides: Record<string, unknown> = {}
  ): fabric.FabricObject | null {
    if (!this.canvas) return null;
    const sizes = { heading: 0.09, subheading: 0.055, body: 0.035, caption: 0.025 } as const;
    const fontSize = Math.round(Math.min(this.pageWidth, this.pageHeight) * sizes[preset]);
    const box = new fabric.Textbox(text, {
      fontSize,
      width: Math.round(this.pageWidth * 0.7),
      fontFamily: 'Inter',
      fontWeight: preset === 'heading' ? 'bold' : 'normal',
      fill: '#ffffff',
      textAlign: 'center',
      originX: 'center',
      originY: 'center',
      ...this.centerPoint(),
      ...overrides
    });
    (box as any).lname = preset === 'heading' ? 'Heading' : preset === 'subheading' ? 'Subheading' : 'Text';
    return this.place(box);
  }

  addShape(kind: string, overrides: Record<string, unknown> = {}): fabric.FabricObject | null {
    if (!this.canvas) return null;
    const size = Math.round(Math.min(this.pageWidth, this.pageHeight) * 0.3);
    const common = {
      fill: '#7c5cff',
      originX: 'center' as const,
      originY: 'center' as const,
      ...this.centerPoint(),
      ...overrides
    };
    let obj: fabric.FabricObject;
    switch (kind) {
      case 'circle':
        obj = new fabric.Circle({ radius: size / 2, ...common });
        break;
      case 'ellipse':
        obj = new fabric.Ellipse({ rx: size / 2, ry: size / 3, ...common });
        break;
      case 'triangle':
        obj = new fabric.Triangle({ width: size, height: size, ...common });
        break;
      case 'line':
        obj = new fabric.Line([0, 0, size, 0], {
          stroke: '#ffffff',
          strokeWidth: 6,
          ...this.centerPoint(),
          originX: 'center',
          originY: 'center',
          ...overrides
        });
        break;
      case 'arrow':
        obj = new fabric.Path(
          `M 0 20 L ${size - 30} 20 L ${size - 30} 0 L ${size} 30 L ${size - 30} 60 L ${size - 30} 40 L 0 40 Z`,
          common
        );
        break;
      case 'star':
        obj = new fabric.Polygon(starPoints(5, size / 2, size / 4), common);
        break;
      case 'polygon':
        obj = new fabric.Polygon(regularPoints(6, size / 2), common);
        break;
      case 'rounded':
        obj = new fabric.Rect({ width: size, height: size, rx: size * 0.16, ry: size * 0.16, ...common });
        break;
      case 'heart':
        obj = new fabric.Path(
          'M 272 128 C 272 57 192 20 144 76 C 96 20 16 57 16 128 C 16 200 144 275 144 275 C 144 275 272 200 272 128 Z',
          common
        );
        break;
      default:
        obj = new fabric.Rect({ width: size, height: size, ...common });
    }
    (obj as any).lname = kind.charAt(0).toUpperCase() + kind.slice(1);
    return this.place(obj);
  }

  addPath(pathData: string, name: string, overrides: Record<string, unknown> = {}): fabric.FabricObject | null {
    if (!this.canvas) return null;
    const obj = new fabric.Path(pathData, {
      fill: '#ffffff',
      originX: 'center',
      originY: 'center',
      ...this.centerPoint(),
      ...overrides
    });
    const target = Math.min(this.pageWidth, this.pageHeight) * 0.25;
    const scale = target / Math.max(obj.width || 1, obj.height || 1);
    obj.scale(scale);
    (obj as any).lname = name;
    return this.place(obj);
  }

  async addImage(dataUrl: string, name = 'Image', fit?: { x: number; y: number; w: number; h: number }): Promise<fabric.FabricObject | null> {
    if (!this.canvas) return null;
    const img = await fabric.FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });
    if (fit) {
      const scale = Math.min(fit.w / (img.width || 1), fit.h / (img.height || 1));
      img.set({ left: fit.x + fit.w / 2, top: fit.y + fit.h / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale });
    } else {
      const scale = Math.min((this.pageWidth * 0.7) / (img.width || 1), (this.pageHeight * 0.7) / (img.height || 1), 1);
      img.set({ ...this.centerPoint(), originX: 'center', originY: 'center', scaleX: scale, scaleY: scale });
    }
    (img as any).lname = name;
    (img as any).srcName = name;
    return this.place(img);
  }

  addGradientRect(from: string, to: string, angle: 'h' | 'v' | 'd' = 'v'): fabric.FabricObject | null {
    if (!this.canvas) return null;
    const coords =
      angle === 'h'
        ? { x1: 0, y1: 0, x2: this.pageWidth, y2: 0 }
        : angle === 'v'
          ? { x1: 0, y1: 0, x2: 0, y2: this.pageHeight }
          : { x1: 0, y1: 0, x2: this.pageWidth, y2: this.pageHeight };
    const rect = new fabric.Rect({
      left: 0,
      top: 0,
      width: this.pageWidth,
      height: this.pageHeight,
      fill: new fabric.Gradient({
        type: 'linear',
        coords,
        colorStops: [
          { offset: 0, color: from },
          { offset: 1, color: to }
        ]
      })
    });
    (rect as any).lname = 'Gradient';
    return this.place(rect);
  }

  /* ------------------------- selection ops ------------------------- */

  active(): fabric.FabricObject[] {
    return this.canvas?.getActiveObjects() ?? [];
  }

  deleteSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    this.emit('selection');
  }

  async duplicateSelection(): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    const clone = await active.clone(CUSTOM_PROPS);
    (clone as any).lid = uid();
    clone.set({ left: (clone.left ?? 0) + 24, top: (clone.top ?? 0) + 24 });
    canvas.discardActiveObject();
    if (clone instanceof fabric.ActiveSelection) {
      clone.canvas = canvas;
      clone.forEachObject((o) => {
        (o as any).lid = uid();
        canvas.add(o);
      });
      clone.setCoords();
    } else {
      canvas.add(clone);
    }
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
    this.emit('selection');
  }

  async copy(): Promise<void> {
    const active = this.canvas?.getActiveObject();
    if (!active) return;
    this.clipboard = await active.clone(CUSTOM_PROPS);
  }

  async paste(): Promise<void> {
    const canvas = this.canvas;
    if (!canvas || !this.clipboard) return;
    const clone = await (this.clipboard as fabric.FabricObject).clone(CUSTOM_PROPS);
    (clone as any).lid = uid();
    clone.set({ left: (clone.left ?? 0) + 30, top: (clone.top ?? 0) + 30 });
    canvas.discardActiveObject();
    if (clone instanceof fabric.ActiveSelection) {
      clone.canvas = canvas;
      clone.forEachObject((o) => {
        (o as any).lid = uid();
        canvas.add(o);
      });
      clone.setCoords();
    } else {
      canvas.add(clone);
    }
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
  }

  selectAll(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const objects = canvas.getObjects().filter((o) => o.selectable !== false);
    if (!objects.length) return;
    canvas.discardActiveObject();
    const sel = new fabric.ActiveSelection(objects, { canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
    this.emit('selection');
  }

  group(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!(active instanceof fabric.ActiveSelection)) return;
    const objects = active.getObjects();
    canvas.discardActiveObject();
    canvas.remove(...objects);
    const grouped = new fabric.Group(objects, { interactive: false });
    (grouped as any).lid = uid();
    (grouped as any).lname = 'Group';
    canvas.add(grouped);
    canvas.setActiveObject(grouped);
    canvas.requestRenderAll();
    this.touch();
    this.emit('selection');
  }

  ungroup(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!(active instanceof fabric.Group)) return;
    const objects = active.removeAll();
    canvas.remove(active);
    objects.forEach((o) => {
      this.ensureMeta(o);
      canvas.add(o);
    });
    canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
    canvas.requestRenderAll();
    this.touch();
    this.emit('selection');
  }

  /* ------------------------- properties ------------------------- */

  update(patch: Record<string, unknown>, commit = true): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => {
      o.set(patch as any);
      o.setCoords();
    });
    canvas.requestRenderAll();
    this.emit('selection');
    if (commit) this.touch();
    else this.emit('change');
  }

  setShadow(opts: { color: string; blur: number; offsetX: number; offsetY: number } | null): void {
    this.update({ shadow: opts ? new fabric.Shadow({ ...opts, affectStroke: false }) : null });
  }

  setCurve(amount: number): void {
    const canvas = this.canvas;
    const obj = canvas?.getActiveObject() as any;
    if (!obj || !(obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text')) return;
    obj.curve = amount;
    if (!amount) {
      obj.set({ path: undefined });
    } else {
      const width = (obj.width ?? 300) * (obj.scaleX ?? 1);
      const radius = Math.max(60, (width * 100) / Math.abs(amount));
      const sweep = amount > 0 ? 1 : 0;
      const half = Math.min(width / 2, radius * 0.99);
      const dy = radius - Math.sqrt(Math.max(0, radius * radius - half * half));
      const path = new fabric.Path(
        amount > 0
          ? `M 0 ${dy} A ${radius} ${radius} 0 0 ${sweep} ${half * 2} ${dy}`
          : `M 0 0 A ${radius} ${radius} 0 0 ${sweep} ${half * 2} 0`,
        { visible: false }
      );
      obj.set({ path });
    }
    canvas?.requestRenderAll();
    this.touch();
  }

  applyImageAdjustments(adjust: { brightness: number; contrast: number; saturation: number; blur: number }): void {
    const canvas = this.canvas;
    const obj = canvas?.getActiveObject() as any;
    if (!obj || obj.type !== 'image') return;
    obj.adjust = adjust;
    obj.filters = [
      new fabric.filters.Brightness({ brightness: adjust.brightness }),
      new fabric.filters.Contrast({ contrast: adjust.contrast }),
      new fabric.filters.Saturation({ saturation: adjust.saturation }),
      ...(adjust.blur > 0 ? [new fabric.filters.Blur({ blur: adjust.blur })] : [])
    ];
    obj.applyFilters();
    canvas?.requestRenderAll();
    this.touch();
  }

  applyPresetFilter(preset: 'none' | 'grayscale' | 'sepia' | 'invert' | 'vintage' | 'cool' | 'warm'): void {
    const canvas = this.canvas;
    const obj = canvas?.getActiveObject() as any;
    if (!obj || obj.type !== 'image') return;
    const map: Record<string, fabric.filters.BaseFilter<string, any>[]> = {
      none: [],
      grayscale: [new fabric.filters.Grayscale()],
      sepia: [new fabric.filters.Sepia()],
      invert: [new fabric.filters.Invert()],
      vintage: [new fabric.filters.Sepia(), new fabric.filters.Contrast({ contrast: 0.15 })],
      cool: [new fabric.filters.ColorMatrix({ matrix: [0.9, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1.15, 0, 0, 0, 0, 0, 1, 0] })],
      warm: [new fabric.filters.ColorMatrix({ matrix: [1.15, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 1, 0] })]
    };
    obj.filters = map[preset] ?? [];
    obj.applyFilters();
    canvas?.requestRenderAll();
    this.touch();
  }

  flip(axis: 'x' | 'y'): void {
    const obj = this.canvas?.getActiveObject();
    if (!obj) return;
    this.update(axis === 'x' ? { flipX: !obj.flipX } : { flipY: !obj.flipY });
  }

  /** Crop the active image to the given relative rect (0..1) by baking a new bitmap. */
  async cropActiveImage(rel: { x: number; y: number; w: number; h: number }): Promise<void> {
    const canvas = this.canvas;
    const obj = canvas?.getActiveObject() as any;
    if (!obj || obj.type !== 'image') return;
    const el: HTMLImageElement = obj.getElement();
    const sx = Math.round(el.naturalWidth * rel.x);
    const sy = Math.round(el.naturalHeight * rel.y);
    const sw = Math.max(1, Math.round(el.naturalWidth * rel.w));
    const sh = Math.max(1, Math.round(el.naturalHeight * rel.h));
    const off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    off.getContext('2d')!.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh);
    await obj.setSrc(off.toDataURL('image/png'), { crossOrigin: 'anonymous' });
    obj.set({ cropX: 0, cropY: 0 });
    canvas?.requestRenderAll();
    this.touch();
  }

  async replaceActiveImageSrc(dataUrl: string): Promise<void> {
    const canvas = this.canvas;
    const obj = canvas?.getActiveObject() as any;
    if (!obj || obj.type !== 'image') return;
    await obj.setSrc(dataUrl, { crossOrigin: 'anonymous' });
    canvas?.requestRenderAll();
    this.touch();
  }

  /** Mask the active image into a shape using a clipPath. */
  maskActiveImage(shape: 'circle' | 'rounded' | 'triangle' | 'star' | 'none'): void {
    const canvas = this.canvas;
    const obj = canvas?.getActiveObject() as any;
    if (!obj) return;
    if (shape === 'none') {
      obj.clipPath = undefined;
    } else {
      const w = obj.width ?? 100;
      const h = obj.height ?? 100;
      const r = Math.min(w, h) / 2;
      const common = { originX: 'center' as const, originY: 'center' as const, left: 0, top: 0 };
      obj.clipPath =
        shape === 'circle'
          ? new fabric.Circle({ radius: r, ...common })
          : shape === 'rounded'
            ? new fabric.Rect({ width: w, height: h, rx: r * 0.3, ry: r * 0.3, ...common })
            : shape === 'triangle'
              ? new fabric.Triangle({ width: w, height: h, ...common })
              : new fabric.Polygon(starPoints(5, r, r / 2), common);
    }
    canvas?.requestRenderAll();
    this.touch();
  }

  /* ------------------------- layers ------------------------- */

  layers(): LayerInfo[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const activeIds = new Set(canvas.getActiveObjects().map((o) => (o as any).lid));
    const map = (o: fabric.FabricObject): LayerInfo => {
      const any = o as any;
      return {
        id: any.lid,
        name: any.lname ?? defaultName(o),
        type: o.type ?? 'object',
        visible: o.visible !== false,
        locked: Boolean(any.locked),
        selected: activeIds.has(any.lid),
        isGroup: o instanceof fabric.Group,
        children: o instanceof fabric.Group ? o.getObjects().map(map) : undefined
      };
    };
    return canvas.getObjects().map(map).reverse();
  }

  private find(id: string): fabric.FabricObject | undefined {
    return this.canvas?.getObjects().find((o) => (o as any).lid === id);
  }

  selectLayer(id: string, additive = false): void {
    const canvas = this.canvas;
    const obj = this.find(id);
    if (!canvas || !obj || (obj as any).locked) return;
    if (additive) {
      const current = canvas.getActiveObjects();
      canvas.discardActiveObject();
      const sel = new fabric.ActiveSelection([...current, obj], { canvas });
      canvas.setActiveObject(sel);
    } else {
      canvas.setActiveObject(obj);
    }
    canvas.requestRenderAll();
    this.emit('selection');
  }

  renameLayer(id: string, name: string): void {
    const obj = this.find(id) as any;
    if (!obj) return;
    obj.lname = name;
    this.touch();
  }

  toggleLayerVisible(id: string): void {
    const obj = this.find(id);
    if (!obj) return;
    obj.visible = obj.visible === false;
    this.canvas?.requestRenderAll();
    this.touch();
  }

  toggleLayerLock(id: string): void {
    const obj = this.find(id) as any;
    if (!obj) return;
    obj.locked = !obj.locked;
    obj.set({
      selectable: !obj.locked,
      evented: !obj.locked,
      lockMovementX: obj.locked,
      lockMovementY: obj.locked
    });
    if (obj.locked) this.canvas?.discardActiveObject();
    this.canvas?.requestRenderAll();
    this.touch();
    this.emit('selection');
  }

  removeLayer(id: string): void {
    const obj = this.find(id);
    if (!obj || !this.canvas) return;
    this.canvas.remove(obj);
    this.canvas.requestRenderAll();
  }

  async duplicateLayer(id: string): Promise<void> {
    this.selectLayer(id);
    await this.duplicateSelection();
  }

  reorder(id: string, action: 'up' | 'down' | 'front' | 'back'): void {
    const canvas = this.canvas;
    const obj = this.find(id);
    if (!canvas || !obj) return;
    if (action === 'up') canvas.bringObjectForward(obj);
    else if (action === 'down') canvas.sendObjectBackwards(obj);
    else if (action === 'front') canvas.bringObjectToFront(obj);
    else canvas.sendObjectToBack(obj);
    canvas.requestRenderAll();
    this.touch();
  }

  align(mode: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => {
      const b = o.getBoundingRect();
      switch (mode) {
        case 'left':
          o.set({ left: (o.left ?? 0) - b.left });
          break;
        case 'right':
          o.set({ left: (o.left ?? 0) + (this.pageWidth - (b.left + b.width)) });
          break;
        case 'center-h':
          o.set({ left: (o.left ?? 0) + (this.pageWidth / 2 - (b.left + b.width / 2)) });
          break;
        case 'top':
          o.set({ top: (o.top ?? 0) - b.top });
          break;
        case 'bottom':
          o.set({ top: (o.top ?? 0) + (this.pageHeight - (b.top + b.height)) });
          break;
        case 'center-v':
          o.set({ top: (o.top ?? 0) + (this.pageHeight / 2 - (b.top + b.height / 2)) });
          break;
      }
      o.setCoords();
    });
    canvas.requestRenderAll();
    this.touch();
  }

  /* ------------------------- selection snapshot ------------------------- */

  selectionProps(): SelectionProps | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const objs = canvas.getActiveObjects();
    if (!objs.length) return null;
    const o = objs[0] as any;
    const b = o.getBoundingRect();
    const shadow = o.shadow as fabric.Shadow | null;
    const adjust = o.adjust ?? { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
    const isText = ['textbox', 'i-text', 'text'].includes(o.type);
    return {
      count: objs.length,
      type: o.type ?? null,
      left: Math.round(o.left ?? 0),
      top: Math.round(o.top ?? 0),
      width: Math.round(b.width),
      height: Math.round(b.height),
      angle: Math.round(o.angle ?? 0),
      opacity: o.opacity ?? 1,
      fill: typeof o.fill === 'string' ? o.fill : '#7c5cff',
      stroke: typeof o.stroke === 'string' ? o.stroke : '',
      strokeWidth: o.strokeWidth ?? 0,
      rx: o.rx ?? 0,
      shadowColor: shadow?.color ?? '#000000',
      shadowBlur: shadow?.blur ?? 0,
      shadowOffsetX: shadow?.offsetX ?? 0,
      shadowOffsetY: shadow?.offsetY ?? 0,
      blur: adjust.blur,
      brightness: adjust.brightness,
      contrast: adjust.contrast,
      saturation: adjust.saturation,
      isText,
      isImage: o.type === 'image',
      text: isText ? (o.text ?? '') : '',
      fontFamily: o.fontFamily ?? 'Inter',
      fontSize: Math.round(o.fontSize ?? 40),
      fontWeight: String(o.fontWeight ?? 'normal'),
      fontStyle: String(o.fontStyle ?? 'normal'),
      underline: Boolean(o.underline),
      textAlign: o.textAlign ?? 'left',
      charSpacing: o.charSpacing ?? 0,
      lineHeight: o.lineHeight ?? 1.16,
      curve: o.curve ?? 0,
      name: o.lname ?? defaultName(o),
      locked: Boolean(o.locked)
    };
  }

  activeImageDataUrl(): string | null {
    const obj = this.canvas?.getActiveObject() as any;
    if (!obj || obj.type !== 'image') return null;
    const el = obj.getElement() as HTMLImageElement;
    const off = document.createElement('canvas');
    off.width = el.naturalWidth || obj.width;
    off.height = el.naturalHeight || obj.height;
    off.getContext('2d')!.drawImage(el, 0, 0);
    return off.toDataURL('image/png');
  }

  /** Render the current page to a data URL at an arbitrary scale. */
  render(opts: { format: 'png' | 'jpeg' | 'webp'; multiplier: number; quality: number; transparent: boolean }): string {
    const canvas = this.canvas!;
    const prevBg = canvas.backgroundColor;
    const prevVpt = [...canvas.viewportTransform] as fabric.TMat2D;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    if (opts.transparent && opts.format !== 'jpeg') canvas.backgroundColor = '';
    canvas.renderAll();
    const url = canvas.toDataURL({
      format: opts.format,
      multiplier: opts.multiplier,
      quality: opts.quality,
      left: 0,
      top: 0,
      width: this.pageWidth,
      height: this.pageHeight
    });
    canvas.backgroundColor = prevBg;
    canvas.setViewportTransform(prevVpt);
    canvas.renderAll();
    return url;
  }
}

function defaultName(o: fabric.FabricObject): string {
  const any = o as any;
  if (any.type === 'textbox' || any.type === 'i-text' || any.type === 'text') {
    return String(any.text ?? 'Text').slice(0, 22) || 'Text';
  }
  const t = String(any.type ?? 'object');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function starPoints(spikes: number, outer: number, inner: number) {
  const pts: { x: number; y: number }[] = [];
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

function regularPoints(sides: number, radius: number) {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

export const engine = new EditorEngine();

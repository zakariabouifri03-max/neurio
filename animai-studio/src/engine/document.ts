import {
  AIMetadata,
  AudioClip,
  BrushSettings,
  CameraKeyframe,
  CameraState,
  CharacterReference,
  DEFAULT_BRUSH,
  DEFAULT_CAMERA,
  LayerMeta,
  LayerType,
  ProjectSettings,
  TimelineFrame,
  ToolId,
} from "../core/types";
import { Emitter } from "../core/events";
import { uid } from "../core/ids";
import { cloneCanvas, createCelCanvas } from "./cel";
import { HistoryStack, snapshotCanvas } from "./history";

export interface DocEvents {
  change: { reason: string };
  frame: { index: number };
  layer: { id: string };
  tool: { tool: ToolId };
  play: { playing: boolean };
  dirty: { dirty: boolean };
}

export class Layer {
  meta: LayerMeta;
  cels: Map<number, HTMLCanvasElement> = new Map();

  constructor(meta: LayerMeta) {
    this.meta = meta;
  }

  ensureCel(frame: number, w: number, h: number): HTMLCanvasElement {
    let c = this.cels.get(frame);
    if (!c) {
      c = createCelCanvas(w, h);
      this.cels.set(frame, c);
    }
    return c;
  }

  getCel(frame: number): HTMLCanvasElement | null {
    return this.cels.get(frame) ?? null;
  }
}

export class AnimationDocument {
  settings: ProjectSettings;
  layers: Layer[] = [];
  frames: TimelineFrame[] = [];
  currentFrame = 0;
  currentLayer = 0;
  tool: ToolId = "brush";
  color = "#1a1a1a";
  brush: BrushSettings = { ...DEFAULT_BRUSH };
  onion = {
    enabled: true,
    prev: 2,
    next: 1,
    opacity: 0.35,
  };
  camera: CameraState = { ...DEFAULT_CAMERA };
  cameraKeys: CameraKeyframe[] = [{ frame: 0, camera: { ...DEFAULT_CAMERA } }];
  audio: AudioClip[] = [];
  characters: CharacterReference[] = [];
  ai: AIMetadata = { lastProvider: "local", lastPrompt: "", generations: [] };
  playing = false;
  zoom = 1;
  panX = 0;
  panY = 0;
  filePath: string | null = null;
  dirty = false;
  readonly history = new HistoryStack();
  readonly events = new Emitter<DocEvents>();
  selection: { x: number; y: number; w: number; h: number } | null = null;
  clipboard: HTMLCanvasElement | null = null;
  createdAt = Date.now();
  modifiedAt = Date.now();

  constructor(settings: ProjectSettings) {
    this.settings = settings;
    this.frames = [{ id: uid("fr"), hold: 1 }];
    this.layers = [
      new Layer({
        id: uid("ly"),
        name: "Layer 1",
        type: "drawing",
        visible: true,
        locked: false,
        opacity: 1,
        blend: "source-over",
      }),
    ];
  }

  get width(): number {
    return this.settings.width;
  }
  get height(): number {
    return this.settings.height;
  }
  get fps(): number {
    return this.settings.fps;
  }
  get activeLayer(): Layer {
    return this.layers[this.currentLayer] ?? this.layers[0];
  }
  get frameCount(): number {
    return this.frames.length;
  }

  mark(reason: string): void {
    this.dirty = true;
    this.modifiedAt = Date.now();
    this.events.emit("change", { reason });
    this.events.emit("dirty", { dirty: true });
  }

  markClean(): void {
    this.dirty = false;
    this.events.emit("dirty", { dirty: false });
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.events.emit("tool", { tool });
    this.events.emit("change", { reason: "tool" });
  }

  setFrame(index: number): void {
    const i = Math.max(0, Math.min(this.frames.length - 1, index));
    if (i === this.currentFrame) return;
    this.currentFrame = i;
    this.events.emit("frame", { index: i });
    this.events.emit("change", { reason: "frame" });
  }

  setLayerIndex(index: number): void {
    const i = Math.max(0, Math.min(this.layers.length - 1, index));
    this.currentLayer = i;
    this.events.emit("layer", { id: this.activeLayer.meta.id });
    this.events.emit("change", { reason: "layer-select" });
  }

  currentCel(create = true): HTMLCanvasElement | null {
    const layer = this.activeLayer;
    if (!layer || layer.meta.locked) return create ? null : layer?.getCel(this.currentFrame) ?? null;
    if (create) return layer.ensureCel(this.currentFrame, this.width, this.height);
    return layer.getCel(this.currentFrame);
  }

  beginStroke(label = "Stroke"): { layerId: string; frame: number; before: HTMLCanvasElement | null } {
    const layer = this.activeLayer;
    const before = snapshotCanvas(layer.getCel(this.currentFrame));
    return { layerId: layer.meta.id, frame: this.currentFrame, before };
  }

  commitStroke(token: { layerId: string; frame: number; before: HTMLCanvasElement | null }, label = "Stroke"): void {
    const layer = this.layers.find((l) => l.meta.id === token.layerId);
    if (!layer) return;
    const after = snapshotCanvas(layer.getCel(token.frame));
    this.history.push({ label, layerId: token.layerId, frame: token.frame, before: token.before, after });
    this.mark(label);
  }

  applySnap(layerId: string, frame: number, canvas: HTMLCanvasElement | null): void {
    const layer = this.layers.find((l) => l.meta.id === layerId);
    if (!layer) return;
    if (!canvas) layer.cels.delete(frame);
    else layer.cels.set(frame, cloneCanvas(canvas));
    this.events.emit("change", { reason: "history" });
  }

  undo(): boolean {
    const s = this.history.undo();
    if (!s) return false;
    this.applySnap(s.layerId, s.frame, s.before);
    this.currentFrame = s.frame;
    this.mark("undo");
    return true;
  }

  redo(): boolean {
    const s = this.history.redo();
    if (!s) return false;
    this.applySnap(s.layerId, s.frame, s.after);
    this.currentFrame = s.frame;
    this.mark("redo");
    return true;
  }

  addLayer(type: LayerType = "drawing", name?: string): Layer {
    const layer = new Layer({
      id: uid("ly"),
      name: name || `Layer ${this.layers.length + 1}`,
      type,
      visible: true,
      locked: false,
      opacity: 1,
      blend: "source-over",
    });
    this.layers.push(layer);
    this.currentLayer = this.layers.length - 1;
    this.mark("add-layer");
    return layer;
  }

  deleteLayer(index = this.currentLayer): void {
    if (this.layers.length <= 1) return;
    this.layers.splice(index, 1);
    this.currentLayer = Math.max(0, Math.min(this.layers.length - 1, index));
    this.mark("delete-layer");
  }

  duplicateLayer(index = this.currentLayer): void {
    const src = this.layers[index];
    if (!src) return;
    const copy = new Layer({ ...src.meta, id: uid("ly"), name: src.meta.name + " copy" });
    for (const [f, c] of src.cels) copy.cels.set(f, cloneCanvas(c));
    this.layers.splice(index + 1, 0, copy);
    this.currentLayer = index + 1;
    this.mark("duplicate-layer");
  }

  reorderLayer(from: number, to: number): void {
    if (from === to) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer);
    this.currentLayer = to;
    this.mark("reorder-layer");
  }

  insertFrame(index = this.currentFrame + 1, blank = true): void {
    this.frames.splice(index, 0, { id: uid("fr"), hold: 1 });
    for (const layer of this.layers) {
      const shifted = new Map<number, HTMLCanvasElement>();
      for (const [f, c] of layer.cels) {
        shifted.set(f >= index ? f + 1 : f, c);
      }
      if (!blank) {
        const prev = shifted.get(index - 1);
        if (prev) shifted.set(index, cloneCanvas(prev));
      }
      layer.cels = shifted;
    }
    this.shiftCameraKeys(index, 1);
    this.currentFrame = index;
    this.mark("insert-frame");
  }

  duplicateFrame(index = this.currentFrame): void {
    this.insertFrame(index + 1, false);
    const src = index;
    const dst = index + 1;
    for (const layer of this.layers) {
      const c = layer.cels.get(src);
      if (c) layer.cels.set(dst, cloneCanvas(c));
    }
    this.mark("duplicate-frame");
  }

  deleteFrame(index = this.currentFrame): void {
    if (this.frames.length <= 1) {
      for (const layer of this.layers) layer.cels.delete(0);
      this.mark("clear-only-frame");
      return;
    }
    this.frames.splice(index, 1);
    for (const layer of this.layers) {
      const shifted = new Map<number, HTMLCanvasElement>();
      for (const [f, c] of layer.cels) {
        if (f === index) continue;
        shifted.set(f > index ? f - 1 : f, c);
      }
      layer.cels = shifted;
    }
    this.shiftCameraKeys(index, -1);
    this.currentFrame = Math.min(index, this.frames.length - 1);
    this.mark("delete-frame");
  }

  moveFrame(from: number, to: number): void {
    if (from === to) return;
    const [fr] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, fr);
    for (const layer of this.layers) {
      const map = new Map<number, HTMLCanvasElement>();
      const order = [...Array(this.frames.length).keys()];
      const items = order.map((i) => layer.cels.get(i) ?? null);
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      items.forEach((c, i) => {
        if (c) map.set(i, c);
      });
      layer.cels = map;
    }
    this.currentFrame = to;
    this.mark("move-frame");
  }

  setHold(index: number, hold: number): void {
    const f = this.frames[index];
    if (!f) return;
    f.hold = Math.max(1, Math.min(120, Math.round(hold)));
    this.mark("hold");
  }

  clearCurrentCel(): void {
    const layer = this.activeLayer;
    if (layer.meta.locked) return;
    const token = this.beginStroke("Clear");
    layer.cels.delete(this.currentFrame);
    this.commitStroke(token, "Clear frame");
  }

  transformCurrentCel(kind: "flipH" | "flipV" | "rotateCW" | "rotateCCW" | "scaleUp" | "scaleDown"): void {
    const layer = this.activeLayer;
    if (layer.meta.locked) return;
    const src = layer.getCel(this.currentFrame);
    if (!src) return;
    const token = this.beginStroke(kind);
    const dst = createCelCanvas(this.width, this.height);
    const ctx = dst.getContext("2d")!;
    ctx.translate(this.width / 2, this.height / 2);
    if (kind === "flipH") ctx.scale(-1, 1);
    if (kind === "flipV") ctx.scale(1, -1);
    if (kind === "rotateCW") ctx.rotate(Math.PI / 2);
    if (kind === "rotateCCW") ctx.rotate(-Math.PI / 2);
    if (kind === "scaleUp") ctx.scale(1.1, 1.1);
    if (kind === "scaleDown") ctx.scale(0.9, 0.9);
    ctx.drawImage(src, -this.width / 2, -this.height / 2);
    layer.cels.set(this.currentFrame, dst);
    this.commitStroke(token, kind);
  }

  pasteClipboard(): void {
    if (!this.clipboard) return;
    const layer = this.activeLayer;
    if (layer.meta.locked) return;
    const token = this.beginStroke("Paste");
    const cel = layer.ensureCel(this.currentFrame, this.width, this.height);
    cel.getContext("2d")!.drawImage(this.clipboard, 0, 0);
    this.commitStroke(token, "Paste");
  }

  copyCurrentCel(): void {
    const cel = this.activeLayer.getCel(this.currentFrame);
    this.clipboard = cel ? cloneCanvas(cel) : null;
  }

  private shiftCameraKeys(index: number, delta: number): void {
    this.cameraKeys = this.cameraKeys
      .map((k) => ({ ...k, frame: k.frame >= index ? k.frame + delta : k.frame }))
      .filter((k) => k.frame >= 0 && k.frame < this.frames.length);
    if (!this.cameraKeys.length) this.cameraKeys = [{ frame: 0, camera: { ...DEFAULT_CAMERA } }];
  }

  playbackLength(): number {
    return this.frames.reduce((s, f) => s + f.hold, 0);
  }

  frameAtPlayhead(playhead: number): number {
    let t = 0;
    for (let i = 0; i < this.frames.length; i++) {
      t += this.frames[i].hold;
      if (playhead < t) return i;
    }
    return this.frames.length - 1;
  }

  cameraAt(frame: number): CameraState {
    const keys = [...this.cameraKeys].sort((a, b) => a.frame - b.frame);
    if (!keys.length) return { ...this.camera };
    if (frame <= keys[0].frame) return { ...keys[0].camera };
    if (frame >= keys[keys.length - 1].frame) return { ...keys[keys.length - 1].camera };
    let a = keys[0];
    let b = keys[1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (keys[i].frame <= frame && keys[i + 1].frame >= frame) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const span = Math.max(1, b.frame - a.frame);
    const t = (frame - a.frame) / span;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
      x: lerp(a.camera.x, b.camera.x),
      y: lerp(a.camera.y, b.camera.y),
      zoom: lerp(a.camera.zoom, b.camera.zoom),
      rotation: lerp(a.camera.rotation, b.camera.rotation),
      shake: lerp(a.camera.shake, b.camera.shake),
    };
  }

  replaceCel(layerId: string, frame: number, canvas: HTMLCanvasElement, label = "AI"): void {
    const layer = this.layers.find((l) => l.meta.id === layerId) ?? this.activeLayer;
    const token = { layerId: layer.meta.id, frame, before: snapshotCanvas(layer.getCel(frame)) };
    layer.cels.set(frame, cloneCanvas(canvas));
    this.commitStroke(token, label);
  }

  insertGeneratedFrames(afterIndex: number, canvases: HTMLCanvasElement[], layerId?: string): void {
    const layer = this.layers.find((l) => l.meta.id === layerId) ?? this.activeLayer;
    for (let i = 0; i < canvases.length; i++) {
      this.insertFrame(afterIndex + 1 + i, true);
      layer.cels.set(afterIndex + 1 + i, cloneCanvas(canvases[i]));
    }
    this.mark("ai-frames");
  }
}

export function createProject(partial?: Partial<ProjectSettings>): AnimationDocument {
  return new AnimationDocument({
    name: partial?.name || "Untitled",
    width: partial?.width || 1920,
    height: partial?.height || 1080,
    fps: partial?.fps || 12,
    background: partial?.background || "#ffffff",
    transparentBackground: partial?.transparentBackground ?? false,
  });
}

import { AnimationDocument } from "../engine/document";
import { PointerSample, ToolId } from "../core/types";
import { StrokeBuilder, drawShape, drawText, floodFill, sampleColor, copyRect, eraseRect } from "../engine/drawing";
import { compositeFrame, drawChecker } from "../engine/compositor";
import { loadSettings } from "../core/settings";

export class CanvasView {
  readonly viewport: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly wrap: HTMLElement;
  private stroke = new StrokeBuilder();
  private drawing = false;
  private start: PointerSample | null = null;
  private last: PointerSample | null = null;
  private token: ReturnType<AnimationDocument["beginStroke"]> | null = null;
  private panning = false;
  private pan0 = { x: 0, y: 0, px: 0, py: 0 };
  private lasso: { x: number; y: number }[] = [];
  onColor: (c: string) => void = () => {};
  onStatus: (s: string) => void = () => {};

  constructor(private doc: AnimationDocument, host: HTMLElement) {
    this.wrap = host;
    this.viewport = document.createElement("canvas");
    this.viewport.className = "view-canvas";
    this.overlay = document.createElement("canvas");
    this.overlay.className = "overlay-canvas";
    host.append(this.viewport, this.overlay);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.bind();
  }

  setDoc(doc: AnimationDocument): void {
    this.doc = doc;
    this.redraw();
  }

  resize(): void {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.viewport, this.overlay]) {
      c.width = Math.max(1, Math.floor(r.width * dpr));
      c.height = Math.max(1, Math.floor(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    this.redraw();
  }

  private screenToDoc(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vx = (clientX - r.left) * dpr;
    const vy = (clientY - r.top) * dpr;
    const { zoom, panX, panY } = this.doc;
    const cx = this.viewport.width / 2 + panX;
    const cy = this.viewport.height / 2 + panY;
    const x = (vx - cx) / zoom + this.doc.width / 2;
    const y = (vy - cy) / zoom + this.doc.height / 2;
    return { x, y };
  }

  redraw(): void {
    const ctx = this.viewport.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    const { zoom, panX, panY } = this.doc;
    ctx.save();
    ctx.translate(this.viewport.width / 2 + panX, this.viewport.height / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.doc.width / 2, -this.doc.height / 2);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 32 / zoom;
    if (this.doc.settings.transparentBackground) {
      drawChecker(ctx, this.doc.width, this.doc.height);
    } else {
      ctx.fillStyle = this.doc.settings.background;
      ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    }
    ctx.restore();

    const composed = compositeFrame(this.doc, this.doc.currentFrame, {
      onion: !this.doc.playing,
      camera: true,
      background: false,
    });
    ctx.drawImage(composed, 0, 0);
    ctx.restore();

    const octx = this.overlay.getContext("2d")!;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.doc.selection) {
      this.strokeRectDoc(octx, this.doc.selection.x, this.doc.selection.y, this.doc.selection.w, this.doc.selection.h);
    }
    void dpr;
  }

  private strokeRectDoc(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const p0 = this.docToScreen(x, y);
    const p1 = this.docToScreen(x + w, y + h);
    ctx.save();
    ctx.strokeStyle = "rgba(62,224,197,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctx.restore();
  }

  private docToScreen(x: number, y: number): { x: number; y: number } {
    const { zoom, panX, panY } = this.doc;
    return {
      x: this.viewport.width / 2 + panX + (x - this.doc.width / 2) * zoom,
      y: this.viewport.height / 2 + panY + (y - this.doc.height / 2) * zoom,
    };
  }

  fit(): void {
    const r = this.wrap.getBoundingClientRect();
    const pad = 48;
    const zx = (r.width - pad) / this.doc.width;
    const zy = (r.height - pad) / this.doc.height;
    this.doc.zoom = Math.max(0.05, Math.min(8, Math.min(zx, zy) * (window.devicePixelRatio > 1 ? window.devicePixelRatio : 1) / Math.min(2, window.devicePixelRatio || 1)));
    this.doc.panX = 0;
    this.doc.panY = 0;
    this.redraw();
  }

  private sample(e: PointerEvent): PointerSample {
    const p = this.screenToDoc(e.clientX, e.clientY);
    const settings = loadSettings();
    const pressure = settings.tabletPressure && e.pointerType === "pen" ? e.pressure || 0.5 : e.pressure || 0.8;
    return { x: p.x, y: p.y, pressure: Math.max(0.05, pressure), t: e.timeStamp };
  }

  private bind(): void {
    const ov = this.overlay;
    ov.style.pointerEvents = "auto";
    ov.addEventListener("pointerdown", (e) => this.onDown(e));
    ov.addEventListener("pointermove", (e) => this.onMove(e));
    ov.addEventListener("pointerup", (e) => this.onUp(e));
    ov.addEventListener("pointerleave", (e) => {
      if (this.drawing) this.onUp(e);
    });
    ov.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        this.doc.zoom = Math.max(0.05, Math.min(16, this.doc.zoom * factor));
        this.redraw();
        this.onStatus(`${Math.round(this.doc.zoom * 100)}%`);
      },
      { passive: false }
    );
  }

  private onDown(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = this.sample(e);
    if (this.doc.tool === "hand" || e.button === 1) {
      this.panning = true;
      this.pan0 = { x: e.clientX, y: e.clientY, px: this.doc.panX, py: this.doc.panY };
      return;
    }
    const layer = this.doc.activeLayer;
    if (layer.meta.locked && this.doc.tool !== "eyedropper") {
      this.onStatus("Layer locked");
      return;
    }
    this.drawing = true;
    this.start = s;
    this.last = s;
    this.stroke.reset();
    this.stroke.add(s, this.doc.brush);

    if (this.doc.tool === "eyedropper") {
      const flat = compositeFrame(this.doc, this.doc.currentFrame, { onion: false, camera: false, background: true });
      this.onColor(sampleColor(flat, s.x, s.y));
      this.drawing = false;
      return;
    }
    if (this.doc.tool === "fill") {
      this.token = this.doc.beginStroke("Fill");
      const cel = this.doc.currentCel(true);
      if (cel) floodFill(cel, s.x, s.y, this.doc.color);
      if (this.token) this.doc.commitStroke(this.token, "Fill");
      this.token = null;
      this.drawing = false;
      this.redraw();
      return;
    }
    if (this.doc.tool === "text") {
      const text = window.prompt("Text");
      if (text) {
        this.token = this.doc.beginStroke("Text");
        const cel = this.doc.currentCel(true);
        if (cel) drawText(cel, text, s.x, s.y, this.doc.color, this.doc.brush.size);
        if (this.token) this.doc.commitStroke(this.token, "Text");
      }
      this.token = null;
      this.drawing = false;
      this.redraw();
      return;
    }
    if (this.doc.tool === "lasso") {
      this.lasso = [{ x: s.x, y: s.y }];
      return;
    }
    if (["pencil", "brush", "ink", "eraser"].includes(this.doc.tool)) {
      this.token = this.doc.beginStroke("Stroke");
      const cel = this.doc.currentCel(true);
      if (cel) {
        const ctx = cel.getContext("2d")!;
        this.stroke.stampAlong(ctx, s, s, this.style(), this.doc.tool);
      }
      this.redraw();
    }
  }

  private style() {
    return {
      color: this.doc.color,
      eraser: this.doc.tool === "eraser",
      brush: this.doc.brush,
    };
  }

  private onMove(e: PointerEvent): void {
    if (this.panning) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.doc.panX = this.pan0.px + (e.clientX - this.pan0.x) * dpr;
      this.doc.panY = this.pan0.py + (e.clientY - this.pan0.y) * dpr;
      this.redraw();
      return;
    }
    const s = this.sample(e);
    this.onStatus(`${Math.round(s.x)}, ${Math.round(s.y)}`);
    if (!this.drawing || !this.last) return;

    if (this.doc.tool === "lasso") {
      this.lasso.push({ x: s.x, y: s.y });
      this.drawLassoPreview();
      this.last = s;
      return;
    }

    if (["line", "rect", "circle", "select", "transform"].includes(this.doc.tool) && this.start) {
      this.drawShapePreview(this.start, s);
      this.last = s;
      return;
    }

    if (["pencil", "brush", "ink", "eraser"].includes(this.doc.tool)) {
      const p = this.stroke.add(s, this.doc.brush);
      const cel = this.doc.currentCel(true);
      if (cel) {
        const ctx = cel.getContext("2d")!;
        this.stroke.stampAlong(ctx, this.last, p, this.style(), this.doc.tool);
      }
      this.last = p;
      this.redraw();
    }
  }

  private drawShapePreview(a: PointerSample, b: PointerSample): void {
    this.redraw();
    const octx = this.overlay.getContext("2d")!;
    const pa = this.docToScreen(a.x, a.y);
    const pb = this.docToScreen(b.x, b.y);
    octx.save();
    octx.strokeStyle = "rgba(62,224,197,0.9)";
    octx.lineWidth = 1.5;
    octx.setLineDash([4, 3]);
    octx.beginPath();
    if (this.doc.tool === "line") {
      octx.moveTo(pa.x, pa.y);
      octx.lineTo(pb.x, pb.y);
      octx.stroke();
    } else {
      octx.strokeRect(pa.x, pa.y, pb.x - pa.x, pb.y - pa.y);
    }
    octx.restore();
  }

  private drawLassoPreview(): void {
    this.redraw();
    const octx = this.overlay.getContext("2d")!;
    octx.save();
    octx.strokeStyle = "rgba(124,108,255,0.95)";
    octx.setLineDash([5, 4]);
    octx.beginPath();
    this.lasso.forEach((p, i) => {
      const s = this.docToScreen(p.x, p.y);
      if (i === 0) octx.moveTo(s.x, s.y);
      else octx.lineTo(s.x, s.y);
    });
    octx.closePath();
    octx.stroke();
    octx.restore();
  }

  private onUp(e: PointerEvent): void {
    if (this.panning) {
      this.panning = false;
      return;
    }
    if (!this.drawing) return;
    this.drawing = false;
    const s = this.sample(e);
    const start = this.start;
    this.start = null;
    this.last = null;

    if (this.doc.tool === "lasso" && this.lasso.length > 2) {
      const xs = this.lasso.map((p) => p.x);
      const ys = this.lasso.map((p) => p.y);
      this.doc.selection = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
      this.lasso = [];
      this.redraw();
      return;
    }

    if (start && ["line", "rect", "circle"].includes(this.doc.tool)) {
      this.token = this.doc.beginStroke("Shape");
      const cel = this.doc.currentCel(true);
      if (cel) {
        drawShape(
          cel.getContext("2d")!,
          this.doc.tool as "line" | "rect" | "circle",
          start.x,
          start.y,
          s.x,
          s.y,
          this.doc.color,
          this.doc.brush.size,
          e.shiftKey
        );
      }
      if (this.token) this.doc.commitStroke(this.token, "Shape");
      this.token = null;
      this.redraw();
      return;
    }

    if (start && (this.doc.tool === "select" || this.doc.tool === "transform")) {
      this.doc.selection = {
        x: Math.min(start.x, s.x),
        y: Math.min(start.y, s.y),
        w: Math.abs(s.x - start.x),
        h: Math.abs(s.y - start.y),
      };
      this.redraw();
      return;
    }

    if (this.token) {
      this.doc.commitStroke(this.token, "Stroke");
      this.token = null;
    }
    this.redraw();
  }

  copySelection(): void {
    const sel = this.doc.selection;
    const cel = this.doc.activeLayer.getCel(this.doc.currentFrame);
    if (!sel || !cel) return;
    this.doc.clipboard = copyRect(cel, sel.x, sel.y, sel.w, sel.h);
  }

  cutSelection(): void {
    const sel = this.doc.selection;
    const cel = this.doc.currentCel(true);
    if (!sel || !cel) return;
    this.copySelection();
    const token = this.doc.beginStroke("Cut");
    eraseRect(cel, sel.x, sel.y, sel.w, sel.h);
    this.doc.commitStroke(token, "Cut");
    this.redraw();
  }

  cursorFor(tool: ToolId): string {
    if (tool === "hand") return "grab";
    if (tool === "eyedropper") return "crosshair";
    if (tool === "fill") return "cell";
    if (tool === "text") return "text";
    return "crosshair";
  }
}

import { BrushSettings, PointerSample, ToolId } from "../core/types";

export interface StrokeStyle {
  color: string;
  eraser: boolean;
  brush: BrushSettings;
}

function parseColor(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(n.slice(0, 2), 16) || 0,
    g: parseInt(n.slice(2, 4), 16) || 0,
    b: parseInt(n.slice(4, 6), 16) || 0,
  };
}

export class BrushCache {
  private canvas = document.createElement("canvas");
  private key = "";

  stamp(size: number, hardness: number, color: string, opacity: number): HTMLCanvasElement {
    const key = `${size}|${hardness}|${color}|${opacity}`;
    if (key === this.key) return this.canvas;
    this.key = key;
    const dim = Math.max(2, Math.ceil(size) + 2);
    this.canvas.width = dim;
    this.canvas.height = dim;
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, dim, dim);
    const cx = dim / 2;
    const cy = dim / 2;
    const outer = Math.max(0.5, size / 2);
    const inner = outer * Math.max(0, Math.min(1, hardness));
    const { r, g, b } = parseColor(color);
    const gdt = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    gdt.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
    gdt.addColorStop(Math.min(0.98, hardness * 0.95 + 0.02), `rgba(${r},${g},${b},${opacity})`);
    gdt.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gdt;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.fill();
    return this.canvas;
  }
}

const cache = new BrushCache();

function dist(a: PointerSample, b: PointerSample): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export class StrokeBuilder {
  private points: PointerSample[] = [];
  private smoothed: PointerSample | null = null;
  private lastStamp: PointerSample | null = null;

  reset(): void {
    this.points = [];
    this.smoothed = null;
    this.lastStamp = null;
  }

  add(raw: PointerSample, brush: BrushSettings): PointerSample {
    const stab = Math.max(0, Math.min(0.95, brush.stabilization));
    if (!this.smoothed) {
      this.smoothed = { ...raw };
    } else {
      const k = 1 - stab;
      this.smoothed = {
        x: this.smoothed.x + (raw.x - this.smoothed.x) * k,
        y: this.smoothed.y + (raw.y - this.smoothed.y) * k,
        pressure: this.smoothed.pressure + (raw.pressure - this.smoothed.pressure) * k,
        t: raw.t,
      };
    }
    const smoothAmt = brush.smoothing;
    const p = this.smoothed;
    if (this.points.length) {
      const prev = this.points[this.points.length - 1];
      const mixed: PointerSample = {
        x: prev.x + (p.x - prev.x) * (1 - smoothAmt * 0.5),
        y: prev.y + (p.y - prev.y) * (1 - smoothAmt * 0.5),
        pressure: p.pressure,
        t: p.t,
      };
      this.points.push(mixed);
      return mixed;
    }
    this.points.push({ ...p });
    return p;
  }

  stampAlong(
    ctx: CanvasRenderingContext2D,
    from: PointerSample,
    to: PointerSample,
    style: StrokeStyle,
    tool: ToolId
  ): void {
    const b = style.brush;
    const pressureSize = (p: number) => {
      const s = Math.max(0.05, Math.min(1, p || 0.5));
      const mix = b.pressureSensitivity;
      return b.size * (1 - mix + mix * s);
    };
    const spacing = Math.max(0.5, b.spacing * Math.max(1, b.size));
    const d = dist(from, to);
    const steps = Math.max(1, Math.ceil(d / spacing));
    ctx.save();
    if (style.eraser) ctx.globalCompositeOperation = "destination-out";
    else ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const pr = from.pressure + (to.pressure - from.pressure) * t;
      let size = pressureSize(pr);
      if (tool === "pencil") size = Math.max(1, b.size * 0.7 * (0.6 + 0.4 * pr));
      if (tool === "ink") size = pressureSize(Math.pow(pr, 0.85)) * 1.1;
      const stamp = cache.stamp(size, tool === "pencil" ? 1 : b.hardness, style.color, style.eraser ? 1 : b.opacity);
      ctx.drawImage(stamp, x - stamp.width / 2, y - stamp.height / 2);
    }
    ctx.restore();
    this.lastStamp = to;
  }
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  tool: "line" | "rect" | "circle",
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  size: number,
  fill = false
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (tool === "line") {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  } else if (tool === "rect") {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    if (fill) ctx.fillRect(x, y, w, h);
    else ctx.strokeRect(x, y, w, h);
  } else {
    const rx = (x1 - x0) / 2;
    const ry = (y1 - y0) / 2;
    const cx = x0 + rx;
    const cy = y0 + ry;
    ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    if (fill) ctx.fill();
    else ctx.stroke();
  }
  ctx.restore();
}

export function floodFill(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  hex: string,
  tolerance = 24
): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const i0 = (iy * w + ix) * 4;
  const sr = data[i0];
  const sg = data[i0 + 1];
  const sb = data[i0 + 2];
  const sa = data[i0 + 3];
  const { r, g, b } = parseColor(hex);
  const a = 255;
  if (Math.abs(sr - r) + Math.abs(sg - g) + Math.abs(sb - b) + Math.abs(sa - a) < 4) return;

  const match = (i: number) =>
    Math.abs(data[i] - sr) <= tolerance &&
    Math.abs(data[i + 1] - sg) <= tolerance &&
    Math.abs(data[i + 2] - sb) <= tolerance &&
    Math.abs(data[i + 3] - sa) <= tolerance;

  const stack = [ix, iy];
  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    let nx = cx;
    while (nx >= 0 && match((cy * w + nx) * 4) && !seen[cy * w + nx]) nx--;
    nx++;
    let spanUp = false;
    let spanDown = false;
    while (nx < w && match((cy * w + nx) * 4) && !seen[cy * w + nx]) {
      const p = (cy * w + nx) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = a;
      seen[cy * w + nx] = 1;
      if (cy > 0) {
        const up = !seen[(cy - 1) * w + nx] && match(((cy - 1) * w + nx) * 4);
        if (up && !spanUp) {
          stack.push(nx, cy - 1);
          spanUp = true;
        } else if (!up) spanUp = false;
      }
      if (cy < h - 1) {
        const down = !seen[(cy + 1) * w + nx] && match(((cy + 1) * w + nx) * 4);
        if (down && !spanDown) {
          stack.push(nx, cy + 1);
          spanDown = true;
        } else if (!down) spanDown = false;
      }
      nx++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function sampleColor(canvas: HTMLCanvasElement, x: number, y: number): string {
  const ctx = canvas.getContext("2d")!;
  const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(p[0])}${hex(p[1])}${hex(p[2])}`;
}

export function drawText(
  canvas: HTMLCanvasElement,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${Math.max(10, size * 4)}px "Segoe UI", Inter, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function copyRect(
  src: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

export function eraseRect(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
  canvas.getContext("2d")!.clearRect(x, y, w, h);
}

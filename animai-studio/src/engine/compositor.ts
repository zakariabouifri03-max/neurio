import { AnimationDocument } from "./document";
import { createCelCanvas } from "./cel";

const checker = (() => {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d9dde6";
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = "#c4cad6";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillRect(16, 16, 16, 16);
  return c;
})();

export function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const pat = ctx.createPattern(checker, "repeat");
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
}

export function compositeFrame(
  doc: AnimationDocument,
  frame: number,
  opts?: { onion?: boolean; camera?: boolean; background?: boolean }
): HTMLCanvasElement {
  const out = createCelCanvas(doc.width, doc.height);
  const ctx = out.getContext("2d")!;
  if (opts?.background !== false) {
    if (doc.settings.transparentBackground) drawChecker(ctx, doc.width, doc.height);
    else {
      ctx.fillStyle = doc.settings.background;
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
  }

  if (opts?.onion !== false && doc.onion.enabled) {
    drawOnion(ctx, doc, frame);
  }

  paintLayers(ctx, doc, frame);

  if (opts?.camera) {
    const cam = doc.playing ? doc.cameraAt(frame) : doc.camera;
    if (cam.zoom !== 1 || cam.x || cam.y || cam.rotation || cam.shake) {
      const cammed = createCelCanvas(doc.width, doc.height);
      const cctx = cammed.getContext("2d")!;
      if (opts?.background !== false && !doc.settings.transparentBackground) {
        cctx.fillStyle = doc.settings.background;
        cctx.fillRect(0, 0, doc.width, doc.height);
      }
      cctx.save();
      const shakeX = cam.shake ? (Math.random() - 0.5) * cam.shake * 8 : 0;
      const shakeY = cam.shake ? (Math.random() - 0.5) * cam.shake * 8 : 0;
      cctx.translate(doc.width / 2 + cam.x + shakeX, doc.height / 2 + cam.y + shakeY);
      cctx.rotate((cam.rotation * Math.PI) / 180);
      cctx.scale(cam.zoom, cam.zoom);
      cctx.drawImage(out, -doc.width / 2, -doc.height / 2);
      cctx.restore();
      return cammed;
    }
  }
  return out;
}

function paintLayers(ctx: CanvasRenderingContext2D, doc: AnimationDocument, frame: number): void {
  for (const layer of doc.layers) {
    if (!layer.meta.visible) continue;
    const cel = layer.getCel(frame);
    if (!cel) continue;
    ctx.save();
    ctx.globalAlpha = layer.meta.opacity;
    ctx.globalCompositeOperation = layer.meta.blend;
    ctx.drawImage(cel, 0, 0);
    ctx.restore();
  }
}

function tinted(src: HTMLCanvasElement, color: string, alpha: number): HTMLCanvasElement {
  const c = createCelCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, src.width, src.height);
  ctx.globalAlpha = alpha;
  return c;
}

function flattenNoOnion(doc: AnimationDocument, frame: number): HTMLCanvasElement {
  const out = createCelCanvas(doc.width, doc.height);
  const ctx = out.getContext("2d")!;
  paintLayers(ctx, doc, frame);
  return out;
}

function drawOnion(ctx: CanvasRenderingContext2D, doc: AnimationDocument, frame: number): void {
  const { prev, next, opacity } = doc.onion;
  for (let i = prev; i >= 1; i--) {
    const f = frame - i;
    if (f < 0) continue;
    const flat = flattenNoOnion(doc, f);
    const t = tinted(flat, "#ff4d6d", opacity * (1 - (i - 1) / (prev + 1)));
    ctx.save();
    ctx.globalAlpha = opacity * (1 - (i - 1) / (prev + 0.5));
    ctx.drawImage(t, 0, 0);
    ctx.restore();
  }
  for (let i = 1; i <= next; i++) {
    const f = frame + i;
    if (f >= doc.frameCount) continue;
    const flat = flattenNoOnion(doc, f);
    const t = tinted(flat, "#3d8bff", opacity * (1 - (i - 1) / (next + 1)));
    ctx.save();
    ctx.globalAlpha = opacity * (1 - (i - 1) / (next + 0.5));
    ctx.drawImage(t, 0, 0);
    ctx.restore();
  }
}

export function flattenForExport(doc: AnimationDocument, frame: number, transparent: boolean): HTMLCanvasElement {
  const out = createCelCanvas(doc.width, doc.height);
  const ctx = out.getContext("2d")!;
  if (!transparent) {
    ctx.fillStyle = doc.settings.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  paintLayers(ctx, doc, frame);
  const cam = doc.cameraAt(frame);
  if (cam.zoom !== 1 || cam.x || cam.y || cam.rotation || cam.shake) {
    const cammed = createCelCanvas(doc.width, doc.height);
    const cctx = cammed.getContext("2d")!;
    if (!transparent) {
      cctx.fillStyle = doc.settings.background;
      cctx.fillRect(0, 0, doc.width, doc.height);
    }
    cctx.save();
    const shakeX = cam.shake ? Math.sin(frame * 12.1) * cam.shake * 6 : 0;
    const shakeY = cam.shake ? Math.cos(frame * 9.4) * cam.shake * 6 : 0;
    cctx.translate(doc.width / 2 + cam.x + shakeX, doc.height / 2 + cam.y + shakeY);
    cctx.rotate((cam.rotation * Math.PI) / 180);
    cctx.scale(cam.zoom, cam.zoom);
    cctx.drawImage(out, -doc.width / 2, -doc.height / 2);
    cctx.restore();
    return cammed;
  }
  return out;
}

export function thumbnail(doc: AnimationDocument, frame: number, maxW = 72, maxH = 48): HTMLCanvasElement {
  const src = flattenForExport(doc, frame, false);
  const scale = Math.min(maxW / src.width, maxH / src.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

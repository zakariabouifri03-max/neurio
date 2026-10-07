// Montaj Pro — single frame capture (freeze frame / thumbnails)
import { drawFrame } from './render.js';

export function captureFrame(app, time) {
  const p = app.project;
  const c = document.createElement('canvas');
  c.width = p.settings.width; c.height = p.settings.height;
  const ctx = c.getContext('2d');
  drawFrame(ctx, p, time, app.provider);
  return c;
}
export function canvasToBlob(canvas, type = 'image/png', q = 0.92) {
  return new Promise((res) => canvas.toBlob(res, type, q));
}
// average colour of the frame (used for gradient hooks)
export function averageColor(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

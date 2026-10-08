/**
 * Offline image operations — no network, no API key.
 * Used by the "Local (offline)" providers for background removal and upscaling.
 */

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported image format.'));
    img.src = dataUrl;
  });
}

/**
 * Background removal by chroma-similarity flood fill from the image border,
 * followed by alpha feathering. Works very well for product shots, logos and
 * AI-generated art on flat backgrounds; cloud providers can be configured for
 * complex photos.
 */
export async function removeBackgroundLocal(dataUrl: string, tolerance = 38): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  // Seed colour = average of the four corners.
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const seed = corners.reduce(
    (acc, i) => ({ r: acc.r + data[i] / 4, g: acc.g + data[i + 1] / 4, b: acc.b + data[i + 2] / 4 }),
    { r: 0, g: 0, b: 0 }
  );

  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  const tol2 = tolerance * tolerance * 3;
  while (stack.length) {
    const p = stack.pop()!;
    if (p < 0 || p >= w * h || visited[p]) continue;
    const i = p * 4;
    const dr = data[i] - seed.r;
    const dg = data[i + 1] - seed.g;
    const db = data[i + 2] - seed.b;
    if (dr * dr + dg * dg + db * db > tol2) continue;
    visited[p] = 1;
    data[i + 3] = 0;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    stack.push(p - w, p + w);
  }

  // Feather the cut edge so it doesn't look stair-stepped.
  const alphaCopy = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alphaCopy[p] = data[p * 4 + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const a = alphaCopy[p];
      if (a === 0) continue;
      const around =
        alphaCopy[p - 1] + alphaCopy[p + 1] + alphaCopy[p - w] + alphaCopy[p + w];
      if (around < 1020) data[p * 4 + 3] = Math.round((a + around / 4) / 2);
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Stepped bicubic-ish resample — noticeably cleaner than a single draw call. */
export async function upscaleLocal(dataUrl: string, scale: 2 | 4 = 2): Promise<string> {
  const img = await loadImage(dataUrl);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let src: CanvasImageSource = img;
  const steps = scale === 4 ? 2 : 1;
  let canvas = document.createElement('canvas');
  for (let i = 0; i < steps; i++) {
    const next = document.createElement('canvas');
    next.width = Math.round(w * 2);
    next.height = Math.round(h * 2);
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, next.width, next.height);
    // Light unsharp mask to restore perceived detail.
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.12;
    ctx.drawImage(next, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    w = next.width;
    h = next.height;
    src = next;
    canvas = next;
  }
  return canvas.toDataURL('image/png');
}

export function validateImageDataUrl(dataUrl: string): void {
  if (!/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/.test(dataUrl)) {
    throw new Error('Unsupported image format.');
  }
}

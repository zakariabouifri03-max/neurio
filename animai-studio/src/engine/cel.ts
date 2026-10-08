export function createCelCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCelCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  return c;
}

export function clearCanvas(c: HTMLCanvasElement): void {
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
}

export function canvasHasPixels(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext("2d")!;
  const data = ctx.getImageData(0, 0, Math.min(c.width, 64), Math.min(c.height, 64)).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) return true;
  return false;
}

export async function canvasToPngBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

export function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

export async function pngBytesToCanvas(bytes: Uint8Array, w: number, h: number): Promise<HTMLCanvasElement> {
  const blob = blobFromBytes(bytes, "image/png");
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = createCelCanvas(w, h);
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

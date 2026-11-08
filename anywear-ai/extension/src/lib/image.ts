/** Image helpers: CORS-safe fetching, canvas dataURL conversion. */

/**
 * Fetch an image URL into a data URL via canvas.
 * Resolves null when the image is cross-origin tainted (cannot read pixels)
 * or unreachable — callers must then send the original URL to the backend,
 * which fetches it server-side (no CORS restrictions).
 */
export async function imageToDataURL(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await blobToDataURL(blob);
  } catch {
    return null;
  }
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** Convert a data URL / blob URL / remote URL to a Blob. */
export async function dataURLToBlob(dataURL: string): Promise<Blob> {
  const resp = await fetch(dataURL);
  return resp.blob();
}

/** Read a File into a data URL. */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

/** Small thumbnail data URL (max edge `max`), used in popup previews. */
export async function thumbnail(
  src: string,
  max = 160
): Promise<string | null> {
  try {
    const dataURL = src.startsWith("data:") ? src : await imageToDataURL(src);
    if (!dataURL) return null;
    return await resizeDataURL(dataURL, max);
  } catch {
    return null;
  }
}

export async function resizeDataURL(dataURL: string, max: number): Promise<string> {
  const img = await loadImage(dataURL);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function isProbablyImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|avif|gif|bmp|svg)(\?|$)/i.test(url);
}

export function guessImageType(file: File): string {
  return file.type || (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
}

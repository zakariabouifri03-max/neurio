import { AnimationDocument, Layer } from "../engine/document";
import { createCelCanvas, loadImage } from "../engine/cel";
import { log } from "../core/logger";

export async function importImageToFrame(
  doc: AnimationDocument,
  file: File,
  asNewFrame = false
): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (asNewFrame) doc.insertFrame(doc.currentFrame + 1, true);
    const layer = doc.activeLayer;
    const token = doc.beginStroke("Import image");
    const cel = layer.ensureCel(doc.currentFrame, doc.width, doc.height);
    const ctx = cel.getContext("2d")!;
    const scale = Math.min(doc.width / img.width, doc.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (doc.width - w) / 2, (doc.height - h) / 2, w, h);
    doc.commitStroke(token, "Import image");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importImageAsLayer(doc: AnimationDocument, file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const layer = doc.addLayer("image", file.name.replace(/\.\w+$/, ""));
    const cel = layer.ensureCel(doc.currentFrame, doc.width, doc.height);
    const ctx = cel.getContext("2d")!;
    const scale = Math.min(doc.width / img.width, doc.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (doc.width - w) / 2, (doc.height - h) / 2, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importGifOrVideoFrames(doc: AnimationDocument, file: File, maxFrames = 120): Promise<void> {
  if (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif")) {
    await importImageToFrame(doc, file, false);
    log.warn("GIF imported as a still on the current frame. Frame extraction for multi-frame GIF uses video decode when possible.");
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name)) {
    await extractVideoFrames(doc, file, maxFrames);
  }
}

async function extractVideoFrames(doc: AnimationDocument, file: File, maxFrames: number): Promise<void> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not read video"));
  });
  const duration = video.duration || 1;
  const count = Math.min(maxFrames, Math.max(1, Math.round(duration * Math.min(doc.fps, 24))));
  const layer = doc.addLayer("video", file.name.replace(/\.\w+$/, ""));
  for (let i = 0; i < count; i++) {
    if (i >= doc.frameCount) doc.insertFrame(doc.frameCount, true);
    video.currentTime = (i / count) * duration;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    const cel = layer.ensureCel(i, doc.width, doc.height);
    const ctx = cel.getContext("2d")!;
    const scale = Math.min(doc.width / video.videoWidth, doc.height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    ctx.drawImage(video, (doc.width - w) / 2, (doc.height - h) / 2, w, h);
  }
  URL.revokeObjectURL(url);
  doc.mark("import-video");
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files!]);
    input.click();
  });
}

export async function svgToImage(file: File): Promise<HTMLImageElement> {
  const text = await file.text();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function stampImage(doc: AnimationDocument, img: HTMLImageElement, layer?: Layer): void {
  const target = layer ?? doc.activeLayer;
  const token = doc.beginStroke("Stamp");
  const cel = target.ensureCel(doc.currentFrame, doc.width, doc.height);
  const ctx = cel.getContext("2d")!;
  const scale = Math.min(doc.width / img.width, doc.height / img.height, 1);
  ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
  doc.commitStroke(token, "Stamp image");
}

export { createCelCanvas };

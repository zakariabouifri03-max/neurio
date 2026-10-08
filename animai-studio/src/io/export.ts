import JSZip from "jszip";
import { AnimationDocument } from "../engine/document";
import { flattenForExport } from "../engine/compositor";
import { encodeGif } from "./gif";
import { downloadBlob } from "../project/format";
import { log } from "../core/logger";
import { createCelCanvas } from "../engine/cel";

export type ExportFormat = "gif" | "pngseq" | "webm" | "mp4" | "webp";

export interface ExportOptions {
  format: ExportFormat;
  fps: number;
  quality: number;
  scale: number;
  transparent: boolean;
  filename: string;
  onProgress?: (t: number, label: string) => void;
}

function scaled(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return src;
  const c = createCelCanvas(Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function expandedFrames(doc: AnimationDocument, transparent: boolean, scale: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < doc.frames.length; i++) {
    const hold = doc.frames[i].hold;
    const frame = scaled(flattenForExport(doc, i, transparent), scale);
    for (let h = 0; h < hold; h++) out.push(frame);
  }
  return out;
}

async function canvasPng(c: HTMLCanvasElement): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png");
  });
}

export async function exportAnimation(doc: AnimationDocument, opts: ExportOptions): Promise<void> {
  const progress = opts.onProgress || (() => {});
  progress(0.02, "Preparing frames");
  const frames = expandedFrames(doc, opts.transparent && (opts.format === "gif" || opts.format === "pngseq" || opts.format === "webp"), opts.scale);
  if (!frames.length) throw new Error("Nothing to export");

  if (opts.format === "pngseq") {
    const zip = new JSZip();
    for (let i = 0; i < frames.length; i++) {
      progress(i / frames.length, `PNG ${i + 1}/${frames.length}`);
      zip.file(`frame_${String(i + 1).padStart(4, "0")}.png`, await canvasPng(frames[i]));
    }
    const bytes = await zip.generateAsync({ type: "blob" });
    downloadBlob(bytes, opts.filename.replace(/\.\w+$/, "") + ".zip");
    progress(1, "Done");
    return;
  }

  if (opts.format === "gif") {
    const encoded = encodeGif(
      frames.map((c) => {
        const ctx = c.getContext("2d")!;
        return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
      }),
      Math.max(2, Math.round(100 / opts.fps)),
      (t) => progress(t, "Encoding GIF")
    );
    const gifCopy = new Uint8Array(encoded.byteLength);
    gifCopy.set(encoded);
    downloadBlob(new Blob([gifCopy.buffer], { type: "image/gif" }), opts.filename.replace(/\.\w+$/, "") + ".gif");
    progress(1, "Done");
    return;
  }

  if (opts.format === "webp") {
    const zip = new JSZip();
    for (let i = 0; i < frames.length; i++) {
      progress(i / frames.length, `WebP ${i + 1}/${frames.length}`);
      const blob = await new Promise<Blob>((resolve, reject) => {
        frames[i].toBlob((b) => (b ? resolve(b) : reject(new Error("webp"))), "image/webp", opts.quality);
      });
      zip.file(`frame_${String(i + 1).padStart(4, "0")}.webp`, blob);
    }
    downloadBlob(await zip.generateAsync({ type: "blob" }), opts.filename.replace(/\.\w+$/, "") + "-webp.zip");
    progress(1, "Done");
    return;
  }

  await exportVideo(frames, opts);
}

async function exportVideo(frames: HTMLCanvasElement[], opts: ExportOptions): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = frames[0].width;
  canvas.height = frames[0].height;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(opts.fps);
  const mimeCandidates =
    opts.format === "mp4"
      ? ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
  if (opts.format === "mp4" && !mime.includes("mp4")) {
    log.warn("This browser cannot mux MP4; exporting WebM instead. The Windows .exe build uses the same capture path.");
  }
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 * opts.quality });
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });
  rec.start();
  const frameTime = 1000 / opts.fps;
  for (let i = 0; i < frames.length; i++) {
    ctx.drawImage(frames[i], 0, 0);
    opts.onProgress?.(i / frames.length, `Recording ${i + 1}/${frames.length}`);
    await new Promise((r) => setTimeout(r, frameTime));
  }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  downloadBlob(new Blob(chunks, { type: mime }), opts.filename.replace(/\.\w+$/, "") + "." + ext);
  opts.onProgress?.(1, "Done");
}

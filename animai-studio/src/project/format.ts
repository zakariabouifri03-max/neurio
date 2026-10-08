import JSZip from "jszip";
import { AnimationDocument, Layer, createProject } from "../engine/document";
import { canvasToPngBytes, pngBytesToCanvas } from "../engine/cel";
import { log } from "../core/logger";
import { AudioClip, CameraKeyframe, CharacterReference, LayerMeta, ProjectSettings, TimelineFrame } from "../core/types";

const VERSION = 1;

interface ProjectJSON {
  version: number;
  kind: "animai";
  settings: ProjectSettings;
  frames: TimelineFrame[];
  layers: LayerMeta[];
  currentFrame: number;
  currentLayer: number;
  onion: AnimationDocument["onion"];
  camera: AnimationDocument["camera"];
  cameraKeys: CameraKeyframe[];
  audio: AudioClip[];
  characters: CharacterReference[];
  ai: AnimationDocument["ai"];
  createdAt: number;
  modifiedAt: number;
}

export async function serializeProject(doc: AnimationDocument): Promise<Uint8Array> {
  const zip = new JSZip();
  const json: ProjectJSON = {
    version: VERSION,
    kind: "animai",
    settings: doc.settings,
    frames: doc.frames,
    layers: doc.layers.map((l) => l.meta),
    currentFrame: doc.currentFrame,
    currentLayer: doc.currentLayer,
    onion: doc.onion,
    camera: doc.camera,
    cameraKeys: doc.cameraKeys,
    audio: doc.audio,
    characters: doc.characters,
    ai: doc.ai,
    createdAt: doc.createdAt,
    modifiedAt: doc.modifiedAt,
  };
  zip.file("project.json", JSON.stringify(json, null, 2));
  for (const layer of doc.layers) {
    for (const [frame, canvas] of layer.cels) {
      const bytes = await canvasToPngBytes(canvas);
      zip.file(`cels/${layer.meta.id}/${frame}.png`, bytes);
    }
  }
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return out;
}

export async function deserializeProject(data: Uint8Array): Promise<AnimationDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    log.error("Corrupted project zip", err);
    throw new Error("This .animai file is not a valid archive.");
  }
  const jsonFile = zip.file("project.json");
  if (!jsonFile) throw new Error("Missing project.json — file may be corrupted.");
  let json: ProjectJSON;
  try {
    json = JSON.parse(await jsonFile.async("string"));
  } catch {
    throw new Error("project.json is unreadable.");
  }
  if (json.kind !== "animai") throw new Error("Not an ANIMAI project.");
  const doc = createProject(json.settings);
  doc.frames = json.frames?.length ? json.frames : doc.frames;
  doc.layers = (json.layers || []).map((m) => new Layer(m));
  if (!doc.layers.length) doc.addLayer("drawing", "Layer 1");
  doc.currentFrame = Math.min(json.currentFrame || 0, doc.frames.length - 1);
  doc.currentLayer = Math.min(json.currentLayer || 0, doc.layers.length - 1);
  if (json.onion) doc.onion = json.onion;
  if (json.camera) doc.camera = json.camera;
  if (json.cameraKeys) doc.cameraKeys = json.cameraKeys;
  if (json.audio) doc.audio = json.audio;
  if (json.characters) doc.characters = json.characters;
  if (json.ai) doc.ai = json.ai;
  doc.createdAt = json.createdAt || Date.now();
  doc.modifiedAt = json.modifiedAt || Date.now();

  const celFiles = Object.keys(zip.files).filter((n) => n.startsWith("cels/") && n.endsWith(".png"));
  for (const name of celFiles) {
    const parts = name.split("/");
    const layerId = parts[1];
    const frame = Number(parts[2].replace(".png", ""));
    const layer = doc.layers.find((l) => l.meta.id === layerId);
    if (!layer || Number.isNaN(frame)) continue;
    const bytes = await zip.file(name)!.async("uint8array");
    layer.cels.set(frame, await pngBytesToCanvas(bytes, doc.width, doc.height));
  }
  doc.dirty = false;
  return doc;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function bytesToDataUrl(bytes: Uint8Array, mime = "application/octet-stream"): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

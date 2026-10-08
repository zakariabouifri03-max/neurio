export interface InterpOptions {
  count: number;
  onProgress?: (t: number) => void;
}

export interface CleanupOptions {
  strength: number;
  detail: number;
  preserveOriginal: boolean;
}

export interface ColorizeOptions {
  palette: string[];
  description: string;
  referenceDataUrl?: string;
}

export interface MotionOptions {
  motion: string;
  customPrompt: string;
  frames: number;
}

export interface AssistantContext {
  frameCount: number;
  currentFrame: number;
  layerName: string;
  fps: number;
  hasDrawing: boolean;
}

export interface AssistantResult {
  message: string;
  action?:
    | { type: "interpolate"; count: number }
    | { type: "cleanup"; strength: number }
    | { type: "colorize"; description: string }
    | { type: "motion"; motion: string; frames: number }
    | { type: "text-to-anim"; prompt: string }
    | { type: "transform"; kind: string }
    | { type: "frames"; op: "add" | "duplicate" | "blank"; count: number }
    | { type: "onion"; enabled?: boolean; prev?: number; next?: number }
    | { type: "none" };
  cloudRequired?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  kind: "local" | "cloud" | "custom";
  description: string;
  requiresCloud: boolean;
  isAvailable(): Promise<boolean>;
  interpolate(a: ImageData, b: ImageData, opts: InterpOptions): Promise<ImageData[]>;
  cleanup(image: ImageData, opts: CleanupOptions): Promise<ImageData>;
  colorize(image: ImageData, opts: ColorizeOptions): Promise<ImageData>;
  generateMotion(image: ImageData, opts: MotionOptions): Promise<ImageData[]>;
  textToAnimation(prompt: string, width: number, height: number, frames: number): Promise<ImageData[]>;
  assistant(prompt: string, ctx: AssistantContext): Promise<AssistantResult>;
}

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

export function canvasToImageData(c: HTMLCanvasElement): ImageData {
  return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
}

export function cloneImageData(img: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export function yieldFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

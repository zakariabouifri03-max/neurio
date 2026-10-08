import type { MediaProbe, MediaAsset } from '../types/media';
import type { WaveformData } from '../types/waveform';
import type { EncoderCapabilities, ExportProgress, ExportSettings } from '../types/export';
import type { RenderPlan } from '../export/plan';

/**
 * The platform bridge.
 *
 * Everything in `core/` is platform-neutral and talks to the outside world only
 * through this interface. Two implementations exist:
 *
 *   • TauriBridge — the real desktop app on Windows. FFmpeg, SQLite, the file
 *     system and the GPU all live behind Rust commands.
 *   • WebBridge   — the browser build used for development, CI smoke tests and
 *     the sandbox preview. It probes with HTMLMediaElement, generates
 *     thumbnails with canvas and exports with MediaRecorder.
 *
 * Feature availability is reported, never assumed: `capabilities()` tells the
 * UI what to disable instead of the UI guessing from `import.meta.env`.
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface FileStat {
  exists: boolean;
  sizeBytes: number;
  modifiedAt: number;
  isDirectory: boolean;
}

export interface ThumbnailOptions {
  count: number;
  width: number;
  height: number;
  /** Seconds of source to cover; defaults to the whole file. */
  spanSec?: number;
}

export interface WaveformOptions {
  /** Target peak buckets across the file. */
  buckets?: number;
}

export interface ExportRunResult {
  ok: boolean;
  outputPath: string;
  sizeBytes?: number;
  error?: string;
  cancelled?: boolean;
  warnings: string[];
}

export interface WhisperResult {
  language: string;
  segments: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PlatformBridge {
  readonly kind: 'tauri' | 'web';
  /** Which optional capabilities this runtime has. */
  capabilities: RuntimeCapabilities;

  /* ---------- file system ---------- */
  pickFiles(filters: FileFilter[]): Promise<string[]>;
  pickSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
  appDataDir(): Promise<string>;
  cacheDir(): Promise<string>;
  joinPath(...parts: string[]): string;
  /** A URI the <video>/<img> element can load for this path. */
  toDisplayUri(path: string): string;

  /* ---------- media engine ---------- */
  probe(path: string): Promise<MediaProbe>;
  generateThumbnails(path: string, options: ThumbnailOptions): Promise<{ uri: string; times: number[] }>;
  generateWaveform(path: string, options?: WaveformOptions): Promise<WaveformData>;
  encoderCapabilities(): Promise<EncoderCapabilities>;
  generateProxy(asset: MediaAsset, height: number, onProgress?: (fraction: number) => void): Promise<string>;
  extractAudio(path: string, targetPath: string): Promise<void>;

  /* ---------- rendering ---------- */
  startExport(plan: RenderPlan, settings: ExportSettings, onProgress: (p: ExportProgress) => void): Promise<ExportRunResult>;
  cancelExport(): void;
  /** Renders one frame to a PNG; used for the poster frame and the export dialog preview. */
  captureFrame(plan: RenderPlan, timeSec: number): Promise<string>;

  /* ---------- local AI ---------- */
  transcribe(path: string, language?: string, onProgress?: (fraction: number) => void): Promise<WhisperResult>;
  listLocalModels(): Promise<{ id: string; sizeBytes?: number; downloaded: boolean }[]>;
  downloadModel(id: string, onProgress?: (fraction: number) => void): Promise<string>;

  /* ---------- misc ---------- */
  isOnline(): boolean;
  log(level: LogLevel, scope: string, message: string, detail?: unknown): void;
  onFileDropped(handler: (paths: string[]) => void): () => void;
}

export interface RuntimeCapabilities {
  /** True when a real FFmpeg binary is available. */
  ffmpeg: boolean;
  ffprobe: boolean;
  /** True when the native encoder can produce H.265. */
  hevc: boolean;
  /** True when a hardware encoder was detected. */
  hardwareEncoding: boolean;
  /** True when faster-whisper is installed and a model is present. */
  whisper: boolean;
  /** True when a local LLM endpoint is reachable. */
  localLlm: boolean;
  /** True when ONNX runtime segmentation models are installed. */
  segmentation: boolean;
  /** Native file dialogs (false = browser <input type=file>). */
  nativeDialogs: boolean;
  /** Persistent app-data directory (false = IndexedDB/localStorage). */
  persistentStorage: boolean;
  /** Export produces a real file on disk rather than a browser download. */
  fileExport: boolean;
}

export const NO_CAPABILITIES: RuntimeCapabilities = {
  ffmpeg: false,
  ffprobe: false,
  hevc: false,
  hardwareEncoding: false,
  whisper: false,
  localLlm: false,
  segmentation: false,
  nativeDialogs: false,
  persistentStorage: false,
  fileExport: false,
};

/** Thrown when the user's machine genuinely lacks what an operation needs. */
export class CapabilityError extends Error {
  constructor(readonly capability: keyof RuntimeCapabilities, message: string) {
    super(message);
    this.name = 'CapabilityError';
  }
}

import type {
  ExportRunResult,
  FileFilter,
  FileStat,
  PlatformBridge,
  RuntimeCapabilities,
  ThumbnailOptions,
  WaveformOptions,
  WhisperResult,
} from './PlatformBridge';
import { CapabilityError } from './PlatformBridge';
import type { LogLevel } from './PlatformBridge';
import type { MediaAsset, MediaProbe } from '../types/media';
import type { WaveformData } from '../types/waveform';
import type { EncoderCapabilities, ExportProgress, ExportSettings } from '../types/export';
import type { RenderPlan } from '../export/plan';

/**
 * Desktop implementation, backed by the Rust commands in `src-tauri/src`.
 *
 * This file contains no business logic: every method is an `invoke` plus a
 * shape check. All the real work — FFmpeg orchestration, SQLite, cache
 * management, progress parsing — lives in Rust where it can use threads,
 * child processes and the GPU.
 *
 * Events (`export-progress`, `log`) come back over Tauri's event channel and
 * are re-emitted to the callers that registered for them.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (event: string, handler: (payload: { payload: unknown }) => void) => Promise<() => void>;

export interface TauriRuntime {
  invoke: Invoke;
  listen: Listen;
  convertFileSrc: (path: string) => string;
  appDataDir: () => Promise<string>;
  appCacheDir: () => Promise<string>;
  join: (...parts: string[]) => Promise<string>;
}

async function loadTauriRuntime(): Promise<TauriRuntime> {
  const core = (await import('@tauri-apps/api/core')) as unknown as {
    invoke: Invoke;
    convertFileSrc: (path: string) => string;
  };
  const event = (await import('@tauri-apps/api/event')) as unknown as { listen: Listen };
  const path = (await import('@tauri-apps/api/path')) as unknown as {
    appDataDir: () => Promise<string>;
    appCacheDir: () => Promise<string>;
    join: (...parts: string[]) => Promise<string>;
  };
  return { invoke: core.invoke, listen: event.listen, convertFileSrc: core.convertFileSrc, appDataDir: path.appDataDir, appCacheDir: path.appCacheDir, join: path.join };
}

export class TauriBridge implements PlatformBridge {
  readonly kind = 'tauri' as const;
  capabilities: RuntimeCapabilities = {
    ffmpeg: false,
    ffprobe: false,
    hevc: false,
    hardwareEncoding: false,
    whisper: false,
    localLlm: false,
    segmentation: false,
    nativeDialogs: true,
    persistentStorage: true,
    fileExport: true,
  };

  private runtime: TauriRuntime | null = null;
  private exportUnlisten: (() => void) | null = null;
  private progressHandler: ((p: ExportProgress) => void) | null = null;

  private async rt(): Promise<TauriRuntime> {
    if (!this.runtime) this.runtime = await loadTauriRuntime();
    return this.runtime;
  }

  /** Probe what this machine can actually do. Called once at startup. */
  async initialise(): Promise<RuntimeCapabilities> {
    const rt = await this.rt();
    const caps = await rt.invoke<EncoderCapabilities>('get_encoder_capabilities');
    this.capabilities = {
      ffmpeg: Boolean(caps.ffmpegVersion),
      ffprobe: caps.ffprobeAvailable,
      hevc: caps.videoCodecs.includes('h265'),
      hardwareEncoding: caps.hardwareEncoders.length > 0,
      whisper: await rt.invoke<boolean>('whisper_is_ready').catch(() => false),
      localLlm: await rt.invoke<boolean>('llm_is_ready').catch(() => false),
      segmentation: await rt.invoke<boolean>('segmentation_is_ready').catch(() => false),
      nativeDialogs: true,
      persistentStorage: true,
      fileExport: true,
    };
    await rt.listen('export-progress', (event) => {
      this.progressHandler?.(event.payload as ExportProgress);
    }).then((unlisten) => {
      this.exportUnlisten = unlisten;
    });
    return this.capabilities;
  }

  /* ---------------- file system ---------------- */

  async pickFiles(filters: FileFilter[]): Promise<string[]> {
    const rt = await this.rt();
    const result = await rt.invoke<string[] | null>('pick_files', { filters });
    return result ?? [];
  }

  async pickSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null> {
    const rt = await this.rt();
    return rt.invoke<string | null>('pick_save_path', { defaultName, filters });
  }

  async pickDirectory(): Promise<string | null> {
    const rt = await this.rt();
    return rt.invoke<string | null>('pick_directory');
  }

  async stat(path: string): Promise<FileStat> {
    const rt = await this.rt();
    return rt.invoke<FileStat>('fs_stat', { path });
  }

  async exists(path: string): Promise<boolean> {
    const rt = await this.rt();
    return rt.invoke<boolean>('fs_exists', { path });
  }

  async readTextFile(path: string): Promise<string> {
    const rt = await this.rt();
    return rt.invoke<string>('fs_read_text', { path });
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const rt = await this.rt();
    await rt.invoke('fs_write_text_atomic', { path, content });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const rt = await this.rt();
    const bytes = await rt.invoke<number[]>('fs_read_binary', { path });
    return Uint8Array.from(bytes);
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const rt = await this.rt();
    await rt.invoke('fs_write_binary', { path, data: Array.from(data) });
  }

  async removeFile(path: string): Promise<void> {
    const rt = await this.rt();
    await rt.invoke('fs_remove', { path });
  }

  async appDataDir(): Promise<string> {
    return (await this.rt()).appDataDir();
  }

  async cacheDir(): Promise<string> {
    return (await this.rt()).appCacheDir();
  }

  joinPath(...parts: string[]): string {
    // Synchronous callers need a synchronous join; Tauri's is async, so use the
    // platform separator directly. Windows is the shipping target.
    const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);
    return parts.filter(Boolean).join(isWindows ? '\\' : '/');
  }

  toDisplayUri(path: string): string {
    if (!this.runtime) return path;
    return this.runtime.convertFileSrc(path);
  }

  /* ---------------- media engine ---------------- */

  async probe(path: string): Promise<MediaProbe> {
    const rt = await this.rt();
    return rt.invoke<MediaProbe>('probe_media', { path });
  }

  async generateThumbnails(path: string, options: ThumbnailOptions): Promise<{ uri: string; times: number[] }> {
    const rt = await this.rt();
    const result = await rt.invoke<{ path: string; times: number[] }>('generate_thumbnails', { path, options });
    return { uri: this.toDisplayUri(result.path), times: result.times };
  }

  async generateWaveform(path: string, options?: WaveformOptions): Promise<WaveformData> {
    const rt = await this.rt();
    return rt.invoke<WaveformData>('generate_waveform', { path, options: options ?? null });
  }

  async encoderCapabilities(): Promise<EncoderCapabilities> {
    const rt = await this.rt();
    return rt.invoke<EncoderCapabilities>('get_encoder_capabilities');
  }

  async generateProxy(asset: MediaAsset, height: number, onProgress?: (fraction: number) => void): Promise<string> {
    const rt = await this.rt();
    if (onProgress) {
      await rt.listen('proxy-progress', (event) => onProgress((event.payload as { fraction: number }).fraction));
    }
    return rt.invoke<string>('generate_proxy', { assetId: asset.id, path: asset.originalPath, height });
  }

  async extractAudio(path: string, targetPath: string): Promise<void> {
    const rt = await this.rt();
    await rt.invoke('extract_audio', { path, targetPath });
  }

  /* ---------------- rendering ---------------- */

  async startExport(
    plan: RenderPlan,
    settings: ExportSettings,
    onProgress: (p: ExportProgress) => void,
  ): Promise<ExportRunResult> {
    const rt = await this.rt();
    this.progressHandler = onProgress;
    try {
      return await rt.invoke<ExportRunResult>('start_export', { plan, settings });
    } finally {
      this.progressHandler = null;
    }
  }

  cancelExport(): void {
    void this.rt().then((rt) => rt.invoke('cancel_export'));
  }

  async captureFrame(plan: RenderPlan, timeSec: number): Promise<string> {
    const rt = await this.rt();
    const path = await rt.invoke<string>('capture_frame', { plan, timeSec });
    return this.toDisplayUri(path);
  }

  /* ---------------- local AI ---------------- */

  async transcribe(path: string, language?: string, onProgress?: (fraction: number) => void): Promise<WhisperResult> {
    const rt = await this.rt();
    if (!this.capabilities.whisper) {
      throw new CapabilityError(
        'whisper',
        'No Whisper model is installed. Open Settings → AI Models to download one (about 150 MB, one time).',
      );
    }
    if (onProgress) {
      await rt.listen('transcribe-progress', (event) => onProgress((event.payload as { fraction: number }).fraction));
    }
    return rt.invoke<WhisperResult>('transcribe', { path, language: language ?? null });
  }

  async listLocalModels(): Promise<{ id: string; sizeBytes?: number; downloaded: boolean }[]> {
    const rt = await this.rt();
    return rt.invoke('list_ai_models');
  }

  async downloadModel(id: string, onProgress?: (fraction: number) => void): Promise<string> {
    const rt = await this.rt();
    if (onProgress) {
      await rt.listen('model-download-progress', (event) => onProgress((event.payload as { fraction: number }).fraction));
    }
    return rt.invoke<string>('download_ai_model', { id });
  }

  /* ---------------- misc ---------------- */

  isOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  log(level: LogLevel, scope: string, message: string, detail?: unknown): void {
    void this.rt()
      .then((rt) => rt.invoke('log_message', { level, scope, message, detail: detail === undefined ? null : String(detail) }))
      .catch(() => undefined);
  }

  onFileDropped(handler: (paths: string[]) => void): () => void {
    let unlisten: (() => void) | undefined;
    void this.rt()
      .then((rt) => rt.listen('files-dropped', (event) => handler(event.payload as string[])))
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }

  dispose(): void {
    this.exportUnlisten?.();
    this.exportUnlisten = null;
  }
}

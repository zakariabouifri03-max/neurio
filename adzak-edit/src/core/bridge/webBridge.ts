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
import { assetKindFromProbe, extensionOf } from '../types/media';
import type { WaveformData } from '../types/waveform';
import type { EncoderCapabilities, ExportProgress, ExportSettings } from '../types/export';
import type { RenderPlan } from '../export/plan';
import * as idb from './idb';
import { renderTimelineToMediaRecorder } from '../render/webExport';

/**
 * Browser implementation of the platform bridge.
 *
 * This is a real runtime, not a stub: probing uses HTMLMediaElement metadata,
 * thumbnails are drawn with canvas, waveforms come from WebAudio's
 * decodeAudioData, and export records the canvas + audio graph with
 * MediaRecorder into a WebM the user can download.
 *
 * What it genuinely cannot do is call FFmpeg. Every capability that needs it is
 * reported as unavailable so the UI disables the control and explains why,
 * rather than pretending.
 */

const VIRTUAL_PREFIX = 'web://';

interface WebFileEntry {
  file: File;
  uri: string;
  path: string;
}

class WebBridge implements PlatformBridge {
  readonly kind = 'web' as const;
  readonly capabilities: RuntimeCapabilities = {
    ffmpeg: false,
    ffprobe: false,
    hevc: false,
    hardwareEncoding: false,
    whisper: false,
    localLlm: false,
    segmentation: false,
    nativeDialogs: false,
    persistentStorage: true,
    fileExport: false,
  };

  private readonly files = new Map<string, WebFileEntry>();
  private recorder: { stop: () => void } | null = null;
  private audioContext: AudioContext | null = null;
  private readonly waveformCache = new Map<string, WaveformData>();

  /* ---------------- file system ---------------- */

  async pickFiles(filters: FileFilter[]): Promise<string[]> {
    const accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    const picked = await openNativePicker(accept, false);
    return picked.map((file) => this.register(file));
  }

  /** Register a File (from a picker or a drag-and-drop) as a virtual path. */
  register(file: File, explicitPath?: string): string {
    const path = explicitPath ?? `${VIRTUAL_PREFIX}${file.name}`;
    const existing = this.files.get(path);
    if (existing) URL.revokeObjectURL(existing.uri);
    const uri = URL.createObjectURL(file);
    this.files.set(path, { file, uri, path });
    return path;
  }

  fileFor(path: string): File | undefined {
    return this.files.get(path)?.file;
  }

  async pickSavePath(defaultName: string, _filters: FileFilter[]): Promise<string | null> {
    // Browsers cannot choose a destination path; downloads go to the user's
    // Downloads folder. The export service handles that instead.
    return defaultName;
  }

  async pickDirectory(): Promise<string | null> {
    throw new CapabilityError('nativeDialogs', 'Folder selection needs the desktop app.');
  }

  async stat(path: string): Promise<FileStat> {
    const entry = this.files.get(path);
    if (!entry) return { exists: false, sizeBytes: 0, modifiedAt: 0, isDirectory: false };
    return { exists: true, sizeBytes: entry.file.size, modifiedAt: entry.file.lastModified, isDirectory: false };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readTextFile(path: string): Promise<string> {
    if (path.startsWith('idb:')) {
      const record = await idb.loadProject(path.slice(4));
      if (!record) throw new Error('That project is no longer in this browser.');
      return record.content;
    }
    const entry = this.files.get(path);
    if (!entry) throw new Error(`"${path}" is not available in this browser session.`);
    return entry.file.text();
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    if (path.startsWith('idb:')) {
      const id = path.slice(4);
      const previous = await idb.loadProject(id);
      const name = previous?.name ?? id;
      await idb.saveProject({ id, name, path, content, updatedAt: Date.now() });
      return;
    }
    // A plain web:// path is a read-only uploaded file; persist to IndexedDB.
    await idb.saveProject({ id: path, name: path, path, content, updatedAt: Date.now() });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`"${path}" is not available in this browser session.`);
    return new Uint8Array(await entry.file.arrayBuffer());
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    await idb.putBlob(path, new Blob([data as unknown as BlobPart]));
  }

  async removeFile(path: string): Promise<void> {
    const entry = this.files.get(path);
    if (entry) URL.revokeObjectURL(entry.uri);
    this.files.delete(path);
  }

  async appDataDir(): Promise<string> {
    return 'idb://appdata';
  }

  async cacheDir(): Promise<string> {
    return 'idb://cache';
  }

  joinPath(...parts: string[]): string {
    return parts.filter(Boolean).join('/');
  }

  toDisplayUri(path: string): string {
    return this.files.get(path)?.uri ?? path;
  }

  /* ---------------- media engine ---------------- */

  async probe(path: string): Promise<MediaProbe> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`"${path}" is not available in this browser session.`);
    const kind = guessKind(entry.file.name, entry.file.type);

    const base: MediaProbe = {
      durationSec: 0,
      format: extensionOf(entry.file.name) || entry.file.type,
      bitrateBps: 0,
      sizeBytes: entry.file.size,
      hasVideo: kind === 'video',
      hasAudio: kind === 'audio' || kind === 'video',
      width: 0,
      height: 0,
      fps: kind === 'video' ? 30 : 0,
      rotation: 0,
      videoCodec: kind === 'video' ? 'browser-decoded' : '',
      pixelFormat: '',
      audioCodec: kind === 'audio' ? 'browser-decoded' : '',
      sampleRate: 0,
      channels: 0,
      isProxy: false,
    };

    if (kind === 'image') {
      const size = await imageSize(entry.uri);
      return { ...base, hasVideo: false, hasAudio: false, width: size.width, height: size.height, durationSec: 0 };
    }

    const media = await loadMetadata(entry.uri, kind === 'audio' ? 'audio' : 'video');
    const video = media as HTMLVideoElement;
    return {
      ...base,
      durationSec: Number.isFinite(video.duration) ? video.duration : 0,
      width: kind === 'video' ? video.videoWidth : 0,
      height: kind === 'video' ? video.videoHeight : 0,
      hasAudio: kind === 'audio' || kind === 'video',
    };
  }

  async generateThumbnails(path: string, options: ThumbnailOptions): Promise<{ uri: string; times: number[] }> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`"${path}" is not available in this browser session.`);
    const count = Math.max(1, options.count);
    const times: number[] = [];

    if (guessKind(entry.file.name, entry.file.type) === 'image') {
      const img = await loadImage(entry.uri);
      const canvas = document.createElement('canvas');
      canvas.width = options.width;
      canvas.height = options.height;
      const ctx = canvas.getContext('2d')!;
      drawCover(ctx, img, options.width, options.height);
      return { uri: canvas.toDataURL('image/jpeg', 0.72), times: [0] };
    }

    const video = (await loadMetadata(entry.uri, 'video')) as HTMLVideoElement;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext('2d')!;
    const dataUrls: string[] = [];

    for (let i = 0; i < count; i++) {
      const time = Math.min(duration - 0.05, (duration / count) * (i + 0.5));
      await seek(video, Math.max(0, time));
      drawCover(ctx, video, options.width, options.height);
      dataUrls.push(canvas.toDataURL('image/jpeg', 0.7));
      times.push(time);
    }
    // One contact sheet would need an atlas; tiles are simpler and the timeline
    // only ever draws the handful that are on screen.
    return { uri: dataUrls[0]!, times };
  }

  async generateWaveform(path: string, options?: WaveformOptions): Promise<WaveformData> {
    const cached = this.waveformCache.get(path);
    if (cached) return cached;
    const entry = this.files.get(path);
    if (!entry) throw new Error(`"${path}" is not available in this browser session.`);

    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) throw new Error('This browser cannot decode audio for waveform display.');
    this.audioContext ??= new AudioCtor();
    const buffer = await this.audioContext.decodeAudioData(await entry.file.arrayBuffer());

    const buckets = Math.max(64, options?.buckets ?? 1600);
    const channels = buffer.numberOfChannels;
    const secondsPerPeak = buffer.duration / buckets;
    const blockSize = Math.max(1, Math.floor(buffer.length / buckets));
    const peaks: number[] = [];
    const troughs: number[] = [];

    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let b = 0; b < buckets; b++) {
        let max = 0;
        let min = 0;
        const start = b * blockSize;
        const end = Math.min(data.length, start + blockSize);
        for (let i = start; i < end; i++) {
          const v = data[i]!;
          if (v > max) max = v;
          if (v < min) min = v;
        }
        peaks.push(max);
        troughs.push(min);
      }
    }

    let sumSquares = 0;
    let peakMax = 0;
    for (let i = 0; i < peaks.length; i++) {
      const level = Math.max(peaks[i]!, Math.abs(troughs[i]!));
      sumSquares += level * level;
      peakMax = Math.max(peakMax, level);
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, peaks.length));

    const waveform: WaveformData = {
      peaks,
      troughs,
      channels,
      secondsPerPeak,
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      rmsDb: rms > 0 ? 20 * Math.log10(rms) : -120,
      peakDb: peakMax > 0 ? 20 * Math.log10(peakMax) : -120,
      generatedAt: Date.now(),
    };
    this.waveformCache.set(path, waveform);
    return waveform;
  }

  async encoderCapabilities(): Promise<EncoderCapabilities> {
    const codecs = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
    ];
    const supported = typeof MediaRecorder !== 'undefined' ? codecs.filter((c) => MediaRecorder.isTypeSupported(c)) : [];
    return {
      ffmpegVersion: 'not installed (browser build)',
      ffprobeAvailable: false,
      videoCodecs: supported.some((c) => c.includes('mp4')) ? ['h264'] : [],
      audioCodecs: supported.length ? ['opus'] : [],
      hardwareEncoders: [],
      filters: [],
      gpu: 'none',
    };
  }

  async generateProxy(_asset: MediaAsset, _height: number): Promise<string> {
    throw new CapabilityError('ffmpeg', 'Proxy generation needs the desktop app, which bundles FFmpeg.');
  }

  async extractAudio(_path: string, _target: string): Promise<void> {
    throw new CapabilityError('ffmpeg', 'Audio extraction needs the desktop app, which bundles FFmpeg.');
  }

  /* ---------------- rendering ---------------- */

  async startExport(
    plan: RenderPlan,
    settings: ExportSettings,
    onProgress: (p: ExportProgress) => void,
  ): Promise<ExportRunResult> {
    if (typeof MediaRecorder === 'undefined') {
      return {
        ok: false,
        outputPath: settings.outputPath,
        warnings: plan.warnings,
        error: 'This browser cannot record video. Install the desktop app to export MP4 files.',
      };
    }
    try {
      const result = await renderTimelineToMediaRecorder(plan, settings, onProgress, (controller) => {
        this.recorder = controller;
      });
      return { ...result, warnings: plan.warnings };
    } catch (error) {
      return {
        ok: false,
        outputPath: settings.outputPath,
        warnings: plan.warnings,
        error: (error as Error).message,
      };
    } finally {
      this.recorder = null;
    }
  }

  cancelExport(): void {
    this.recorder?.stop();
    this.recorder = null;
  }

  async captureFrame(_plan: RenderPlan, _timeSec: number): Promise<string> {
    throw new CapabilityError('ffmpeg', 'Frame capture needs the desktop renderer.');
  }

  /* ---------------- local AI ---------------- */

  async transcribe(_path: string, _language?: string): Promise<WhisperResult> {
    throw new CapabilityError(
      'whisper',
      'Speech recognition runs a local Whisper model and needs the desktop app. Install it, then open Settings → AI Models to download a model once.',
    );
  }

  async listLocalModels(): Promise<{ id: string; sizeBytes?: number; downloaded: boolean }[]> {
    return [];
  }

  async downloadModel(): Promise<string> {
    throw new CapabilityError('whisper', 'Model downloads are handled by the desktop app.');
  }

  /* ---------------- misc ---------------- */

  isOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  log(level: LogLevel, scope: string, message: string, detail?: unknown): void {
    const prefix = `[${scope}]`;
    if (level === 'error') console.error(prefix, message, detail ?? '');
    else if (level === 'warn') console.warn(prefix, message, detail ?? '');
    else if (level === 'debug') console.debug(prefix, message, detail ?? '');
    else console.info(prefix, message, detail ?? '');
  }

  onFileDropped(handler: (paths: string[]) => void): () => void {
    const listener = (event: DragEvent) => {
      const dropped = event.dataTransfer?.files;
      if (!dropped?.length) return;
      event.preventDefault();
      const paths: string[] = [];
      for (let i = 0; i < dropped.length; i++) {
        const file = dropped.item(i);
        if (file) paths.push(this.register(file));
      }
      handler(paths);
    };
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('drop', listener);
    window.addEventListener('dragover', prevent);
    return () => {
      window.removeEventListener('drop', listener);
      window.removeEventListener('dragover', prevent);
    };
  }
}

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

function openNativePicker(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      document.body.removeChild(input);
      resolve(files);
    });
    // Some browsers never fire `change` when the user cancels; clean up on blur.
    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
      resolve([]);
    });
    input.click();
    setTimeout(() => {
      if (document.body.contains(input)) {
        document.body.removeChild(input);
        reject(new Error('The file picker was closed before a file was chosen.'));
      }
    }, 600_000);
  });
}

function guessKind(name: string, mime: string): 'video' | 'audio' | 'image' {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  const ext = extensionOf(name);
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ogv', 'ts'].includes(ext)) return 'video';
  if (['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
  return 'image';
}

function loadMetadata(uri: string, kind: 'video' | 'audio'): Promise<HTMLVideoElement | HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.src = uri;
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error('This browser cannot play that file. The codec may not be supported.'));
  });
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be decoded.'));
    img.src = uri;
  });
}

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return loadImage(uri).then((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    try {
      video.currentTime = time;
    } catch {
      resolve();
    }
    // Some browsers never fire `seeked` on a stalled stream.
    setTimeout(() => {
      video.removeEventListener('seeked', done);
      resolve();
    }, 4000);
  });
}

function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number): void {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLImageElement).naturalWidth;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLImageElement).naturalHeight;
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

export { assetKindFromProbe };
export const webBridge = new WebBridge();
export type { WebBridge };

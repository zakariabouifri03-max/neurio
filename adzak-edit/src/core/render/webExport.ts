import type { ExportProgress, ExportSettings } from '../types/export';
import type { RenderPlan } from '../export/plan';

/**
 * Browser export backend.
 *
 * The desktop app exports with FFmpeg through `TauriBridge.startExport`. In a
 * browser there is no FFmpeg, so instead of failing we render the same timeline
 * through the canvas compositor and record it with MediaRecorder, producing a
 * real, playable WebM (H.264/MP4 where the browser supports it).
 *
 * It is a genuine export — not a preview — but it is realtime: a 60-second
 * timeline takes 60 seconds. The export dialog says so.
 */

export interface MediaRecorderController {
  stop: () => void;
}

export interface WebExportResult {
  ok: boolean;
  outputPath: string;
  sizeBytes?: number;
  error?: string;
  cancelled?: boolean;
}

/**
 * The compositor is injected rather than constructed here, because the preview
 * player already owns the media elements and re-decoding every clip would be
 * slow and memory-hungry.
 */
export interface WebExportDeps {
  /** Draw timeline second `t` into the canvas, at real time. */
  drawFrame: (ctx: CanvasRenderingContext2D, timeSec: number) => Promise<void>;
  /** Start audio playback for the range and return the mixable nodes. */
  prepareAudio: () => Promise<AudioNode[]>;
  stopAudio: () => void;
  /** Total timeline duration in seconds. */
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export interface WebExportHandle {
  promise: Promise<WebExportResult>;
  cancel: () => void;
}

let activeDeps: WebExportDeps | null = null;

/** Wire the preview player's compositor into the exporter. */
export function setWebExportDeps(deps: WebExportDeps | null): void {
  activeDeps = deps;
}

export function pickMimeType(settings: ExportSettings): { mime: string; extension: string } {
  const candidates: { mime: string; extension: string }[] =
    settings.container === 'mp4'
      ? [
          { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
          { mime: 'video/webm;codecs=vp9,opus', extension: 'webm' },
          { mime: 'video/webm;codecs=vp8,opus', extension: 'webm' },
          { mime: 'video/webm', extension: 'webm' },
        ]
      : [
          { mime: 'video/webm;codecs=vp9,opus', extension: 'webm' },
          { mime: 'video/webm;codecs=vp8,opus', extension: 'webm' },
          { mime: 'video/webm', extension: 'webm' },
          { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
        ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
  }
  return { mime: '', extension: settings.container === 'mp4' ? 'mp4' : 'webm' };
}

export async function renderTimelineToMediaRecorder(
  plan: RenderPlan,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  onController: (c: MediaRecorderController) => void,
): Promise<WebExportResult> {
  const deps = activeDeps;
  if (!deps) {
    return {
      ok: false,
      outputPath: settings.outputPath,
      error: 'The preview player is not ready, so the browser export cannot run. Load a clip first.',
    };
  }

  const { mime, extension } = pickMimeType(settings);
  if (!mime) {
    return {
      ok: false,
      outputPath: settings.outputPath,
      error: 'This browser cannot record video (MediaRecorder is unavailable or supports no usable codec).',
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = settings.width;
  canvas.height = settings.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return { ok: false, outputPath: settings.outputPath, error: 'Canvas 2D is unavailable in this browser.' };

  const stream = canvas.captureStream(settings.fps);
  const audioNodes = await deps.prepareAudio();
  if (audioNodes.length) {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtor();
    const destination = audioCtx.createMediaStreamDestination();
    for (const node of audioNodes) node.connect(destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
  }

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.max(500_000, settings.videoBitrateKbps * 1000 || 4_000_000),
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  let cancelled = false;
  onController({
    stop: () => {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
    },
  });

  const finished = new Promise<WebExportResult>((resolve) => {
    recorder.onstop = () => {
      deps.stopAudio();
      const blob = new Blob(chunks, { type: mime });
      const filename = replaceExtension(settings.outputPath || `export.${extension}`, extension);
      if (!cancelled && blob.size > 0) {
        triggerDownload(blob, filename);
        resolve({ ok: true, outputPath: filename, sizeBytes: blob.size });
      } else if (cancelled) {
        resolve({ ok: false, outputPath: filename, cancelled: true, error: 'The export was cancelled.' });
      } else {
        resolve({ ok: false, outputPath: filename, error: 'The recording produced no data.' });
      }
    };
    recorder.onerror = () => {
      deps.stopAudio();
      resolve({ ok: false, outputPath: settings.outputPath, error: 'The browser recorder failed mid-export.' });
    };
  });

  const totalDuration = Math.max(0.1, deps.durationSec || plan.durationSec);
  const startedAt = performance.now();
  recorder.start(500);

  // Realtime render loop: the compositor is driven by wall-clock time so the
  // media elements stay in sync with the recorded stream.
  await new Promise<void>((resolve) => {
    const tick = async () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const fraction = Math.min(1, elapsed / totalDuration);
      onProgress({
        jobId: 'web',
        stage: 'encoding',
        fraction,
        processedSec: elapsed,
        totalSec: totalDuration,
        speedFps: settings.fps,
        etaSec: Math.max(0, totalDuration - elapsed),
        message: `Recording in real time — ${Math.round(fraction * 100)}%`,
      });
      await deps.drawFrame(ctx, Math.min(totalDuration - 0.001, elapsed));
      if (elapsed >= totalDuration || cancelled) {
        resolve();
        return;
      }
      requestAnimationFrame(() => void tick());
    };
    void tick();
  });

  // Give the encoder a beat to flush the tail before stopping.
  await new Promise((r) => setTimeout(r, 320));
  if (recorder.state !== 'inactive') recorder.stop();
  return finished;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.split(/[\\/]/).pop() ?? filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function replaceExtension(path: string, extension: string): string {
  const dot = path.lastIndexOf('.');
  return dot > 0 ? `${path.slice(0, dot)}.${extension}` : `${path}.${extension}`;
}

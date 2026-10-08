import { useEffect, useMemo, useRef, useState } from 'react';
import { useExport } from '../store/exportStore';
import { useEditor } from '../store/editorStore';
import { Icons } from '../components/Icons';
import { EXPORT_PRESETS, getPreset } from '../../core/export/presets';
import { buildRenderPlan, planToArgs } from '../../core/export/plan';
import { renderTimelineToMediaRecorder, type MediaRecorderController } from '../../core/render/webExport';
import { burnInScriptFromSequence } from '../../core/subtitles/fromTimeline';
import { ENCODER_PRESETS } from '../../core/types/export';
import type { ExportProgress, ExportSettings } from '../../core/types/export';
import { getBridge, isTauri } from '../../core/bridge';
import { sequenceDuration } from '../../core/timeline/queries';
import { formatTimecode } from '../../core/types/time';
import { clsx } from 'clsx';

/**
 * Export dialog.
 *
 * Two honest paths:
 *  • desktop (Tauri + FFmpeg): builds a pure `RenderPlan`, hands the argument
 *    vector to the Rust executor, streams progress back.
 *  • browser: `MediaRecorder` capture of the preview canvas. This is realtime by
 *    construction, produces WebM/MP4 depending on browser support, and the dialog
 *    says so plainly instead of pretending to be an encoder.
 */

const PRESET_CATEGORY_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  short: 'Vertical / Shorts',
  social: 'Social',
  archive: 'Archive',
  custom: 'Custom',
};

export function ExportDialog() {
  const { dialogOpen, settings, progress, running, lastError, lastWarnings, lastOutputPath, cancelled } = useExport();
  const { closeDialog, selectPreset, patchSettings, start, reportProgress, finish } = useExport.getState();
  const project = useEditor((s) => s.project);
  const capabilities = useEditor((s) => s.capabilities);
  const controllerRef = useRef<MediaRecorderController | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const duration = useMemo(() => sequenceDuration(project.sequence), [project.sequence]);
  const subtitleCount = useMemo(
    () => project.sequence.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'subtitle').length,
    [project.sequence],
  );

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) closeDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, running, closeDialog]);

  useEffect(() => () => controllerRef.current?.stop(), []);

  // Rebuilding the plan on every keystroke of the bitrate field would be
  // wasteful, so it is derived once per (project, settings) pair. It is a hook,
  // so it must run on every render including the closed-dialog one.
  const argsPreview = useMemo(() => {
    const plan = buildRenderPlan(project, settings, {
      resolveAssetPath: (asset) => (asset.isMissing ? null : asset.originalPath),
      progress: false,
    });
    return planToArgs(plan);
  }, [project, settings]);

  if (!dialogOpen) return null;

  const desktop = isTauri();
  const ffmpeg = capabilities?.ffmpeg ?? false;
  const hasClips = project.sequence.tracks.some((t) => t.clips.length > 0);

  const runExport = async () => {
    start();
    const bridge = getBridge();
    const burnScript =
      settings.burnSubtitles && subtitleCount > 0 ? burnInScriptFromSequence(project.sequence, settings.width, settings.height) : null;

    let outputPath = settings.outputPath || 'export.mp4';
    const plan = buildRenderPlan(project, settings, {
      resolveAssetPath: (asset) => (asset.isMissing ? null : asset.originalPath),
      burnSubtitlePath: burnScript ? 'subtitles.ass' : undefined,
      hardwareEncoder: settings.hardwareEncoder,
      progress: true,
    });

    try {
      if (desktop || ffmpeg) {
        const result = await bridge.startExport(plan, settings, (p) => reportProgress(p));
        finish({
          ok: result.ok,
          error: result.error,
          warnings: result.warnings,
          outputPath: result.outputPath,
          cancelled: result.cancelled,
        });
        return;
      }

      // Browser path: the plan is not used for encoding, but building it keeps
      // the warning list (missing media, unsupported effects) honest either way.
      const result = await renderTimelineToMediaRecorder(plan, settings, (p) => reportProgress(p), (c) => {
        controllerRef.current = c;
      });
      outputPath = result.outputPath;
      finish({
        ok: result.ok,
        error: result.error,
        warnings: [...plan.warnings, ...(result.ok ? [] : [])],
        outputPath,
        cancelled: result.cancelled,
      });
    } catch (error) {
      finish({ ok: false, error: (error as Error).message, warnings: plan.warnings });
    } finally {
      controllerRef.current = null;
    }
  };

  const cancel = () => {
    if (desktop || ffmpeg) getBridge().cancelExport();
    controllerRef.current?.stop();
    finish({ ok: false, error: undefined, cancelled: true });
  };

  const grouped = EXPORT_PRESETS.reduce<Record<string, typeof EXPORT_PRESETS>>((acc, preset) => {
    (acc[preset.category] ??= []).push(preset);
    return acc;
  }, {});

  const estimatedMb = estimateSizeMb(settings, duration);

  return (
    <Modal onClose={running ? undefined : closeDialog} wide>
      <div className="panel-header">
        <Icons.Export size={15} />
        <span>Export</span>
        <span className="ml-auto normal-case tracking-normal text-ink-500">
          {formatTimecode(duration, project.sequence.fps)} · {settings.width}×{settings.height} @ {settings.fps}
        </span>
        {!running && (
          <button className="icon-btn w-7 h-7 ml-2" onClick={closeDialog}>
            <Icons.Close size={15} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-[240px_1fr] min-h-0 flex-1">
        {/* Presets */}
        <div className="border-r border-ink-800 scroll-area p-2 space-y-2">
          {Object.entries(grouped).map(([category, presets]) => (
            <div key={category}>
              <div className="px-1.5 py-1 text-[9px] uppercase tracking-wider text-ink-500">
                {PRESET_CATEGORY_LABEL[category] ?? category}
              </div>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className={clsx(
                    'w-full text-left rounded-md px-2 py-1.5 mb-0.5 border transition-colors',
                    settings.presetId === preset.id
                      ? 'border-brand-500/60 bg-brand-600/15'
                      : 'border-transparent hover:bg-ink-800',
                  )}
                  onClick={() => selectPreset(preset.id)}
                  disabled={running}
                  title={preset.description}
                >
                  <div className="text-[11px] text-ink-100">{preset.name}</div>
                  <div className="text-[9px] text-ink-500 mono">
                    {preset.settings.width}×{preset.settings.height} · {preset.settings.fps}fps ·{' '}
                    {preset.settings.videoCodec.toUpperCase()}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Settings */}
        <div className="scroll-area p-3 space-y-3">
          {!desktop && !ffmpeg && (
            <div className="rounded-md border border-accent-warm/40 bg-accent-warm/10 px-2.5 py-2 text-[11px] text-accent-warm/90 flex items-start gap-2">
              <Icons.Info size={13} className="mt-0.5 shrink-0" />
              <span>
                You are running the browser build, which has no FFmpeg. Export records the preview canvas in real time
                with <span className="mono">MediaRecorder</span> — a {Math.round(duration)}s timeline takes about{' '}
                {Math.round(duration)}s, and the codec is whatever this browser records. The desktop app encodes
                offline with full quality control.
              </span>
            </div>
          )}

          {!hasClips && (
            <div className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-2.5 py-2 text-[11px] text-accent-danger flex items-start gap-2">
              <Icons.Warning size={13} className="mt-0.5 shrink-0" />
              <span>The timeline is empty — there is nothing to export yet.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="field-label">Output file</span>
              <div className="flex gap-1">
                <input
                  className="field h-8 text-[11px]"
                  value={settings.outputPath}
                  onChange={(e) => patchSettings({ outputPath: e.target.value })}
                  disabled={running}
                />
                <button
                  className="btn h-8 px-2"
                  onClick={() => void chooseOutputPath()}
                  disabled={running}
                  title="Browse…"
                >
                  <Icons.Folder size={13} />
                </button>
              </div>
            </label>
            <label className="block">
              <span className="field-label">Container / codec</span>
              <select
                className="field h-8 text-[11px]"
                value={`${settings.container}:${settings.videoCodec}`}
                disabled={running}
                onChange={(e) => {
                  const [container, videoCodec] = e.target.value.split(':');
                  patchSettings({
                    container: container as ExportSettings['container'],
                    videoCodec: videoCodec as ExportSettings['videoCodec'],
                  });
                }}
              >
                <option value="mp4:h264">MP4 · H.264 (most compatible)</option>
                <option value="mp4:h265" disabled={!(capabilities?.hevc ?? false)}>
                  MP4 · H.265/HEVC{capabilities?.hevc ? '' : ' (unavailable)'}
                </option>
                <option value="webm:vp9">WebM · VP9</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="field-label">Width</span>
              <input
                type="number"
                className="field h-8 text-[11px]"
                value={settings.width}
                min={64}
                max={8192}
                step={2}
                disabled={running}
                onChange={(e) => patchSettings({ width: Number(e.target.value) })}
              />
            </label>
            <label className="block">
              <span className="field-label">Height</span>
              <input
                type="number"
                className="field h-8 text-[11px]"
                value={settings.height}
                min={64}
                max={8192}
                step={2}
                disabled={running}
                onChange={(e) => patchSettings({ height: Number(e.target.value) })}
              />
            </label>
            <label className="block">
              <span className="field-label">Frame rate</span>
              <select
                className="field h-8 text-[11px]"
                value={settings.fps}
                disabled={running}
                onChange={(e) => patchSettings({ fps: Number(e.target.value) })}
              >
                {[24, 25, 30, 48, 50, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={settings.burnSubtitles}
              disabled={running || subtitleCount === 0}
              onChange={(e) => patchSettings({ burnSubtitles: e.target.checked })}
            />
            Burn subtitles into the picture
            <span className="text-ink-500">
              ({subtitleCount} subtitle clip{subtitleCount === 1 ? '' : 's'} on the timeline)
            </span>
          </label>
          {settings.burnSubtitles && !desktop && !ffmpeg && (
            <p className="text-[10px] text-accent-warm">
              Burn-in needs FFmpeg&apos;s <span className="mono">subtitles</span> filter. In the browser build the
              subtitle clips are rendered by the preview canvas instead, so they are captured as-is.
            </p>
          )}

          <button
            className="btn h-7 w-full text-[11px]"
            onClick={() => setShowAdvanced((s) => !s)}
            disabled={running}
          >
            <Icons.Settings size={12} />
            {showAdvanced ? 'Hide' : 'Show'} advanced encoder settings
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-ink-800 bg-ink-850/60 p-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="field-label">Quality mode</span>
                  <select
                    className="field h-8 text-[11px]"
                    value={settings.videoBitrateKbps > 0 ? 'bitrate' : 'crf'}
                    disabled={running}
                    onChange={(e) =>
                      patchSettings({ videoBitrateKbps: e.target.value === 'bitrate' ? 8000 : 0 })
                    }
                  >
                    <option value="crf">Constant quality (CRF)</option>
                    <option value="bitrate">Target bitrate</option>
                  </select>
                </label>
                {settings.videoBitrateKbps > 0 ? (
                  <label className="block">
                    <span className="field-label">Video bitrate (kbps)</span>
                    <input
                      type="number"
                      className="field h-8 text-[11px]"
                      value={settings.videoBitrateKbps}
                      min={500}
                      step={500}
                      disabled={running}
                      onChange={(e) => patchSettings({ videoBitrateKbps: Number(e.target.value) })}
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="field-label">CRF ({settings.crf})</span>
                    <input
                      type="range"
                      min={15}
                      max={40}
                      value={settings.crf}
                      disabled={running}
                      className="w-full mt-2"
                      onChange={(e) => patchSettings({ crf: Number(e.target.value) })}
                    />
                  </label>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="field-label">Encoder speed</span>
                  <select
                    className="field h-8 text-[11px]"
                    value={settings.encoderPreset}
                    disabled={running}
                    onChange={(e) => patchSettings({ encoderPreset: e.target.value as ExportSettings['encoderPreset'] })}
                  >
                    {ENCODER_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Audio bitrate (kbps)</span>
                  <select
                    className="field h-8 text-[11px]"
                    value={settings.audioBitrateKbps}
                    disabled={running}
                    onChange={(e) => patchSettings({ audioBitrateKbps: Number(e.target.value) })}
                  >
                    {[96, 128, 160, 192, 256, 320].map((b) => (
                      <option key={b} value={b}>
                        {b} kbps
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-3 text-[11px] text-ink-300">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={settings.twoPass}
                    disabled={running || settings.videoBitrateKbps <= 0}
                    onChange={(e) => patchSettings({ twoPass: e.target.checked })}
                  />
                  Two-pass
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={settings.overwrite}
                    disabled={running}
                    onChange={(e) => patchSettings({ overwrite: e.target.checked })}
                  />
                  Overwrite existing file
                </label>
                {capabilities?.hardwareEncoding && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.hardwareEncoder)}
                      disabled={running}
                      onChange={(e) =>
                        patchSettings({ hardwareEncoder: e.target.checked ? 'h264_nvenc' : undefined })
                      }
                    />
                    Hardware encoder
                  </label>
                )}
              </div>
              <div className="text-[10px] text-ink-500">
                Estimated size: <span className="mono text-ink-300">~{estimatedMb} MB</span> for{' '}
                {formatTimecode(duration, settings.fps)}
              </div>
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="rounded-md border border-ink-700 bg-ink-850 p-2.5">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-ink-200">{stageLabel(progress)}</span>
                <span className="mono text-ink-400">
                  {(progress.fraction * 100).toFixed(0)}%
                  {progress.speedFps > 0 && ` · ${progress.speedFps.toFixed(1)} fps`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-[width] duration-200"
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
              <div className="mono text-[9px] text-ink-500 mt-1">
                {formatTimecode(progress.processedSec, settings.fps)} / {formatTimecode(progress.totalSec, settings.fps)}
                {progress.etaSec > 0 && ` · ${Math.round(progress.etaSec)}s remaining`}
              </div>
            </div>
          )}

          {/* Success */}
          {lastOutputPath && !running && (
            <div className="rounded-md border border-brand-500/40 bg-brand-600/10 px-2.5 py-2 text-[11px] text-brand-200">
              <div className="flex items-center gap-1.5 font-medium">
                <Icons.Check size={13} />
                Export finished
              </div>
              <p className="mono text-[10px] text-brand-300/80 mt-1 break-all">{lastOutputPath}</p>
              {lastWarnings.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[10px] text-accent-warm/90">
                  {lastWarnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Cancelled */}
          {cancelled && !lastError && !running && (
            <div className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-[11px] text-ink-300">
              Export cancelled. No partial file was kept.
            </div>
          )}

          {/* Error */}
          {lastError && !running && (
            <div className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-2.5 py-2 text-[11px] text-accent-danger/90">
              <div className="flex items-start gap-1.5">
                <Icons.Warning size={13} className="mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-accent-danger">Export failed</p>
                  <p className="mt-1 leading-relaxed">{lastError}</p>
                  <div className="flex gap-1.5 mt-2">
                    <button className="btn h-7 text-[11px]" onClick={() => void runExport()}>
                      <Icons.Refresh size={12} />
                      Retry
                    </button>
                    <button
                      className="btn h-7 text-[11px]"
                      onClick={() => {
                        setShowAdvanced(true);
                        const fallback = getPreset('youtube-1080');
                        if (fallback) selectPreset(fallback.id);
                      }}
                    >
                      Change settings
                    </button>
                    <button className="btn h-7 text-[11px]" onClick={() => setShowDetails((d) => !d)}>
                      {showDetails ? 'Hide' : 'View'} details
                    </button>
                  </div>
                  {showDetails && (
                    <pre className="mt-2 p-2 rounded bg-ink-950 border border-ink-800 text-[9px] text-ink-400 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                      {argsPreview.join(' ')}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-ink-800 px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] text-ink-500">
          {desktop || ffmpeg ? 'Encoded with FFmpeg on your machine' : 'Recorded in-browser'}
        </span>
        <div className="ml-auto flex gap-2">
          {running ? (
            <button className="btn h-8 px-3" onClick={cancel}>
              <Icons.Close size={13} />
              Cancel
            </button>
          ) : (
            <>
              <button className="btn h-8 px-3" onClick={closeDialog}>
                Close
              </button>
              <button className="btn-primary h-8 px-4" onClick={() => void runExport()} disabled={!hasClips}>
                <Icons.Export size={13} />
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );

  async function chooseOutputPath() {
    const bridge = getBridge();
    if (!bridge.capabilities.nativeDialogs) {
      useEditor.getState().toast({
        kind: 'info',
        title: 'Type the file name',
        message: 'This build has no save dialog — type the name in the field.',
      });
      return;
    }
    const picked = await bridge.pickSavePath(settings.outputPath || 'export.mp4', [
      { name: 'Video', extensions: [settings.container] },
    ]);
    if (picked) patchSettings({ outputPath: picked });
  }
}

function stageLabel(progress: ExportProgress): string {
  switch (progress.stage) {
    case 'preparing':
      return 'Preparing sources…';
    case 'encoding':
      return 'Encoding video…';
    case 'muxing':
      return 'Muxing audio…';
    case 'finalizing':
      return 'Finalizing…';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Working…';
  }
}

function estimateSizeMb(settings: ExportSettings, durationSec: number): number {
  const videoKbps = settings.videoBitrateKbps > 0 ? settings.videoBitrateKbps : bitrateFromCrf(settings);
  const totalKbps = videoKbps + settings.audioBitrateKbps;
  return Math.max(1, Math.round((totalKbps * durationSec) / 8 / 1024));
}

function bitrateFromCrf(settings: ExportSettings): number {
  // Rough x264 rule of thumb; only ever used to size the estimate.
  const pixelsPerFrame = settings.width * settings.height;
  const quality = Math.max(0.04, 0.22 - (settings.crf - 18) * 0.0085);
  return Math.round((pixelsPerFrame * settings.fps * quality) / 1000);
}

/* ------------------------------------------------------------------ */

export function Modal({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose?: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-[2px] flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className={clsx('panel flex flex-col max-h-full', wide ? 'w-[880px]' : 'w-[560px]')}>{children}</div>
    </div>
  );
}

import type { ProjectDocument } from '../types/project';
import type { Clip, Sequence, Track } from '../types/timeline';
import type { ExportSettings } from '../types/export';
import type { MediaAsset } from '../types/media';
import { buildEffectFilters, buildTransformFilters, overlayPosition, buildDrawtext, type FontResolver, type FilterBuildContext } from '../effects/filtergraph';
import { buildClipAudioChain } from '../audio/chain';
import { buildFilter, chain, evenDimension, escapeFilterPath } from '../../utils/ffmpegEscape';
import { endOf } from '../types/time';
import { sequenceDuration, isTrackAudible, isTrackRendered, videoTracks } from '../timeline/queries';

/**
 * Render plan builder.
 *
 * Turns a `ProjectDocument` + `ExportSettings` into a **complete, deterministic
 * FFmpeg argument list**. This function is pure: no I/O, no process spawning.
 * That is what makes the exporter testable (see tests/e2e/ffmpegExport.test.ts,
 * which runs the generated command against a real FFmpeg binary) and lets the
 * Rust backend stay a thin, dumb executor.
 */

export interface RenderInputSpec {
  /** FFmpeg input index, in the order the `-i` flags are emitted. */
  index: number;
  path: string;
  /** `-ss` before `-i`: fast, keyframe-accurate enough and avoids decoding the head. */
  seekSec?: number;
  /** `-t` before `-i`: caps the decode work to what the timeline needs. */
  durationSec?: number;
  /** Still images are looped for the clip duration. */
  loop?: boolean;
  framerate?: number;
  role: 'video' | 'audio' | 'image';
  clipId: string;
}

export interface RenderPlan {
  inputs: RenderInputSpec[];
  /** The full `-filter_complex` script. */
  filterComplex: string;
  /** Stream label mapped to the video output, e.g. "[vout]". */
  videoLabel: string | null;
  audioLabel: string | null;
  outputArgs: string[];
  warnings: string[];
  /** Files the executor must write before starting FFmpeg (e.g. ASS subtitles). */
  sidecars: RenderSidecar[];
  durationSec: number;
}

export interface RenderSidecar {
  /** Suggested file name inside the job's temp directory. */
  name: string;
  content: string;
}

export interface RenderPlanOptions {
  /** Resolve an asset to a readable path. Return null when the media is missing. */
  resolveAssetPath: (asset: MediaAsset) => string | null;
  /** Font family → absolute font file path. */
  resolveFont?: FontResolver;
  /** Filters the local FFmpeg reports; used to warn instead of hard-failing. */
  availableFilters?: Set<string>;
  /** Path to an ASS file to burn in (mutually exclusive with the subtitle track). */
  burnSubtitlePath?: string;
  /** Hardware encoder id, e.g. "h264_nvenc". */
  hardwareEncoder?: string;
  /** Include `-progress pipe:1` style flags. Off for the dry-run tests. */
  progress?: boolean;
}

const VIDEO_ENCODERS: Record<string, { software: string; args: (s: ExportSettings) => string[] }> = {
  h264: {
    software: 'libx264',
    args: (s) =>
      s.videoBitrateKbps > 0
        ? ['-b:v', `${s.videoBitrateKbps}k`, '-maxrate', `${Math.round(s.videoBitrateKbps * 1.3)}k`, '-bufsize', `${s.videoBitrateKbps * 2}k`]
        : ['-crf', String(s.crf)],
  },
  h265: {
    software: 'libx265',
    args: (s) =>
      s.videoBitrateKbps > 0
        ? ['-b:v', `${s.videoBitrateKbps}k`, '-tag:v', 'hvc1']
        : ['-crf', String(s.crf), '-tag:v', 'hvc1'],
  },
  vp9: {
    software: 'libvpx-vp9',
    args: (s) =>
      s.videoBitrateKbps > 0
        ? ['-b:v', `${s.videoBitrateKbps}k`]
        : ['-crf', String(s.crf), '-b:v', '0'],
  },
};

const AUDIO_ENCODERS: Record<string, string> = { aac: 'aac', opus: 'libopus', mp3: 'libmp3lame' };

export function buildRenderPlan(
  project: ProjectDocument,
  settings: ExportSettings,
  options: RenderPlanOptions,
): RenderPlan {
  const warnings: string[] = [];
  const sidecars: RenderSidecar[] = [];
  const seq = project.sequence;
  const width = evenDimension(settings.width);
  const height = evenDimension(settings.height);
  const fps = settings.fps > 0 ? settings.fps : seq.fps || 30;
  const duration = Math.max(1 / fps, sequenceDuration(seq));

  const inputs: RenderInputSpec[] = [];
  const filterLines: string[] = [];

  /**
   * Input registry. A clip contributes both a video and an audio stream, and
   * FFmpeg should only open the file once — so inputs are interned by their
   * (path, seek, duration, loop) key. This roughly halves the decode work on
   * any timeline with audio, which is all of them.
   */
  const inputKeys = new Map<string, number>();
  const getOrAddInput = (spec: Omit<RenderInputSpec, 'index'>): number => {
    const key = [spec.path, spec.seekSec ?? -1, spec.durationSec ?? -1, spec.loop ? 1 : 0].join('|');
    const existing = inputKeys.get(key);
    if (existing !== undefined) return existing;
    const index = inputs.length;
    inputs.push({ ...spec, index });
    inputKeys.set(key, index);
    return index;
  };

  const ctx: FilterBuildContext = {
    width,
    height,
    fps,
    timeSec: 0,
    availableFilters: options.availableFilters,
    warnings,
  };

  /* ---------------- background ---------------- */
  const bgLabel = 'bg0';
  filterLines.push(
    `color=c=${settings.container === 'webm' ? 'black' : hexToX11(project.settings.backgroundColor)}:s=${width}x${height}:r=${fps}:d=${duration.toFixed(4)}[${bgLabel}]`,
  );

  let acc = bgLabel;
  let overlayCount = 0;

  /* ---------------- video layers ---------------- */
  const vTracks = videoTracks(seq).filter((t) => isTrackRendered(t, seq.tracks));
  for (const track of vTracks) {
    const clips = [...track.clips].sort((a, b) => a.timeline.start - b.timeline.start);
    for (const clip of clips) {
      if (clip.timeline.duration <= 0) continue;
      const label = `v${overlayCount++}`;
      const built = buildVideoSegment(clip, project, settings, options, ctx, {
        width,
        height,
        fps,
        duration,
        label,
        filterLines,
        getOrAddInput,
      });
      if (!built) continue;

      const pos = overlayPosition(clip.transform, ctx);
      const outLabel = `ov${overlayCount}`;
      filterLines.push(
        `[${acc}][${label}]overlay=x=${pos.x}:y=${pos.y}:eof_action=pass:repeatlast=0` +
          `:enable='between(t,${clip.timeline.start.toFixed(4)},${endOf(clip.timeline).toFixed(4)})'[${outLabel}]`,
      );
      acc = outLabel;
    }
  }

  /* ---------------- burned subtitles ---------------- */
  if (settings.burnSubtitles && options.burnSubtitlePath) {
    const out = `sub${overlayCount++}`;
    filterLines.push(
      `[${acc}]subtitles=f='${escapeFilterPath(options.burnSubtitlePath)}':original_size=${width}x${height}[${out}]`,
    );
    acc = out;
  }

  /* ---------------- audio ---------------- */
  const audioLabels: string[] = [];
  for (const track of seq.tracks) {
    if (!isTrackAudible(track, seq.tracks)) continue;
    for (const clip of [...track.clips].sort((a, b) => a.timeline.start - b.timeline.start)) {
      if (clip.kind === 'text' || clip.kind === 'subtitle') continue;
      if (clip.audio.muted) continue;
      const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
      if (!asset) continue;
      if (!asset.probe?.hasAudio) continue;
      const path = options.resolveAssetPath(asset);
      if (!path) {
        warnings.push(`Audio for "${clip.name}" was skipped because the media file is missing.`);
        continue;
      }
      const index = getOrAddInput({
        path,
        role: 'audio',
        clipId: clip.id,
        seekSec: clip.source.in,
        durationSec: Math.max(0.04, clip.source.out - clip.source.in),
      });
      const filters = buildClipAudioChain(clip, {
        clipDurationSec: clip.timeline.duration,
        timelineStartSec: clip.timeline.start,
        channels: settings.width > 0 ? project.settings.channels : 2,
      });
      if (track.gain !== 1) {
        const db = 20 * Math.log10(Math.max(1e-6, track.gain));
        filters.push(`volume=${db.toFixed(3)}dB`);
      }
      filters.push(`aformat=sample_fmts=fltp:sample_rates=${project.settings.sampleRate}:channel_layouts=stereo`);
      const label = `a${audioLabels.length}`;
      filterLines.push(`[${index}:a]${filters.join(',')}[${label}]`);
      audioLabels.push(label);
    }
  }

  // NB: `apad` must be bounded. An unbounded apad emits audio forever, and
  // because FFmpeg stops on the *longest* stream the encode would never end.
  const padTail = `apad=whole_dur=${duration.toFixed(4)}`;
  let audioLabel: string | null = null;
  if (audioLabels.length === 1) {
    filterLines.push(
      `[${audioLabels[0]}]atrim=0:${duration.toFixed(4)},asetpts=PTS-STARTPTS,${padTail}[aout]`,
    );
    audioLabel = 'aout';
  } else if (audioLabels.length > 1) {
    filterLines.push(
      `${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[mixraw]`,
    );
    filterLines.push(
      `[mixraw]atrim=0:${duration.toFixed(4)},asetpts=PTS-STARTPTS,alimiter=limit=0.97,${padTail}[aout]`,
    );
    audioLabel = 'aout';
  }

  /* ---------------- output ---------------- */
  const videoLabel = `[${acc}]`;
  const encoder = settings.hardwareEncoder
    ? { software: settings.hardwareEncoder, args: (s: ExportSettings) => (s.videoBitrateKbps > 0 ? ['-b:v', `${s.videoBitrateKbps}k`] : ['-cq', String(s.crf)]) }
    : VIDEO_ENCODERS[settings.videoCodec] ?? VIDEO_ENCODERS['h264']!;

  const outputArgs: string[] = [
    '-map', videoLabel,
    ...(audioLabel ? ['-map', `[${audioLabel}]`] : []),
    '-c:v', encoder.software,
    ...encoder.args(settings),
    '-preset', settings.videoCodec === 'vp9' ? 'good' : settings.encoderPreset ?? 'medium',
    ...(settings.videoCodec === 'vp9' ? ['-row-mt', '1'] : []),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-g', String(Math.round(fps * 2)),
    // Hard stop: guarantees termination even if a filter graph misbehaves.
    '-t', duration.toFixed(4),
    ...(settings.twoPass ? ['-pass', '2'] : []),
  ];
  if (audioLabel) {
    outputArgs.push(
      '-c:a',
      AUDIO_ENCODERS[settings.audioCodec] ?? 'aac',
      '-b:a',
      `${settings.audioBitrateKbps}k`,
      '-ar',
      String(project.settings.sampleRate),
      '-ac',
      String(project.settings.channels),
    );
  } else {
    outputArgs.push('-an');
  }
  if (settings.container === 'mp4' || settings.container === 'mov') {
    outputArgs.push('-movflags', '+faststart');
  }
  if (options.progress) outputArgs.push('-progress', 'pipe:1', '-nostats');
  outputArgs.push('-y', settings.outputPath);

  if (!vTracks.length || overlayCount === 0) {
    warnings.push('The timeline contains no video clips — the export will be a solid colour background.');
  }
  if (!audioLabel) warnings.push('No audio will be present in the export.');

  return {
    inputs,
    filterComplex: filterLines.join(';\n'),
    videoLabel,
    audioLabel,
    outputArgs,
    warnings,
    sidecars,
    durationSec: duration,
  };
}

/* ------------------------------------------------------------------ *
 * Per-clip segment construction
 * ------------------------------------------------------------------ */

interface SegmentContext {
  width: number;
  height: number;
  fps: number;
  duration: number;
  label: string;
  filterLines: string[];
  getOrAddInput: (spec: Omit<RenderInputSpec, 'index'>) => number;
}

function buildVideoSegment(
  clip: Clip,
  project: ProjectDocument,
  _settings: ExportSettings,
  options: RenderPlanOptions,
  ctx: FilterBuildContext,
  sc: SegmentContext,
): boolean {
  const { width, height, fps, label } = sc;

  // --- Text and subtitle layers are synthesised, no input needed. ---
  if (clip.kind === 'text' || clip.kind === 'subtitle') {
    const drawtext = buildDrawtext(clip, ctx, options.resolveFont ?? (() => null));
    if (!drawtext) return false;
    const d = clip.timeline.duration.toFixed(4);
    sc.filterLines.push(
      `color=c=black@0:s=${width}x${height}:r=${fps}:d=${d}` +
        `,format=yuva420p,${drawtext},setpts=PTS-STARTPTS+${clip.timeline.start.toFixed(4)}/TB[${label}]`,
    );
    return true;
  }

  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  if (!asset) {
    ctx.warnings.push(`Clip "${clip.name}" was skipped: its media asset is not in this project.`);
    return false;
  }
  const path = options.resolveAssetPath(asset);
  if (!path) {
    ctx.warnings.push(`Clip "${clip.name}" was skipped: the file "${asset.originalPath}" could not be found. Relink it in the Media panel to include it.`);
    return false;
  }

  const probe = asset.probe;
  const isImage = asset.kind === 'image';
  const sourceSpan = Math.max(0.04, clip.source.out - clip.source.in);
  const index = sc.getOrAddInput({
    path,
    role: isImage ? 'image' : 'video',
    clipId: clip.id,
    ...(isImage
      ? { loop: true, framerate: fps, durationSec: clip.timeline.duration }
      : { seekSec: clip.source.in, durationSec: sourceSpan }),
  });

  const sourceW = probe?.width || width;
  const sourceH = probe?.height || height;

  const pre: string[] = [];
  // Reverse buffers the whole clip in RAM — warn for anything long.
  if (clip.reverse) {
    if (clip.timeline.duration > 10) {
      ctx.warnings.push(`"${clip.name}" is reversed and longer than 10 s; the encoder will use a lot of memory.`);
    }
    pre.push('reverse');
  }

  const transform = buildTransformFilters(clip.transform, ctx, sourceW, sourceH);
  const effects = buildEffectFilters(clip, ctx);

  // Rate change must happen before the timing filters.
  const speedFilters: string[] = [];
  if (Math.abs(clip.speed - 1) > 1e-4) {
    speedFilters.push(`setpts=PTS/${clip.speed.toFixed(6)}`);
  }

  const fades = buildFadeFilters(clip);

  const filters = chain(
    ...pre,
    ...speedFilters,
    ...transform.pre,
    ...transform.post,
    ...effects,
    ...fades,
    `fps=${fps}`,
    'format=yuv420p',
    `setpts=PTS-STARTPTS+${clip.timeline.start.toFixed(4)}/TB`,
  );

  sc.filterLines.push(`[${index}:v]${filters}[${label}]`);
  return true;
}

function buildFadeFilters(clip: Clip): string[] {
  const out: string[] = [];
  // Video fades come from the audio-style fade fields when present, otherwise
  // from dedicated transform opacity keyframes (handled by the effect chain).
  if (clip.audio.fadeInSec > 0 && clip.kind === 'media') {
    out.push(`fade=t=in:st=0:d=${clip.audio.fadeInSec.toFixed(3)}`);
  }
  if (clip.audio.fadeOutSec > 0 && clip.kind === 'media') {
    const start = Math.max(0, clip.timeline.duration - clip.audio.fadeOutSec);
    out.push(`fade=t=out:st=${start.toFixed(3)}:d=${clip.audio.fadeOutSec.toFixed(3)}`);
  }
  return out;
}

function hexToX11(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'black';
  return `0x${m[1]}`;
}

/** Flatten a plan into a spawnable argv, with `-i` flags interleaved. */
export function planToArgs(plan: RenderPlan): string[] {
  const args: string[] = ['-hide_banner', '-nostdin'];
  for (const input of plan.inputs) {
    if (input.loop) {
      args.push('-loop', '1', '-framerate', String(input.framerate ?? 30));
    }
    if (input.seekSec !== undefined && input.seekSec > 0) {
      args.push('-ss', input.seekSec.toFixed(4));
    }
    if (input.durationSec !== undefined && input.durationSec > 0) {
      args.push('-t', input.durationSec.toFixed(4));
    }
    args.push('-i', input.path);
  }
  if (plan.filterComplex) args.push('-filter_complex', plan.filterComplex);
  args.push(...plan.outputArgs);
  return args;
}

/** Tracks that actually contribute pixels — used by the preview renderer. */
export function renderedVideoTracks(seq: Sequence): Track[] {
  return videoTracks(seq).filter((t) => isTrackRendered(t, seq.tracks));
}

export { buildFilter };

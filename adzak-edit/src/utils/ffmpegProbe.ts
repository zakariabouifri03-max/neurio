import type { MediaProbe } from '../core/types/media';
import { normalizeFps } from './ffmpegEscape';

/**
 * Probe parsing.
 *
 * Two paths, because real deployments have both:
 *   1. `ffprobe -print_format json`  → structured, preferred.
 *   2. `ffmpeg -i <file>`           → the fallback. ffprobe is a separate
 *      binary and is frequently missing from bundled FFmpeg distributions
 *      (including the static builds many packagers ship). Everything the editor
 *      needs is present in FFmpeg's own banner output, so we parse that too
 *      instead of failing.
 */

export interface FfprobeJson {
  format?: { duration?: string; size?: string; bit_rate?: string; format_name?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    pix_fmt?: string;
    sample_rate?: string;
    channels?: number;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
    side_data_list?: { rotation?: number }[];
  }[];
}

export function parseFfprobeJson(json: FfprobeJson, sizeBytes = 0): MediaProbe {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !isAttachedPic(s));
  const audio = streams.find((s) => s.codec_type === 'audio');
  const format = json.format ?? {};

  const duration = Number.parseFloat(format.duration ?? video?.duration ?? audio?.duration ?? '0');
  const fps = pickFps(video?.r_frame_rate, video?.avg_frame_rate);
  const rotation = video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? video?.tags?.['rotate'] ? Number(video?.tags?.['rotate'] ?? 0) : 0;

  return {
    durationSec: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    format: format.format_name ?? '',
    bitrateBps: Number(format.bit_rate ?? video?.bit_rate ?? 0) || 0,
    sizeBytes: Number(format.size ?? sizeBytes) || sizeBytes,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps,
    rotation: normalizeRotation(rotation),
    videoCodec: video?.codec_name ?? '',
    pixelFormat: video?.pix_fmt ?? '',
    audioCodec: audio?.codec_name ?? '',
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : 0,
    channels: audio?.channels ?? 0,
    isProxy: false,
  };
}

function isAttachedPic(stream: { codec_type?: string; tags?: Record<string, string>; disposition?: Record<string, number> }): boolean {
  // Album art in MP3/M4A shows up as a "video" stream; it must not be treated as video.
  return stream.tags?.['comment'] === 'Cover (front)' || stream.tags?.['COMMENT'] === 'Cover (front)';
}

/** `r_frame_rate` can be "30000/1001"; `avg_frame_rate` is "0/0" for images. */
export function pickFps(rFrameRate?: string, avgFrameRate?: string): number {
  for (const raw of [rFrameRate, avgFrameRate]) {
    if (!raw) continue;
    const fps = parseRational(raw);
    if (Number.isFinite(fps) && fps > 0.5 && fps < 1000) return normalizeFps(fps);
  }
  return 0;
}

export function parseRational(value: string): number {
  if (!value) return Number.NaN;
  if (value.includes('/')) {
    const [num, den] = value.split('/').map(Number);
    if (!num || !den) return Number.NaN;
    return num! / den!;
  }
  return Number.parseFloat(value);
}

function normalizeRotation(rotation: number): number {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/* ------------------------------------------------------------------ *
 * `ffmpeg -i` fallback parser
 * ------------------------------------------------------------------ */

export function parseFfmpegStderr(stderr: string, sizeBytes = 0): MediaProbe {
  const probe: MediaProbe = {
    durationSec: 0,
    format: '',
    bitrateBps: 0,
    sizeBytes,
    hasVideo: false,
    hasAudio: false,
    width: 0,
    height: 0,
    fps: 0,
    rotation: 0,
    videoCodec: '',
    pixelFormat: '',
    audioCodec: '',
    sampleRate: 0,
    channels: 0,
    isProxy: false,
  };

  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (duration) {
    probe.durationSec = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  }
  const inputFormat = /Input #\d+,\s*([^,]+),/.exec(stderr);
  if (inputFormat) probe.format = inputFormat[1]!.trim();

  // Video stream: "Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 ... 29.97 fps"
  const video = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Video:\s*([^\s,]+)[^\n]*/.exec(stderr);
  if (video) {
    const line = video[0]!;
    probe.hasVideo = true;
    probe.videoCodec = video[1] ?? '';
    const dims = /,\s*(\d{2,5})x(\d{2,5})/.exec(line);
    if (dims) {
      probe.width = Number(dims[1]);
      probe.height = Number(dims[2]);
    }
    const pix = /,\s*(yuv\w+|rgb\w+|bgr\w+|nv12|p010\w*)/.exec(line);
    if (pix) probe.pixelFormat = pix[1]!;
    const fps = /(\d+(?:\.\d+)?)\s+fps/.exec(line);
    if (fps) probe.fps = normalizeFps(Number(fps[1]));
    const rotate = /rotate\s*:\s*(-?\d+)/.exec(stderr);
    if (rotate) probe.rotation = normalizeRotation(Number(rotate[1]));
    const bit = /(\d+)\s+kb\/s/.exec(line);
    if (bit) probe.bitrateBps = Number(bit[1]) * 1000;
  }

  // Audio stream: "Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s"
  const audio = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:\s*([^\s,]+)([^\n]*)/.exec(stderr);
  if (audio) {
    const tail = audio[2] ?? '';
    probe.hasAudio = true;
    probe.audioCodec = audio[1] ?? '';
    const rate = /,\s*(\d+)\s*Hz/.exec(tail);
    if (rate) probe.sampleRate = Number(rate[1]);
    const layout = /(mono|stereo|5\.1|7\.1|quad)/.exec(tail);
    if (layout) probe.channels = layout[1] === 'mono' ? 1 : layout[1] === 'stereo' ? 2 : layout[1] === '5.1' ? 6 : layout[1] === '7.1' ? 8 : 4;
    if (!probe.bitrateBps) {
      const bit = /(\d+)\s+kb\/s/.exec(tail);
      if (bit) probe.bitrateBps = Number(bit[1]) * 1000;
    }
  }

  return probe;
}

/**
 * Decide whether FFmpeg's "Invalid data" style failure is something the user can
 * act on. Returns a friendly message, or null when the output looked healthy.
 */
export function diagnoseProbeFailure(stderr: string, path: string): string {
  const lower = stderr.toLowerCase();
  if (lower.includes('no such file or directory')) {
    return `"${path}" could not be found. It may have been moved, renamed or deleted.`;
  }
  if (lower.includes('permission denied')) {
    return `The operating system will not let ADZAK EDIT read "${path}".`;
  }
  if (lower.includes('invalid data found when processing input')) {
    return `"${path}" is not a media file this build of FFmpeg can read. It may be corrupt, or use a codec that is not installed.`;
  }
  if (lower.includes('moov atom not found')) {
    return `"${path}" looks like an MP4 that was never finished recording, so its index is missing. Try re-muxing it with another tool.`;
  }
  if (lower.includes('decoder (codec') || lower.includes('unknown encoder')) {
    return `"${path}" uses a codec that is not available on this computer.`;
  }
  if (lower.includes('operation not permitted')) {
    return `The operating system blocked access to "${path}".`;
  }
  return `"${path}" could not be read. FFmpeg reported: ${stderr.trim().split('\n').pop() ?? 'unknown error'}`;
}

/** Extensions FFmpeg needs an explicit demuxer hint for. */
export function needsExplicitFormat(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'h264' || ext === '264') return 'h264';
  if (ext === 'hevc' || ext === '265') return 'hevc';
  if (ext === 'y4m') return 'yuv4mpegpipe';
  return null;
}

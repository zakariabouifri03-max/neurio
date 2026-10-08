export type VideoCodec = 'h264' | 'h265' | 'vp9';
export type AudioCodec = 'aac' | 'opus' | 'mp3';
export type Container = 'mp4' | 'mov' | 'webm' | 'mkv';

export type EncoderPreset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow';

export const ENCODER_PRESETS: { value: EncoderPreset; label: string }[] = [
  { value: 'ultrafast', label: 'Ultra fast (largest files)' },
  { value: 'superfast', label: 'Super fast' },
  { value: 'veryfast', label: 'Very fast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium (recommended)' },
  { value: 'slow', label: 'Slow' },
  { value: 'slower', label: 'Slower' },
  { value: 'veryslow', label: 'Very slow (smallest files)' },
];

export interface ExportSettings {
  presetId: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  container: Container;
  /** Target bitrate in kbps. 0 = use CRF/quality mode. */
  videoBitrateKbps: number;
  /** 0..51 for x264/x265, ignored when videoBitrateKbps > 0. */
  crf: number;
  audioBitrateKbps: number;
  /** Hardware encoder id when available, e.g. "h264_nvenc". */
  hardwareEncoder?: string;
  twoPass: boolean;
  /** x264/x265 speed-quality tradeoff. */
  encoderPreset: EncoderPreset;
  /** Burn subtitles into the picture instead of muxing a sidecar. */
  burnSubtitles: boolean;
  subtitleTrackIndex?: number;
  outputPath: string;
  /** Overwrite without asking. */
  overwrite: boolean;
}

export interface ExportPreset {
  id: string;
  name: string;
  category: 'youtube' | 'short' | 'social' | 'archive' | 'custom';
  description: string;
  settings: Omit<ExportSettings, 'outputPath' | 'overwrite' | 'burnSubtitles'>;
}

export type ExportStage =
  | 'idle'
  | 'preparing'
  | 'encoding'
  | 'muxing'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface ExportProgress {
  jobId: string;
  stage: ExportStage;
  /** 0..1 across the whole job. */
  fraction: number;
  /** Seconds of timeline encoded so far. */
  processedSec: number;
  totalSec: number;
  /** Frames per second of encode throughput. */
  speedFps: number;
  etaSec: number;
  message: string;
}

export interface ExportJob {
  id: string;
  projectId: string;
  settings: ExportSettings;
  createdAt: number;
  progress: ExportProgress;
  outputPath: string;
  outputSizeBytes?: number;
  error?: string;
}

/** What the encoder backend reports about the machine, cached in settings. */
export interface EncoderCapabilities {
  ffmpegVersion: string;
  ffprobeAvailable: boolean;
  videoCodecs: VideoCodec[];
  audioCodecs: AudioCodec[];
  hardwareEncoders: string[];
  /** Filters present, used to grey out unsupported effects. */
  filters: string[];
  /** "none" | "nvenc" | "qsv" | "videotoolbox" | "vaapi" */
  gpu: string;
}

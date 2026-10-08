import type { ExportPreset, ExportSettings } from '../types/export';

/**
 * Export presets.
 *
 * Bitrates follow the published platform recommendations (YouTube's per-frame
 * rate guidance) so "YouTube 4K" produces something a platform will not
 * re-crush. Everything here is user-overridable in the export dialog.
 */
export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'youtube-1080',
    name: 'YouTube 1080p',
    category: 'youtube',
    description: '1920×1080, 30 fps, H.264 High, 12 Mbps + AAC 256k',
    settings: {
      presetId: 'youtube-1080',
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 12000,
      crf: 20,
      audioBitrateKbps: 256,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'youtube-4k',
    name: 'YouTube 4K',
    category: 'youtube',
    description: '3840×2160, 30 fps, H.264, 45 Mbps + AAC 320k',
    settings: {
      presetId: 'youtube-4k',
      width: 3840,
      height: 2160,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 45000,
      crf: 18,
      audioBitrateKbps: 320,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'shorts-1080',
    name: 'Shorts 1080×1920',
    category: 'short',
    description: 'Vertical 9:16, 60 fps, 10 Mbps — YouTube Shorts',
    settings: {
      presetId: 'shorts-1080',
      width: 1080,
      height: 1920,
      fps: 60,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 10000,
      crf: 20,
      audioBitrateKbps: 192,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'tiktok-1080',
    name: 'TikTok 1080×1920',
    category: 'social',
    description: 'Vertical 9:16, 30 fps, 8 Mbps',
    settings: {
      presetId: 'tiktok-1080',
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 8000,
      crf: 21,
      audioBitrateKbps: 192,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'instagram-reel',
    name: 'Instagram Reel 1080×1920',
    category: 'social',
    description: 'Vertical 9:16, 30 fps, 8 Mbps + AAC 192k',
    settings: {
      presetId: 'instagram-reel',
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 8000,
      crf: 21,
      audioBitrateKbps: 192,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'instagram-square',
    name: 'Instagram Square 1080×1080',
    category: 'social',
    description: 'Square 1:1, 30 fps, 6 Mbps',
    settings: {
      presetId: 'instagram-square',
      width: 1080,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 6000,
      crf: 21,
      audioBitrateKbps: 192,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'web-vp9',
    name: 'WebM (VP9)',
    category: 'archive',
    description: '1920×1080, VP9 + Opus, quality mode (CRF 32)',
    settings: {
      presetId: 'web-vp9',
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'vp9',
      audioCodec: 'opus',
      container: 'webm',
      videoBitrateKbps: 0,
      crf: 32,
      audioBitrateKbps: 128,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'archive-prores-proxy',
    name: 'Archive / Master (H.265)',
    category: 'archive',
    description: '1920×1080, H.265 CRF 18 — high quality master copy',
    settings: {
      presetId: 'archive-prores-proxy',
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h265',
      audioCodec: 'aac',
      container: 'mov',
      videoBitrateKbps: 0,
      crf: 18,
      audioBitrateKbps: 320,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
  {
    id: 'custom',
    name: 'Custom',
    category: 'custom',
    description: 'Start from the sequence settings and adjust everything yourself',
    settings: {
      presetId: 'custom',
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      videoBitrateKbps: 0,
      crf: 20,
      audioBitrateKbps: 192,
      twoPass: false,
      encoderPreset: 'medium',
    },
  },
];

export function getPreset(id: string): ExportPreset | undefined {
  return EXPORT_PRESETS.find((p) => p.id === id);
}

export function presetToSettings(id: string, outputPath: string): ExportSettings {
  const preset = getPreset(id) ?? getPreset('custom')!;
  return {
    ...preset.settings,
    presetId: preset.id,
    outputPath,
    overwrite: false,
    burnSubtitles: false,
  };
}

export const VIDEO_CODEC_LABELS: Record<string, string> = {
  h264: 'H.264 / AVC (most compatible)',
  h265: 'H.265 / HEVC (smaller files)',
  vp9: 'VP9 (WebM)',
};

export const CONTAINER_EXTENSIONS: Record<string, string> = {
  mp4: '.mp4',
  mov: '.mov',
  webm: '.webm',
  mkv: '.mkv',
};

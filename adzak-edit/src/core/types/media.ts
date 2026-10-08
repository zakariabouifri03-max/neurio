import type { WaveformData } from './waveform';

/** High level category derived from the container + streams. */
export type MediaKind = 'video' | 'audio' | 'image' | 'gif' | 'unknown';

/** Where the bytes live. `file` = real path via the desktop bridge,
 *  `blob` = in-memory object URL (browser dev session), `proxy` = derived file. */
export type MediaLocation =
  | { kind: 'file'; path: string }
  | { kind: 'blob'; uri: string }
  | { kind: 'url'; url: string };

export type ProbeState = 'pending' | 'probing' | 'ready' | 'error';

/** Everything ffprobe (or the `ffmpeg -i` fallback) tells us about a file. */
export interface MediaProbe {
  durationSec: number;
  /** Container format long name, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  format: string;
  bitrateBps: number;
  sizeBytes: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  /** Display frame rate (after r_frame_rate/avg_frame_rate reconciliation). */
  fps: number;
  /** Rotation reported by the container in degrees (0/90/180/270). */
  rotation: number;
  videoCodec: string;
  pixelFormat: string;
  audioCodec: string;
  sampleRate: number;
  channels: number;
  /** True when this asset is itself a generated proxy of a larger original. */
  isProxy: boolean;
  /** Stream metadata that survives re-import, so missing media can be matched. */
  fingerprint?: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  /** Stable display name without extension. */
  kind: MediaKind;
  location: MediaLocation;
  /** Original absolute path, kept even after the file goes missing. */
  originalPath: string;
  sizeBytes: number;
  importedAt: number;
  /** Probe result; null until probing completes. */
  probe: MediaProbe | null;
  probeState: ProbeState;
  probeError?: string;
  /** Cached thumbnail strip (paths/URIs) keyed by width. */
  thumbnails?: ThumbnailStrip;
  waveform?: WaveformData | null;
  waveformState?: 'idle' | 'pending' | 'ready' | 'error';
  /** True when the file could not be found at load time. */
  isMissing: boolean;
  /** User assigned colour / favourite / folder for organisation. */
  labels?: string[];
  /** Path of the generated low-res proxy, when the proxy workflow is on. */
  proxyPath?: string;
}

export interface ThumbnailStrip {
  /** Absolute path (desktop) or object URL (web) of the sprite/contact sheet. */
  uri: string;
  /** Individual tile URIs when a contact sheet is not used. */
  tiles: string[];
  /** Source timestamps each tile was grabbed at. */
  times: number[];
  tileWidth: number;
  tileHeight: number;
  generatedAt: number;
}

export function assetKindFromProbe(probe: MediaProbe, name: string): MediaKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'gif') return 'gif';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'avif'].includes(ext)) return 'image';
  if (probe.hasVideo) return 'video';
  if (probe.hasAudio) return 'audio';
  return 'unknown';
}

/** Extensions the importer accepts. Deliberately permissive: unknown
 *  containers are still handed to the prober instead of being rejected. */
export const SUPPORTED_EXTENSIONS = {
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'mts', '3gp', 'wmv', 'flv', 'ogv'],
  audio: ['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'ac3'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'avif'],
} as const;

export const SUPPORTED_FILE_FILTER: string[] = [
  ...SUPPORTED_EXTENSIONS.video,
  ...SUPPORTED_EXTENSIONS.audio,
  ...SUPPORTED_EXTENSIONS.image,
];

export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

export function isSupportedPath(path: string): boolean {
  return SUPPORTED_FILE_FILTER.includes(extensionOf(path));
}

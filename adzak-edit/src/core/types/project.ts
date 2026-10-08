import type { MediaAsset } from './media';
import type { EditDecision, ProjectSettings, Sequence } from './timeline';
import type { SubtitleDocument } from './subtitles';

/**
 * `.adzak` project container.
 *
 * Media is referenced, never embedded. The file must stay small enough to be
 * written on every autosave tick and diffed by git.
 */
export const ADZAK_FORMAT_VERSION = 1;
export const ADZAK_MAGIC = 'ADZAKEDIT';
export const ADZAK_EXTENSION = '.adzak';

export interface ExportSettingsSnapshot {
  presetId: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: 'h264' | 'h265' | 'vp9';
  videoBitrateKbps: number;
  audioCodec: 'aac' | 'opus' | 'mp3';
  audioBitrateKbps: number;
  container: 'mp4' | 'mov' | 'webm' | 'mkv';
  twoPass: boolean;
  outputPath: string;
}

export interface ProjectDocument {
  magic: typeof ADZAK_MAGIC;
  version: number;
  /** App version that last wrote the file, for diagnostics. */
  appVersion: string;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  assets: MediaAsset[];
  sequence: Sequence;
  subtitles: SubtitleDocument[];
  /** Non-destructive decisions (silence removal, AI suggestions). */
  decisions: EditDecision[];
  exportSettings: ExportSettingsSnapshot | null;
  /** Free-form workspace state: panel sizes, zoom, playhead. Never affects render. */
  workspace: ProjectWorkspace;
  /** Bumped by migrations so old files can be detected. */
  migrationsApplied: string[];
}

export interface ProjectWorkspace {
  zoomPxPerSec: number;
  playheadSec: number;
  scrollX: number;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  activePanel: 'media' | 'audio' | 'text' | 'subtitles' | 'effects' | 'transitions' | 'ai' | 'export';
}

export const defaultWorkspace = (): ProjectWorkspace => ({
  zoomPxPerSec: 60,
  playheadSec: 0,
  scrollX: 0,
  selectedClipIds: [],
  selectedTrackId: null,
  activePanel: 'media',
});

/** A recent-project entry stored in SQLite, not in the project file. */
export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
  thumbnailPath?: string;
  /** True when the file exists but could not be parsed. */
  corrupt?: boolean;
}

/** Result of loading a project, so the UI can warn instead of failing. */
export interface ProjectLoadReport {
  document: ProjectDocument;
  missingAssets: MediaAsset[];
  upgradedFromVersion: number | null;
  warnings: string[];
}

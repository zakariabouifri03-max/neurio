import type { ProjectDocument, ProjectLoadReport } from '../types/project';
import { ADZAK_FORMAT_VERSION, ADZAK_MAGIC } from '../types/project';
import { APP_VERSION } from '../../version';
import type { Clip, Sequence, Track } from '../types/timeline';
import type { MediaAsset } from '../types/media';
import {
  defaultAudioSettings,
  defaultProjectSettings,
  defaultTransform,
  defaultTextStyle,
  defaultWorkspace,
} from './defaults';

/**
 * `.adzak` serialisation.
 *
 * The format is JSON with a magic header and an integer version so future
 * releases can migrate old files. Media is referenced by path — never embedded —
 * so a project stays a few tens of kilobytes regardless of footage size.
 */

export class ProjectFormatError extends Error {
  readonly code: 'not-adzak' | 'bad-json' | 'unsupported-version' | 'corrupt';
  constructor(code: ProjectFormatError['code'], message: string) {
    super(message);
    this.name = 'ProjectFormatError';
    this.code = code;
  }
}

export function serializeProject(doc: ProjectDocument, pretty = false): string {
  const stamped: ProjectDocument = { ...doc, updatedAt: Date.now(), appVersion: doc.appVersion || APP_VERSION };
  return JSON.stringify(stamped, null, pretty ? 2 : 0);
}

/**
 * Parse + validate + migrate. Never throws for recoverable problems: missing
 * media, unknown effects and unknown fields are reported as warnings so the
 * user can open the project and fix them.
 */
export function deserializeProject(raw: string): ProjectLoadReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ProjectFormatError('bad-json', `The project file is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProjectFormatError('not-adzak', 'The project file is empty or not an ADZAK project.');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['magic'] !== ADZAK_MAGIC) {
    throw new ProjectFormatError(
      'not-adzak',
      'This file is not an ADZAK EDIT project (.adzak). Check that you selected the right file.',
    );
  }
  const version = typeof obj['version'] === 'number' ? obj['version'] : 0;
  if (version > ADZAK_FORMAT_VERSION) {
    throw new ProjectFormatError(
      'unsupported-version',
      `This project was saved by a newer version of ADZAK EDIT (format v${version}; this build understands v${ADZAK_FORMAT_VERSION}). Update the application to open it.`,
    );
  }

  const warnings: string[] = [];
  let doc = repair(obj as Partial<ProjectDocument>, warnings);
  const upgradedFrom = version < ADZAK_FORMAT_VERSION ? version : null;
  if (upgradedFrom !== null) {
    doc = migrate(doc, upgradedFrom, warnings);
  }

  const missingAssets = doc.assets.filter((a) => a.isMissing);
  for (const asset of missingAssets) {
    warnings.push(`Media not found: ${asset.originalPath}`);
  }
  // Flag clips whose asset disappeared so the timeline can show them offline.
  const assetIds = new Set(doc.assets.map((a) => a.id));
  for (const track of doc.sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.assetId && !assetIds.has(clip.assetId)) {
        warnings.push(`Clip "${clip.name}" references media that is no longer in the project.`);
        clip.isOffline = true;
      }
    }
  }

  return { document: doc, missingAssets, upgradedFromVersion: upgradedFrom, warnings };
}

/* ------------------------------------------------------------------ *
 * Repair: fill in anything absent so a partially-written file still opens
 * ------------------------------------------------------------------ */

function repair(input: Partial<ProjectDocument>, warnings: string[]): ProjectDocument {
  const settings: ProjectDocument['settings'] = {
    ...defaultProjectSettings(),
    ...(input.settings ?? {}),
    proxy: { ...defaultProjectSettings().proxy, ...(input.settings?.proxy ?? {}) },
    preview: { ...defaultProjectSettings().preview, ...(input.settings?.preview ?? {}) },
  };
  const assets: MediaAsset[] = Array.isArray(input.assets) ? input.assets.map(repairAsset) : [];
  const sequence = repairSequence(input.sequence, settings, warnings);

  return {
    magic: ADZAK_MAGIC,
    version: ADZAK_FORMAT_VERSION,
    appVersion: input.appVersion ?? APP_VERSION,
    id: input.id ?? `prj_${Date.now().toString(36)}`,
    name: input.name ?? 'Untitled Project',
    createdAt: input.createdAt ?? Date.now(),
    updatedAt: input.updatedAt ?? Date.now(),
    settings,
    assets,
    sequence,
    subtitles: Array.isArray(input.subtitles) ? input.subtitles : [],
    decisions: Array.isArray(input.decisions) ? input.decisions : [],
    exportSettings: input.exportSettings ?? null,
    workspace: { ...defaultWorkspace(), ...(input.workspace ?? {}) },
    migrationsApplied: Array.isArray(input.migrationsApplied) ? input.migrationsApplied : [],
  };
}

function repairAsset(asset: MediaAsset): MediaAsset {
  return {
    ...asset,
    probeState: asset.probeState ?? (asset.probe ? 'ready' : 'pending'),
    isMissing: Boolean(asset.isMissing),
    location: asset.location ?? { kind: 'file', path: asset.originalPath },
  };
}

function repairSequence(
  input: Sequence | undefined,
  settings: ProjectDocument['settings'],
  warnings: string[],
): Sequence {
  if (!input || !Array.isArray(input.tracks)) {
    warnings.push('The project had no timeline; a fresh one was created.');
    return {
      fps: settings.fps,
      width: settings.width,
      height: settings.height,
      backgroundColor: settings.backgroundColor,
      tracks: [
        { id: 'trk_v0', kind: 'video', name: 'V1', z: 0, muted: false, solo: false, locked: false, hidden: false, heightPx: 84, expanded: true, clips: [], gain: 1 },
        { id: 'trk_a0', kind: 'audio', name: 'A1', z: 0, muted: false, solo: false, locked: false, hidden: false, heightPx: 56, expanded: true, clips: [], gain: 1 },
      ],
      markers: [],
    };
  }
  const tracks: Track[] = input.tracks.map((t) => ({
    ...t,
    clips: Array.isArray(t.clips) ? t.clips.map(repairClip) : [],
    gain: typeof t.gain === 'number' ? t.gain : 1,
    heightPx: t.heightPx || (t.kind === 'video' ? 84 : 56),
  }));
  if (!tracks.some((t) => t.kind === 'video')) {
    warnings.push('The project had no video track; one was added.');
    tracks.unshift({ id: 'trk_v0', kind: 'video', name: 'V1', z: 0, muted: false, solo: false, locked: false, hidden: false, heightPx: 84, expanded: true, clips: [], gain: 1 });
  }
  if (!tracks.some((t) => t.kind === 'audio')) {
    warnings.push('The project had no audio track; one was added.');
    tracks.push({ id: 'trk_a0', kind: 'audio', name: 'A1', z: 0, muted: false, solo: false, locked: false, hidden: false, heightPx: 56, expanded: true, clips: [], gain: 1 });
  }
  return {
    fps: input.fps || settings.fps,
    width: input.width || settings.width,
    height: input.height || settings.height,
    backgroundColor: input.backgroundColor ?? settings.backgroundColor,
    tracks,
    markers: Array.isArray(input.markers) ? input.markers : [],
  };
}

function repairClip(clip: Clip): Clip {
  const transform = { ...defaultTransform(), ...(clip.transform ?? {}) };
  transform.crop = { ...defaultTransform().crop, ...(clip.transform?.crop ?? {}) };
  const audio = { ...defaultAudioSettings(), ...(clip.audio ?? {}) };
  const timeline = clip.timeline ?? { start: 0, duration: 1 };
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const source = clip.source ?? { in: 0, out: timeline.duration * speed };
  return {
    ...clip,
    timeline: {
      start: Math.max(0, Number(timeline.start) || 0),
      duration: Math.max(1 / 240, Number(timeline.duration) || 1 / 30),
    },
    source: {
      in: Math.max(0, Number(source.in) || 0),
      out: Math.max(0, Number(source.out) || 0),
    },
    speed,
    reverse: Boolean(clip.reverse),
    transform,
    audio,
    effects: Array.isArray(clip.effects) ? clip.effects : [],
    keyframes: clip.keyframes ?? {},
    ...(clip.text ? { text: { ...defaultTextStyle(), ...clip.text } } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Migrations
 * ------------------------------------------------------------------ */

type Migration = { from: number; id: string; apply: (doc: ProjectDocument) => ProjectDocument };

/**
 * Ordered migrations. Each takes a document at version `from` and returns it at
 * `from + 1`. Add new entries here; never edit an existing one, because users
 * have files on disk that still need the original step.
 */
const MIGRATIONS: Migration[] = [
  // Example of the shape a future migration takes:
  // { from: 1, id: 'v2-int-timebase', apply: (doc) => ({ ...doc, version: 2 }) },
];

export function migrate(doc: ProjectDocument, fromVersion: number, warnings: string[]): ProjectDocument {
  let current = { ...doc, version: fromVersion };
  for (let v = fromVersion; v < ADZAK_FORMAT_VERSION; v++) {
    const step = MIGRATIONS.find((m) => m.from === v);
    if (!step) {
      warnings.push(`No migration path from format v${v}; the file was loaded with defaults applied.`);
      current = { ...current, version: v + 1 };
      continue;
    }
    current = { ...step.apply(current), version: v + 1, migrationsApplied: [...(current.migrationsApplied ?? []), step.id] };
    warnings.push(`Project upgraded from format v${v} to v${v + 1} (${step.id}).`);
  }
  return current;
}

/** Crash-recovery record written alongside the project. */
export interface AutosaveRecord {
  projectId: string;
  projectPath: string | null;
  savedAt: number;
  path: string;
  reason: 'autosave' | 'crash-recovery' | 'backup';
}

/** Atomic-write helper: callers must write `tmp` then rename. */
export function autosavePathFor(projectPath: string, projectId: string): string {
  const dir = projectPath.replace(/[\\/][^\\/]*$/, '') || '.';
  return `${dir}/.${projectId}.adzak.autosave`;
}

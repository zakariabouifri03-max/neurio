import { describe, it, expect } from 'vitest';
import { serializeProject, deserializeProject, ProjectFormatError } from '../../src/core/project/serialize';
import { createProject, createClip, createTextClip } from '../../src/core/timeline/factory';
import { ADZAK_FORMAT_VERSION, ADZAK_MAGIC } from '../../src/core/types/project';
import type { MediaAsset, MediaProbe } from '../../src/core/types/media';
import type { ProjectDocument } from '../../src/core/types/project';

function probe(duration: number): MediaProbe {
  return {
    durationSec: duration,
    format: 'mp4',
    bitrateBps: 1,
    sizeBytes: 1,
    hasVideo: true,
    hasAudio: true,
    width: 1920,
    height: 1080,
    fps: 30,
    rotation: 0,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    sampleRate: 48000,
    channels: 2,
    isProxy: false,
  };
}

function makeProject(): ProjectDocument {
  const project = createProject('Round Trip');
  const track = project.sequence.tracks[0]!;
  const asset: MediaAsset = {
    id: 'a1',
    name: 'interview.mp4',
    kind: 'video',
    location: { kind: 'file', path: 'C:\\Footage\\interview.mp4' },
    originalPath: 'C:\\Footage\\interview.mp4',
    sizeBytes: 1234,
    importedAt: 100,
    probe: probe(60),
    probeState: 'ready',
    isMissing: false,
  };
  project.assets = [asset];
  track.clips = [
    createClip({ name: 'interview', assetId: 'a1', trackId: track.id, start: 0, duration: 10, fps: 30 }),
    createTextClip(track.id, 10, 3, 'Lower third', 30),
  ];
  return project;
}

describe('project: save and load', () => {
  it('round-trips a project without losing clips', () => {
    const original = makeProject();
    const raw = serializeProject(original);
    const report = deserializeProject(raw);
    expect(report.document.name).toBe('Round Trip');
    expect(report.document.assets.length).toBe(1);
    expect(report.document.sequence.tracks[0]!.clips.length).toBe(2);
    expect(report.warnings).toEqual([]);
    expect(report.upgradedFromVersion).toBeNull();
  });

  it('keeps every field that affects the render', () => {
    const original = makeProject();
    original.sequence.tracks[0]!.clips[0]!.speed = 1.5;
    original.sequence.tracks[0]!.clips[0]!.reverse = true;
    original.sequence.tracks[0]!.clips[0]!.transform.opacity = 0.4;
    original.sequence.tracks[0]!.clips[0]!.audio.volume = 0.25;
    original.sequence.tracks[0]!.clips[0]!.effects = [
      { id: 'e1', effectId: 'color.basic', enabled: true, params: { brightness: 0.2, contrast: 1, saturation: 1, gamma: 1 } },
    ];
    original.sequence.tracks[0]!.clips[0]!.keyframes = {
      opacity: [{ id: 'k1', time: 0, value: 0, interpolation: 'linear' }],
    };

    const loaded = deserializeProject(serializeProject(original)).document;
    const clip = loaded.sequence.tracks[0]!.clips[0]!;
    expect(clip.speed).toBe(1.5);
    expect(clip.reverse).toBe(true);
    expect(clip.transform.opacity).toBe(0.4);
    expect(clip.audio.volume).toBe(0.25);
    expect(clip.effects[0]!.params['brightness']).toBe(0.2);
    expect(clip.keyframes['opacity']!.length).toBe(1);
  });

  it('stores media as a reference, not the bytes', () => {
    const raw = serializeProject(makeProject());
    expect(raw.length).toBeLessThan(8000);
    expect(raw).toContain('C:\\\\Footage\\\\interview.mp4');
  });

  it('writes the magic header and version', () => {
    const parsed = JSON.parse(serializeProject(makeProject())) as Record<string, unknown>;
    expect(parsed['magic']).toBe(ADZAK_MAGIC);
    expect(parsed['version']).toBe(ADZAK_FORMAT_VERSION);
  });

  it('rejects a file that is not an ADZAK project', () => {
    expect(() => deserializeProject('{"hello":"world"}')).toThrow(ProjectFormatError);
    try {
      deserializeProject('{"hello":"world"}');
    } catch (e) {
      expect((e as ProjectFormatError).code).toBe('not-adzak');
    }
  });

  it('rejects invalid JSON with a clear message', () => {
    try {
      deserializeProject('{not json at all');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ProjectFormatError).code).toBe('bad-json');
    }
  });

  it('rejects a project from a newer version', () => {
    const project = makeProject();
    const parsed = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    parsed['version'] = ADZAK_FORMAT_VERSION + 5;
    try {
      deserializeProject(JSON.stringify(parsed));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ProjectFormatError).code).toBe('unsupported-version');
      expect((e as Error).message).toContain('newer version');
    }
  });
});

describe('project: missing media', () => {
  it('opens a project whose footage has moved, and says which file is gone', () => {
    const project = makeProject();
    project.assets[0]!.isMissing = true;
    const report = deserializeProject(serializeProject(project));
    expect(report.missingAssets.length).toBe(1);
    expect(report.missingAssets[0]!.originalPath).toBe('C:\\Footage\\interview.mp4');
    expect(report.warnings.some((w) => w.includes('Media not found'))).toBe(true);
    // The project still opens.
    expect(report.document.sequence.tracks[0]!.clips.length).toBe(2);
  });

  it('flags clips whose asset vanished from the project', () => {
    const project = makeProject();
    project.assets = [];
    const report = deserializeProject(serializeProject(project));
    const clip = report.document.sequence.tracks[0]!.clips[0]!;
    expect(clip.isOffline).toBe(true);
    expect(report.warnings.some((w) => w.includes('no longer in the project'))).toBe(true);
  });
});

describe('project: repair of damaged files', () => {
  it('survives a project with no timeline', () => {
    const project = makeProject();
    delete (project as Partial<ProjectDocument>).sequence;
    const report = deserializeProject(JSON.stringify(project));
    expect(report.document.sequence.tracks.length).toBeGreaterThan(0);
    expect(report.warnings.some((w) => w.includes('fresh one was created'))).toBe(true);
  });

  it('survives a project with no assets array', () => {
    const project = makeProject();
    delete (project as Partial<ProjectDocument>).assets;
    const report = deserializeProject(JSON.stringify(project));
    expect(report.document.assets).toEqual([]);
  });

  it('fills in defaults for a clip missing its transform', () => {
    const project = makeProject();
    const raw = JSON.parse(serializeProject(project)) as {
      sequence: { tracks: { clips: Record<string, unknown>[] }[] };
    };
    delete raw.sequence.tracks[0]!.clips[0]!['transform'];
    delete raw.sequence.tracks[0]!.clips[0]!['audio'];
    const report = deserializeProject(JSON.stringify(raw));
    const clip = report.document.sequence.tracks[0]!.clips[0]!;
    expect(clip.transform.opacity).toBe(1);
    expect(clip.audio.volume).toBe(1);
    expect(clip.timeline.duration).toBeCloseTo(10);
  });

  it('clamps a nonsense clip duration instead of breaking the ruler', () => {
    const project = makeProject();
    const raw = JSON.parse(serializeProject(project)) as {
      sequence: { tracks: { clips: Record<string, unknown>[] }[] };
    };
    (raw.sequence.tracks[0]!.clips[0]!['timeline'] as Record<string, number>)['duration'] = -5;
    const report = deserializeProject(JSON.stringify(raw));
    expect(report.document.sequence.tracks[0]!.clips[0]!.timeline.duration).toBeGreaterThan(0);
  });

  it('adds a missing audio track so mixing still works', () => {
    const project = makeProject();
    project.sequence.tracks = project.sequence.tracks.filter((t) => t.kind === 'video');
    const report = deserializeProject(serializeProject(project));
    expect(report.document.sequence.tracks.some((t) => t.kind === 'audio')).toBe(true);
    expect(report.warnings.some((w) => w.includes('no audio track'))).toBe(true);
  });
});

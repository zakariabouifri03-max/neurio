/**
 * End-to-end render test.
 *
 * Builds a real `ProjectDocument` (two video clips — one at 2x speed with
 * effects, one reversed, plus a still image), compiles it through
 * `buildRenderPlan()` and then **actually runs FFmpeg** on the result.
 *
 * This is the test that proves the exporter is not a mock: if the filtergraph
 * is wrong, FFmpeg exits non-zero and this fails.
 *
 * Run with: npm run test:e2e
 * Requires ADZAK_FFMPEG to point at an ffmpeg binary (auto-detected otherwise).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProject } from '../../src/core/timeline/factory';
import { createClip } from '../../src/core/timeline/factory';
import { buildRenderPlan, planToArgs } from '../../src/core/export/plan';
import { presetToSettings } from '../../src/core/export/presets';
import type { MediaAsset, MediaProbe } from '../../src/core/types/media';

function findFfmpeg(): string | null {
  const candidates = [
    process.env['ADZAK_FFMPEG'],
    '/tmp/iff/x/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2',
    'ffmpeg',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (!c) continue;
    const probe = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (probe.status === 0) return c;
  }
  return null;
}

const FIXTURES = process.env['ADZAK_FIXTURES'] ?? '/tmp/adzak';

function probe(w: number, h: number, duration: number, hasAudio: boolean): MediaProbe {
  return {
    durationSec: duration,
    format: 'mov,mp4,m4a,3gp,3g2,mj2',
    bitrateBps: 8_000_000,
    sizeBytes: 1_000_000,
    hasVideo: true,
    hasAudio,
    width: w,
    height: h,
    fps: 30,
    rotation: 0,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: hasAudio ? 'aac' : '',
    sampleRate: hasAudio ? 48000 : 0,
    channels: hasAudio ? 2 : 0,
    isProxy: false,
  };
}

function asset(id: string, name: string, path: string, kind: MediaAsset['kind'], p: MediaProbe): MediaAsset {
  return {
    id,
    name,
    kind,
    location: { kind: 'file', path },
    originalPath: path,
    sizeBytes: p.sizeBytes,
    importedAt: Date.now(),
    probe: p,
    probeState: 'ready',
    isMissing: false,
  };
}

describe('FFmpeg export (real encoder)', () => {
  const ffmpeg = findFfmpeg();
  const fixturesPresent = existsSync(join(FIXTURES, 'A.mp4'));
  const run = Boolean(ffmpeg) && fixturesPresent;
  let workdir = '';

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'adzak-e2e-'));
  });

  it.skipIf(!run)('compiles a multi-clip timeline and encodes a valid MP4', () => {
    const project = createProject('E2E Export');
    project.settings.width = 1280;
    project.settings.height = 720;
    project.settings.fps = 30;
    const v1 = project.sequence.tracks[0]!;

    const a = asset('a1', 'A.mp4', join(FIXTURES, 'A.mp4'), 'video', probe(1280, 720, 6, true));
    const b = asset('b1', 'B.mp4', join(FIXTURES, 'B.mp4'), 'video', probe(1280, 720, 4, true));
    const c = asset('c1', 'C.png', join(FIXTURES, 'C.png'), 'image', probe(1280, 720, 0, false));
    project.assets = [a, b, c];

    // Clip 1: full 6 s source, played at 2x with a colour grade + vignette.
    const clip1 = createClip({ name: 'A', assetId: 'a1', trackId: v1.id, start: 0, duration: 3, fps: 30 });
    clip1.speed = 2;
    clip1.source = { in: 0, out: 6 };
    clip1.effects = [
      { id: 'e1', effectId: 'color.basic', enabled: true, params: { brightness: 0.05, contrast: 1.15, saturation: 1.2, gamma: 1 } },
      { id: 'e2', effectId: 'stylize.vignette', enabled: true, params: { amount: 0.4, mode: 'forward' } },
    ];
    clip1.audio.volume = 0.8;
    clip1.audio.fadeInSec = 0.2;

    // Clip 2: trimmed to 2 s and reversed.
    const clip2 = createClip({ name: 'B', assetId: 'b1', trackId: v1.id, start: 3, duration: 2, fps: 30 });
    clip2.source = { in: 0.5, out: 2.5 };
    clip2.reverse = true;
    clip2.audio.volume = 1;

    // Clip 3: a 2 s still.
    const clip3 = createClip({ name: 'C', assetId: 'c1', trackId: v1.id, start: 5, duration: 2, kind: 'media', fps: 30 });

    v1.clips = [clip1, clip2, clip3];

    const settings = presetToSettings('youtube-1080', join(workdir, 'out.mp4'));
    settings.width = 1280;
    settings.height = 720;
    settings.fps = 30;
    settings.videoBitrateKbps = 0;
    settings.crf = 28;
    settings.encoderPreset = 'ultrafast';

    const plan = buildRenderPlan(project, settings, {
      resolveAssetPath: (asset) => (asset.isMissing ? null : asset.originalPath),
    });

    expect(plan.inputs.length).toBe(3);
    expect(plan.videoLabel).toBeTruthy();
    expect(plan.audioLabel).toBeTruthy();
    expect(plan.durationSec).toBeCloseTo(7, 1);

    const args = planToArgs(plan);
    const result = spawnSync(ffmpeg!, args, { encoding: 'utf8', timeout: 180_000 });

    if (result.status !== 0) {
      // Surface FFmpeg's own diagnosis — that is the whole point of the test.
      throw new Error(`ffmpeg failed (${result.status}):\n${result.stderr?.slice(-3000)}`);
    }

    expect(existsSync(settings.outputPath)).toBe(true);
    const bytes = readFileSync(settings.outputPath).length;
    expect(bytes).toBeGreaterThan(20_000);
  }, 200_000);

  it.skipIf(!run)('reports a helpful warning for missing media instead of crashing', () => {
    const project = createProject('Missing media');
    const v1 = project.sequence.tracks[0]!;
    const missing = asset('m1', 'gone.mp4', '/nonexistent/gone.mp4', 'video', probe(1280, 720, 5, true));
    missing.isMissing = true;
    project.assets = [missing];
    v1.clips = [createClip({ name: 'gone', assetId: 'm1', trackId: v1.id, start: 0, duration: 5, fps: 30 })];

    const settings = presetToSettings('youtube-1080', join(workdir, 'missing.mp4'));
    const plan = buildRenderPlan(project, settings, { resolveAssetPath: () => null });

    expect(plan.warnings.some((w) => w.includes('could not be found'))).toBe(true);
    expect(plan.inputs.length).toBe(0);
  });

  it('generates a deterministic filtergraph for the same input', () => {
    const project = createProject('Determinism');
    const v1 = project.sequence.tracks[0]!;
    const a = asset('a1', 'A.mp4', join(FIXTURES, 'A.mp4'), 'video', probe(1280, 720, 6, true));
    project.assets = [a];
    v1.clips = [createClip({ name: 'A', assetId: 'a1', trackId: v1.id, start: 0, duration: 3, fps: 30 })];
    const settings = presetToSettings('custom', '/tmp/x.mp4');
    const mk = () =>
      buildRenderPlan(project, settings, { resolveAssetPath: (x) => x.originalPath }).filterComplex;
    expect(mk()).toBe(mk());
  });
});

export { findFfmpeg, FIXTURES };

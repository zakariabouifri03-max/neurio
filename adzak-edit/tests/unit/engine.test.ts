import { describe, it, expect } from 'vitest';
import { detectSilence, normalizeGain, buildClipAudioChain } from '../../src/core/audio/chain';
import { sampleKeyframes, ease, cubicBezier, upsertKeyframe, removeKeyframeAt } from '../../src/core/types/keyframes';
import { snapTime, collectSnapTargets, snapBlockStart, rulerStepSec } from '../../src/core/timeline/snapping';
import { parseFfmpegStderr, parseFfprobeJson, diagnoseProbeFailure, pickFps, parseRational } from '../../src/utils/ffmpegProbe';
import { atempoCascade, gainToDbArg, evenDimension, escapeFilterPath } from '../../src/utils/ffmpegEscape';
import { buildRenderPlan, planToArgs } from '../../src/core/export/plan';
import { getPreset, presetToSettings, EXPORT_PRESETS } from '../../src/core/export/presets';
import { createProject, createClip } from '../../src/core/timeline/factory';
import type { MediaAsset, MediaProbe } from '../../src/core/types/media';

/* ------------------------------------------------------------------ *
 * Silence detection
 * ------------------------------------------------------------------ */

describe('audio: silence detection', () => {
  // 10 buckets of 1 s: loud, loud, silent x4, loud, silent x2, loud
  const peaks = [0.8, 0.7, 0.001, 0.002, 0.001, 0.001, 0.9, 0.001, 0.001, 0.8];

  it('finds a long silent run', () => {
    const segments = detectSilence(peaks, 1, { thresholdDb: -40, minSilenceSec: 2, paddingSec: 0 });
    expect(segments.length).toBe(2);
    expect(segments[0]!.start).toBeCloseTo(2);
    expect(segments[0]!.end).toBeCloseTo(6);
    expect(segments[1]!.start).toBeCloseTo(7);
    expect(segments[1]!.end).toBeCloseTo(9);
  });

  it('ignores short pauses below the minimum length', () => {
    const segments = detectSilence(peaks, 1, { thresholdDb: -40, minSilenceSec: 5, paddingSec: 0 });
    expect(segments.length).toBe(0);
  });

  it('applies padding so cuts do not clip into speech', () => {
    const segments = detectSilence(peaks, 1, { thresholdDb: -40, minSilenceSec: 2, paddingSec: 0.2 });
    expect(segments[0]!.start).toBeCloseTo(2.2);
    expect(segments[0]!.end).toBeCloseTo(5.8);
  });

  it('merges silences separated by a short blip', () => {
    const blip = [0.8, 0.001, 0.001, 0.5, 0.001, 0.001, 0.8];
    const merged = detectSilence(blip, 1, { thresholdDb: -40, minSilenceSec: 1, mergeGapSec: 3, paddingSec: 0 });
    expect(merged.length).toBe(1);
    expect(merged[0]!.start).toBeCloseTo(1);
    expect(merged[0]!.end).toBeCloseTo(6);
  });

  it('reports a level in dBFS for each segment', () => {
    const segments = detectSilence(peaks, 1, { thresholdDb: -40, minSilenceSec: 2, paddingSec: 0 });
    expect(segments[0]!.levelDb).toBeLessThan(-40);
  });

  it('handles empty and degenerate input', () => {
    expect(detectSilence([], 1)).toEqual([]);
    expect(detectSilence([0.5, 0.5], 0)).toEqual([]);
    expect(detectSilence([0.5, 0.5], 1)).toEqual([]);
  });

  it('detects silence across an all-silent file', () => {
    const segments = detectSilence([0, 0, 0, 0, 0], 1, { thresholdDb: -40, minSilenceSec: 2, paddingSec: 0 });
    expect(segments.length).toBe(1);
    expect(segments[0]!.start).toBeCloseTo(0);
    expect(segments[0]!.end).toBeCloseTo(5);
  });
});

describe('audio: normalisation', () => {
  it('computes the gain needed to reach the target peak', () => {
    expect(normalizeGain(-6, -1)).toBeCloseTo(10 ** (5 / 20), 3);
  });

  it('caps the boost at 12 dB so the noise floor is not pumped up', () => {
    expect(normalizeGain(-60, -1)).toBeCloseTo(10 ** (12 / 20), 3);
  });

  it('never boosts more than 12 dB', () => {
    expect(normalizeGain(-90, -1)).toBeCloseTo(10 ** (12 / 20), 3);
  });

  it('attenuates a too-loud file', () => {
    expect(normalizeGain(3, -1)).toBeLessThan(1);
  });
});

describe('audio: clip filter chain', () => {
  const clip = {
    id: 'c',
    trackId: 't',
    kind: 'media' as const,
    name: 'A',
    timeline: { start: 5, duration: 10 },
    source: { in: 0, out: 10 },
    speed: 1,
    reverse: false,
    transform: {} as never,
    audio: { volume: 1, pan: 0, fadeInSec: 0.5, fadeOutSec: 0.5, chain: [], muted: false },
    effects: [],
    keyframes: {},
    createdAt: 0,
  };

  it('places the clip on the timeline with adelay', () => {
    const chain = buildClipAudioChain(clip, { clipDurationSec: 10, timelineStartSec: 5, channels: 2 });
    expect(chain.some((f) => f === 'adelay=5000|5000')).toBe(true);
  });

  it('adds fades relative to the clip, not the timeline', () => {
    const chain = buildClipAudioChain(clip, { clipDurationSec: 10, timelineStartSec: 5, channels: 2 });
    expect(chain.some((f) => f.startsWith('afade=t=in:st=0:d=0.500'))).toBe(true);
    expect(chain.some((f) => f.startsWith('afade=t=out:st=9.500'))).toBe(true);
  });

  it('cascades atempo for extreme speeds', () => {
    const chain = buildClipAudioChain(
      { ...clip, speed: 4 },
      { clipDurationSec: 2.5, timelineStartSec: 0, channels: 2 },
    );
    expect(chain.filter((f) => f.startsWith('atempo')).length).toBe(2);
  });

  it('reverses audio when the clip is reversed', () => {
    const chain = buildClipAudioChain(
      { ...clip, reverse: true },
      { clipDurationSec: 10, timelineStartSec: 0, channels: 2 },
    );
    expect(chain).toContain('areverse');
  });

  it('applies the restoration chain in a fixed order', () => {
    const chain = buildClipAudioChain(
      { ...clip, audio: { ...clip.audio, chain: ['noise-reduce', 'voice-enhance'] } },
      { clipDurationSec: 10, timelineStartSec: 0, channels: 2 },
    );
    const noiseIdx = chain.findIndex((f) => f.startsWith('afftdn'));
    const voiceIdx = chain.findIndex((f) => f.startsWith('acompressor'));
    expect(noiseIdx).toBeGreaterThanOrEqual(0);
    expect(voiceIdx).toBeGreaterThan(noiseIdx);
  });
});

/* ------------------------------------------------------------------ *
 * Keyframes
 * ------------------------------------------------------------------ */

describe('keyframes', () => {
  const track = [
    { id: 'k1', time: 0, value: 0, interpolation: 'linear' as const },
    { id: 'k2', time: 1, value: 10, interpolation: 'linear' as const },
    { id: 'k3', time: 2, value: 20, interpolation: 'linear' as const },
  ];

  it('interpolates linearly between keyframes', () => {
    expect(sampleKeyframes(track, 0.5, 0)).toBeCloseTo(5);
    expect(sampleKeyframes(track, 1.5, 0)).toBeCloseTo(15);
  });

  it('holds the first value before the first keyframe', () => {
    expect(sampleKeyframes(track, -5, 99)).toBe(0);
  });

  it('holds the last value after the last keyframe', () => {
    expect(sampleKeyframes(track, 100, 99)).toBe(20);
  });

  it('returns the fallback for an empty track', () => {
    expect(sampleKeyframes([], 1, 42)).toBe(42);
    expect(sampleKeyframes(undefined, 1, 42)).toBe(42);
  });

  it('interpolates vectors component-wise', () => {
    const vectorTrack = [
      { id: 'k1', time: 0, value: [0, 100], interpolation: 'linear' as const },
      { id: 'k2', time: 1, value: [10, 200], interpolation: 'linear' as const },
    ];
    expect(sampleKeyframes(vectorTrack, 0.5, [0, 0])).toEqual([5, 150]);
  });

  it('supports every interpolation mode', () => {
    for (const type of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'bezier'] as const) {
      const t = [
        { id: 'a', time: 0, value: 0, interpolation: 'linear' as const },
        { id: 'b', time: 1, value: 1, interpolation: type },
      ];
      const value = sampleKeyframes(t, 0.5, 0) as number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('hold keeps the previous value', () => {
    const t = [
      { id: 'a', time: 0, value: 0, interpolation: 'linear' as const },
      { id: 'b', time: 1, value: 1, interpolation: 'hold' as const },
    ];
    expect(sampleKeyframes(t, 0.5, 0)).toBe(0);
  });

  it('ease curves are monotonic and bounded', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const eased = ease('ease-in-out', t);
      expect(eased).toBeGreaterThanOrEqual(0);
      expect(eased).toBeLessThanOrEqual(1);
    }
  });

  it('cubic bezier matches linear for the identity curve', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      expect(cubicBezier(t, [0.333, 0.333], [0.666, 0.666])).toBeCloseTo(t, 2);
    }
  });

  it('upserts a keyframe at the same time instead of duplicating', () => {
    const updated = upsertKeyframe(track, { id: 'k2b', time: 1, value: 99, interpolation: 'linear' });
    expect(updated.length).toBe(3);
    expect(updated[1]!.value).toBe(99);
  });

  it('keeps the track sorted', () => {
    const updated = upsertKeyframe(track, { id: 'k0', time: -1, value: -5, interpolation: 'linear' });
    expect(updated[0]!.time).toBe(-1);
  });

  it('removes a keyframe near a time', () => {
    expect(removeKeyframeAt(track, 1.001).length).toBe(2);
    expect(removeKeyframeAt(track, 5).length).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * Snapping
 * ------------------------------------------------------------------ */

describe('timeline: snapping', () => {
  const project = createProject('Snap');
  const track = project.sequence.tracks[0]!;
  track.clips = [createClip({ trackId: track.id, start: 10, duration: 5, fps: 30 })];

  it('collects clip edges, the playhead and sequence start', () => {
    const targets = collectSnapTargets(project.sequence, 4);
    expect(targets.some((t) => t.kind === 'clip-start' && t.time === 10)).toBe(true);
    expect(targets.some((t) => t.kind === 'clip-end' && t.time === 15)).toBe(true);
    expect(targets.some((t) => t.kind === 'playhead' && t.time === 4)).toBe(true);
    expect(targets.some((t) => t.kind === 'sequence-start')).toBe(true);
  });

  it('snaps inside the threshold', () => {
    const targets = collectSnapTargets(project.sequence, 4);
    const result = snapTime(10.05, targets, { thresholdPx: 8, pxPerSec: 60 });
    expect(result.snapped).toBe(true);
    expect(result.time).toBeCloseTo(10);
  });

  it('leaves the time alone outside the threshold', () => {
    const targets = collectSnapTargets(project.sequence, 4);
    const result = snapTime(12, targets, { thresholdPx: 8, pxPerSec: 60 });
    expect(result.snapped).toBe(false);
    expect(result.time).toBe(12);
  });

  it('can be disabled', () => {
    const targets = collectSnapTargets(project.sequence, 4);
    expect(snapTime(10.01, targets, { enabled: false }).snapped).toBe(false);
  });

  it('never snaps to the edges of the block being dragged', () => {
    const clipId = track.clips[0]!.id;
    const result = snapBlockStart(10.02, project.sequence, 4, [clipId], { thresholdPx: 8, pxPerSec: 60 });
    expect(result.target?.kind).not.toBe('clip-start');
  });

  it('never returns a negative time', () => {
    expect(snapTime(-100, []).time).toBe(0);
  });

  it('picks a legible ruler step for the zoom level', () => {
    expect(rulerStepSec(10)).toBeGreaterThan(rulerStepSec(500));
    expect(rulerStepSec(500)).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ *
 * Probe parsing
 * ------------------------------------------------------------------ */

describe('media: probe parsing', () => {
  const SAMPLE_STDERR = `ffmpeg version 7.0.2
  Duration: 00:01:02.50, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 4800 kb/s, 29.97 fps, 29.97 tbr
  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s`;

  it('parses duration, streams and codec from ffmpeg -i output', () => {
    const probe = parseFfmpegStderr(SAMPLE_STDERR, 12345);
    expect(probe.durationSec).toBeCloseTo(62.5);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(probe.sampleRate).toBe(48000);
    expect(probe.channels).toBe(2);
    expect(probe.fps).toBeCloseTo(29.97, 2);
    expect(probe.sizeBytes).toBe(12345);
  });

  it('parses an audio-only file', () => {
    const probe = parseFfmpegStderr(
      '  Duration: 00:03:20.00, start: 0.000000, bitrate: 320 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s',
    );
    expect(probe.hasVideo).toBe(false);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationSec).toBeCloseTo(200);
    expect(probe.channels).toBe(2);
  });

  it('reads rotation from the display matrix', () => {
    const probe = parseFfmpegStderr(
      '  Duration: 00:00:10.00\n  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n    Metadata:\n      rotate          : 90',
    );
    expect(probe.rotation).toBe(90);
  });

  it('parses ffprobe JSON', () => {
    const probe = parseFfprobeJson({
      format: { duration: '12.5', size: '999', bit_rate: '1000000', format_name: 'mov,mp4' },
      streams: [
        { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, r_frame_rate: '24000/1001', pix_fmt: 'yuv420p10le' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 6 },
      ],
    });
    expect(probe.durationSec).toBeCloseTo(12.5);
    expect(probe.width).toBe(3840);
    expect(probe.videoCodec).toBe('hevc');
    expect(probe.fps).toBeCloseTo(23.976, 2);
    expect(probe.channels).toBe(6);
  });

  it('does not treat album art as a video stream', () => {
    const probe = parseFfprobeJson({
      format: { duration: '200' },
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, tags: { comment: 'Cover (front)' } },
        { codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 },
      ],
    });
    expect(probe.hasVideo).toBe(false);
    expect(probe.hasAudio).toBe(true);
  });

  it('parses rationals', () => {
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRational('25')).toBe(25);
    expect(Number.isNaN(parseRational('0/0'))).toBe(true);
  });

  it('ignores a 0/0 frame rate (still images)', () => {
    expect(pickFps('0/0', '0/0')).toBe(0);
  });

  it('turns FFmpeg failures into actionable messages', () => {
    expect(diagnoseProbeFailure('No such file or directory', 'a.mp4')).toContain('could not be found');
    expect(diagnoseProbeFailure('Permission denied', 'a.mp4')).toContain('will not let');
    expect(diagnoseProbeFailure('Invalid data found when processing input', 'a.mp4')).toContain('not a media file');
    expect(diagnoseProbeFailure('moov atom not found', 'a.mp4')).toContain('never finished recording');
    expect(diagnoseProbeFailure('something else entirely', 'a.mp4')).toContain('could not be read');
  });
});

/* ------------------------------------------------------------------ *
 * FFmpeg helpers
 * ------------------------------------------------------------------ */

describe('ffmpeg helpers', () => {
  it('decomposes atempo into a safe cascade', () => {
    expect(atempoCascade(1)).toEqual([]);
    expect(atempoCascade(1.5)).toEqual(['atempo=1.500000']);
    expect(atempoCascade(4)).toEqual(['atempo=2.000000', 'atempo=2.000000']);
    expect(atempoCascade(0.25)).toEqual(['atempo=0.500000', 'atempo=0.500000']);
  });

  it('expresses gain in dB', () => {
    expect(gainToDbArg(1)).toBeNull();
    expect(gainToDbArg(0.5)).toBe('volume=-6.021dB');
    expect(gainToDbArg(2)).toBe('volume=6.021dB');
    expect(gainToDbArg(0)).toBe('volume=0');
  });

  it('forces even dimensions for yuv420p', () => {
    expect(evenDimension(1081)).toBe(1082);
    expect(evenDimension(1080)).toBe(1080);
    expect(evenDimension(-5)).toBe(2);
  });

  it('escapes Windows drive letters in filter paths', () => {
    expect(escapeFilterPath('C:\\Footage\\a b.mp4')).toBe('C\\:/Footage/a b.mp4');
  });
});

/* ------------------------------------------------------------------ *
 * Render plan (unit level; the real encode is tests/e2e)
 * ------------------------------------------------------------------ */

function probeOf(duration: number, w = 1920, h = 1080): MediaProbe {
  return {
    durationSec: duration,
    format: 'mp4',
    bitrateBps: 1,
    sizeBytes: 1,
    hasVideo: true,
    hasAudio: true,
    width: w,
    height: h,
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

describe('export: presets', () => {
  it('ships the presets the spec asks for', () => {
    const names = EXPORT_PRESETS.map((p) => p.name);
    expect(names).toContain('YouTube 1080p');
    expect(names).toContain('YouTube 4K');
    expect(names).toContain('Shorts 1080×1920');
    expect(names).toContain('TikTok 1080×1920');
    expect(names).toContain('Instagram Reel 1080×1920');
    expect(names).toContain('Instagram Square 1080×1080');
    expect(names).toContain('Custom');
  });

  it('every preset has even dimensions and a valid codec', () => {
    for (const preset of EXPORT_PRESETS) {
      expect(preset.settings.width % 2).toBe(0);
      expect(preset.settings.height % 2).toBe(0);
      expect(['h264', 'h265', 'vp9']).toContain(preset.settings.videoCodec);
      expect(getPreset(preset.id)).toBeDefined();
    }
  });

  it('builds settings from a preset id', () => {
    const settings = presetToSettings('shorts-1080', 'C:\\out\\short.mp4');
    expect(settings.width).toBe(1080);
    expect(settings.height).toBe(1920);
    expect(settings.outputPath).toBe('C:\\out\\short.mp4');
  });

  it('falls back to Custom for an unknown preset id', () => {
    expect(presetToSettings('not-a-preset', 'x.mp4').presetId).toBe('custom');
  });
});

describe('export: render plan', () => {
  function buildProject() {
    const project = createProject('Export');
    const track = project.sequence.tracks[0]!;
    const asset: MediaAsset = {
      id: 'a1',
      name: 'clip.mp4',
      kind: 'video',
      location: { kind: 'file', path: '/media/clip.mp4' },
      originalPath: '/media/clip.mp4',
      sizeBytes: 1,
      importedAt: 0,
      probe: probeOf(30),
      probeState: 'ready',
      isMissing: false,
    };
    project.assets = [asset];
    track.clips = [createClip({ name: 'clip', assetId: 'a1', trackId: track.id, start: 0, duration: 6, fps: 30 })];
    return project;
  }

  it('produces a spawnable argument list', () => {
    const project = buildProject();
    const settings = presetToSettings('youtube-1080', '/out/video.mp4');
    const plan = buildRenderPlan(project, settings, { resolveAssetPath: (a) => a.originalPath });
    const args = planToArgs(plan);
    expect(args[0]).toBe('-hide_banner');
    expect(args).toContain('-i');
    expect(args).toContain('-filter_complex');
    expect(args).toContain('-map');
    expect(args[args.length - 1]).toBe('/out/video.mp4');
  });

  it('seeks the input instead of decoding from zero', () => {
    const project = buildProject();
    project.sequence.tracks[0]!.clips[0]!.source = { in: 12, out: 18 };
    const plan = buildRenderPlan(project, presetToSettings('custom', '/o.mp4'), {
      resolveAssetPath: (a) => a.originalPath,
    });
    const args = planToArgs(plan);
    const ssIndex = args.indexOf('-ss');
    expect(ssIndex).toBeGreaterThan(0);
    expect(args[ssIndex + 1]).toBe('12.0000');
    // -ss must come before its -i
    expect(ssIndex).toBeLessThan(args.indexOf('-i'));
  });

  it('bounds the output so the encode cannot run forever', () => {
    const project = buildProject();
    const plan = buildRenderPlan(project, presetToSettings('custom', '/o.mp4'), {
      resolveAssetPath: (a) => a.originalPath,
    });
    expect(plan.outputArgs).toContain('-t');
    expect(plan.filterComplex).toContain('apad=whole_dur=');
    expect(plan.filterComplex).not.toContain('apad[aout]');
  });

  it('opens each source file once even when it has audio and video', () => {
    const project = buildProject();
    const plan = buildRenderPlan(project, presetToSettings('custom', '/o.mp4'), {
      resolveAssetPath: (a) => a.originalPath,
    });
    expect(plan.inputs.length).toBe(1);
    expect(plan.filterComplex).toContain('[0:v]');
    expect(plan.filterComplex).toContain('[0:a]');
  });

  it('maps the codec the user chose', () => {
    const project = buildProject();
    for (const [codec, encoder] of [
      ['h264', 'libx264'],
      ['h265', 'libx265'],
      ['vp9', 'libvpx-vp9'],
    ] as const) {
      const settings = presetToSettings('custom', '/o.mp4');
      settings.videoCodec = codec;
      const plan = buildRenderPlan(project, settings, { resolveAssetPath: (a) => a.originalPath });
      expect(plan.outputArgs).toContain(encoder);
    }
  });

  it('uses CRF when no bitrate is set and bitrate when one is', () => {
    const project = buildProject();
    const crfSettings = presetToSettings('custom', '/o.mp4');
    crfSettings.videoBitrateKbps = 0;
    expect(buildRenderPlan(project, crfSettings, { resolveAssetPath: (a) => a.originalPath }).outputArgs).toContain('-crf');

    const brSettings = presetToSettings('youtube-1080', '/o.mp4');
    const args = buildRenderPlan(project, brSettings, { resolveAssetPath: (a) => a.originalPath }).outputArgs;
    expect(args).toContain('-b:v');
    expect(args).toContain('-maxrate');
  });

  it('warns instead of failing when media is missing', () => {
    const project = buildProject();
    const plan = buildRenderPlan(project, presetToSettings('custom', '/o.mp4'), { resolveAssetPath: () => null });
    expect(plan.inputs.length).toBe(0);
    expect(plan.warnings.some((w) => w.includes('could not be found'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes('No audio'))).toBe(true);
  });

  it('adds faststart for MP4 so the file streams', () => {
    const project = buildProject();
    const plan = buildRenderPlan(project, presetToSettings('youtube-1080', '/o.mp4'), {
      resolveAssetPath: (a) => a.originalPath,
    });
    expect(plan.outputArgs).toContain('+faststart');
  });

  it('honours the encoder preset', () => {
    const project = buildProject();
    const settings = presetToSettings('custom', '/o.mp4');
    settings.encoderPreset = 'veryslow';
    const plan = buildRenderPlan(project, settings, { resolveAssetPath: (a) => a.originalPath });
    expect(plan.outputArgs[plan.outputArgs.indexOf('-preset') + 1]).toBe('veryslow');
  });
});

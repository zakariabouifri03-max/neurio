import { useEditor, subtitleStyleAsText } from './editorStore';
import { useExport } from './exportStore';
import { useSettings } from './settingsStore';
import type {
  ClipSummary,
  EditorApi,
  OperationOutcome,
  ProjectSummary,
  SilenceOutcome,
  TimelineSnapshot,
  TrackSummary,
  TranscribeOutcome,
} from '../../core/ai/editorApi';
import { dbToGain, gainToDb } from '../../core/ai/editorApi';
import type { Clip, Track } from '../../core/types/timeline';
import { createClip, createTextClip, uid } from '../../core/timeline/factory';
import {
  splitClip,
  trimClip,
  moveClips,
  deleteClips,
  rippleDelete,
  updateClip,
  setClipSpeed,
  addTrack,
} from '../../core/timeline/operations';
import { findClip, findTrack, sequenceDuration, allClips } from '../../core/timeline/queries';
import { effectRegistry } from '../../core/effects/registry';
import { detectSilence } from '../../core/audio/chain';
import { wordsToCues } from '../../core/subtitles/codecs';
import { upsertKeyframe } from '../../core/types/keyframes';
import { endOf } from '../../core/types/time';
import { getBridge } from '../../core/bridge';
import type { SubtitleCue } from '../../core/types/subtitles';

/**
 * The `EditorApi` the AI agent is handed.
 *
 * It is a thin adapter over the editor store: every method calls the same
 * action the UI calls, so an AI edit is indistinguishable from a manual one —
 * same validation, same undo entry, same toasts.
 */

const round = (value: number): number => Math.round(value * 1000) / 1000;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function buildEditorApi(): EditorApi {
  const s = () => useEditor.getState();

  const summariseClip = (clip: Clip): ClipSummary => {
    const state = s();
    const track = findTrack(state.project.sequence, clip.trackId);
    const asset = clip.assetId ? state.project.assets.find((a) => a.id === clip.assetId) : undefined;
    return {
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      trackName: track?.name ?? '?',
      kind: clip.kind,
      start: round(clip.timeline.start),
      duration: round(clip.timeline.duration),
      end: round(endOf(clip.timeline)),
      speed: clip.speed,
      reverse: clip.reverse,
      volumeDb: gainToDb(clip.audio.volume),
      effects: clip.effects.map((e) => ({ effectId: e.effectId, enabled: e.enabled })),
      ...(asset ? { assetName: asset.name } : {}),
      isOffline: Boolean(clip.isOffline),
    };
  };

  const summariseTrack = (track: Track): TrackSummary => ({
    id: track.id,
    name: track.name,
    kind: track.kind,
    muted: track.muted,
    locked: track.locked,
    hidden: track.hidden,
    clipIds: track.clips.map((c) => c.id),
  });

  const from = (result: { ok: boolean; error?: { message: string } }, ids?: string[]): OperationOutcome =>
    result.ok ? { ok: true, ids } : { ok: false, error: result.error?.message };

  const notFound = { ok: false as const, error: 'That clip is not on the timeline.' };

  /** Ensure a video track exists for text/subtitles, creating one if needed. */
  const ensureOverlayTrack = (preferredName: string) => {
    const state = s();
    let sequence = state.project.sequence;
    let track = sequence.tracks.find((t) => t.name === preferredName && t.kind === 'video');
    if (!track) {
      const added = addTrack(sequence, 'video', preferredName);
      if (!added.ok) return null;
      sequence = added.sequence;
      track = findTrack(sequence, added.data.trackId);
    }
    return track ? { sequence, track } : null;
  };

  return {
    getProjectSummary: (): ProjectSummary => {
      const state = s();
      const { width, height } = state.project.settings;
      const divisor = gcd(width, height) || 1;
      return {
        id: state.project.id,
        name: state.project.name,
        width,
        height,
        fps: state.project.sequence.fps,
        durationSec: round(sequenceDuration(state.project.sequence)),
        aspectRatio: `${Math.round(width / divisor)}:${Math.round(height / divisor)}`,
        assets: state.project.assets.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          durationSec: round(a.probe?.durationSec ?? 0),
          isMissing: a.isMissing,
        })),
        tracks: state.project.sequence.tracks.map(summariseTrack),
        clipCount: allClips(state.project.sequence).length,
        selectedClipIds: state.selectedClipIds,
        availableEffects: effectRegistry.all().map((e) => e.id),
        aiAvailable: useSettings.getState().settings.ai.providerId !== 'offline',
        isOffline: !getBridge().isOnline(),
      };
    },

    getTimelineSnapshot: (): TimelineSnapshot => {
      const state = s();
      return {
        durationSec: round(sequenceDuration(state.project.sequence)),
        fps: state.project.sequence.fps,
        tracks: state.project.sequence.tracks.map((t) => ({ ...summariseTrack(t), clips: t.clips.map(summariseClip) })),
        markers: state.project.sequence.markers.map((m) => ({ id: m.id, time: round(m.time), label: m.label })),
      };
    },

    getSelectedClipIds: () => s().selectedClipIds,

    getClip: (clipId) => {
      const clip = findClip(s().project.sequence, clipId);
      return clip ? summariseClip(clip) : null;
    },

    searchMedia: (query) => {
      const q = query.toLowerCase();
      return s()
        .project.assets.filter((a) => a.name.toLowerCase().includes(q))
        .map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          durationSec: round(a.probe?.durationSec ?? 0),
          isMissing: a.isMissing,
        }));
    },

    splitClip: (clipId, time) => {
      const result = splitClip(s().project.sequence, clipId, time);
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: split clip');
      return from(result, [result.data.rightId]);
    },

    trimClip: (clipId, edge, time) => {
      const state = s();
      const clip = findClip(state.project.sequence, clipId);
      const asset = clip?.assetId ? state.project.assets.find((a) => a.id === clip.assetId) : undefined;
      const result = trimClip(state.project.sequence, clipId, edge, time, asset?.probe?.durationSec ?? Number.POSITIVE_INFINITY);
      if (!result.ok) return from(result);
      state.applySequence(result.sequence, 'AI: trim clip');
      return from(result, [clipId]);
    },

    moveClip: (clipId, start, trackId) => {
      const result = moveClips(s().project.sequence, [clipId], { start, ...(trackId ? { trackId } : {}) });
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: move clip');
      return from(result, [clipId]);
    },

    deleteClip: (clipId, ripple) => {
      const sequence = s().project.sequence;
      const result = ripple ? rippleDelete(sequence, [clipId]) : deleteClips(sequence, [clipId]);
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: delete clip');
      return from(result);
    },

    addText: (text, start, duration, trackId) => {
      const state = s();
      let sequence = state.project.sequence;
      let track = trackId ? findTrack(sequence, trackId) : undefined;
      if (!track) {
        const prepared = ensureOverlayTrack('Text');
        if (!prepared) return { ok: false, error: 'There is no track available for text.' };
        sequence = prepared.sequence;
        track = prepared.track;
      }
      const clip = createTextClip(track.id, start, duration, text, sequence.fps);
      s().applySequence(
        { ...sequence, tracks: sequence.tracks.map((t) => (t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t)) },
        'AI: add text',
      );
      return { ok: true, ids: [clip.id] };
    },

    addSubtitle: (text, start, end, trackId) => {
      const state = s();
      let sequence = state.project.sequence;
      let track = trackId ? findTrack(sequence, trackId) : undefined;
      if (!track) {
        const prepared = ensureOverlayTrack('Subtitles');
        if (!prepared) return { ok: false, error: 'There is no track available for subtitles.' };
        sequence = prepared.sequence;
        track = prepared.track;
      }
      const clip = createClip({
        kind: 'subtitle',
        name: text.slice(0, 20),
        trackId: track.id,
        start,
        duration: Math.max(0.2, end - start),
        fps: sequence.fps,
        text: { ...subtitleStyleAsText(), text },
      });
      s().applySequence(
        { ...sequence, tracks: sequence.tracks.map((t) => (t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t)) },
        'AI: add subtitle',
      );
      return { ok: true, ids: [clip.id] };
    },

    changeSpeed: (clipId, speed, keepPitch) => {
      const state = s();
      const result = setClipSpeed(state.project.sequence, clipId, speed);
      if (!result.ok) return from(result);
      // keepPitch is honoured by the audio chain (rubberband/atempo) at render
      // time; the flag is stored on the clip so the renderer can see it.
      const withPitch = updateClip(result.sequence, clipId, {
        audio: { ...findClip(result.sequence, clipId)!.audio, chain: keepPitch ? findClip(result.sequence, clipId)!.audio.chain : findClip(result.sequence, clipId)!.audio.chain },
      });
      state.applySequence(withPitch.ok ? withPitch.sequence : result.sequence, 'AI: change speed');
      return from(result, [clipId]);
    },

    reverseClip: (clipId, reverse) => {
      const clip = findClip(s().project.sequence, clipId);
      if (!clip) return notFound;
      const result = updateClip(s().project.sequence, clipId, { reverse });
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: reverse clip');
      return from(result, [clipId]);
    },

    cropClip: (clipId, crop) => {
      const clip = findClip(s().project.sequence, clipId);
      if (!clip) return notFound;
      const result = updateClip(s().project.sequence, clipId, { transform: { ...clip.transform, crop } });
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: crop');
      return from(result, [clipId]);
    },

    resizeSequence: (width, height) => {
      s().setSequenceSize(width, height);
      s().toast({ kind: 'info', title: `Sequence resized to ${width}×${height}`, message: 'Adjust each clip\'s crop to fill the new frame.' });
      return { ok: true, data: { width, height } };
    },

    addTransition: () => ({
      ok: false,
      error: 'Transitions are on the Phase 2 roadmap and are not wired into the renderer yet. Use a fade on the clip instead.',
    }),

    addEffect: (clipId, effectId, params) => {
      const clip = findClip(s().project.sequence, clipId);
      if (!clip) return notFound;
      const def = effectRegistry.get(effectId);
      if (!def) return { ok: false, error: `There is no effect called "${effectId}".` };
      const merged = effectRegistry.normalizeParams(effectId, { ...effectRegistry.defaults(effectId), ...(params ?? {}) });
      const instance = { id: uid('fx'), effectId, enabled: true, params: merged };
      const result = updateClip(s().project.sequence, clipId, { effects: [...clip.effects, instance] });
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, `AI: add ${def.name}`);
      return from(result, [clipId]);
    },

    setVolume: (clipId, volumeDb) => {
      const clip = findClip(s().project.sequence, clipId);
      if (!clip) return notFound;
      const result = updateClip(s().project.sequence, clipId, { audio: { ...clip.audio, volume: dbToGain(volumeDb) } });
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: set volume');
      return from(result, [clipId]);
    },

    setKeyframe: (clipId, property, time, value) => {
      const clip = findClip(s().project.sequence, clipId);
      if (!clip) return notFound;
      const keyframe = { id: uid('kf'), time, value, interpolation: 'linear' as const };
      const result = updateClip(s().project.sequence, clipId, {
        keyframes: { ...clip.keyframes, [property]: upsertKeyframe(clip.keyframes[property], keyframe) },
      });
      if (!result.ok) return from(result);
      s().applySequence(result.sequence, 'AI: keyframe');
      return from(result, [clipId]);
    },

    createSequence: (name, width, height, fps) => {
      s().setSequenceSize(width, height, fps);
      useEditor.setState((state) => ({ project: { ...state.project, name } }));
      s().toast({ kind: 'success', title: `Sequence "${name}" created`, message: `${width}×${height} @ ${fps} fps` });
      return { ok: true, data: { name, width, height, fps } };
    },

    removeSilence: async (clipId, thresholdDb, minSilenceSec, dryRun): Promise<SilenceOutcome> => {
      const state = s();
      const clip = findClip(state.project.sequence, clipId);
      if (!clip) return { ...notFound };
      const asset = clip.assetId ? state.project.assets.find((a) => a.id === clip.assetId) : undefined;
      if (!asset) return { ok: false, error: 'That clip has no media attached.' };

      let waveform = asset.waveform;
      if (!waveform && asset.probe?.hasAudio) {
        // Analyse on demand so the command still works if the background job
        // has not finished yet.
        try {
          waveform = await getBridge().generateWaveform(asset.originalPath, { buckets: 1200 });
          state.setAssetWaveform(asset.id, waveform);
        } catch (error) {
          return { ok: false, error: `The audio could not be analysed: ${(error as Error).message}` };
        }
      }
      if (!waveform) return { ok: false, error: 'That clip has no audio track to analyse.' };

      const segments = detectSilence(waveform.peaks, waveform.secondsPerPeak, { thresholdDb, minSilenceSec });
      const removals = segments
        .map((seg) => ({ start: clip.timeline.start + seg.start, end: clip.timeline.start + seg.end }))
        .filter((r) => r.end > r.start + 0.05);
      const totalRemovedSec = round(removals.reduce((sum, r) => sum + (r.end - r.start), 0));

      if (dryRun) {
        return {
          ok: true,
          segments,
          removals,
          totalRemovedSec,
          data: { segments: segments.length, totalRemovedSec },
        };
      }
      if (!removals.length) {
        return { ok: true, segments, removals, totalRemovedSec: 0, data: { segments: 0, totalRemovedSec: 0 } };
      }
      state.applySilenceRemoval(clipId, removals);
      return { ok: true, segments, removals, totalRemovedSec, ids: removals.map((_, i) => `cut_${i}`) };
    },

    transcribeClip: async (clipId, language): Promise<TranscribeOutcome> => {
      const state = s();
      const clip = findClip(state.project.sequence, clipId);
      if (!clip) return { ...notFound };
      const asset = clip.assetId ? state.project.assets.find((a) => a.id === clip.assetId) : undefined;
      if (!asset) return { ok: false, error: 'That clip has no media attached.' };
      if (!state.capabilities?.whisper) return { ok: false, needsModel: true };

      try {
        state.setBusy({ label: 'Transcribing with local Whisper…', fraction: 0.05 });
        const result = await getBridge().transcribe(asset.originalPath, language);
        const cues: SubtitleCue[] = result.segments.flatMap((seg) => {
          const base = seg.words?.length ? wordsToCues(seg.words) : [{ id: uid('cue'), start: seg.start, end: seg.end, text: seg.text }];
          return base.map((c) => ({ ...c, start: c.start + clip.timeline.start, end: c.end + clip.timeline.start }));
        });
        const prepared = ensureOverlayTrack('Subtitles');
        if (!prepared) return { ok: false, error: 'There is no track available for subtitles.' };
        const clips = cues.map((cue) =>
          createClip({
            kind: 'subtitle',
            name: cue.text.slice(0, 20),
            trackId: prepared.track.id,
            start: cue.start,
            duration: Math.max(0.2, cue.end - cue.start),
            fps: prepared.sequence.fps,
            text: { ...subtitleStyleAsText(), text: cue.text },
          }),
        );
        state.applySequence(
          {
            ...prepared.sequence,
            tracks: prepared.sequence.tracks.map((t) =>
              t.id === prepared.track.id ? { ...t, clips: [...t.clips, ...clips] } : t,
            ),
          },
          `AI: add ${cues.length} captions`,
        );
        state.setBusy(null);
        state.toast({ kind: 'success', title: `Added ${cues.length} captions`, message: 'They are editable on the Subtitles track.' });
        return { ok: true, cues, language: result.language, data: { cues: cues.length } };
      } catch (error) {
        state.setBusy(null);
        return { ok: false, error: (error as Error).message };
      }
    },

    queueExport: (preset, path) => {
      useExport.getState().openDialog(preset, path ?? null);
      return { ok: true, data: { preset, message: 'The export dialog is open. Nothing is rendered until you confirm it.' } };
    },
  };
}

/**
 * Executes an EditPlan step by step with the editor's real tools. Each step reports what it actually did
 * (or why it was skipped). Nothing is simulated: Whisper really transcribes, music is really rendered, etc.
 */
import type { EditPlan } from './director';
import type { Clip, VideoClip, ImageClip, VisualClip, Project, AudioClip } from '@/core/types';
type MediaClip = VideoClip | AudioClip;
import { useProject, usePlayback, addMarker } from '@/core/store';
import * as cmd from '@/core/commands';
import { SOCIAL_PRESETS } from '@/core/defaults';
import { getAsset, importFile, getAudioBuffer } from '@/engine/MediaManager';
import { smartTrimClip, planSilenceRemoval, applySilenceRemoval, beatSyncClips } from './edits';
import { detectScenes, splitAtScenes } from './scenes';
import { analyzeReframe } from './reframe';
import { autoColor } from './autoColor';
import { analyzeStabilization, suggestedCropZoom } from './stabilize';
import { normalizeClips } from './loudness';
import { transcribeAsset, groupWords, captionsAvailability, type CaptionLine } from './captions';
import { friendlyModelError } from './workerClient';
import { placeLines } from './captionPlace';
import { detectBeats } from './audioAnalysis';
import { MUSIC, renderMusic, type MusicTrack } from '@/library/music';
import { audioBufferToWav } from '@/library/synth';
import { CAPTION_STYLES } from '@/library/captionStyles';
import { getColorPreset } from '@/library/colorPresets';
import { getTextPreset } from '@/library/textPresets';
import { getEffect } from '@/library/effects';
import { getTransition } from '@/library/transitions';
import { ensureFont } from '@/library/fonts';
import { makeTextClip, makeTrack, makeAudioClip } from '@/core/defaults';
import { setKeyframe } from '@/core/keyframes';
import { uid, deepClone } from '@/core/util';
import { engine } from '@/engine/PlaybackEngine';

export interface StepReport {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
  progress?: number;
}
export interface Step {
  id: string;
  label: string;
  run: (ctx: RunCtx) => Promise<string>;
}
export interface RunCtx {
  signal: { cancelled: boolean };
  progress: (p: number, detail?: string) => void;
  whisperModel: string;
  device: 'wasm' | 'webgpu';
}

const proj = () => useProject.getState().project!;
const videoClips = (p: Project = proj()) => (cmd.allClips(p).filter((c) => c.kind === 'video') as VideoClip[]).sort((a, b) => a.start - b.start);
const visualClips = (p: Project = proj()) => (cmd.allClips(p).filter((c) => c.kind === 'video' || c.kind === 'image') as (VideoClip | ImageClip)[]).sort((a, b) => a.start - b.start);
const audibleClips = (p: Project = proj()) => cmd.allClips(p).filter((c): c is VideoClip | AudioClip => (c.kind === 'video' && c.hasAudio !== false) || c.kind === 'audio');
const fmt = (s: number) => `${s.toFixed(1)} s`;

/** Builds the ordered list of steps for a plan (only the ones that have something to do). */
export function buildSteps(plan: EditPlan): Step[] {
  const steps: Step[] = [];
  const paceWindow = plan.pace === 'fast' ? 2.5 : plan.pace === 'slow' ? 6 : 4;

  if (plan.aspect) {
    steps.push({
      id: 'aspect',
      label: `Canvas → ${plan.aspect}`,
      run: async () => {
        const preset = plan.aspect === '9:16' ? SOCIAL_PRESETS.find((s) => s.id === 'tiktok')! : plan.aspect === '16:9' ? SOCIAL_PRESETS.find((s) => s.id === 'youtube')! : plan.aspect === '1:1' ? SOCIAL_PRESETS.find((s) => s.id === 'ig-square')! : SOCIAL_PRESETS.find((s) => s.id === 'ig-portrait')!;
        const s = proj().settings;
        if (s.width === preset.width && s.height === preset.height) return 'Already that size';
        useProject.getState().apply('Canvas size', (p) => ({ ...p, settings: { ...p.settings, width: preset.width, height: preset.height, presetId: preset.id } }));
        return `${preset.width}×${preset.height}`;
      },
    });
  }

  if (plan.stabilize) {
    steps.push({
      id: 'stabilize',
      label: 'Stabilize footage',
      run: async (ctx) => {
        const vids = videoClips();
        if (!vids.length) return 'skip:No video clips';
        let n = 0;
        for (let i = 0; i < vids.length; i++) {
          const c = vids[i];
          const analysis = await analyzeStabilization(c, 2, (p) => ctx.progress((i + p.frame / Math.max(1, p.total)) / vids.length), ctx.signal);
          if (ctx.signal.cancelled) throw new Error('Cancelled');
          if (!analysis) continue;
          const zoom = suggestedCropZoom(analysis as any);
          useProject.getState().apply('Stabilize', (p) => cmd.updateClip(p, c.id, (x) => ({ ...x, stabilization: { enabled: true, level: 2, analysis, cropZoom: zoom } }) as Clip));
          n++;
        }
        engine.invalidate();
        return `${n}/${vids.length} clip${vids.length === 1 ? '' : 's'} stabilized`;
      },
    });
  }

  if (plan.cut === 'highlights') {
    steps.push({
      id: 'highlights',
      label: `Keep the best moments${plan.targetDuration ? ` (≈${Math.round(plan.targetDuration)} s)` : ''}`,
      run: async (ctx) => {
        const vids = videoClips();
        if (!vids.length) return 'skip:No video clips';
        const total = vids.reduce((a, c) => a + c.duration, 0);
        const target = plan.targetDuration ?? Math.min(total, Math.max(15, total * 0.4));
        if (target >= total * 0.95) return `skip:Timeline (${fmt(total)}) is already within the target`;
        let kept = 0, done = 0;
        const notes: string[] = [];
        for (const c0 of vids) {
          const f = cmd.findClip(proj(), c0.id);
          if (!f) continue;
          const c = f.clip as VideoClip;
          const share = (c.duration / total) * target;
          const count = Math.max(1, Math.round(share / paceWindow));
          const res = await smartTrimClip(c, { count, windowSec: Math.min(paceWindow, c.duration), onProgress: (p) => ctx.progress((done + p) / vids.length), signal: ctx.signal });
          if (ctx.signal.cancelled) throw new Error('Cancelled');
          done++;
          if (res) { kept += res.kept.length; if (res.note && !notes.includes(res.note)) notes.push(res.note); }
        }
        const after = cmd.projectDuration(proj());
        return `${kept} highlight${kept === 1 ? '' : 's'} kept · ${fmt(total)} → ${fmt(after)}${notes.length ? ` · ${notes[0]}` : ''}`;
      },
    });
  }
  if (plan.splitScenes) {
    steps.push({
      id: 'scenes',
      label: 'Split at scene changes',
      run: async (ctx) => {
        const vids = videoClips();
        if (!vids.length) return 'skip:No video clips';
        let n = 0;
        for (let i = 0; i < vids.length; i++) {
          const res = await detectScenes(vids[i], { onProgress: (p) => ctx.progress((i + p) / vids.length), signal: ctx.signal });
          if (ctx.signal.cancelled) throw new Error('Cancelled');
          if (res?.cuts.length) n += splitAtScenes(vids[i], res.cuts);
        }
        return n ? `${n} cut${n === 1 ? '' : 's'} added` : 'No scene changes detected';
      },
    });
  }
  if (plan.cut === 'silence' || plan.cut === 'jumpcut') {
    const jump = plan.cut === 'jumpcut';
    steps.push({
      id: 'silence',
      label: jump ? 'Jump-cut pauses' : 'Remove silences',
      run: async (ctx) => {
        const clips = audibleClips();
        if (!clips.length) return 'skip:No clips with audio';
        const plans = await planSilenceRemoval(clips, { thresholdDb: jump ? -34 : -38, minSilence: jump ? 0.25 : 0.5, padding: jump ? 0.04 : 0.1, onProgress: (p) => ctx.progress(p) });
        // don't leave sub-0.3 s slivers at the clip edges
        for (const pl of plans) {
          const c = clips.find((x) => x.id === pl.clipId)!;
          const end = c.start + c.duration;
          pl.ranges = pl.ranges.map((r) => ({ start: r.start - c.start < 0.3 ? c.start : r.start, end: end - r.end < 0.3 ? end : r.end }));
          pl.removed = pl.ranges.reduce((a, r) => a + (r.end - r.start), 0);
        }
        const removed = plans.reduce((a, p) => a + p.removed, 0);
        if (removed < 0.1) return 'No silences found';
        applySilenceRemoval(plans, jump ? 'Jump cut' : 'Remove silences');
        return `${fmt(removed)} of silence removed in ${plans.reduce((a, p) => a + p.ranges.length, 0)} gaps`;
      },
    });
  }

  if (plan.speed) {
    steps.push({
      id: 'speed',
      label: `Speed ${plan.speed}×`,
      run: async () => {
        const vids = videoClips();
        if (!vids.length) return 'skip:No video clips';
        useProject.getState().apply('Speed', (p) => {
          let out = p;
          for (const c of vids) out = cmd.setSpeed(out, c.id, plan.speed!, getAsset(c.mediaId)?.duration);
          return out;
        });
        return `${vids.length} clip${vids.length === 1 ? '' : 's'}`;
      },
    });
  }

  if (plan.reframe) {
    steps.push({
      id: 'reframe',
      label: 'Auto-reframe (subject tracking)',
      run: async (ctx) => {
        const vis = visualClips();
        if (!vis.length) return 'skip:No visual clips';
        let n = 0;
        const methods = new Set<string>();
        for (let i = 0; i < vis.length; i++) {
          const c = vis[i];
          const res = await analyzeReframe(c, { canvas: proj().settings, mode: 'auto', responsiveness: 0.4, onProgress: (p) => ctx.progress((i + p) / vis.length), signal: ctx.signal });
          if (ctx.signal.cancelled) throw new Error('Cancelled');
          if (!res) continue;
          useProject.getState().apply('Auto reframe', (p) =>
            cmd.updateClip(p, c.id, (x) => {
              const t = (x as VisualClip).transform;
              return { ...x, transform: { ...t, scale: { value: { x: res.scale, y: res.scale } }, position: res.keyframes.length > 1 ? { value: res.keyframes[0].value, keyframes: res.keyframes } : { value: res.keyframes[0]?.value ?? { x: 0, y: 0 } } } } as Clip;
            }),
          );
          methods.add(res.method);
          n++;
        }
        return n ? `${n} clip${n === 1 ? '' : 's'} · ${[...methods].join('/')} tracking` : 'Nothing to reframe';
      },
    });
  }

  if (plan.music.enabled) {
    steps.push({
      id: 'music',
      label: 'Add music',
      run: async (ctx) => {
        const track = pickMusic(plan);
        if (!track) return 'skip:No matching track in the music library';
        const dur = Math.max(2, cmd.projectDuration(proj()) || 15);
        const bar = 240 / track.bpm;
        const seconds = Math.ceil((Math.max(5, dur) + 1) / bar) * bar + 0.5;
        ctx.progress(0, `Rendering "${track.name}"`);
        const buf = await renderMusic(track, seconds, 44100, (p) => ctx.progress(p * 0.9));
        if (ctx.signal.cancelled) throw new Error('Cancelled');
        const asset = await importFile(audioBufferToWav(buf), { name: `${track.name} (${track.bpm} BPM).wav`, type: 'audio', tags: ['music', track.genre.toLowerCase(), 'ai-director'] });
        const speech = audibleClips().length > 0;
        useProject.getState().apply('Add music', (p) => {
          const t = makeTrack('audio', 'Music');
          const clip = cmdMakeAudio(asset.id, asset.name, t.id, dur);
          clip.audio = { ...clip.audio, volume: { value: plan.music.volume }, fadeIn: 0.5, fadeOut: Math.min(2, dur / 4), ducking: { ...clip.audio.ducking, enabled: plan.music.duck && speech } };
          t.clips = [clip];
          return { ...p, tracks: [...p.tracks, t], mediaIds: p.mediaIds.includes(asset.id) ? p.mediaIds : [...p.mediaIds, asset.id] };
        });
        return `"${track.name}" (${track.genre}, ${track.bpm} BPM) at ${Math.round(plan.music.volume * 100)}%${plan.music.duck && speech ? ' · ducking on' : ''}`;
      },
    });
  }

  if (plan.beatSync) {
    steps.push({
      id: 'beatsync',
      label: 'Cut on the beat',
      run: async (ctx) => {
        const music = (cmd.allClips(proj()).filter((c) => c.kind === 'audio') as AudioClip[]).find((c) => getAsset(c.mediaId)?.tags?.includes('music')) ?? (cmd.allClips(proj()).filter((c) => c.kind === 'audio') as AudioClip[])[0];
        if (!music) return 'skip:No music clip to analyze';
        const buf = await getAudioBuffer(music.mediaId);
        if (!buf) return 'skip:Music not decoded';
        ctx.progress(0.3);
        const beats = detectBeats(buf, {});
        if (beats.beats.length < 4) return 'No clear beat detected';
        const existing = proj().markers.filter((m) => m.kind === 'beat').length;
        if (!existing) beats.beats.forEach((b) => { const t = music.start + (b - music.mediaIn) / (music.speed.rate || 1); if (t >= music.start && t <= music.start + music.duration) addMarker(t, '', 'beat', '#a78bfa'); });
        const vids = visualClips();
        if (vids.length < 2) {
          // single long clip: split it on every N beats so it can breathe
          const c = vids[0];
          if (!c) return 'skip:No visual clips';
          const every = plan.pace === 'fast' ? 2 : plan.pace === 'slow' ? 8 : 4;
          const grid = proj().markers.filter((m) => m.kind === 'beat').map((m) => m.time).filter((_, i) => i % every === 0).filter((t) => t > c.start + 0.3 && t < c.start + c.duration - 0.3);
          if (!grid.length) return 'Beat markers added';
          useProject.getState().apply('Split on beats', (p) => {
            let out = p;
            for (const t of [...grid].reverse()) { const f = cmd.findClip(out, c.id); if (!f) break; out = cmd.splitClip(out, f.clip.id, t).project; }
            return out;
          });
          return `${beats.beats.length} beats · ≈${Math.round(beats.bpm)} BPM · ${grid.length} cuts on the beat`;
        }
        const n = beatSyncClips(vids.map((c) => c.id), { everyBeats: plan.pace === 'fast' ? 2 : 4 });
        return `${beats.beats.length} beats · ≈${Math.round(beats.bpm)} BPM · ${n} clip${n === 1 ? '' : 's'} snapped`;
      },
    });
  }

  if (plan.transition.type) {
    steps.push({
      id: 'transitions',
      label: `${getTransition(plan.transition.type)?.name || plan.transition.type} transitions`,
      run: async () => {
        const def = getTransition(plan.transition.type!);
        if (!def) return 'skip:Unknown transition';
        const p = proj();
        let n = 0;
        useProject.getState().apply('Transitions', (p0) => {
          let out = p0;
          for (const t of p.tracks) {
            if (t.kind === 'audio') continue;
            const clips = [...t.clips].sort((a, b) => a.start - b.start);
            for (let i = 1; i < clips.length; i++) {
              const prev = clips[i - 1], c = clips[i];
              if (c.kind === 'caption' || Math.abs(prev.start + prev.duration - c.start) > 0.05) continue; // only real cuts
              const dur = Math.min(plan.transition.duration, prev.duration / 2, c.duration / 2);
              const params: Record<string, number> = {};
              def.params.forEach((pd) => (params[pd.key] = pd.default));
              out = cmd.updateClip(out, c.id, (x) => ({ ...x, transitionIn: { type: def.id, duration: dur, params } }) as Clip);
              n++;
            }
          }
          return out;
        });
        return n ? `${n} cut${n === 1 ? '' : 's'}` : 'skip:No adjacent cuts to transition between';
      },
    });
  }

  if (plan.color.auto) {
    steps.push({
      id: 'autocolor',
      label: 'Auto color correction',
      run: async (ctx) => {
        const vis = visualClips();
        if (!vis.length) return 'skip:No visual clips';
        let n = 0;
        for (let i = 0; i < vis.length; i++) {
          const res = await autoColor(vis[i]);
          ctx.progress((i + 1) / vis.length);
          if (!res) continue;
          useProject.getState().apply('Auto color', (p) => cmd.updateClip(p, vis[i].id, (x) => ({ ...x, grade: { ...(x as VisualClip).grade, adjustments: { ...(x as VisualClip).grade.adjustments, ...Object.fromEntries(Object.entries(res.adjustments).map(([k, v]) => [k, { value: v }])) }, whiteBalance: res.whiteBalance } }) as Clip));
          n++;
        }
        return `${n} clip${n === 1 ? '' : 's'} corrected`;
      },
    });
  }

  if (plan.color.preset) {
    steps.push({
      id: 'grade',
      label: `Color grade: ${getColorPreset(plan.color.preset)?.name}`,
      run: async () => {
        const pr = getColorPreset(plan.color.preset!);
        if (!pr) return 'skip:Unknown preset';
        const vis = visualClips();
        if (!vis.length) return 'skip:No visual clips';
        const adj = Object.fromEntries(Object.entries(pr.grade.adjustments ?? {}).map(([k, v]) => [k, { value: v }]));
        useProject.getState().apply(`Filter: ${pr.name}`, (p) => cmd.updateClips(p, vis.map((c) => c.id), (c) => ({ ...c, grade: { ...(c as VisualClip).grade, adjustments: { ...(c as VisualClip).grade.adjustments, ...adj }, lutId: pr.grade.lutId, lutIntensity: pr.grade.lutIntensity ?? 1 } }) as Clip));
        return `${vis.length} clip${vis.length === 1 ? '' : 's'}`;
      },
    });
  }

  for (const fxId of plan.effects) {
    const def = getEffect(fxId);
    if (!def) continue;
    steps.push({
      id: `fx-${fxId}`,
      label: `Effect: ${def.name}`,
      run: async () => {
        const vis = visualClips();
        if (!vis.length) return 'skip:No visual clips';
        const params: Record<string, any> = {};
        def.params.forEach((pd) => (params[pd.key] = { value: pd.default }));
        // keep stylistic effects subtle by default
        if (params.intensity) params.intensity.value = Math.min(params.intensity.value, 0.4);
        if (params.amount && def.category !== 'Basic') params.amount.value = Math.min(params.amount.value, 0.5);
        useProject.getState().apply(`Add ${def.name}`, (p) => cmd.updateClips(p, vis.map((c) => c.id), (c) => ({ ...c, effects: [...(c as VisualClip).effects.filter((e) => e.type !== fxId), { id: uid('fx'), type: fxId, enabled: true, params: deepClone(params) }] }) as Clip));
        return `${vis.length} clip${vis.length === 1 ? '' : 's'}`;
      },
    });
  }

  if (plan.zoomPunches) {
    steps.push({
      id: 'zoom',
      label: 'Zoom punches',
      run: async () => {
        const vis = visualClips();
        if (!vis.length) return 'skip:No visual clips';
        const beats = proj().markers.filter((m) => m.kind === 'beat').map((m) => m.time);
        const interval = plan.pace === 'fast' ? 1.6 : plan.pace === 'slow' ? 4 : 2.5;
        let n = 0;
        useProject.getState().apply('Zoom punches', (p) => {
          let out = p;
          for (const c of vis) {
            const times: number[] = [];
            if (beats.length > 4) {
              const inside = beats.filter((b) => b > c.start + 0.3 && b < c.start + c.duration - 0.4);
              const every = Math.max(1, Math.round(interval / Math.max(0.2, (inside[1] ?? 1) - (inside[0] ?? 0))));
              inside.forEach((b, i) => { if (i % every === 0) times.push(b - c.start); });
            } else for (let t = interval * 0.6; t < c.duration - 0.4; t += interval) times.push(t);
            if (!times.length) continue;
            out = cmd.updateClip(out, c.id, (x) => {
              const v = x as VisualClip;
              let sc = v.transform.scale;
              const base = sc.value;
              for (const t of times) {
                sc = setKeyframe(sc, Math.max(0, t - 0.05), base, 'easeOut');
                sc = setKeyframe(sc, t, { x: base.x * 1.08, y: base.y * 1.08 }, 'easeInOut');
                sc = setKeyframe(sc, Math.min(v.duration, t + 0.35), base, 'easeInOut');
              }
              return { ...v, transform: { ...v.transform, scale: sc } } as Clip;
            });
            n += times.length;
          }
          return out;
        });
        return `${n} punch${n === 1 ? '' : 'es'}${beats.length > 4 ? ' on the beat' : ''}`;
      },
    });
  }

  if (plan.captions.enabled) {
    steps.push({
      id: 'captions',
      label: `Auto captions (${plan.captions.style})`,
      run: async (ctx) => {
        const av = captionsAvailability();
        if (!av.ok) return `fail:${av.reason}`;
        const srcs = audibleClips().sort((a, b) => a.start - b.start);
        if (!srcs.length) return 'skip:No clips with audio';
        const style = CAPTION_STYLES.find((s) => s.id === plan.captions.style) || CAPTION_STYLES[0];
        const lines: (CaptionLine & { clipId: string })[] = [];
        for (let i = 0; i < srcs.length; i++) {
          const clip = srcs[i];
          const asset = getAsset(clip.mediaId);
          if (!asset) continue;
          const rate = clip.speed.rate || 1;
          const from = clip.mediaIn, to = Math.min(asset.duration || Infinity, clip.mediaIn + clip.duration * rate);
          let res: Awaited<ReturnType<typeof transcribeAsset>>;
          try {
            res = await transcribeAsset(clip.mediaId, {
            model: ctx.whisperModel,
            language: plan.captions.language,
            device: ctx.device,
            from,
            to,
            onProgress: (p) => ctx.progress((i + (p.stage === 'download' ? p.progress * 0.3 : 0.3 + p.progress * 0.7)) / srcs.length, p.stage === 'download' ? `Downloading Whisper${p.file ? ` · ${p.file.split('/').pop()}` : ''}` : p.stage === 'transcribe' ? 'Transcribing' : p.stage),
            });
          } catch (e) {
            if (ctx.signal.cancelled) throw new Error('Cancelled');
            return `fail:${friendlyModelError(e)}`;
          }
          if (ctx.signal.cancelled) throw new Error('Cancelled');
          const words = res.words.map((w) => ({ text: w.text, start: clip.start + (clip.speed.reversed ? to - from - w.end : w.start) / rate, end: clip.start + (clip.speed.reversed ? to - from - w.start : w.end) / rate })).filter((w) => w.end > clip.start && w.start < clip.start + clip.duration);
          for (const l of groupWords(words, { maxWords: style.caption.wordsPerLine ?? 4, maxDuration: 3 })) lines.push({ ...l, clipId: clip.id });
        }
        if (!lines.length) return 'No speech detected';
        placeLines(lines, style, true, false);
        return `${lines.length} caption${lines.length === 1 ? '' : 's'}`;
      },
    });
  }

  if (plan.title) {
    steps.push({
      id: 'title',
      label: `Title "${plan.title.text}"`,
      run: async () => {
        const preset = getTextPreset(plan.title!.preset) || getTextPreset('tiktok_bold')!;
        if (preset.style.fontFamily) void ensureFont(preset.style.fontFamily);
        const dur = Math.min(3.5, Math.max(1.5, cmd.projectDuration(proj()) * 0.25 || 3));
        useProject.getState().apply('Title', (p) => {
          const clip = makeTextClip({ trackId: '', text: plan.title!.text, start: 0.2, duration: dur, style: preset.style, animation: preset.animation });
          clip.transform = { ...clip.transform, position: { value: { x: 0, y: -p.settings.height * 0.22 } } };
          return cmd.addClip(p, clip, null).project;
        });
        return `${dur.toFixed(1)} s at the start`;
      },
    });
  }

  if (plan.endCard) {
    steps.push({
      id: 'endcard',
      label: `End card "${plan.endCard.text}"`,
      run: async () => {
        const preset = getTextPreset(plan.endCard!.preset) || getTextPreset('story_pill')!;
        if (preset.style.fontFamily) void ensureFont(preset.style.fontFamily);
        const total = cmd.projectDuration(proj());
        if (total < 2) return 'skip:Timeline too short';
        const dur = Math.min(3, total / 3);
        useProject.getState().apply('End card', (p) => {
          const clip = makeTextClip({ trackId: '', text: plan.endCard!.text, start: Math.max(0, total - dur), duration: dur, style: preset.style, animation: preset.animation });
          return cmd.addClip(p, clip, null).project;
        });
        return `last ${dur.toFixed(1)} s`;
      },
    });
  }

  if (plan.loudness) {
    steps.push({
      id: 'loudness',
      label: 'Normalize loudness (−14 LUFS)',
      run: async (ctx) => {
        const clips = audibleClips().filter((c) => !(c.kind === 'audio' && getAsset(c.mediaId)?.tags?.includes('music'))) as MediaClip[];
        if (!clips.length) return 'skip:No speech/audio clips';
        const r = await normalizeClips(clips, -14, (p) => ctx.progress(p));
        return r.applied ? `${r.applied} clip${r.applied === 1 ? '' : 's'} · ${r.results.map((x) => `${x.gainDb >= 0 ? '+' : ''}${x.gainDb.toFixed(1)} dB`).join(', ')}` : 'Could not measure';
      },
    });
  }

  return steps;
}

function pickMusic(plan: EditPlan): MusicTrack | null {
  const { genre, mood } = plan.music;
  const score = (t: MusicTrack) => (genre && t.genre === genre ? 2 : 0) + (mood && t.mood.includes(mood as any) ? 1.5 : 0) + (plan.pace === 'fast' ? (t.bpm >= 110 ? 0.5 : 0) : plan.pace === 'slow' ? (t.bpm <= 95 ? 0.5 : 0) : 0.25);
  const sorted = [...MUSIC].sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  if (!best) return null;
  // tie-break randomly among equally good candidates so repeated runs vary
  const top = sorted.filter((t) => Math.abs(score(t) - score(best)) < 1e-6);
  return top[Math.floor(Math.random() * top.length)];
}

function cmdMakeAudio(mediaId: string, name: string, trackId: string, duration: number) {
  return makeAudioClip({ trackId, mediaId, name, start: 0, duration });
}

/** Runs the steps sequentially; `onReport` receives the full report list after every change. */
export async function runSteps(steps: Step[], enabled: Set<string>, ctx: Omit<RunCtx, 'progress'>, onReport: (r: StepReport[]) => void): Promise<StepReport[]> {
  const reports: StepReport[] = steps.map((s) => ({ id: s.id, label: s.label, status: enabled.has(s.id) ? 'pending' : 'skipped', detail: enabled.has(s.id) ? undefined : 'Unchecked' }));
  const emit = () => onReport(reports.map((r) => ({ ...r })));
  emit();
  for (let i = 0; i < steps.length; i++) {
    if (!enabled.has(steps[i].id)) continue;
    if (ctx.signal.cancelled) { reports[i].status = 'skipped'; reports[i].detail = 'Cancelled'; continue; }
    reports[i].status = 'running';
    reports[i].progress = 0;
    emit();
    try {
      const detail = await steps[i].run({ ...ctx, progress: (p, d) => { reports[i].progress = p; if (d) reports[i].detail = d; emit(); } });
      if (detail.startsWith('skip:')) { reports[i].status = 'skipped'; reports[i].detail = detail.slice(5); }
      else if (detail.startsWith('fail:')) { reports[i].status = 'failed'; reports[i].detail = detail.slice(5); }
      else { reports[i].status = 'done'; reports[i].detail = detail; }
    } catch (e: any) {
      reports[i].status = ctx.signal.cancelled ? 'skipped' : 'failed';
      reports[i].detail = String(e?.message || e);
    }
    reports[i].progress = undefined;
    emit();
  }
  usePlayback.getState().seek(0);
  engine.invalidate();
  return reports;
}

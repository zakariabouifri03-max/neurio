import React, { useMemo, useRef, useState } from 'react';
import { Sparkles, Scissors, Crop, Wand2, Subtitles, Activity, Music, Volume2, UserRoundX, Star, Flame, Image as ImageIcon, Info } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { Slider, SelectRow, Toggle, ColorRow } from '../common';
import { useProject, getSelectedClips, patchClip, useSelectedClip } from '@/core/store';
import { toast, useUI } from '@/core/uiStore';
import type { Clip, VideoClip, ImageClip, AudioClip, VisualClip } from '@/core/types';
import * as cmd from '@/core/commands';
import { autoColor } from '@/ai/autoColor';
import { analyzeReframe } from '@/ai/reframe';
import { planSilenceRemoval, applySilenceRemoval, addBeatMarkersForClip, beatSyncClips, smartTrimClip, markHighlights } from '@/ai/edits';
import { detectHighlights } from '@/ai/highlights';
import { loadSegmenter, useSegmentation, segmentationSupported, dropMaskCache } from '@/ai/segmentation';
import { captionsAvailability } from '@/ai/captions';
import { useMedia } from '@/engine/MediaManager';
import { engine } from '@/engine/PlaybackEngine';
import { formatDuration } from '@/core/util';
import { Card, Busy } from './aiCommon';
import { VoiceOverCard, TranslateCaptionsCard, SceneDetectCard, LoudnessCard, FillerWordsCard, FaceBlurCard } from './AIToolsExtra';

type Target = VideoClip | AudioClip | ImageClip;
const isVideo = (c: Clip | null): c is VideoClip => !!c && c.kind === 'video';
const isVisual = (c: Clip | null): c is VideoClip | ImageClip => !!c && (c.kind === 'video' || c.kind === 'image');
const hasAudio = (c: Clip | null): c is VideoClip | AudioClip => !!c && ((c.kind === 'video' && c.hasAudio !== false) || c.kind === 'audio');

export function AIPanel() {
  const clip = useSelectedClip();
  const selection = useProject((s) => s.selection);
  const project = useProject((s) => s.project)!;
  const seg = useSegmentation();
  const assets = useMedia((s) => s.assets);
  const setLeft = useUI((s) => s.setLeftPanel);
  const setRight = useUI((s) => s.setRightPanel);
  const [busy, setBusy] = useState<Record<string, { label: string; progress: number }>>({});
  const cancels = useRef<Record<string, { cancelled: boolean }>>({});
  const start = (k: string, label: string) => {
    cancels.current[k] = { cancelled: false };
    setBusy((b) => ({ ...b, [k]: { label, progress: 0 } }));
    return cancels.current[k];
  };
  const prog = (k: string, p: number, label?: string) => setBusy((b) => ({ ...b, [k]: { label: label ?? b[k]?.label ?? '', progress: p } }));
  const end = (k: string) => setBusy((b) => { const n = { ...b }; delete n[k]; return n; });
  const cancel = (k: string) => { if (cancels.current[k]) cancels.current[k].cancelled = true; end(k); };

  // ---------- options ----------
  const [silenceDb, setSilenceDb] = useState(-38);
  const [silenceMin, setSilenceMin] = useState(0.5);
  const [jumpMode, setJumpMode] = useState(false);
  const [reframeMode, setReframeMode] = useState<'auto' | 'face' | 'motion'>('auto');
  const [reframeResp, setReframeResp] = useState(0.4);
  const [hlCount, setHlCount] = useState(4);
  const [hlLen, setHlLen] = useState(4);
  const [beatEvery, setBeatEvery] = useState(2);
  const [plan, setPlan] = useState<{ ranges: number; removed: number; plans: Awaited<ReturnType<typeof planSilenceRemoval>> } | null>(null);
  const segSup = useMemo(() => segmentationSupported(), []);
  const capAvail = useMemo(() => captionsAvailability(), [selection]);
  const imageAssets = Object.values(assets).filter((a) => a.type === 'image' && !a.isProxy);

  const targets = (pred: (c: Clip | null) => boolean) => {
    const sel = getSelectedClips().filter(pred) as Target[];
    return sel;
  };
  const needSel = (what: string) => toast(`Select ${what} first`, 'info');

  // ---------- actions ----------
  const runSilence = async (apply: boolean) => {
    const ts = targets(hasAudio);
    if (!ts.length) return needSel('a clip with audio');
    const k = 'silence';
    const sig = start(k, 'Analyzing audio…');
    try {
      const plans = await planSilenceRemoval(ts, { thresholdDb: jumpMode ? silenceDb + 6 : silenceDb, minSilence: jumpMode ? Math.min(silenceMin, 0.3) : silenceMin, padding: jumpMode ? 0.03 : 0.08, onProgress: (p) => prog(k, p) });
      if (sig.cancelled) return;
      const ranges = plans.reduce((a, p) => a + p.ranges.length, 0), removed = plans.reduce((a, p) => a + p.removed, 0);
      setPlan({ ranges, removed, plans });
      if (!ranges) toast('No silences found', 'info', 'Try a higher threshold or shorter minimum length.');
      else if (apply) {
        const n = applySilenceRemoval(plans, jumpMode ? 'Jump cut' : 'Remove silences');
        toast(`${n} cut${n === 1 ? '' : 's'} made`, 'success', `Removed ${formatDuration(removed)} of silence.`);
        setPlan(null);
      }
    } catch (e: any) {
      toast('Analysis failed', 'error', String(e?.message || e));
    } finally {
      end(k);
    }
  };

  const runAutoColor = async () => {
    const ts = targets(isVisual) as (VideoClip | ImageClip)[];
    if (!ts.length) return needSel('a video or image clip');
    const k = 'color';
    start(k, 'Analyzing frame…');
    try {
      let n = 0;
      for (const c of ts) {
        const res = await autoColor(c);
        prog(k, ++n / ts.length);
        if (!res) continue;
        patchClip(c.id, 'Auto color', (x) => ({ grade: { ...(x as VisualClip).grade, adjustments: { ...(x as VisualClip).grade.adjustments, ...Object.fromEntries(Object.entries(res.adjustments).map(([kk, v]) => [kk, { value: v }])) }, whiteBalance: res.whiteBalance } }) as any, false);
      }
      toast('Auto color applied', 'success');
      setRight('adjust');
    } finally {
      end(k);
    }
  };

  const runReframe = async () => {
    const ts = targets(isVisual) as (VideoClip | ImageClip)[];
    if (!ts.length) return needSel('a video or image clip');
    const k = 'reframe';
    const sig = start(k, 'Tracking subject…');
    try {
      for (const c of ts) {
        const res = await analyzeReframe(c, { canvas: project.settings, mode: reframeMode, responsiveness: reframeResp, onProgress: (p) => prog(k, p), signal: sig });
        if (sig.cancelled) return;
        if (!res) {
          toast('Reframe unavailable for this clip', 'error', reframeMode === 'face' ? seg.error || 'Face model could not be loaded.' : 'Media has no dimensions yet.');
          continue;
        }
        patchClip(c.id, 'Auto reframe', (x) => {
          const t = (x as VisualClip).transform;
          return { transform: { ...t, scale: { value: { x: res.scale, y: res.scale } }, position: res.keyframes.length > 1 ? { value: res.keyframes[0].value, keyframes: res.keyframes } : { value: res.keyframes[0]?.value ?? { x: 0, y: 0 } } } } as any;
        }, false);
        toast(`Reframed (${res.method === 'face' ? 'face tracking' : res.method === 'person' ? 'person tracking' : 'motion-based'})`, 'success', res.note);
      }
      setRight('keyframes');
    } finally {
      end(k);
    }
  };

  const runHighlights = async (mode: 'mark' | 'trim') => {
    const ts = targets(isVideo) as VideoClip[];
    if (!ts.length) return needSel('a video clip');
    const k = 'hl';
    const sig = start(k, 'Scoring moments…');
    try {
      for (const c of ts) {
        if (mode === 'trim') {
          const r = await smartTrimClip(c, { count: hlCount, windowSec: hlLen, onProgress: (p) => prog(k, p), signal: sig });
          if (sig.cancelled) return;
          if (!r) toast('Could not analyze clip', 'error');
          else toast(`Kept ${r.kept.length} highlight${r.kept.length === 1 ? '' : 's'}`, 'success', r.note);
        } else {
          const r = await detectHighlights(c.mediaId, { count: hlCount, windowSec: hlLen, onProgress: (p) => prog(k, p), signal: sig });
          if (sig.cancelled) return;
          if (!r) toast('Could not analyze clip', 'error');
          else {
            const n = markHighlights(c, r.highlights);
            toast(`${n} highlight marker${n === 1 ? '' : 's'} added`, 'success', r.note);
          }
        }
      }
    } finally {
      end(k);
    }
  };

  const runBeats = async () => {
    const ts = targets(hasAudio) as (VideoClip | AudioClip)[];
    if (!ts.length) return needSel('a music/audio clip');
    const k = 'beats';
    start(k, 'Detecting beats…');
    try {
      for (const c of ts) {
        const r = await addBeatMarkersForClip(c, { every: 1 });
        if (!r) toast('No decodable audio', 'error');
        else toast(`${r.count} beats · ≈${r.bpm} BPM`, 'success', 'Beat markers added to the ruler. Snapping follows them.');
      }
    } finally {
      end(k);
    }
  };
  const runBeatSync = () => {
    const ts = getSelectedClips().filter((c) => c.kind !== 'audio');
    if (!ts.length) return needSel('the visual clips to cut');
    const n = beatSyncClips(ts.map((c) => c.id), { everyBeats: beatEvery });
    if (n) toast(`${n} clip${n === 1 ? '' : 's'} snapped to the beat`, 'success');
  };

  const enableSegmentation = async (c: VideoClip | ImageClip, background: 'transparent' | 'blur' | 'color' | 'image') => {
    const ok = await loadSegmenter();
    if (!ok) return toast('Background removal unavailable', 'error', useSegmentation.getState().error || segSup.reason);
    patchClip(c.id, 'Remove background', (x) => ({ segmentation: { enabled: true, background, color: (x as VisualClip).segmentation?.color || '#00ff00', blur: (x as VisualClip).segmentation?.blur || 12, imageMediaId: (x as VisualClip).segmentation?.imageMediaId } }) as any, false);
    dropMaskCache(c.id);
    engine.invalidate?.();
  };

  const vclip = isVisual(clip) ? clip : null;
  const segOn = !!vclip?.segmentation?.enabled;

  return (
    <>
      <PanelHeader title="AI tools" sub={clip ? clip.name : 'Select a clip'} />
      <div className="panel-body scroll">
        <div className="muted small" style={{ marginBottom: 8, display: 'flex', gap: 6 }}><Info size={14} style={{ flexShrink: 0 }} /> Everything runs in your browser. Tools that need a model download say so and report when they can't run — nothing is simulated.</div>

        <Card icon={<Scissors size={16} />} title={jumpMode ? 'Jump cut' : 'Silence removal'} desc="Finds quiet gaps in speech and cuts them out, closing the gaps on every track." badge="DSP">
          <Toggle label="Jump-cut mode (tighter, pauses too)" value={jumpMode} onChange={setJumpMode} />
          <Slider label="Threshold" value={silenceDb} min={-60} max={-20} step={1} unit="dB" onChange={setSilenceDb} />
          <Slider label="Min silence" value={silenceMin} min={0.1} max={2} step={0.05} unit="s" onChange={setSilenceMin} />
          {busy.silence ? <Busy {...busy.silence} onCancel={() => cancel('silence')} /> : (
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="btn sm" onClick={() => runSilence(false)} disabled={!hasAudio(clip)}>Preview</button>
              <button className="btn sm primary" onClick={() => runSilence(true)} disabled={!hasAudio(clip)}>Remove silences</button>
            </div>
          )}
          {plan && <div className="muted small" style={{ marginTop: 6 }}>{plan.ranges} silent range{plan.ranges === 1 ? '' : 's'} · {formatDuration(plan.removed)} would be removed. {plan.ranges > 0 && <button className="link" onClick={() => { applySilenceRemoval(plan.plans, jumpMode ? 'Jump cut' : 'Remove silences'); setPlan(null); }}>Apply</button>}</div>}
        </Card>

        <Card icon={<Subtitles size={16} />} title="Auto captions" desc="Speech-to-text with word timing (OpenAI Whisper, local)." badge="Model" status={capAvail.ok ? { kind: 'ok', text: `Available · ${capAvail.webgpu ? 'WebGPU' : 'CPU'} · model downloads on first use` } : { kind: 'off', text: capAvail.reason || 'Unavailable' }}>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setLeft('captions')}>Open captions tool →</button>
        </Card>

        <Card icon={<UserRoundX size={16} />} title="Remove background" desc="Person segmentation (MediaPipe) — no green screen needed. Replace with blur, color or an image." badge="Model" status={seg.status === 'ready' ? { kind: 'ok', text: `Model loaded · ${seg.fps ? seg.fps + ' fps' : 'ready'}` } : seg.status === 'loading' ? { kind: 'warn', text: 'Loading model…' } : seg.status === 'unavailable' ? { kind: 'off', text: `Unavailable: ${seg.error}` } : segSup.ok ? { kind: 'warn', text: 'Model not loaded yet (≈250 KB download on first use)' } : { kind: 'off', text: segSup.reason || 'Unavailable' }}>
          {!vclip && <div className="muted small" style={{ marginTop: 6 }}>Select a video or image clip.</div>}
          {vclip && !segOn && (
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn sm primary" onClick={() => enableSegmentation(vclip, 'transparent')} disabled={!segSup.ok}>Remove background</button>
              <button className="btn sm" onClick={() => enableSegmentation(vclip, 'blur')} disabled={!segSup.ok}>Blur background</button>
            </div>
          )}
          {vclip && segOn && (
            <div style={{ marginTop: 6 }}>
              <SelectRow label="Background" value={vclip.segmentation!.background} options={[{ value: 'transparent', label: 'Transparent (show tracks below)' }, { value: 'blur', label: 'Blurred original' }, { value: 'color', label: 'Solid color' }, { value: 'image', label: 'Image from library' }]} onChange={(v) => patchClip(vclip.id, 'Background', (x) => ({ segmentation: { ...(x as VisualClip).segmentation!, background: v } }) as any, false)} />
              {vclip.segmentation!.background === 'blur' && <Slider label="Blur" value={vclip.segmentation!.blur} min={1} max={40} step={1} onChange={(v) => patchClip(vclip.id, 'Background blur', (x) => ({ segmentation: { ...(x as VisualClip).segmentation!, blur: v } }) as any)} />}
              {vclip.segmentation!.background === 'color' && <ColorRow label="Color" value={vclip.segmentation!.color} onChange={(v) => patchClip(vclip.id, 'Background color', (x) => ({ segmentation: { ...(x as VisualClip).segmentation!, color: v || '#000000' } }) as any)} />}
              {vclip.segmentation!.background === 'image' && (
                <SelectRow label="Image" value={vclip.segmentation!.imageMediaId || ''} options={[{ value: '', label: imageAssets.length ? 'Choose…' : 'No images imported' }, ...imageAssets.map((a) => ({ value: a.id, label: a.name }))]} onChange={(v) => patchClip(vclip.id, 'Background image', (x) => ({ segmentation: { ...(x as VisualClip).segmentation!, imageMediaId: v || undefined } }) as any, false)} />
              )}
              <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => { patchClip(vclip.id, 'Disable segmentation', { segmentation: null } as any, false); dropMaskCache(vclip.id); engine.invalidate?.(); }}>Turn off</button>
              <div className="muted small" style={{ marginTop: 4 }}>Trained for people (selfie segmenter). Objects/animals are not supported. Also applied in export.</div>
            </div>
          )}
        </Card>

        <Card icon={<Crop size={16} />} title="Auto reframe" desc={`Fit ${project.settings.width}×${project.settings.height} by tracking the subject (face → person → motion).`} badge="Model / heuristic" status={seg.faceStatus === 'ready' ? { kind: 'ok', text: 'Face model loaded' } : seg.faceStatus === 'unavailable' ? { kind: 'warn', text: `Face model unavailable (${seg.error}) → motion fallback` } : { kind: 'warn', text: 'Face model downloads on first use (≈230 KB)' }}>
          <SelectRow label="Tracking" value={reframeMode} options={[{ value: 'auto', label: 'Auto (face → person → motion)' }, { value: 'face', label: 'Faces only (fail if none)' }, { value: 'motion', label: 'Motion only (no model)' }]} onChange={(v) => setReframeMode(v as any)} />
          <Slider label="Responsiveness" value={reframeResp} min={0} max={1} step={0.05} format={(v) => (v < 0.33 ? 'Smooth' : v < 0.66 ? 'Balanced' : 'Snappy')} onChange={setReframeResp} />
          {busy.reframe ? <Busy {...busy.reframe} onCancel={() => cancel('reframe')} /> : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={runReframe} disabled={!isVisual(clip)}>Reframe selected</button>}
        </Card>

        <Card icon={<Wand2 size={16} />} title="Auto color" desc="Balances exposure, contrast and white balance from a histogram/gray-world analysis." badge="DSP">
          {busy.color ? <Busy {...busy.color} /> : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={runAutoColor} disabled={!isVisual(clip)}>Auto color</button>}
        </Card>

        <VoiceOverCard />
        <TranslateCaptionsCard />
        <FaceBlurCard />
        <SceneDetectCard />
        <LoudnessCard />
        <FillerWordsCard />

        <Card icon={<Flame size={16} />} title="Highlights & smart trim" desc="Ranks moments by loudness, onsets and motion. Mark them or keep only the best parts." badge="Heuristic">
          <Slider label="Highlights" value={hlCount} min={1} max={10} step={1} onChange={setHlCount} />
          <Slider label="Length" value={hlLen} min={2} max={15} step={1} unit="s" onChange={setHlLen} />
          {busy.hl ? <Busy {...busy.hl} onCancel={() => cancel('hl')} /> : (
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button className="btn sm" onClick={() => runHighlights('mark')} disabled={!isVideo(clip)}><Star size={12} /> Mark</button>
              <button className="btn sm primary" onClick={() => runHighlights('trim')} disabled={!isVideo(clip)}>Smart trim</button>
            </div>
          )}
        </Card>

        <Card icon={<Music size={16} />} title="Beat detection & sync" desc="Finds beats in music (energy flux), adds markers, then cuts selected clips on the beat." badge="DSP">
          {busy.beats ? <Busy {...busy.beats} /> : <button className="btn sm" style={{ marginTop: 6 }} onClick={runBeats} disabled={!hasAudio(clip)}><Activity size={12} /> Detect beats on selected audio</button>}
          <Slider label="Cut every" value={beatEvery} min={1} max={8} step={1} format={(v) => `${v} beat${v > 1 ? 's' : ''}`} onChange={setBeatEvery} />
          <button className="btn sm primary" onClick={runBeatSync} disabled={!selection.length || !project.markers.some((m) => m.kind === 'beat')}>Sync selected clips to beats</button>
        </Card>

        <Card icon={<Volume2 size={16} />} title="Noise reduction & voice enhance" desc="Spectral gate + high-pass + presence EQ (AudioWorklet). Found in the Audio inspector." badge="DSP">
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => (hasAudio(clip) ? setRight('audio') : needSel('an audio clip'))}>Open audio inspector →</button>
        </Card>

        <Card icon={<Activity size={16} />} title="Stabilization" desc="Block-matching motion analysis with smoothing; three strengths and crop preview." badge="DSP">
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => (isVideo(clip) ? setRight('stabilize') : needSel('a video clip'))}>Open stabilizer →</button>
        </Card>

        <Card icon={<ImageIcon size={16} />} title="Not available in-browser" desc="Generative upscaling, object removal, lip-sync, voice cloning and video enhancement need server-side GPU models. Neurio Studio doesn't fake them; they will appear here when a processing backend is configured." status={{ kind: 'off', text: 'Unavailable — no backend configured' }} />

        <div className="muted small" style={{ marginTop: 8, display: 'flex', gap: 6 }}><Sparkles size={14} style={{ flexShrink: 0 }} /> Models: Whisper (speech-to-text), Kokoro-82M (voice-over), OPUS-MT (translation) — ONNX via Hugging Face; MediaPipe selfie segmentation & BlazeFace. Downloads are cached by the browser.</div>
      </div>
    </>
  );
}

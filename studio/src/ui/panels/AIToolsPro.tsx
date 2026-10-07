/**
 * "Pro" AI cards: prompt-to-edit director, face tracking, watermark removal.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, ScanFace, Eraser, Crosshair, RotateCcw, Play, KeyRound, ListChecks } from 'lucide-react';
import { Slider, SelectRow, Toggle } from '../common';
import { Card, Busy, useBusy } from './aiCommon';
import { useProject, useSelectedClip, usePlayback } from '@/core/store';
import { toast, useUI } from '@/core/uiStore';
import type { Clip, VideoClip, ImageClip, VisualClip, Project } from '@/core/types';
import * as cmd from '@/core/commands';
import { engine } from '@/engine/PlaybackEngine';
import { getAsset } from '@/engine/MediaManager';
import { useSegmentation, segmentationSupported } from '@/ai/segmentation';
import { analyzeFaces, type Track as FaceTrack } from '@/ai/faceblur';
import { applyFollowFace, applyAttachToFace, applyTrackedMask, overlayCandidates, describeTrack } from '@/ai/faceTrack';
import { detectWatermarks, applyWatermarkRemoval, canvasRegionToClip, type WatermarkCandidate, type Region, type RemoveMode } from '@/ai/watermark';
import { buildMessages, parsePlan, rulesPlan, projectContext, describePlan, type EditPlan } from '@/ai/director';
import { buildSteps, runSteps, type Step, type StepReport } from '@/ai/directorApply';
import { LOCAL_MODELS, API_PRESETS, loadApiConfig, saveApiConfig, chatLocal, chatApi, cancelLocalLlm, localLlmAvailability, type ApiConfig } from '@/ai/llm';
import { WHISPER_MODELS, captionsAvailability } from '@/ai/captions';

const isVisual = (c: Clip | null): c is VideoClip | ImageClip => !!c && (c.kind === 'video' || c.kind === 'image');

/* ------------------------------------------------------------------ AI director */
type Backend = 'rules' | 'local' | 'api';
const EXAMPLES = [
  'Make a 30s TikTok with the best moments, yellow captions, energetic trap music and zoom transitions',
  'Dir liya montage 9sir 20 thania l reels, zid lktaba b l3arbiya o musika hadya',
  'Vidéo YouTube 16:9 : enlève les silences, corrige les couleurs, titre "Mon voyage à Fès" et musique lo-fi douce',
  'Podcast clip: jump-cut the pauses, clean white captions, normalize the audio, end card "Subscribe for more"',
];

export function DirectorCard() {
  const project = useProject((s) => s.project!);
  const [brief, setBrief] = useState(() => localStorage.getItem('neurio.director.brief') || '');
  const [backend, setBackend] = useState<Backend>(() => (localStorage.getItem('neurio.director.backend') as Backend) || 'rules');
  const [localModel, setLocalModel] = useState(() => localStorage.getItem('neurio.director.local') || LOCAL_MODELS[1].id);
  const [api, setApi] = useState<ApiConfig>(() => loadApiConfig());
  const [plan, setPlan] = useState<{ plan: EditPlan; steps: Step[]; source: string } | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [reports, setReports] = useState<StepReport[] | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const snapshot = useRef<Project | null>(null);
  const { busy, start, prog, end, modelProg, sig } = useBusy();
  const abort = useRef<AbortController | null>(null);
  const localAv = useMemo(() => localLlmAvailability(), []);
  useEffect(() => localStorage.setItem('neurio.director.brief', brief), [brief]);
  useEffect(() => localStorage.setItem('neurio.director.backend', backend), [backend]);
  useEffect(() => localStorage.setItem('neurio.director.local', localModel), [localModel]);
  const updateApi = (patch: Partial<ApiConfig>) => setApi((a) => { const n = { ...a, ...patch }; saveApiConfig(n); return n; });
  const ctx = useMemo(() => projectContext(project), [project]);

  const makePlan = async () => {
    const text = brief.trim();
    if (!text) return toast('Describe the edit you want', 'info', 'e.g. "30s TikTok, best moments, yellow captions, trap music".');
    setReports(null);
    setRaw(null);
    let p: EditPlan;
    let source = '';
    if (backend === 'rules') {
      p = rulesPlan(text, ctx);
      source = 'Keyword rules (no model)';
    } else {
      const s = start(backend === 'local' ? 'Loading model…' : 'Asking the model…');
      try {
        const messages = buildMessages(text, ctx, { fullCatalog: backend === 'api' });
        let out: string;
        if (backend === 'local') {
          if (!localAv.ok) throw new Error(localAv.reason);
          out = await chatLocal(messages, { model: localModel, onProgress: modelProg('Generating plan…') });
          source = `${LOCAL_MODELS.find((m) => m.id === localModel)?.name || localModel} (local)`;
        } else {
          abort.current = new AbortController();
          out = await chatApi(messages, api, { signal: abort.current.signal });
          source = `${API_PRESETS.find((x) => x.id === api.preset)?.name || 'API'} · ${api.model}`;
        }
        if (s.cancelled) return;
        setRaw(out);
        try {
          p = parsePlan(out);
        } catch (e) {
          // fall back to rules so the user still gets something, but say so
          p = rulesPlan(text, ctx);
          p.notes.unshift(`${(e as Error).message} Showing the keyword-rules plan instead.`);
          source += ' → fell back to keyword rules';
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || s.cancelled) return;
        toast('Could not plan the edit', 'error', String(e?.message || e));
        return;
      } finally {
        end();
      }
    }
    const steps = buildSteps(p);
    setPlan({ plan: p, steps, source });
    setEnabled(new Set(steps.map((x) => x.id)));
    if (!steps.length) toast('Nothing actionable in that brief', 'info', p.notes[0] || 'Try mentioning captions, music, cuts, colors, duration or platform.');
  };

  const apply = async () => {
    if (!plan) return;
    const s = start('Applying…');
    snapshot.current = useProject.getState().project;
    const whisperModel = localStorage.getItem('neurio.whisper') || WHISPER_MODELS[1].id;
    const device = captionsAvailability().webgpu ? 'webgpu' : 'wasm';
    try {
      const r = await runSteps(plan.steps, enabled, { signal: s, whisperModel, device }, (rep) => {
        setReports(rep);
        const running = rep.find((x) => x.status === 'running');
        const doneCount = rep.filter((x) => x.status !== 'pending' && x.status !== 'running').length;
        prog((doneCount + (running?.progress ?? 0)) / Math.max(1, rep.length), running ? `${running.label}${running.detail ? ` · ${running.detail}` : ''}` : 'Finishing…');
      });
      const done = r.filter((x) => x.status === 'done').length, failed = r.filter((x) => x.status === 'failed').length;
      toast(`AI edit applied: ${done} step${done === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`, failed ? 'info' : 'success', failed ? 'See the step list for details.' : 'Review the result — every change is editable. "Revert" restores the project as it was.');
      engine.invalidate();
    } finally {
      end();
    }
  };
  const revert = () => {
    const snap = snapshot.current;
    if (!snap) return;
    useProject.getState().apply('Revert AI edit', () => snap);
    snapshot.current = null;
    setReports(null);
    usePlayback.getState().seek(0);
    engine.invalidate();
    toast('Project restored', 'success');
  };
  const cancel = () => { sig.current.cancelled = true; abort.current?.abort(); cancelLocalLlm(); end(); };

  const status = backend === 'rules'
    ? { kind: 'ok' as const, text: 'Keyword rules · offline · no model — understands EN / FR / AR / Darija keywords' }
    : backend === 'local'
      ? localAv.ok ? { kind: 'warn' as const, text: `Local model · ${LOCAL_MODELS.find((m) => m.id === localModel)?.size} download on first use · ${localAv.webgpu ? 'WebGPU' : 'CPU (slow)'}` } : { kind: 'off' as const, text: localAv.reason || 'Unavailable' }
      : api.key || api.preset === 'ollama' ? { kind: 'ok' as const, text: `API · ${api.model} — requests go straight from your browser to the provider` } : { kind: 'warn' as const, text: 'Enter an API key (stored only in this browser)' };

  return (
    <Card icon={<Clapperboard size={16} />} title="AI director — describe your edit" desc="Write what you want; the director plans the edit and applies it with the real tools (cuts, captions, music, grades, transitions…). You review the plan first." badge="Prompt" status={status}>
      <textarea className="input" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder='e.g. "30s TikTok with the best moments, yellow captions, trap music, zoom transitions and a title «Day in Fès»"' style={{ width: '100%', resize: 'vertical', marginTop: 6 }} />
      <div className="chips scroll" style={{ marginTop: 4 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" onClick={() => setBrief(ex)} title={ex}>{ex.slice(0, 34)}…</button>
        ))}
      </div>
      <SelectRow label="Brain" value={backend} options={[{ value: 'rules', label: 'Keyword rules (offline, no model)' }, { value: 'local', label: 'Local model (in-browser LLM)' }, { value: 'api', label: 'API key (OpenAI-compatible)' }]} onChange={(v) => setBackend(v as Backend)} />
      {backend === 'local' && (
        <SelectRow label="Model" value={localModel} options={LOCAL_MODELS.map((m) => ({ value: m.id, label: `${m.name} · ${m.size} · ${m.note}` }))} onChange={setLocalModel} />
      )}
      {backend === 'api' && (
        <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
          <SelectRow label="Provider" value={api.preset} options={API_PRESETS.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => { const p = API_PRESETS.find((x) => x.id === v)!; updateApi({ preset: v, baseUrl: p.baseUrl || api.baseUrl, model: p.model || api.model }); }} />
          <div className="row"><span className="label">Base URL</span><input className="input" value={api.baseUrl} onChange={(e) => updateApi({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" style={{ flex: 1 }} /></div>
          <div className="row"><span className="label">Model</span><input className="input" value={api.model} onChange={(e) => updateApi({ model: e.target.value })} placeholder="gpt-4o-mini" style={{ flex: 1 }} /></div>
          <div className="row"><span className="label"><KeyRound size={12} /> Key</span><input className="input" type="password" value={api.key} onChange={(e) => updateApi({ key: e.target.value })} placeholder="sk-…" style={{ flex: 1 }} autoComplete="off" /></div>
          <div className="muted small">Stored in this browser's localStorage only; sent as a Bearer token directly to the provider. {API_PRESETS.find((p) => p.id === api.preset)?.keyUrl && <a href={API_PRESETS.find((p) => p.id === api.preset)!.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a>}</div>
        </div>
      )}
      {busy ? <Busy {...busy} onCancel={cancel} /> : (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn sm primary" onClick={makePlan} disabled={!brief.trim()}><ListChecks size={13} /> Plan the edit</button>
          {plan && <button className="btn sm" onClick={apply} disabled={!enabled.size}><Play size={13} /> Apply {enabled.size} step{enabled.size === 1 ? '' : 's'}</button>}
          {snapshot.current && reports && <button className="btn sm ghost" onClick={revert} title="Restore the project exactly as it was before the AI edit"><RotateCcw size={13} /> Revert</button>}
        </div>
      )}
      {plan && (
        <div style={{ marginTop: 8 }}>
          <div className="small"><b>Plan</b> <span className="muted">· {plan.source}</span></div>
          {plan.plan.summary && <div className="small" style={{ marginTop: 2 }}>{plan.plan.summary}</div>}
          <div className="plan-steps">
            {plan.steps.map((s) => {
              const rep = reports?.find((r) => r.id === s.id);
              const st = rep?.status ?? (enabled.has(s.id) ? 'pending' : 'skipped');
              return (
                <label key={s.id} className="plan-step">
                  {!reports ? <input type="checkbox" checked={enabled.has(s.id)} onChange={(e) => setEnabled((set) => { const n = new Set(set); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} /> : <span className={`st ${st}`}>{st === 'done' ? '✓' : st === 'failed' ? '!' : st === 'skipped' ? '–' : ''}</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{s.label}</div>
                    {rep?.detail && <div className="detail">{rep.detail}</div>}
                    {rep?.status === 'running' && rep.progress !== undefined && <div className="progress" style={{ marginTop: 4 }}><div style={{ width: `${Math.round(rep.progress * 100)}%` }} /></div>}
                  </div>
                </label>
              );
            })}
            {!plan.steps.length && <div className="muted small">No actionable steps.</div>}
          </div>
          {plan.plan.notes.length > 0 && (
            <div className="muted small">{plan.plan.notes.map((n, i) => <div key={i}>• {n}</div>)}</div>
          )}
          {raw && <details style={{ marginTop: 4 }}><summary className="muted small" style={{ cursor: 'pointer' }}>Model output (JSON)</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{raw}</pre></details>}
        </div>
      )}
      {!plan && <div className="muted small" style={{ marginTop: 6 }}>{describePlanHint(ctx.videoClips.length)}</div>}
    </Card>
  );
}
const describePlanHint = (n: number) => (n ? 'Tip: mention the platform (TikTok / YouTube), a target length, captions (+ language), music style, color look, transitions, and a title in quotes.' : 'Add a video to the timeline first — the director edits what is on the timeline.');

/* ------------------------------------------------------------------ face tracking */
export function FaceTrackCard() {
  const clip = useSelectedClip();
  const project = useProject((s) => s.project!);
  const seg = useSegmentation();
  const sup = useMemo(() => segmentationSupported(), []);
  const [result, setResult] = useState<{ clipId: string; tracks: FaceTrack[]; frames: number } | null>(null);
  const [face, setFace] = useState(0);
  const [action, setAction] = useState<'follow' | 'attach' | 'mask'>('follow');
  const [zoom, setZoom] = useState(1.3);
  const [smooth, setSmooth] = useState(0.4);
  const [headroom, setHeadroom] = useState(0.12);
  const [targetId, setTargetId] = useState('');
  const [anchor, setAnchor] = useState<'above' | 'center' | 'below'>('above');
  const [scaleWith, setScaleWith] = useState(true);
  const [maskShape, setMaskShape] = useState<'circle' | 'rectangle'>('circle');
  const [invert, setInvert] = useState(false);
  const [pad, setPad] = useState(1.6);
  const { busy, start, prog, end } = useBusy();
  useEffect(() => { if (result && clip?.id !== result.clipId) setResult(null); }, [clip?.id]);
  const candidates = useMemo(() => (isVisual(clip) ? overlayCandidates(project, clip) : []), [project, clip?.id]);
  useEffect(() => { if (!candidates.find((c) => c.id === targetId)) setTargetId(candidates[0]?.id || ''); }, [candidates]);

  const analyze = async () => {
    if (!isVisual(clip)) return toast('Select a video or image clip', 'info');
    const sig = start('Detecting faces…');
    try {
      const r = await analyzeFaces(clip, { maxFaces: 4, sampleFps: 8, onProgress: (p) => prog(p), signal: sig });
      if (sig.cancelled) return;
      if (!r) return toast('Face detection unavailable', 'error', useSegmentation.getState().error || 'The face model could not be loaded (network needed on first use).');
      if (!r.tracks.length) { setResult({ clipId: clip.id, tracks: [], frames: r.frames }); return toast('No faces found', 'info', `Scanned ${r.frames} frames.`); }
      setResult({ clipId: clip.id, tracks: r.tracks, frames: r.frames });
      setFace(0);
      toast(`${r.tracks.length} face${r.tracks.length === 1 ? '' : 's'} tracked`, 'success', `${r.detections} detections in ${r.frames} frames.`);
    } finally {
      end();
    }
  };
  const tracks = result && clip?.id === result.clipId ? result.tracks : [];
  const tr = tracks[face];
  const run = () => {
    if (!isVisual(clip) || !tr) return;
    if (action === 'follow') {
      const r = applyFollowFace(clip, tr, { zoom, smoothing: smooth, headroom });
      toast('Camera follows the face', 'success', `${r.keyframes} position keyframes · scale ${r.scale.toFixed(2)}. Fine-tune in Keyframes.`);
      useUI.getState().setRightPanel('keyframes');
    } else if (action === 'attach') {
      const target = candidates.find((c) => c.id === targetId);
      if (!target) return toast('Pick a clip to attach', 'info', 'Add a text, sticker or image on another track overlapping this clip.');
      const r = applyAttachToFace(clip, tr, target, { anchor, scaleWithFace: scaleWith, smoothing: smooth });
      if (!r.keyframes) return toast('No overlap in time', 'info', 'The target clip does not overlap the face track.');
      toast(`"${target.name}" pinned to the face`, 'success', `${r.keyframes} keyframes written on the target clip.`);
      useProject.getState().select([target.id]);
      useUI.getState().setRightPanel('keyframes');
    } else {
      const r = applyTrackedMask(clip, tr, { shape: maskShape, invert, padding: pad });
      toast(invert ? 'Mask follows the face (inverted)' : 'Mask follows the face', 'success', `${r.keyframes} mask keyframes. Add effects/adjustments — they now apply ${invert ? 'around' : 'inside'} the face.`);
      useUI.getState().setRightPanel('mask');
    }
    engine.invalidate();
  };
  return (
    <Card icon={<Crosshair size={16} />} title="Face tracking" desc="Tracks a face through the clip and turns it into keyframes: follow it with the camera, pin text/stickers to it, or make a mask that follows it." badge="Model"
      status={seg.faceStatus === 'ready' ? { kind: 'ok', text: 'Face model loaded (MediaPipe BlazeFace)' } : seg.faceStatus === 'unavailable' ? { kind: 'off', text: `Unavailable: ${seg.error}` } : sup.ok ? { kind: 'warn', text: 'Face model downloads on first use (≈230 KB)' } : { kind: 'off', text: sup.reason || 'Unavailable' }}>
      {busy ? <Busy {...busy} onCancel={end} /> : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={analyze} disabled={!isVisual(clip) || !sup.ok}><ScanFace size={13} /> {tracks.length ? 'Re-analyze faces' : 'Analyze faces in selected clip'}</button>}
      {tracks.length > 0 && isVisual(clip) && (
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <SelectRow label="Face" value={String(face)} options={tracks.map((t, i) => ({ value: String(i), label: `Face ${i + 1} · ${describeTrack(clip, t, result!.frames)}` }))} onChange={(v) => setFace(parseInt(v))} />
          <div className="chips">
            {(['follow', 'attach', 'mask'] as const).map((a) => <button key={a} className={`chip ${action === a ? 'active' : ''}`} onClick={() => setAction(a)}>{a === 'follow' ? 'Camera follow' : a === 'attach' ? 'Pin a clip to it' : 'Tracking mask'}</button>)}
          </div>
          {action === 'follow' && (
            <>
              <Slider label="Zoom" value={zoom} min={1} max={2.2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setZoom} />
              <Slider label="Headroom" value={headroom} min={0} max={0.3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setHeadroom} />
              <Slider label="Smoothing" value={smooth} min={0} max={1} step={0.05} onChange={setSmooth} />
            </>
          )}
          {action === 'attach' && (
            <>
              <SelectRow label="Clip" value={targetId} options={candidates.length ? candidates.map((c) => ({ value: c.id, label: `${c.name} (${c.kind})` })) : [{ value: '', label: 'No overlapping text/sticker/image clip' }]} onChange={setTargetId} />
              <SelectRow label="Anchor" value={anchor} options={[{ value: 'above', label: 'Above the head' }, { value: 'center', label: 'On the face' }, { value: 'below', label: 'Below the chin' }]} onChange={(v) => setAnchor(v as any)} />
              <Toggle label="Scale with face size" value={scaleWith} onChange={setScaleWith} />
              <Slider label="Smoothing" value={smooth} min={0} max={1} step={0.05} onChange={setSmooth} />
            </>
          )}
          {action === 'mask' && (
            <>
              <SelectRow label="Shape" value={maskShape} options={[{ value: 'circle', label: 'Ellipse' }, { value: 'rectangle', label: 'Rectangle' }]} onChange={(v) => setMaskShape(v as any)} />
              <Slider label="Padding" value={pad} min={1} max={3} step={0.1} format={(v) => `${Math.round(v * 100)}%`} onChange={setPad} />
              <Toggle label="Invert (affect everything except the face)" value={invert} onChange={setInvert} />
            </>
          )}
          <button className="btn sm primary" onClick={run}>{action === 'follow' ? 'Follow this face' : action === 'attach' ? 'Pin clip to this face' : 'Create tracking mask'}</button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ watermark removal */
export function WatermarkCard() {
  const clip = useSelectedClip();
  const project = useProject((s) => s.project!);
  const [mode, setMode] = useState<RemoveMode>('fill');
  const [feather, setFeather] = useState(0.3);
  const [strength, setStrength] = useState(0.6);
  const [cands, setCands] = useState<{ clipId: string; list: WatermarkCandidate[]; note: string } | null>(null);
  const { busy, start, prog, end } = useBusy();
  useEffect(() => { if (cands && clip?.id !== cands.clipId) setCands(null); }, [clip?.id]);
  const existing = isVisual(clip) ? clip.effects.filter((e) => e.type === 'watermark').length : 0;

  const detect = async () => {
    if (!isVisual(clip)) return toast('Select a video clip', 'info');
    const sig = start('Scanning frames for static regions…');
    try {
      const r = await detectWatermarks(clip, { onProgress: (p) => prog(p), signal: sig });
      if (sig.cancelled) return;
      if (!r) return toast('Could not read this clip', 'error');
      setCands({ clipId: clip.id, list: r.candidates, note: r.note });
      if (!r.candidates.length) toast('No watermark found automatically', 'info', r.note);
    } finally {
      end();
    }
  };
  const applyRegion = (region: Region, label: string) => {
    if (!isVisual(clip)) return;
    applyWatermarkRemoval(clip, region, { mode, feather, strength, clone: { dx: 0, dy: region.h > region.w ? 0 : -(region.h * 1.2) } });
    engine.invalidate();
    toast(`Watermark remover applied (${label})`, 'success', 'Adjust region, feather and mode in the Effects panel — or add keyframes if the logo moves.');
    useUI.getState().setRightPanel('effects');
  };
  const draw = () => {
    if (!isVisual(clip)) return toast('Select a video or image clip', 'info');
    const c = clip;
    useUI.getState().set({
      regionPick: {
        label: 'Watermark',
        onPick: (r) => {
          const t = usePlayback.getState().time - c.start;
          const region = canvasRegionToClip(r, c as VisualClip, project.settings, getAsset(c.mediaId) ?? null, Math.max(0, t));
          applyRegion(region, 'drawn region');
        },
      },
    });
    toast('Draw a rectangle around the watermark on the preview', 'info');
  };
  const list = cands && clip?.id === cands.clipId ? cands.list : [];
  return (
    <Card icon={<Eraser size={16} />} title="Remove watermark / logo" desc="Covers a burnt-in logo with content-aware fill from its surroundings (or blur / pixelate / clone). Auto-detect finds static high-contrast regions in moving video." badge="GPU"
      status={{ kind: 'warn', text: 'Hides the mark using nearby pixels — it cannot recover what was underneath. Works best on plain or soft backgrounds.' }}>
      <SelectRow label="Method" value={mode} options={[{ value: 'fill', label: 'Content-aware fill' }, { value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'clone', label: 'Clone from above' }]} onChange={(v) => setMode(v as RemoveMode)} />
      <Slider label="Feather" value={feather} min={0} max={1} step={0.05} onChange={setFeather} />
      <Slider label="Strength" value={strength} min={0} max={1} step={0.05} onChange={setStrength} />
      {busy ? <Busy {...busy} onCancel={end} /> : (
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" onClick={draw} disabled={!isVisual(clip)}><Crosshair size={13} /> Draw region</button>
          <button className="btn sm" onClick={detect} disabled={!isVisual(clip) || clip.kind !== 'video'}><ScanFace size={13} /> Auto-detect</button>
        </div>
      )}
      {cands && clip?.id === cands.clipId && (
        <div style={{ marginTop: 8 }}>
          <div className="muted small">{cands.note}</div>
          {list.length > 0 && (
            <div className="region-list" style={{ display: 'grid', gap: 4, marginTop: 4 }}>
              {list.map((c, i) => (
                <button key={i} className="btn sm" onClick={() => applyRegion(c, `auto ${c.corner || 'region'}`)} title="Apply the remover to this region">
                  <span>{c.corner ? c.corner.replace('-', ' ') : 'region'} · {Math.round(c.w * 100)}×{Math.round(c.h * 100)}%</span>
                  <span className="muted">{Math.round(c.score * 100)}%</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {existing > 0 && <div className="muted small" style={{ marginTop: 6 }}>{existing} remover effect{existing === 1 ? '' : 's'} on this clip — edit in <a onClick={() => useUI.getState().setRightPanel('effects')} style={{ cursor: 'pointer' }}>Effects</a>.</div>}
      {!isVisual(clip) && <div className="muted small" style={{ marginTop: 6 }}>Select a video or image clip.</div>}
    </Card>
  );
}


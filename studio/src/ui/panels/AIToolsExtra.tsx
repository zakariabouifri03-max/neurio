/**
 * Additional AI / analysis tools shown in the AI panel. Each card owns its state and reports
 * real availability (model download / offline / unsupported) instead of pretending.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic2, Languages, Clapperboard, Gauge, MessageSquareOff, ScanFace, Play, Square } from 'lucide-react';
import { Card, Busy, fmtBytes } from './aiCommon';
import { Slider, SelectRow, Toggle } from '../common';
import { useProject, getSelectedClips, useSelectedClip, patchClip } from '@/core/store';
import { toast, useUI } from '@/core/uiStore';
import type { Clip, VideoClip, AudioClip, ImageClip, CaptionClip } from '@/core/types';
import * as cmd from '@/core/commands';
import { TTS_VOICES, ttsAvailability, synthesizeSpeech, cancelSpeech } from '@/ai/tts';
import { TRANSLATION_LANGS, SOURCE_LANGS, TARGET_LANGS, findPair, translationAvailability, translateTexts, cancelTranslation } from '@/ai/translate';
import { detectScenes, addSceneMarkers, splitAtScenes, type SceneCut } from '@/ai/scenes';
import { LOUDNESS_TARGETS, measureClip, normalizeClips } from '@/ai/loudness';
import { findFillers, removeFillers, FILLER_SETS, type FillerHit } from '@/ai/fillers';
import { analyzeFaces, applyFaceBlur } from '@/ai/faceblur';
import { useSegmentation, segmentationSupported } from '@/ai/segmentation';
import { importFile, getAudioContext } from '@/engine/MediaManager';
import { audioBufferToWav } from '@/library/synth';
import { addAssetToTimeline } from '@/services/clipActions';
import { engine } from '@/engine/PlaybackEngine';
import { formatDuration, uid } from '@/core/util';
import type { ModelProgress } from '@/ai/workerClient';

type Prog = { label: string; progress: number };
const useBusy = () => {
  const [busy, setBusy] = useState<Prog | null>(null);
  const sig = useRef<{ cancelled: boolean }>({ cancelled: false });
  const start = (label: string) => { sig.current = { cancelled: false }; setBusy({ label, progress: 0 }); return sig.current; };
  const prog = (p: number, label?: string) => setBusy((b) => ({ label: label ?? b?.label ?? '', progress: Math.max(0, Math.min(1, p)) }));
  const end = () => setBusy(null);
  const modelProg = (what: string) => (p: ModelProgress) => {
    if (p.stage === 'download') prog(p.progress, `Downloading model${p.file ? ` · ${p.file.split('/').pop()}` : ''}${p.total ? ` (${fmtBytes(p.loaded)} / ${fmtBytes(p.total)})` : ''}`);
    else if (p.stage === 'ready') prog(0, what);
    else prog(p.progress, what);
  };
  return { busy, start, prog, end, modelProg, sig };
};
const isVideo = (c: Clip | null): c is VideoClip => !!c && c.kind === 'video';
const isVisual = (c: Clip | null): c is VideoClip | ImageClip => !!c && (c.kind === 'video' || c.kind === 'image');
const hasAudio = (c: Clip | null): c is VideoClip | AudioClip => !!c && ((c.kind === 'video' && c.hasAudio !== false) || c.kind === 'audio');

/* ------------------------------------------------------------------ voice-over (TTS) */
export function VoiceOverCard() {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(1);
  const [useGpu, setUseGpu] = useState(false);
  const [last, setLast] = useState<{ buffer: AudioBuffer; text: string } | null>(null);
  const [playing, setPlaying] = useState<(() => void) | null>(null);
  const { busy, start, end, modelProg } = useBusy();
  const avail = useMemo(() => ttsAvailability(), [busy]);
  const captions = useProject((s) => s.project)?.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'caption' || c.kind === 'text') ?? [];
  const run = async () => {
    const sig = start('Loading voice model…');
    try {
      const r = await synthesizeSpeech(text, { voice, speed, device: useGpu && avail.webgpu ? 'webgpu' : 'wasm', onProgress: modelProg('Synthesizing speech…') });
      if (sig.cancelled) return;
      setLast({ buffer: r.buffer, text });
      toast(`Voice-over ready · ${formatDuration(r.duration)}`, 'success', 'Preview it or add it to the timeline.');
    } catch (e) {
      toast('Voice-over failed', 'error', String((e as Error).message || e));
    } finally {
      end();
    }
  };
  const add = async () => {
    if (!last) return;
    const name = `Voice-over – ${last.text.slice(0, 32).replace(/[\\/:*?"<>|]+/g, '')}${last.text.length > 32 ? '…' : ''}.wav`;
    const asset = await importFile(audioBufferToWav(last.buffer), { name, type: 'audio', tags: ['voice-over', 'tts', voice] });
    addAssetToTimeline(asset);
    toast('Voice-over added at the playhead', 'success');
  };
  const preview = () => {
    if (playing) { playing(); setPlaying(null); return; }
    if (!last) return;
    const ctx = getAudioContext();
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = last.buffer;
    src.connect(ctx.destination);
    src.onended = () => setPlaying(null);
    src.start();
    setPlaying(() => () => { try { src.stop(); } catch { /* already stopped */ } });
  };
  const fromCaptions = () => {
    const sel = getSelectedClips().filter((c) => c.kind === 'caption' || c.kind === 'text') as (CaptionClip | { text: string })[];
    const src = sel.length ? sel : (captions as any[]);
    const t = src.map((c) => c.text).join(' ').trim();
    if (!t) return toast('No text or caption clips in the project', 'info');
    setText(t.slice(0, 5000));
  };
  const v = TTS_VOICES.find((x) => x.id === voice);
  return (
    <Card icon={<Mic2 size={16} />} title="AI voice-over" desc="Text-to-speech with Kokoro-82M, generated locally. English voices (US/UK), 25 speakers." badge="Model"
      status={avail.ok ? { kind: 'ok', text: `Available · ${useGpu && avail.webgpu ? 'WebGPU' : 'CPU'} · ≈90 MB model downloads on first use` } : { kind: 'off', text: avail.reason || 'Unavailable' }}>
      <textarea className="input" rows={3} placeholder="Type the narration here… (English)" value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', marginTop: 6, resize: 'vertical', fontFamily: 'inherit' }} maxLength={5000} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="link small" onClick={fromCaptions}>Use text from captions / text clips</button>
        <span className="muted small">{text.length} / 5000</span>
      </div>
      <SelectRow label="Voice" value={voice} options={TTS_VOICES.map((x) => ({ value: x.id, label: `${x.name} · ${x.gender} · ${x.lang === 'en-gb' ? 'British' : 'American'} · grade ${x.grade}` }))} onChange={setVoice} />
      <Slider label="Speed" value={speed} min={0.6} max={1.6} step={0.05} format={(x) => `${x.toFixed(2)}×`} onChange={setSpeed} />
      {avail.webgpu && <Toggle label="Use GPU (WebGPU, faster)" value={useGpu} onChange={setUseGpu} />}
      {busy ? <Busy {...busy} onCancel={() => { cancelSpeech(); end(); }} /> : (
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn sm primary" onClick={run} disabled={!avail.ok || !text.trim()}>Generate voice-over</button>
          {last && <button className="btn sm" onClick={preview}>{playing ? <Square size={12} /> : <Play size={12} />} {playing ? 'Stop' : 'Preview'}</button>}
          {last && <button className="btn sm" onClick={add}>Add to timeline</button>}
        </div>
      )}
      {last && <div className="muted small" style={{ marginTop: 4 }}>Last result: {formatDuration(last.buffer.duration)} · {v?.name}</div>}
      <div className="muted small" style={{ marginTop: 4 }}>Kokoro is Apache-2.0; generated speech is yours to use. Other languages are not offered because the model's quality outside English is poor.</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ caption translation */
export function TranslateCaptionsCard() {
  const [from, setFrom] = useState('en');
  const [to, setTo] = useState('ar');
  const [mode, setMode] = useState<'replace' | 'copy'>('copy');
  const { busy, start, end, modelProg } = useBusy();
  const avail = useMemo(() => translationAvailability(), [busy]);
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const caps = useMemo(() => {
    const all = (project?.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'caption') as CaptionClip[]) ?? [];
    const sel = all.filter((c) => selection.includes(c.id));
    return sel.length ? sel : all;
  }, [project, selection]);
  const pair = findPair(from, to);
  const run = async () => {
    if (!caps.length) return toast('No caption clips to translate', 'info', 'Generate captions first (Captions tool).');
    if (!pair) return;
    const sig = start('Loading translation model…');
    try {
      const texts = caps.map((c) => c.text);
      const out = await translateTexts(texts, from, to, { onProgress: modelProg('Translating…') });
      if (sig.cancelled) return;
      const st = useProject.getState();
      st.apply(`Translate captions → ${TRANSLATION_LANGS[to]}`, (p0) => {
        let p = p0;
        let trackId: string | null = null;
        if (mode === 'copy') {
          const nt = cmd.addTrack(p, 'text');
          p = { ...nt.project, tracks: nt.project.tracks.map((t) => (t.id === nt.track.id ? { ...t, name: `Captions (${to})` } : t)) };
          trackId = nt.track.id;
        }
        caps.forEach((c, i) => {
          const txt = out[i] || c.text;
          // re-time words proportionally to character length across the original span
          const span = c.words.length ? Math.max(c.words[c.words.length - 1].end, 0.2) : c.duration;
          const parts = txt.split(/\s+/).filter(Boolean);
          const total = parts.reduce((a, w) => a + w.length + 1, 0) || 1;
          let acc = 0;
          const words = parts.map((w) => { const s = (acc / total) * span; acc += w.length + 1; return { text: w, start: s, end: (acc / total) * span }; });
          if (mode === 'replace') p = cmd.updateClip(p, c.id, (x) => ({ ...x, text: txt, words }) as Clip);
          else {
            const copy = { ...c, id: uid('clip'), text: txt, words, name: `${c.name} (${to})` } as Clip;
            p = cmd.addClip(p, copy, trackId, { allowNewTrack: true }).project;
          }
        });
        return p;
      });
      toast(`${caps.length} caption${caps.length === 1 ? '' : 's'} translated`, 'success', mode === 'copy' ? 'Added on a new caption track (originals kept).' : 'Word highlight timing is approximated after translation.');
      engine.invalidate?.();
    } catch (e) {
      toast('Translation failed', 'error', String((e as Error).message || e));
    } finally {
      end();
    }
  };
  const langOpts = (codes: string[]) => codes.map((c) => ({ value: c, label: TRANSLATION_LANGS[c] || c }));
  return (
    <Card icon={<Languages size={16} />} title="Translate captions" desc="Offline neural translation (OPUS-MT) of caption clips — keeps timing, re-times word highlights." badge="Model"
      status={!avail.ok ? { kind: 'off', text: avail.reason || 'Unavailable' } : pair ? { kind: 'ok', text: `Model ${pair.model.replace('Xenova/', '')} · ${pair.size} on first use` } : { kind: 'off', text: `No offline model for ${TRANSLATION_LANGS[from]} → ${TRANSLATION_LANGS[to]} (try via English)` }}>
      <SelectRow label="From" value={from} options={langOpts(SOURCE_LANGS)} onChange={setFrom} />
      <SelectRow label="To" value={to} options={langOpts(TARGET_LANGS)} onChange={setTo} />
      <SelectRow label="Result" value={mode} options={[{ value: 'copy', label: 'New caption track (keep originals)' }, { value: 'replace', label: 'Replace original captions' }]} onChange={(v) => setMode(v as any)} />
      <div className="muted small">{caps.length} caption clip{caps.length === 1 ? '' : 's'} {selection.some((id) => caps.some((c) => c.id === id)) ? 'selected' : 'in project'}</div>
      {busy ? <Busy {...busy} onCancel={() => { cancelTranslation(); end(); }} /> : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={run} disabled={!avail.ok || !pair || !caps.length}>Translate</button>}
    </Card>
  );
}

/* ------------------------------------------------------------------ face blur */
export function FaceBlurCard() {
  const clip = useSelectedClip();
  const seg = useSegmentation();
  const sup = useMemo(() => segmentationSupported(), []);
  const [mode, setMode] = useState<'pixelate' | 'blur'>('pixelate');
  const [strength, setStrength] = useState(0.7);
  const [maxFaces, setMaxFaces] = useState(3);
  const { busy, start, prog, end } = useBusy();
  const run = async () => {
    if (!isVisual(clip)) return toast('Select a video or image clip', 'info');
    const sig = start('Detecting faces…');
    try {
      const r = await analyzeFaces(clip, { maxFaces, onProgress: (p) => prog(p), signal: sig });
      if (sig.cancelled) return;
      if (!r) return toast('Face detection unavailable', 'error', useSegmentation.getState().error || 'The face model could not be loaded (network needed on first use).');
      if (!r.tracks.length) return toast('No faces found', 'info', `Scanned ${r.frames} frames · ${r.detections} detections were too brief to track.`);
      const n = applyFaceBlur(clip, r.tracks, { mode, strength });
      toast(`${n} face${n === 1 ? '' : 's'} blurred`, 'success', 'Each face is an overlay clip with an animated mask — edit it in Mask / Keyframes.');
      useUI.getState().setRightPanel('mask');
      engine.invalidate?.();
    } catch (e) {
      toast('Face blur failed', 'error', String((e as Error).message || e));
    } finally {
      end();
    }
  };
  return (
    <Card icon={<ScanFace size={16} />} title="Blur faces (privacy)" desc="Detects and tracks faces, then pixelates/blurs them with animated masks on overlay tracks." badge="Model"
      status={seg.faceStatus === 'ready' ? { kind: 'ok', text: 'Face model loaded' } : seg.faceStatus === 'unavailable' ? { kind: 'off', text: `Unavailable: ${seg.error}` } : sup.ok ? { kind: 'warn', text: 'Face model downloads on first use (≈230 KB)' } : { kind: 'off', text: sup.reason || 'Unavailable' }}>
      <SelectRow label="Style" value={mode} options={[{ value: 'pixelate', label: 'Pixelate (mosaic)' }, { value: 'blur', label: 'Gaussian blur' }]} onChange={(v) => setMode(v as any)} />
      <Slider label="Strength" value={strength} min={0.2} max={1} step={0.05} onChange={setStrength} />
      <Slider label="Max faces" value={maxFaces} min={1} max={6} step={1} onChange={setMaxFaces} />
      {busy ? <Busy {...busy} onCancel={() => { busy && (end()); }} /> : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={run} disabled={!isVisual(clip) || !sup.ok}>Blur faces in selected clip</button>}
    </Card>
  );
}

/* ------------------------------------------------------------------ scene detection */
export function SceneDetectCard() {
  const clip = useSelectedClip();
  const [sens, setSens] = useState(0.5);
  const [minLen, setMinLen] = useState(1);
  const [result, setResult] = useState<{ clipId: string; cuts: SceneCut[] } | null>(null);
  const { busy, start, prog, end } = useBusy();
  useEffect(() => { if (result && clip?.id !== result.clipId) setResult(null); }, [clip?.id]);
  const run = async () => {
    if (!isVideo(clip)) return toast('Select a video clip', 'info');
    const sig = start('Scanning frames…');
    try {
      const r = await detectScenes(clip, { sensitivity: sens, minSceneLength: minLen, onProgress: (p) => prog(p), signal: sig });
      if (sig.cancelled) return;
      if (!r) return toast('Could not read this clip', 'error');
      setResult({ clipId: clip.id, cuts: r.cuts });
      if (!r.cuts.length) toast('No scene changes found', 'info', 'Try a higher sensitivity.');
      else toast(`${r.cuts.length} scene change${r.cuts.length === 1 ? '' : 's'} found`, 'success', `Scanned ${r.sampled} frames.`);
    } finally {
      end();
    }
  };
  const cuts = result && clip?.id === result.clipId ? result.cuts : [];
  return (
    <Card icon={<Clapperboard size={16} />} title="Scene detection" desc="Finds shot changes (colour histogram + luminance jumps). Add chapter markers or split the clip at every cut." badge="DSP">
      <Slider label="Sensitivity" value={sens} min={0} max={1} step={0.05} onChange={setSens} />
      <Slider label="Min scene" value={minLen} min={0.3} max={5} step={0.1} unit="s" onChange={setMinLen} />
      {busy ? <Busy {...busy} onCancel={() => end()} /> : (
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn sm primary" onClick={run} disabled={!isVideo(clip)}>Detect scenes</button>
          {cuts.length > 0 && isVideo(clip) && <button className="btn sm" onClick={() => { const n = addSceneMarkers(clip, cuts); toast(`${n} markers added`, 'success'); }}>Add markers</button>}
          {cuts.length > 0 && isVideo(clip) && <button className="btn sm" onClick={() => { const n = splitAtScenes(clip, cuts); toast(`Split into ${n + 1} clips`, 'success'); setResult(null); }}>Split clip</button>}
        </div>
      )}
      {cuts.length > 0 && <div className="muted small" style={{ marginTop: 4 }}>Cuts at {cuts.slice(0, 8).map((c) => formatDuration(c.time)).join(', ')}{cuts.length > 8 ? ` +${cuts.length - 8} more` : ''} (source time)</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ loudness */
export function LoudnessCard() {
  const clip = useSelectedClip();
  const selection = useProject((s) => s.selection);
  const [target, setTarget] = useState('tiktok');
  const [measured, setMeasured] = useState<{ id: string; lufs: number; peak: number } | null>(null);
  const { busy, start, prog, end } = useBusy();
  const tgt = LOUDNESS_TARGETS.find((t) => t.id === target)!;
  const audible = () => getSelectedClips().filter(hasAudio) as (VideoClip | AudioClip)[];
  const measure = async () => {
    if (!hasAudio(clip)) return toast('Select a clip with audio', 'info');
    start('Measuring loudness…');
    try {
      const m = await measureClip(clip);
      if (!m) return toast('No decodable audio', 'error');
      setMeasured({ id: clip.id, lufs: m.integrated, peak: m.truePeakApprox });
    } finally {
      end();
    }
  };
  const normalize = async () => {
    const ts = audible();
    if (!ts.length) return toast('Select clips with audio', 'info');
    start('Normalizing…');
    try {
      const r = await normalizeClips(ts, tgt.lufs, (p) => prog(p));
      if (!r.applied) return toast('Nothing to normalize', 'info', 'Clips are silent or could not be decoded.');
      const avg = r.results.reduce((a, x) => a + x.gainDb, 0) / r.results.length;
      toast(`${r.applied} clip${r.applied === 1 ? '' : 's'} normalized to ${tgt.lufs} LUFS`, 'success', `Average gain ${avg >= 0 ? '+' : ''}${avg.toFixed(1)} dB (peak-limited to -1 dBTP).`);
      setMeasured(null);
    } finally {
      end();
    }
  };
  const m = measured && measured.id === clip?.id ? measured : null;
  return (
    <Card icon={<Gauge size={16} />} title="Loudness normalize" desc="Measures integrated loudness (BS.1770 K-weighting, gated) and sets clip volume to hit a platform target." badge="DSP">
      <SelectRow label="Target" value={target} options={LOUDNESS_TARGETS.map((t) => ({ value: t.id, label: t.label }))} onChange={setTarget} />
      {m && <div className="muted small">Selected clip: <b>{isFinite(m.lufs) ? `${m.lufs.toFixed(1)} LUFS` : 'silent'}</b> · peak {m.peak.toFixed(1)} dBTP → {isFinite(m.lufs) ? `${(tgt.lufs - m.lufs) >= 0 ? '+' : ''}${(tgt.lufs - m.lufs).toFixed(1)} dB needed` : ''}</div>}
      {busy ? <Busy {...busy} /> : (
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={measure} disabled={!hasAudio(clip)}>Measure</button>
          <button className="btn sm primary" onClick={normalize} disabled={!selection.length}>Normalize selected ({audible().length})</button>
        </div>
      )}
      <div className="muted small" style={{ marginTop: 4 }}>Select several clips to match their loudness to each other.</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ filler words */
export function FillerWordsCard() {
  const project = useProject((s) => s.project);
  const [discourse, setDiscourse] = useState(false);
  const [langs, setLangs] = useState<string[]>(['en', 'fr', 'ar']);
  const [hits, setHits] = useState<FillerHit[] | null>(null);
  const capCount = project?.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'caption' && (c as CaptionClip).words?.length).length ?? 0;
  const scan = () => {
    if (!project) return;
    const h = findFillers(project, { langs, includeDiscourse: discourse });
    setHits(h);
    if (!h.length) toast('No filler words found', 'info', capCount ? 'Captions contain no fillers from the selected lists.' : 'Generate word-timed captions first (Captions tool).');
  };
  const apply = () => {
    if (!hits?.length) return;
    const n = removeFillers(hits);
    toast(`${n} filler cut${n === 1 ? '' : 's'} made`, 'success', 'Timeline rippled closed. Re-run auto captions if you need exact word timing afterwards.');
    setHits(null);
  };
  const toggleLang = (k: string) => setLangs((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const total = hits?.reduce((a, h) => a + (h.end - h.start), 0) ?? 0;
  return (
    <Card icon={<MessageSquareOff size={16} />} title="Remove filler words" desc="Cuts “um / uh / euh / آه…” out of speech using the word timings of your auto captions." badge="Captions">
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {Object.entries(FILLER_SETS).map(([k, v]) => <button key={k} className={`chip ${langs.includes(k) ? 'active' : ''}`} onClick={() => toggleLang(k)}>{v.label}</button>)}
      </div>
      <Toggle label="Also discourse words (like, you know, en fait, يعني…)" value={discourse} onChange={setDiscourse} />
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={scan} disabled={!capCount}>Scan captions</button>
        <button className="btn sm primary" onClick={apply} disabled={!hits?.length}>Remove {hits?.length ? `${hits.length} (${total.toFixed(1)}s)` : ''}</button>
      </div>
      {!capCount && <div className="muted small" style={{ marginTop: 4 }}>Needs word-timed captions on the timeline.</div>}
      {hits && hits.length > 0 && <div className="muted small" style={{ marginTop: 4 }}>{hits.slice(0, 10).map((h) => `“${h.text}” @${formatDuration(h.start)}`).join(' · ')}{hits.length > 10 ? ` +${hits.length - 10} more` : ''}</div>}
    </Card>
  );
}

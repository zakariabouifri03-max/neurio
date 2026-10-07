import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Subtitles, Download, Upload, Wand2, XCircle, Trash2 } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SelectRow, Slider, Toggle, Empty, pickFiles } from '../common';
import { useProject, getSelectedClips, usePlayback } from '@/core/store';
import { toast } from '@/core/uiStore';
import * as cmd from '@/core/commands';
import type { CaptionClip, Clip, VideoClip, AudioClip } from '@/core/types';
import { CAPTION_STYLES, type CaptionStyleDef } from '@/library/captionStyles';
import { ensureFont } from '@/library/fonts';
import { captionsAvailability, transcribeAsset, cancelTranscriptions, groupWords, toSRT, toVTT, parseSubtitles, WHISPER_MODELS, CAPTION_LANGUAGES, type CaptionProgress, type CaptionLine } from '@/ai/captions';
import { downloadBlob, formatBytes } from '@/core/util';
import { getAsset } from '@/engine/MediaManager';
import { placeLines } from '@/ai/captionPlace';

type Source = { clip: VideoClip | AudioClip; label: string };

function sources(): Source[] {
  const p = useProject.getState().project;
  if (!p) return [];
  const sel = getSelectedClips().filter((c): c is VideoClip | AudioClip => (c.kind === 'video' && c.hasAudio !== false) || c.kind === 'audio');
  if (sel.length) return sel.map((c) => ({ clip: c, label: c.name }));
  // default: all audible clips on the timeline, sorted
  const all = cmd.allClips(p).filter((c): c is VideoClip | AudioClip => (c.kind === 'video' && c.hasAudio !== false) || c.kind === 'audio').sort((a, b) => a.start - b.start);
  return all.map((c) => ({ clip: c, label: c.name }));
}

export function CaptionsToolPanel() {
  const project = useProject((s) => s.project)!;
  const selection = useProject((s) => s.selection);
  const avail = useMemo(() => captionsAvailability(), [selection]);
  const [model, setModel] = useState(localStorage.getItem('neurio.whisper') || WHISPER_MODELS[1].id);
  const [lang, setLang] = useState(localStorage.getItem('neurio.captionLang') || 'auto');
  const [device, setDevice] = useState<'auto' | 'wasm' | 'webgpu'>(avail.webgpu ? 'auto' : 'wasm');
  const [styleId, setStyleId] = useState('hormozi');
  const [maxWords, setMaxWords] = useState(3);
  const [maxDur, setMaxDur] = useState(3);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState<null | { stage: string; progress: number; detail?: string }>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const cancelled = useRef(false);
  const srcs = sources();
  const captionClips = useMemo(() => cmd.allClips(project).filter((c): c is CaptionClip => c.kind === 'caption'), [project]);
  const style = CAPTION_STYLES.find((s) => s.id === styleId) || CAPTION_STYLES[0];
  useEffect(() => localStorage.setItem('neurio.whisper', model), [model]);
  useEffect(() => localStorage.setItem('neurio.captionLang', lang), [lang]);

  const run = async () => {
    if (!srcs.length) return toast('Nothing to transcribe', 'info', 'Add a video or audio clip (or select one).');
    cancelled.current = false;
    setBusy({ stage: 'Preparing', progress: 0 });
    const lines: (CaptionLine & { clipId: string })[] = [];
    let langDetected: string | null = null;
    try {
      for (let i = 0; i < srcs.length; i++) {
        const { clip } = srcs[i];
        const asset = getAsset(clip.mediaId);
        if (!asset) continue;
        const rate = clip.speed.rate || 1;
        const from = clip.mediaIn, to = Math.min(asset.duration || Infinity, clip.mediaIn + clip.duration * rate);
        const res = await transcribeAsset(clip.mediaId, {
          model,
          language: lang === 'auto' ? null : lang,
          device,
          from,
          to,
          onProgress: (p: CaptionProgress) => {
            if (cancelled.current) return;
            const base = i / srcs.length, span = 1 / srcs.length;
            const label = p.stage === 'download' ? `Downloading model${p.file ? ` · ${p.file.split('/').pop()}` : ''}` : p.stage === 'decode' ? 'Decoding audio' : p.stage === 'ready' ? 'Model ready' : `Transcribing ${srcs.length > 1 ? `${i + 1}/${srcs.length}` : ''}`;
            setBusy({ stage: label, progress: base + span * (p.stage === 'download' ? p.progress * 0.3 : p.stage === 'decode' ? 0.3 + p.progress * 0.05 : 0.35 + p.progress * 0.65), detail: p.total ? `${formatBytes(p.loaded || 0)} / ${formatBytes(p.total)}` : undefined });
          },
        });
        if (cancelled.current) return;
        langDetected = res.language;
        // map source seconds → timeline seconds
        const words = res.words.map((w) => ({ text: w.text, start: clip.start + (clip.speed.reversed ? (to - from) - w.end : w.start) / rate, end: clip.start + (clip.speed.reversed ? (to - from) - w.start : w.end) / rate })).filter((w) => w.end > clip.start && w.start < clip.start + clip.duration);
        for (const l of groupWords(words, { maxWords, maxDuration: maxDur })) lines.push({ ...l, clipId: clip.id });
      }
      if (!lines.length) {
        setBusy(null);
        return toast('No speech detected', 'info', 'Whisper returned no words for this audio.');
      }
      placeLines(lines, style, replace);
      setLastNote(`${lines.length} caption${lines.length === 1 ? '' : 's'} created with ${WHISPER_MODELS.find((m) => m.id === model)?.name || model}${langDetected ? ` (${langDetected})` : ''}. Click a caption to edit words & timing.`);
      toast('Captions added', 'success');
    } catch (e: any) {
      if (!cancelled.current) toast('Transcription failed', 'error', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };
  const cancel = () => {
    cancelled.current = true;
    cancelTranscriptions();
    setBusy(null);
  };

  const exportSubs = (fmt: 'srt' | 'vtt') => {
    const lines = captionClips.sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text }));
    if (!lines.length) return toast('No captions to export', 'info');
    const txt = fmt === 'srt' ? toSRT(lines) : toVTT(lines);
    downloadBlob(new Blob([txt], { type: 'text/plain' }), `${project.name.replace(/[^\w.-]+/g, '_')}.${fmt}`);
  };
  const importSubs = async () => {
    const [f] = await pickFiles('.srt,.vtt,text/plain', false);
    if (!f) return;
    const lines = parseSubtitles(await f.text());
    if (!lines.length) return toast('No cues found in that file', 'error');
    placeLines(lines.map((l) => ({ ...l, clipId: '' })), style, replace);
    toast(`${lines.length} captions imported`, 'success');
  };
  const clearAll = () => {
    if (!captionClips.length) return;
    if (!confirm(`Delete ${captionClips.length} caption clips?`)) return;
    useProject.getState().apply('Clear captions', (p) => cmd.removeClips(p, captionClips.map((c) => c.id)));
  };

  return (
    <>
      <PanelHeader title="Auto captions" sub="Whisper · runs locally" />
      <div className="panel-body scroll">
        {!avail.ok && (
          <div className="ai-card">
            <div className="head"><span className="ico">⚠️</span><b>Speech recognition unavailable</b></div>
            <div className="muted small">{avail.reason}</div>
          </div>
        )}
        <div className="ai-card">
          <div className="head"><span className="ico"><Subtitles size={16} /></span><div><b>Transcribe {srcs.length ? (selection.length ? `${srcs.length} selected clip${srcs.length > 1 ? 's' : ''}` : `all ${srcs.length} clip${srcs.length > 1 ? 's' : ''}`) : '—'}</b><div className="muted small">Speech → word-timed captions on a text track.</div></div></div>
          <SelectRow label="Model" value={model} options={WHISPER_MODELS.map((m) => ({ value: m.id, label: `${m.name} · ${m.size}` }))} onChange={setModel} />
          <div className="muted small" style={{ marginTop: -4, marginBottom: 6 }}>{WHISPER_MODELS.find((m) => m.id === model)?.note}. Downloaded once from huggingface.co, then cached.</div>
          <SelectRow label="Language" value={/\.en$/.test(model) ? 'en' : lang} options={CAPTION_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} onChange={setLang} />
          <SelectRow label="Compute" value={device} options={[{ value: 'auto', label: avail.webgpu ? 'Auto (WebGPU)' : 'Auto (CPU)' }, { value: 'wasm', label: 'CPU (WebAssembly)' }, ...(avail.webgpu ? [{ value: 'webgpu', label: 'GPU (WebGPU)' }] : [])]} onChange={(v) => setDevice(v as any)} />
          {!busy ? (
            <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={!avail.ok || !srcs.length} onClick={run}>
              <Wand2 size={14} /> Generate captions
            </button>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small">{busy.stage}</span><span className="muted small">{busy.detail || `${Math.round(busy.progress * 100)}%`}</span></div>
              <div className="progress"><div style={{ width: `${Math.round(busy.progress * 100)}%` }} /></div>
              <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={cancel}><XCircle size={13} /> Cancel</button>
            </div>
          )}
          {lastNote && <div className="muted small" style={{ marginTop: 8 }}>{lastNote}</div>}
        </div>

        <h4 className="muted small" style={{ margin: '12px 0 6px' }}>Style</h4>
        <div className="caption-styles">
          {CAPTION_STYLES.map((s) => (
            <button key={s.id} className={`caption-style ${styleId === s.id ? 'active' : ''}`} onClick={() => { setStyleId(s.id); if (s.style.fontFamily) void ensureFont(s.style.fontFamily); }} title={s.name}>
              <StylePreview s={s} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        <Slider label="Words per caption" value={maxWords} min={1} max={8} step={1} onChange={setMaxWords} />
        <Slider label="Max duration" value={maxDur} min={1} max={6} step={0.5} unit="s" onChange={setMaxDur} />
        <Toggle label="Replace existing captions" value={replace} onChange={setReplace} />
        {captionClips.length > 0 && (
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => applyStyleToAll(style)}>Apply style to {captionClips.length} caption{captionClips.length > 1 ? 's' : ''}</button>
        )}

        <h4 className="muted small" style={{ margin: '14px 0 6px' }}>Captions on timeline ({captionClips.length})</h4>
        {!captionClips.length && <Empty icon={<Subtitles />}>No captions yet. Generate them above or import an .srt/.vtt.</Empty>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={importSubs}><Upload size={13} /> Import SRT/VTT</button>
          <button className="btn sm" onClick={() => exportSubs('srt')} disabled={!captionClips.length}><Download size={13} /> SRT</button>
          <button className="btn sm" onClick={() => exportSubs('vtt')} disabled={!captionClips.length}><Download size={13} /> VTT</button>
          <button className="btn sm ghost" onClick={clearAll} disabled={!captionClips.length}><Trash2 size={13} /> Clear</button>
        </div>
        <div className="caption-list" style={{ marginTop: 8 }}>
          {captionClips.sort((a, b) => a.start - b.start).slice(0, 200).map((c) => (
            <button key={c.id} className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => { usePlayback.getState().seek(c.start + 0.01); useProject.getState().select([c.id]); }}>
              <div className="info">
                <div className="title" style={{ whiteSpace: 'normal' }}>{c.text}</div>
                <div className="sub">{c.start.toFixed(2)}s → {(c.start + c.duration).toFixed(2)}s · {c.words.length} words</div>
              </div>
            </button>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>Privacy: audio never leaves your device — the model runs in your browser.</div>
      </div>
    </>
  );
}

function StylePreview({ s }: { s: CaptionStyleDef }) {
  const st = s.style;
  return (
    <span className="prev" style={{ fontFamily: `"${st.fontFamily}", sans-serif`, fontWeight: st.fontWeight as any, textTransform: st.uppercase ? 'uppercase' : 'none', color: st.color, WebkitTextStroke: st.outline ? `1px ${st.outline.color}` : undefined, textShadow: st.glow ? `0 0 8px ${st.glow.color}` : st.shadow ? `1px 1px 0 ${st.shadow.color}` : undefined, background: st.background?.color, borderRadius: 4, padding: st.background ? '2px 6px' : 0 }}>
      {s.sample[0]} <span style={{ color: s.caption.mode === 'none' ? undefined : s.caption.highlightColor, background: s.caption.highlightBackground || undefined, borderRadius: 3, padding: s.caption.highlightBackground ? '0 3px' : 0 }}>{s.sample[1]}</span> {s.sample[2]}
    </span>
  );
}

/** Create caption clips on a dedicated "Captions" text track. */
function applyStyleToAll(style: CaptionStyleDef) {
  if (style.style.fontFamily) void ensureFont(style.style.fontFamily);
  useProject.getState().apply('Caption style', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.kind === 'caption' ? { ...c, style: { ...c.style, ...style.style }, caption: { ...c.caption, ...style.caption }, animation: style.animation ? { ...c.animation, ...style.animation } : c.animation } : c)) })) }) as any);
  toast('Caption style applied', 'success');
}

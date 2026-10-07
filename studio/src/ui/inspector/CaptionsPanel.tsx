import React from 'react';
import type { CaptionClip, CaptionStyle, CaptionWord } from '@/core/types';
import { patchClip, useProject, seekFrameSnapped } from '@/core/store';
import { toast } from '@/core/uiStore';
import { Section, Slider, SelectRow, ColorRow, Toggle } from '../common';
import { useLocalTime } from './anim';
import { CAPTION_STYLES } from '@/library/captionStyles';
import { Scissors, Trash2, Crosshair, Copy } from 'lucide-react';
import * as cmd from '@/core/commands';
import { uid } from '@/core/util';
import { ensureFont } from '@/library/fonts';
import { engine } from '@/engine/PlaybackEngine';

export function CaptionsPanel({ clip }: { clip: CaptionClip }) {
  const c = clip.caption;
  const set = (label: string, patch: Partial<CaptionStyle>, merge = true) => patchClip(clip.id, label, { caption: { ...clip.caption, ...patch } } as any, merge);
  const lt = useLocalTime(clip);
  const fps = useProject((s) => s.project!.settings.fps);

  const applyToAll = () => {
    useProject.getState().apply('Apply caption style to all', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => (x.kind === 'caption' ? { ...x, style: structuredClone(clip.style), caption: structuredClone(clip.caption), animation: structuredClone(clip.animation), transform: { ...x.transform, position: structuredClone(clip.transform.position) } } : x)) })) }));
    toast('Style applied to all captions', 'success');
  };
  const setWords = (words: CaptionWord[], label = 'Edit captions') => patchClip(clip.id, label, { words, text: words.map((w) => w.text).join(' ') } as any);

  const splitAtWord = (i: number) => {
    if (i <= 0 || i >= clip.words.length) return;
    const t = clip.start + clip.words[i].start;
    useProject.getState().apply('Split caption', (p) => cmd.splitClip(p, clip.id, t).project);
  };

  return (
    <>
      <Section title="Caption style" id="cap-style" actions={<button className="icon-btn sm" title="Apply this look to all caption clips" onClick={applyToAll}><Copy size={12} /></button>}>
        <div className="caption-styles">
          {CAPTION_STYLES.map((s) => (
            <button
              key={s.id}
              className="caption-style"
              title={s.name}
              onClick={() => {
                void ensureFont(s.style.fontFamily ?? 'Inter').then(() => engine.invalidate());
                patchClip(clip.id, `Caption style ${s.name}`, { style: { ...clip.style, ...s.style }, caption: { ...clip.caption, ...s.caption }, animation: { ...clip.animation, ...(s.animation ?? {}) } } as any, false);
              }}
            >
              <span className="prev" style={{ fontFamily: s.style.fontFamily, fontWeight: s.style.fontWeight, color: s.style.color, textTransform: s.style.uppercase ? 'uppercase' : undefined, WebkitTextStroke: s.style.outline ? `1px ${s.style.outline.color}` : undefined, background: s.style.background?.color }}>
                {s.sample[0]} <em style={{ color: s.caption.highlightColor, background: s.caption.highlightBackground ?? undefined, fontStyle: 'normal', padding: s.caption.highlightBackground ? '0 3px' : 0, borderRadius: 3 }}>{s.sample[1]}</em> {s.sample[2]}
              </span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        <SelectRow label="Highlight" value={c.mode} options={[{ value: 'word', label: 'Current word (color)' }, { value: 'box', label: 'Current word (box)' }, { value: 'karaoke', label: 'Karaoke fill' }, { value: 'none', label: 'None' }]} onChange={(v) => set('Caption mode', { mode: v as CaptionStyle['mode'] }, false)} />
        <ColorRow label="Highlight color" value={c.highlightColor} onChange={(v) => set('Highlight color', { highlightColor: v || '#ffe600' })} />
        <ColorRow label="Highlight box" value={c.highlightBackground} allowNone onChange={(v) => set('Highlight box', { highlightBackground: v })} />
        <Slider label="Highlight scale" value={c.highlightScale} min={1} max={1.6} step={0.01} defaultValue={1.1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Highlight scale', { highlightScale: v })} />
        <Slider label="Words per line" value={c.wordsPerLine} min={1} max={12} step={1} defaultValue={4} onChange={(v) => set('Words per line', { wordsPerLine: v })} />
        <div className="muted small">Font, colors, outline and position are in the <b>Text</b> tab. Use "apply to all" (⧉) to restyle every caption at once.</div>
      </Section>
      <Section title={`Words (${clip.words.length})`} id="cap-words">
        <div className="muted small" style={{ marginBottom: 6 }}>Edit text and timings. Times are seconds from the start of this caption clip.</div>
        <div className="word-list">
          {clip.words.map((w, i) => {
            const active = lt >= w.start && lt < w.end;
            return (
              <div key={i} className={`word-row ${active ? 'current' : ''}`}>
                <button className="icon-btn sm" title="Jump to word" onClick={() => seekFrameSnapped(clip.start + w.start)}><Crosshair size={11} /></button>
                <input className="w" value={w.text} onChange={(e) => setWords(clip.words.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <input className="t" type="number" step={1 / fps} min={0} max={clip.duration} value={Math.round(w.start * 100) / 100} onChange={(e) => setWords(clip.words.map((x, j) => (j === i ? { ...x, start: Math.max(0, parseFloat(e.target.value) || 0) } : x)), 'Word timing')} title="Start" />
                <input className="t" type="number" step={1 / fps} min={0} max={clip.duration} value={Math.round(w.end * 100) / 100} onChange={(e) => setWords(clip.words.map((x, j) => (j === i ? { ...x, end: Math.max(x.start + 0.02, parseFloat(e.target.value) || 0) } : x)), 'Word timing')} title="End" />
                <button className="icon-btn sm" title="Split caption clip before this word" disabled={i === 0} onClick={() => splitAtWord(i)}><Scissors size={11} /></button>
                <button className="icon-btn sm" title="Delete word" onClick={() => setWords(clip.words.filter((_, j) => j !== i), 'Delete word')}><Trash2 size={11} /></button>
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn sm ghost" onClick={() => { const last = clip.words[clip.words.length - 1]; const start = last ? last.end : 0; setWords([...clip.words, { text: 'word', start, end: Math.min(clip.duration, start + 0.3) }], 'Add word'); }}>+ Word</button>
          <button className="btn sm ghost" title="Spread word timings evenly across the clip" onClick={() => { const n = clip.words.length || 1; setWords(clip.words.map((w, i) => ({ ...w, start: (i / n) * clip.duration, end: ((i + 1) / n) * clip.duration })), 'Retime words'); }}>Even timing</button>
          <button className="btn sm ghost" title="Set the word under the playhead to start now" onClick={() => { const i = clip.words.findIndex((w) => lt < w.end); if (i < 0) return; setWords(clip.words.map((w, j) => (j === i ? { ...w, start: lt } : j === i - 1 ? { ...w, end: Math.min(w.end, lt) } : w)), 'Word timing'); }}>Mark start</button>
        </div>
      </Section>
      <Section title="Tools" id="cap-tools" defaultOpen={false}>
        <Toggle label="Burn-in on export" value={true} onChange={() => toast('Captions on the timeline are always rendered into the video. To export a subtitle file, use AI → Auto captions → Export SRT/VTT.', 'info')} />
        <div className="row">
          <button className="btn sm ghost" onClick={() => { const text = prompt('Replace caption text (words will be re-timed evenly):', clip.text); if (text === null) return; const ws = text.split(/\s+/).filter(Boolean); const n = ws.length || 1; setWords(ws.map((t, i) => ({ text: t, start: (i / n) * clip.duration, end: ((i + 1) / n) * clip.duration })), 'Replace caption'); }}>Replace text…</button>
        </div>
      </Section>
    </>
  );
}

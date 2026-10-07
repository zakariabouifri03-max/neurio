import React, { useRef, useState } from 'react';
import type { VideoClip, Stabilization } from '@/core/types';
import { patchClip } from '@/core/store';
import { toast } from '@/core/uiStore';
import { Section, Slider, Toggle } from '../common';
import { analyzeStabilization, suggestedCropZoom } from '@/ai/stabilize';
import { Activity, Square } from 'lucide-react';
import { engine } from '@/engine/PlaybackEngine';

export function StabilizePanel({ clip }: { clip: VideoClip }) {
  const st = clip.stabilization;
  const [progress, setProgress] = useState<number | null>(null);
  const cancel = useRef({ cancelled: false });
  const set = (label: string, patch: Partial<Stabilization>, merge = true) => patchClip(clip.id, label, { stabilization: { ...clip.stabilization, ...patch } } as any, merge);

  const run = async (level: 1 | 2 | 3) => {
    cancel.current = { cancelled: false };
    setProgress(0);
    const started = performance.now();
    try {
      const analysis = await analyzeStabilization(clip, level, (p) => setProgress(p.frame / p.total), cancel.current);
      if (!analysis) {
        if (!cancel.current.cancelled) toast('Stabilization analysis failed', 'error');
        return;
      }
      const zoom = suggestedCropZoom(analysis as any);
      set('Stabilize', { enabled: true, level, analysis, cropZoom: zoom }, false);
      engine.invalidate();
      toast('Stabilization ready', 'success', `${(analysis.smoothed.length / 2) | 0} frames analyzed in ${((performance.now() - started) / 1000).toFixed(1)}s · crop ${Math.round((zoom - 1) * 100)}%`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <Section title="Stabilization" id="stab-main">
        <div className="muted small" style={{ marginBottom: 8 }}>Analyzes camera motion (block matching) and smooths it. Higher levels smooth more but crop more. Analysis runs in the background; the preview updates when finished.</div>
        <div className="preset-grid cols-3">
          {([1, 2, 3] as const).map((l) => (
            <button key={l} className={`preset ${st.enabled && st.level === l ? 'active' : ''}`} disabled={progress !== null} onClick={() => run(l)}>
              <span className="ico"><Activity size={16} /></span>
              <span>{['', 'Low', 'Medium', 'High'][l]}</span>
            </button>
          ))}
        </div>
        {progress !== null && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="progress" style={{ flex: 1 }}><div style={{ width: `${progress * 100}%` }} /></div>
            <span className="mono small">{Math.round(progress * 100)}%</span>
            <button className="icon-btn sm" title="Cancel" onClick={() => (cancel.current.cancelled = true)}><Square size={12} /></button>
          </div>
        )}
        {st.analysis && (
          <>
            <Toggle label="Enabled (compare before/after)" value={st.enabled} onChange={(v) => { set('Toggle stabilization', { enabled: v }, false); engine.invalidate(); }} />
            <Slider label="Crop zoom" value={st.cropZoom} min={1} max={1.5} step={0.005} defaultValue={suggestedCropZoom(st.analysis as any)} format={(v) => `${Math.round((v - 1) * 100)}%`} onChange={(v) => set('Crop zoom', { cropZoom: v })} />
            <div className="row">
              <button className="btn sm ghost" onClick={() => set('Remove stabilization', { enabled: false, level: 0, analysis: undefined }, false)}>Remove analysis</button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}

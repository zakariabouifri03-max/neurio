import React, { useState } from 'react';
import type { VideoClip, AudioClip, AudioFX } from '@/core/types';
import { patchClip, useProject } from '@/core/store';
import { toast } from '@/core/uiStore';
import { Section, Slider, Toggle, Chips } from '../common';
import { AnimSlider } from './anim';
import { getAudioBuffer } from '@/engine/MediaManager';
import { detectBeats, integratedLoudnessDb } from '@/ai/audioAnalysis';
import { usePresets } from '@/services/favorites';
import { Save, RotateCcw, Activity, Music2 } from 'lucide-react';
import { defaultAudioFX } from '@/core/defaults';
import * as cmd from '@/core/commands';
import { uid } from '@/core/util';

const EQ_PRESETS: { name: string; low: number; mid: number; high: number }[] = [
  { name: 'Flat', low: 0, mid: 0, high: 0 },
  { name: 'Bass boost', low: 8, mid: 0, high: -1 },
  { name: 'Treble boost', low: -1, mid: 0, high: 7 },
  { name: 'Voice', low: -4, mid: 4, high: 3 },
  { name: 'Podcast', low: -2, mid: 3, high: 2 },
  { name: 'Phone', low: -14, mid: 6, high: -10 },
  { name: 'Lo-fi', low: 4, mid: -3, high: -8 },
  { name: 'Bright', low: 0, mid: 1, high: 5 },
];

export function AudioPanel({ clip }: { clip: VideoClip | AudioClip }) {
  const fx = clip.audio;
  const set = (label: string, patch: Partial<AudioFX>, merge = true) => patchClip(clip.id, label, { audio: { ...clip.audio, ...patch } } as any, merge);
  const presets = usePresets((s) => s.presets.filter((p) => p.kind === 'audio'));
  const [busy, setBusy] = useState<string | null>(null);
  const halfDur = Math.max(0.05, clip.duration / 2);

  const analyzeBeats = async () => {
    setBusy('beats');
    try {
      const buf = await getAudioBuffer(clip.mediaId);
      if (!buf) return toast('Audio not decoded yet', 'error');
      const res = detectBeats(buf);
      const rate = cmd.effectiveRate(clip) || 1;
      const beats = res.beats.map((b) => (b - clip.mediaIn) / rate).filter((t) => t >= 0 && t <= clip.duration);
      useProject.getState().apply('Detect beats', (p) => {
        let np = cmd.updateClip(p, clip.id, (c) => ({ ...c, beats }) as any);
        const markers = np.markers.filter((m) => !(m.kind === 'beat' && m.label === clip.id));
        for (const b of beats) markers.push({ id: uid('mk'), time: clip.start + b, label: clip.id, kind: 'beat', color: '#f59e0b' });
        np = { ...np, markers: markers.sort((a, b) => a.time - b.time) };
        return np;
      });
      toast(`${beats.length} beats · ~${res.bpm} BPM`, 'success', `Confidence ${(res.confidence * 100).toFixed(0)}%. Beat markers added to the ruler (clips snap to them).`);
    } finally {
      setBusy(null);
    }
  };
  const clearBeats = () => useProject.getState().apply('Clear beats', (p) => ({ ...cmd.updateClip(p, clip.id, (c) => ({ ...c, beats: undefined }) as any), markers: p.markers.filter((m) => !(m.kind === 'beat' && m.label === clip.id)) }));

  const measure = async () => {
    setBusy('loud');
    try {
      const buf = await getAudioBuffer(clip.mediaId);
      if (!buf) return toast('Audio not decoded yet', 'error');
      const db = integratedLoudnessDb(buf);
      toast(`Average level ${db.toFixed(1)} dBFS`, 'info', db < -24 ? 'Quiet — consider Normalize or more volume.' : db > -10 ? 'Loud — consider the compressor.' : 'Healthy level.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section
        title="Volume"
        id="aud-vol"
        actions={
          <>
            <button className="icon-btn sm" title="Save audio settings as preset" onClick={() => { const n = prompt('Preset name', 'My audio preset'); if (n) usePresets.getState().add('audio', n, { ...fx, volume: { value: fx.volume.value } }); }}><Save size={12} /></button>
            <button className="icon-btn sm" title="Reset audio" onClick={() => set('Reset audio', defaultAudioFX(), false)}><RotateCcw size={12} /></button>
          </>
        }
      >
        <AnimSlider clip={clip} label="Volume" prop={fx.volume} fallback={1} min={0} max={3} step={0.01} defaultValue={1} format={(v) => (v <= 0 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`)} set={(a) => ({ audio: { ...clip.audio, volume: a } })} historyLabel="Volume" />
        <div className="chips">
          {[0, 0.25, 0.5, 1, 1.5, 2].map((v) => (
            <button key={v} className="chip" onClick={() => set('Volume', { volume: { ...fx.volume, value: v } }, false)}>{v === 0 ? 'Mute' : `${Math.round(v * 100)}%`}</button>
          ))}
        </div>
        <Slider label="Fade in" value={fx.fadeIn} min={0} max={halfDur} step={0.05} unit="s" defaultValue={0} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set('Fade in', { fadeIn: v })} />
        <Slider label="Fade out" value={fx.fadeOut} min={0} max={halfDur} step={0.05} unit="s" defaultValue={0} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set('Fade out', { fadeOut: v })} />
        <Toggle label="Normalize peak to -0.5 dB" value={fx.normalize} onChange={(v) => set('Normalize', { normalize: v }, false)} />
        <Slider label="Pan" value={fx.pan} min={-1} max={1} step={0.01} defaultValue={0} format={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v) => set('Pan', { pan: v })} />
        <Slider label="Stereo width" value={fx.stereoWidth} min={0} max={2} step={0.01} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Stereo width', { stereoWidth: v })} />
        <div className="row">
          <button className="btn sm ghost" disabled={busy !== null} onClick={measure}><Activity size={13} /> Measure level</button>
        </div>
      </Section>

      {presets.length > 0 && (
        <div className="chips" style={{ padding: '0 10px 6px' }}>
          {presets.map((p) => (
            <button key={p.id} className="chip" onClick={() => set('Apply audio preset', { ...p.data, volume: { value: p.data.volume?.value ?? 1 } }, false)} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete preset "${p.name}"?`)) usePresets.getState().remove(p.id); }} title="Click to apply · right-click to delete">
              {p.name}
            </button>
          ))}
        </div>
      )}

      <Section title="Pitch & speed" id="aud-pitch" defaultOpen={false}>
        <Slider label="Pitch" value={fx.pitch} min={-12} max={12} step={1} unit="st" defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v) => set('Pitch', { pitch: v })} />
        <div className="muted small">Speed is set in the Speed tab. Pitch shifting uses the DSP worklet (preview quality may differ slightly from export).</div>
      </Section>

      <Section title="Equalizer" id="aud-eq" defaultOpen={false}>
        <Chips items={EQ_PRESETS.map((p) => p.name)} value={EQ_PRESETS.find((p) => p.low === fx.eq.low && p.mid === fx.eq.mid && p.high === fx.eq.high)?.name ?? null} onChange={(n) => { const p = EQ_PRESETS.find((x) => x.name === n); if (p) set('EQ preset', { eq: { ...fx.eq, low: p.low, mid: p.mid, high: p.high } }, false); }} />
        <Slider label="Bass" value={fx.eq.low} min={-24} max={24} step={0.5} unit="dB" defaultValue={0} format={(v) => `${v} dB`} onChange={(v) => set('EQ', { eq: { ...fx.eq, low: v } })} />
        <Slider label="Mid" value={fx.eq.mid} min={-24} max={24} step={0.5} unit="dB" defaultValue={0} format={(v) => `${v} dB`} onChange={(v) => set('EQ', { eq: { ...fx.eq, mid: v } })} />
        <Slider label="Treble" value={fx.eq.high} min={-24} max={24} step={0.5} unit="dB" defaultValue={0} format={(v) => `${v} dB`} onChange={(v) => set('EQ', { eq: { ...fx.eq, high: v } })} />
      </Section>

      <Section title="Clean up" id="aud-clean" defaultOpen={fx.noiseReduction > 0 || fx.voiceEnhance > 0}>
        <Slider label="Noise reduction" value={fx.noiseReduction} min={0} max={1} step={0.01} defaultValue={0} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Noise reduction', { noiseReduction: v })} />
        <Slider label="Voice enhance" value={fx.voiceEnhance} min={0} max={1} step={0.01} defaultValue={0} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Voice enhance', { voiceEnhance: v })} />
        <div className="muted small">Noise reduction = spectral gate + high/low-pass (DSP). Voice enhance = presence EQ + gentle compression.</div>
      </Section>

      <Section title="Compressor" id="aud-comp" defaultOpen={fx.compressor.enabled}>
        <Toggle label="Enabled" value={fx.compressor.enabled} onChange={(v) => set('Compressor', { compressor: { ...fx.compressor, enabled: v } }, false)} />
        <Slider label="Threshold" value={fx.compressor.threshold} min={-60} max={0} step={1} unit="dB" defaultValue={-24} format={(v) => `${v} dB`} onChange={(v) => set('Compressor', { compressor: { ...fx.compressor, threshold: v } })} />
        <Slider label="Ratio" value={fx.compressor.ratio} min={1} max={20} step={0.5} defaultValue={4} format={(v) => `${v}:1`} onChange={(v) => set('Compressor', { compressor: { ...fx.compressor, ratio: v } })} />
        <Slider label="Attack" value={fx.compressor.attack} min={0} max={0.5} step={0.001} unit="s" defaultValue={0.003} format={(v) => `${(v * 1000).toFixed(0)} ms`} onChange={(v) => set('Compressor', { compressor: { ...fx.compressor, attack: v } })} />
        <Slider label="Release" value={fx.compressor.release} min={0.01} max={1} step={0.01} unit="s" defaultValue={0.25} format={(v) => `${(v * 1000).toFixed(0)} ms`} onChange={(v) => set('Compressor', { compressor: { ...fx.compressor, release: v } })} />
        <Slider label="Makeup gain" value={fx.compressor.makeup} min={0} max={24} step={0.5} unit="dB" defaultValue={0} format={(v) => `${v} dB`} onChange={(v) => set('Compressor', { compressor: { ...fx.compressor, makeup: v } })} />
      </Section>

      <Section title="Reverb" id="aud-reverb" defaultOpen={fx.reverb.enabled}>
        <Toggle label="Enabled" value={fx.reverb.enabled} onChange={(v) => set('Reverb', { reverb: { ...fx.reverb, enabled: v } }, false)} />
        <Slider label="Mix" value={fx.reverb.mix} min={0} max={1} step={0.01} defaultValue={0.3} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Reverb', { reverb: { ...fx.reverb, mix: v } })} />
        <Slider label="Room size" value={fx.reverb.size} min={0} max={1} step={0.01} defaultValue={0.5} onChange={(v) => set('Reverb', { reverb: { ...fx.reverb, size: v } })} />
        <Slider label="Decay" value={fx.reverb.decay} min={0.1} max={6} step={0.1} unit="s" defaultValue={1.5} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => set('Reverb', { reverb: { ...fx.reverb, decay: v } })} />
      </Section>

      <Section title="Echo" id="aud-echo" defaultOpen={fx.echo.enabled}>
        <Toggle label="Enabled" value={fx.echo.enabled} onChange={(v) => set('Echo', { echo: { ...fx.echo, enabled: v } }, false)} />
        <Slider label="Time" value={fx.echo.time} min={0.02} max={1.5} step={0.01} unit="s" defaultValue={0.3} format={(v) => `${(v * 1000).toFixed(0)} ms`} onChange={(v) => set('Echo', { echo: { ...fx.echo, time: v } })} />
        <Slider label="Feedback" value={fx.echo.feedback} min={0} max={0.95} step={0.01} defaultValue={0.35} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Echo', { echo: { ...fx.echo, feedback: v } })} />
        <Slider label="Mix" value={fx.echo.mix} min={0} max={1} step={0.01} defaultValue={0.3} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Echo', { echo: { ...fx.echo, mix: v } })} />
      </Section>

      <Section title="Auto ducking" id="aud-duck" defaultOpen={fx.ducking.enabled}>
        <Toggle label="Duck under other audio" value={fx.ducking.enabled} hint="Lower this clip automatically when other clips (voice) are playing" onChange={(v) => set('Ducking', { ducking: { ...fx.ducking, enabled: v } }, false)} />
        <Slider label="Amount" value={fx.ducking.amount} min={0} max={1} step={0.01} defaultValue={0.6} format={(v) => `-${Math.round(v * 100)}%`} onChange={(v) => set('Ducking', { ducking: { ...fx.ducking, amount: v } })} />
        <Slider label="Sensitivity" value={fx.ducking.threshold} min={0.005} max={0.3} step={0.005} defaultValue={0.05} format={(v) => `${(20 * Math.log10(v)).toFixed(0)} dB`} onChange={(v) => set('Ducking', { ducking: { ...fx.ducking, threshold: v } })} />
        <Slider label="Attack" value={fx.ducking.attack} min={0.02} max={1} step={0.01} unit="s" defaultValue={0.1} format={(v) => `${(v * 1000).toFixed(0)} ms`} onChange={(v) => set('Ducking', { ducking: { ...fx.ducking, attack: v } })} />
        <Slider label="Release" value={fx.ducking.release} min={0.05} max={3} step={0.05} unit="s" defaultValue={0.4} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set('Ducking', { ducking: { ...fx.ducking, release: v } })} />
      </Section>

      <Section title="Beats" id="aud-beats" defaultOpen={!!(clip as AudioClip).beats?.length}>
        <div className="row">
          <button className="btn sm" disabled={busy !== null} onClick={analyzeBeats}><Music2 size={13} /> {busy === 'beats' ? 'Analyzing…' : 'Detect beats'}</button>
          {!!(clip as AudioClip).beats?.length && <button className="btn sm ghost" onClick={clearBeats}>Clear ({(clip as AudioClip).beats!.length})</button>}
        </div>
        <div className="muted small">Energy-onset detection. Beat markers appear in the ruler and the timeline snaps to them. Use AI → Beat sync to cut clips on beats.</div>
      </Section>
    </>
  );
}

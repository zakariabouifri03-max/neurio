import React from 'react';
import type { VideoClip, ImageClip, ChromaKey } from '@/core/types';
import { patchClip } from '@/core/store';
import { useUI, toast } from '@/core/uiStore';
import { Section, Toggle, Empty } from '../common';
import { AnimSlider } from './anim';
import { defaultChroma } from '@/core/defaults';
import { rgbToHex, hexToRgb } from '@/core/util';
import { Pipette, Trash2, Layers } from 'lucide-react';

export function ChromaPanel({ clip }: { clip: VideoClip | ImageClip }) {
  const c = clip.chroma;
  const set = (label: string, patch: Partial<ChromaKey>, merge = true) => patchClip(clip.id, label, { chroma: { ...(clip.chroma ?? defaultChroma()), ...patch } } as any, merge);
  const picking = useUI((s) => !!s.eyedropper);
  const pick = () => {
    // temporarily disable the key so the picker samples the original color
    const wasEnabled = c?.enabled ?? false;
    if (wasEnabled) set('Chroma', { enabled: false }, false);
    useUI.getState().set({
      eyedropper: (rgb) => {
        set('Pick key color', { color: rgb, enabled: true }, false);
        toast('Key color picked', 'success', rgbToHex(Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)));
      },
    });
    toast('Click the color to remove in the preview', 'info', 'Press Esc to cancel.');
  };
  const hex = c ? rgbToHex(Math.round(c.color.r * 255), Math.round(c.color.g * 255), Math.round(c.color.b * 255)) : '#00ff00';
  return (
    <>
      <Section title="Chroma key" id="chroma-main">
        {!c ? (
          <Empty>
            Remove a green/blue screen background.
            <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center' }}>
              <button className="btn sm primary" onClick={() => patchClip(clip.id, 'Enable chroma key', { chroma: defaultChroma() } as any, false)}>Green screen</button>
              <button className="btn sm" onClick={() => patchClip(clip.id, 'Enable chroma key', { chroma: { ...defaultChroma(), color: { r: 0, g: 0.3, b: 1 } } } as any, false)}>Blue screen</button>
              <button className="btn sm" onClick={() => { patchClip(clip.id, 'Enable chroma key', { chroma: { ...defaultChroma(), enabled: false } } as any, false); setTimeout(pick, 0); }}>
                <Pipette size={13} /> Pick color
              </button>
            </div>
          </Empty>
        ) : (
          <>
            <Toggle label="Enabled" value={c.enabled} onChange={(v) => set('Toggle chroma', { enabled: v }, false)} />
            <div className="row">
              <label>Key color</label>
              <input type="color" value={hex} onChange={(e) => { const { r, g, b } = hexToRgb(e.target.value); set('Key color', { color: { r: r / 255, g: g / 255, b: b / 255 } }); }} />
              <button className={`btn sm ${picking ? 'primary' : ''}`} onClick={pick} title="Pick the key color from the preview">
                <Pipette size={13} /> {picking ? 'Click preview…' : 'Pick'}
              </button>
              <button className="btn sm ghost" onClick={() => set('Key color', { color: { r: 0, g: 1, b: 0 } }, false)} title="Green">G</button>
              <button className="btn sm ghost" onClick={() => set('Key color', { color: { r: 0, g: 0.3, b: 1 } }, false)} title="Blue">B</button>
            </div>
            <AnimSlider clip={clip} label="Strength" prop={c.strength} fallback={0.4} min={0} max={1} step={0.005} defaultValue={0.4} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ chroma: { ...c, strength: a } })} historyLabel="Chroma strength" />
            <AnimSlider clip={clip} label="Smoothness" prop={c.smoothness} fallback={0.1} min={0} max={1} step={0.005} defaultValue={0.1} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ chroma: { ...c, smoothness: a } })} historyLabel="Chroma smoothness" />
            <AnimSlider clip={clip} label="Spill removal" prop={c.spill} fallback={0.5} min={0} max={1} step={0.01} defaultValue={0.5} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ chroma: { ...c, spill: a } })} historyLabel="Spill" />
            <AnimSlider clip={clip} label="Edge softness" prop={c.edgeSoftness} fallback={0.02} min={0} max={0.2} step={0.001} defaultValue={0.02} format={(v) => `${Math.round(v * 500)}%`} set={(a) => ({ chroma: { ...c, edgeSoftness: a } })} historyLabel="Edge softness" />
            <AnimSlider clip={clip} label="Shadow preservation" prop={c.shadowPreservation} fallback={0.3} min={0} max={1} step={0.01} defaultValue={0.3} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ chroma: { ...c, shadowPreservation: a } })} historyLabel="Shadow preservation" />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm ghost" onClick={() => patchClip(clip.id, 'Remove chroma key', { chroma: null } as any, false)}>
                <Trash2 size={13} /> Remove
              </button>
            </div>
          </>
        )}
      </Section>
      <Section title="Background replacement" id="chroma-bg" defaultOpen={false}>
        <div className="muted small">
          Put the keyed clip on an <b>upper</b> track and place the new background (video, image or color) on the track below it. The transparent areas reveal the background.
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => { useUI.getState().setLeftPanel('media'); useUI.getState().set({ leftOpen: true }); }}>
            <Layers size={13} /> Choose background media
          </button>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>No green screen? Use <b>AI → Remove background</b> (person segmentation model) instead.</div>
      </Section>
    </>
  );
}

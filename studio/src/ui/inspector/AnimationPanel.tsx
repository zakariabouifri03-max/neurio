import React, { useState } from 'react';
import type { VisualClip, TextAnimation, TextAnimUnit } from '@/core/types';
import { patchClip, useProject, usePlayback } from '@/core/store';
import { Section, Slider, SelectRow, Empty } from '../common';
import { MOTION_PRESETS, type MotionPreset } from '@/library/animationPresets';
import { IN_OUT_ANIMATIONS, LOOP_ANIMATIONS } from '@/library/textAnimations';
import { STICKER_ANIMATIONS } from '@/library/stickers';
import { usePresets } from '@/services/favorites';
import { hasKeyframes } from '@/core/keyframes';
import { Play, Save, RotateCcw } from 'lucide-react';

export function AnimationPanel({ clip }: { clip: VisualClip }) {
  const project = useProject((s) => s.project)!;
  const [inDur, setInDur] = useState(0.6);
  const [outDur, setOutDur] = useState(0.6);
  const presets = usePresets((s) => s.presets.filter((p) => p.kind === 'animation'));
  const t = clip.transform;
  const animated = hasKeyframes(t.position) || hasKeyframes(t.scale) || hasKeyframes(t.rotation) || hasKeyframes(t.opacity);

  const applyMotion = (m: MotionPreset) => {
    const d = m.kind === 'in' ? inDur : outDur;
    const patch = m.build(clip.transform, clip.duration, project.settings.width, project.settings.height, Math.min(d, clip.duration / 2));
    // merge: keep other keyframes; for in/out combine with existing keyframes on same property when possible
    const nt = { ...clip.transform };
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      const incoming = patch[k] as any;
      const existing = (clip.transform as any)[k];
      if ((m.kind === 'in' || m.kind === 'out') && existing?.keyframes?.length) {
        // keep keyframes on the opposite half
        const keep = existing.keyframes.filter((kf: any) => (m.kind === 'in' ? kf.time > clip.duration / 2 : kf.time < clip.duration / 2));
        incoming.keyframes = [...keep, ...incoming.keyframes].sort((a: any, b: any) => a.time - b.time);
      }
      (nt as any)[k] = incoming;
    }
    patchClip(clip.id, `Animation: ${m.name}`, { transform: nt } as any, false);
    usePlayback.getState().seek(m.kind === 'out' ? Math.max(0, clip.start + clip.duration - d - 0.2) : clip.start);
  };
  const preview = () => {
    usePlayback.getState().seek(clip.start);
    void import('@/engine/PlaybackEngine').then(({ engine }) => engine.play());
  };
  const clearMotion = () => patchClip(clip.id, 'Clear animation', { transform: { ...clip.transform, position: { value: t.position.value }, scale: { value: t.scale.value }, rotation: { value: t.rotation.value }, opacity: { value: t.opacity.value } } } as any, false);

  return (
    <>
      {(clip.kind === 'text' || clip.kind === 'caption') && <TextAnimationSection clip={clip} />}
      {clip.kind === 'sticker' && (
        <Section title="Sticker animation" id="anim-sticker">
          <div className="preset-grid cols-3">
            {STICKER_ANIMATIONS.map((a) => (
              <button key={a.id} className={`preset ${(clip.animation ?? 'none') === a.id ? 'active' : ''}`} onClick={() => patchClip(clip.id, 'Sticker animation', { animation: a.id === 'none' ? null : a.id } as any, false)}>
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section
        title="Motion presets (keyframes)"
        id="anim-motion"
        actions={
          <>
            <button className="icon-btn sm" title="Preview from clip start" onClick={preview}><Play size={12} /></button>
            {animated && <button className="icon-btn sm" title="Save as animation preset" onClick={() => { const n = prompt('Preset name', 'My animation'); if (n) usePresets.getState().add('animation', n, { transform: clip.transform, duration: clip.duration }); }}><Save size={12} /></button>}
            {animated && <button className="icon-btn sm" title="Remove motion keyframes" onClick={clearMotion}><RotateCcw size={12} /></button>}
          </>
        }
      >
        <div className="muted small" style={{ marginBottom: 6 }}>Presets write real keyframes you can fine-tune in the Keyframes tab.</div>
        <div className="sub">In</div>
        <Slider label="Duration" value={inDur} min={0.1} max={3} step={0.05} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={setInDur} />
        <div className="preset-grid cols-4">
          {MOTION_PRESETS.filter((m) => m.kind === 'in').map((m) => (
            <button key={m.id} className="preset" onClick={() => applyMotion(m)} title={m.name}>
              <span className="ico">{m.icon}</span>
              <span>{m.name.replace(/^(Slide from|Fade|Zoom) /, '')}</span>
            </button>
          ))}
        </div>
        <div className="sub">Out</div>
        <Slider label="Duration" value={outDur} min={0.1} max={3} step={0.05} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={setOutDur} />
        <div className="preset-grid cols-4">
          {MOTION_PRESETS.filter((m) => m.kind === 'out').map((m) => (
            <button key={m.id} className="preset" onClick={() => applyMotion(m)} title={m.name}>
              <span className="ico">{m.icon}</span>
              <span>{m.name.replace(/^(Slide to|Fade|Zoom) /, '')}</span>
            </button>
          ))}
        </div>
        <div className="sub">Whole clip</div>
        <div className="preset-grid cols-4">
          {MOTION_PRESETS.filter((m) => m.kind === 'motion' || m.kind === 'loop').map((m) => (
            <button key={m.id} className="preset" onClick={() => applyMotion(m)} title={m.name}>
              <span className="ico">{m.icon}</span>
              <span>{m.name}</span>
            </button>
          ))}
        </div>
        {presets.length > 0 && (
          <>
            <div className="sub">My presets</div>
            <div className="chips">
              {presets.map((p) => (
                <button key={p.id} className="chip" title="Click to apply · right-click to delete" onClick={() => { const d = p.data as { transform: VisualClip['transform']; duration: number }; const f = clip.duration / (d.duration || clip.duration); const scaleKf = (a: any) => ({ ...a, keyframes: a.keyframes?.map((k: any) => ({ ...k, time: k.time * f })) }); patchClip(clip.id, 'Apply animation preset', { transform: { ...clip.transform, position: scaleKf(d.transform.position), scale: scaleKf(d.transform.scale), rotation: scaleKf(d.transform.rotation), opacity: scaleKf(d.transform.opacity) } } as any, false); }} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete preset "${p.name}"?`)) usePresets.getState().remove(p.id); }}>
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </Section>
      {!animated && clip.kind !== 'text' && clip.kind !== 'caption' && clip.kind !== 'sticker' && <Empty>Tip: enable the ◇ keyframe button next to any slider to animate it manually.</Empty>}
    </>
  );
}

const UNITS: { value: TextAnimUnit; label: string }[] = [
  { value: 'block', label: 'Whole text' },
  { value: 'line', label: 'By line' },
  { value: 'word', label: 'By word' },
  { value: 'char', label: 'By character' },
];

export function TextAnimationSection({ clip }: { clip: VisualClip & { animation: TextAnimation } }) {
  const a = clip.animation;
  const set = (patch: Partial<TextAnimation>, merge = true) => patchClip(clip.id, 'Text animation', { animation: { ...(a as TextAnimation), ...patch } } as any, merge);
  const maxD = Math.max(0.1, clip.duration / 2);
  const Grid = ({ value, onPick }: { value: string; onPick: (id: string) => void }) => (
    <div className="preset-grid cols-4">
      {IN_OUT_ANIMATIONS.map((x) => (
        <button key={x.id} className={`preset ${value === x.id ? 'active' : ''}`} onClick={() => onPick(x.id)} title={x.name}>
          <span className="ico">{x.icon}</span>
          <span>{x.name}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      <Section title="Text in" id="anim-text-in">
        <Grid value={a.in.type} onPick={(id) => { set({ in: { ...a.in, type: id } }, false); usePlayback.getState().seek(clip.start); }} />
        <Slider label="Duration" value={a.in.duration} min={0} max={maxD} step={0.05} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set({ in: { ...a.in, duration: v } })} />
        <SelectRow label="Animate" value={a.in.unit} options={UNITS} onChange={(v) => set({ in: { ...a.in, unit: v as TextAnimUnit } }, false)} />
        {a.in.unit !== 'block' && <Slider label="Stagger" value={a.in.stagger} min={0} max={0.5} step={0.01} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set({ in: { ...a.in, stagger: v } })} />}
      </Section>
      <Section title="Text out" id="anim-text-out" defaultOpen={false}>
        <Grid value={a.out.type} onPick={(id) => { set({ out: { ...a.out, type: id } }, false); usePlayback.getState().seek(Math.max(0, clip.start + clip.duration - a.out.duration - 0.1)); }} />
        <Slider label="Duration" value={a.out.duration} min={0} max={maxD} step={0.05} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set({ out: { ...a.out, duration: v } })} />
        <SelectRow label="Animate" value={a.out.unit} options={UNITS} onChange={(v) => set({ out: { ...a.out, unit: v as TextAnimUnit } }, false)} />
        {a.out.unit !== 'block' && <Slider label="Stagger" value={a.out.stagger} min={0} max={0.5} step={0.01} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={(v) => set({ out: { ...a.out, stagger: v } })} />}
      </Section>
      <Section title="Loop" id="anim-text-loop" defaultOpen={!!a.loop}>
        <div className="preset-grid cols-4">
          <button className={`preset ${!a.loop ? 'active' : ''}`} onClick={() => set({ loop: null }, false)}>
            <span className="ico">—</span>
            <span>None</span>
          </button>
          {LOOP_ANIMATIONS.map((x) => (
            <button key={x.id} className={`preset ${a.loop?.type === x.id ? 'active' : ''}`} onClick={() => set({ loop: { type: x.id, speed: a.loop?.speed ?? 1, intensity: a.loop?.intensity ?? 1 } }, false)} title={x.name}>
              <span className="ico">{x.icon}</span>
              <span>{x.name}</span>
            </button>
          ))}
        </div>
        {a.loop && (
          <>
            <Slider label="Speed" value={a.loop.speed} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => set({ loop: { ...a.loop!, speed: v } })} />
            <Slider label="Intensity" value={a.loop.intensity} min={0} max={3} step={0.05} onChange={(v) => set({ loop: { ...a.loop!, intensity: v } })} />
          </>
        )}
      </Section>
    </>
  );
}

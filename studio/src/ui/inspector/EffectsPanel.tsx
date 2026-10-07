import React from 'react';
import type { VisualClip, EffectInstance } from '@/core/types';
import { patchClip } from '@/core/store';
import { useUI } from '@/core/uiStore';
import { getEffect } from '@/library/effects';
import { Section, Empty } from '../common';
import { AnimSlider } from './anim';
import { usePresets } from '@/services/favorites';
import { Eye, EyeOff, Trash2, ChevronUp, ChevronDown, Plus, Save, RotateCcw } from 'lucide-react';
import { uid, deepClone } from '@/core/util';

export function EffectsPanel({ clip }: { clip: VisualClip }) {
  const effects = clip.effects;
  const set = (label: string, fx: EffectInstance[], merge = true) => patchClip(clip.id, label, { effects: fx } as any, merge);
  const presets = usePresets((s) => s.presets.filter((p) => p.kind === 'effect'));
  return (
    <>
      <div className="row" style={{ padding: '10px 10px 0' }}>
        <button className="btn sm primary" onClick={() => { useUI.getState().setLeftPanel('effects'); useUI.getState().set({ leftOpen: true }); }}>
          <Plus size={13} /> Add effect
        </button>
        {effects.length > 0 && (
          <>
            <button className="btn sm ghost" title="Save effect stack as preset" onClick={() => { const n = prompt('Preset name', 'My effect stack'); if (n) usePresets.getState().add('effect', n, effects); }}>
              <Save size={13} />
            </button>
            <button className="btn sm ghost" title="Remove all effects" onClick={() => set('Clear effects', [], false)}>
              <RotateCcw size={13} />
            </button>
          </>
        )}
      </div>
      {presets.length > 0 && (
        <div className="chips" style={{ padding: '8px 10px 0' }}>
          {presets.map((p) => (
            <button key={p.id} className="chip" onClick={() => set('Apply effect preset', [...effects, ...deepClone(p.data as EffectInstance[]).map((e) => ({ ...e, id: uid('fx') }))], false)} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete preset "${p.name}"?`)) usePresets.getState().remove(p.id); }} title="Click to apply · right-click to delete">
              {p.name}
            </button>
          ))}
        </div>
      )}
      {effects.length === 0 && <Empty>No effects on this clip. Browse the Effects panel and click an effect to add it.</Empty>}
      {effects.map((fx, i) => {
        const def = getEffect(fx.type);
        return (
          <Section
            key={fx.id}
            title={`${def?.icon ?? ''} ${def?.name ?? fx.type}`}
            id={`fx-${fx.id}`}
            actions={
              <>
                <button className="icon-btn sm" title={fx.enabled ? 'Disable' : 'Enable'} onClick={() => set('Toggle effect', effects.map((e) => (e.id === fx.id ? { ...e, enabled: !e.enabled } : e)), false)}>
                  {fx.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button className="icon-btn sm" title="Move up" disabled={i === 0} onClick={() => set('Reorder effects', swap(effects, i, i - 1), false)}>
                  <ChevronUp size={12} />
                </button>
                <button className="icon-btn sm" title="Move down" disabled={i === effects.length - 1} onClick={() => set('Reorder effects', swap(effects, i, i + 1), false)}>
                  <ChevronDown size={12} />
                </button>
                <button className="icon-btn sm" title="Remove" onClick={() => set('Remove effect', effects.filter((e) => e.id !== fx.id), false)}>
                  <Trash2 size={12} />
                </button>
              </>
            }
          >
            {!def && <div className="muted small">Unknown effect type "{fx.type}"</div>}
            {def?.params.map((pd) => (
              <AnimSlider
                key={pd.key}
                clip={clip}
                label={pd.label}
                prop={fx.params[pd.key]}
                fallback={pd.default}
                min={pd.min}
                max={pd.max}
                step={pd.step ?? (pd.max - pd.min) / 200}
                defaultValue={pd.default}
                set={(a) => ({ effects: clip.effects.map((e) => (e.id === fx.id ? { ...e, params: { ...e.params, [pd.key]: a } } : e)) })}
                historyLabel={`Effect ${pd.label}`}
              />
            ))}
            {def && def.params.length === 0 && <div className="muted small">This effect has no parameters.</div>}
          </Section>
        );
      })}
    </>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = [...arr];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

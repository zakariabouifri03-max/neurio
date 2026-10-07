import React from 'react';
import { useProject } from '@/core/store';
import { useUI } from '@/core/uiStore';
import { SOCIAL_PRESETS } from '@/core/defaults';
import { Section, SelectRow, ColorRow, Empty } from '../common';
import { Row, NumberField } from './anim';
import { Film, MousePointerClick } from 'lucide-react';
import * as cmd from '@/core/commands';
import { formatDuration } from '@/core/util';

/** Shown in the inspector when nothing is selected. */
export function ProjectSettingsPanel() {
  const project = useProject((s) => s.project)!;
  const s = project.settings;
  const apply = (label: string, patch: Partial<typeof s>) => useProject.getState().apply(label, (p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const preset = SOCIAL_PRESETS.find((p) => p.id === s.presetId);
  const clips = cmd.allClips(project).length;
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <Film size={14} />
        <span style={{ fontWeight: 600 }}>Project</span>
      </div>
      <div className="inspector-body">
        <Section title="Canvas" id="proj-canvas">
          <SelectRow
            label="Preset"
            value={preset ? s.presetId : 'custom'}
            options={[...SOCIAL_PRESETS.map((p) => ({ value: p.id, label: `${p.label} · ${p.width}×${p.height}` })), { value: 'custom', label: 'Custom' }]}
            onChange={(id) => {
              const p = SOCIAL_PRESETS.find((x) => x.id === id);
              if (p) apply('Canvas preset', { presetId: p.id, width: p.width, height: p.height, fps: p.fps });
              else apply('Canvas preset', { presetId: 'custom' });
            }}
          />
          <Row label="Size">
            <NumberField value={s.width} min={16} max={7680} step={2} onChange={(v) => apply('Canvas size', { width: Math.round(v / 2) * 2, presetId: 'custom' })} />
            <span className="muted">×</span>
            <NumberField value={s.height} min={16} max={7680} step={2} onChange={(v) => apply('Canvas size', { height: Math.round(v / 2) * 2, presetId: 'custom' })} />
          </Row>
          <div className="chips">
            {[
              ['9:16', 1080, 1920],
              ['16:9', 1920, 1080],
              ['1:1', 1080, 1080],
              ['4:5', 1080, 1350],
              ['4:3', 1440, 1080],
              ['21:9', 2560, 1080],
            ].map(([l, w, h]) => (
              <button key={l as string} className={`chip ${s.width === w && s.height === h ? 'active' : ''}`} onClick={() => apply('Aspect', { width: w as number, height: h as number, presetId: 'custom' })}>
                {l}
              </button>
            ))}
          </div>
          <SelectRow label="Frame rate" value={String(s.fps)} options={[24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} fps` }))} onChange={(v) => apply('Frame rate', { fps: parseInt(v) })} />
          <ColorRow label="Background" value={s.background} onChange={(v) => apply('Background', { background: v || '#000000' })} />
        </Section>
        <Section title="Summary" id="proj-summary">
          <Row label="Duration"><span>{formatDuration(cmd.projectDuration(project))}</span></Row>
          <Row label="Tracks"><span>{project.tracks.length}</span></Row>
          <Row label="Clips"><span>{clips}</span></Row>
          <Row label="Markers"><span>{project.markers.length}</span></Row>
        </Section>
        {clips === 0 ? (
          <Empty icon={<MousePointerClick size={22} />}>Import media from the left panel and drag it to the timeline to start editing.</Empty>
        ) : (
          <Empty icon={<MousePointerClick size={22} />}>Select a clip in the timeline or preview to edit its properties.</Empty>
        )}
        <div style={{ padding: 10 }}>
          <button className="btn" style={{ width: '100%' }} onClick={() => useUI.getState().openDialog({ kind: 'settings' })}>
            Project settings & preferences…
          </button>
        </div>
      </div>
    </aside>
  );
}

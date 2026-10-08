import { useState } from 'react';
import { useEditor } from '../store/editorStore';
import { Icons } from '../components/Icons';
import { findClip, findTrack } from '../../core/timeline/queries';
import { effectRegistry } from '../../core/effects/registry';
import { AUDIO_PROCESS_LABELS } from '../../core/audio/chain';
import type { AudioProcessId } from '../../core/types/timeline';
import { gainToDb, dbToGain } from '../../core/ai/editorApi';
import { clsx } from 'clsx';

/**
 * Inspector.
 *
 * Contextual properties for the current selection: transform, speed, audio,
 * effects and text. Every control writes through `setClip`, so inspector edits
 * are undoable exactly like timeline edits.
 */

export function InspectorPanel() {
  const project = useEditor((s) => s.project);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const selectedTrackId = useEditor((s) => s.selectedTrackId);
  const { setClip, addEffectToClip, removeEffectFromClip, setEffectParam, toggleEffect, setKeyframeOnClip } =
    useEditor.getState();

  const clip = selectedClipIds.length === 1 ? findClip(project.sequence, selectedClipIds[0]!) : undefined;
  const track = selectedTrackId ? findTrack(project.sequence, selectedTrackId) : undefined;

  if (selectedClipIds.length > 1) {
    return (
      <PanelShell title="Inspector">
        <div className="p-3 text-[12px] text-ink-400">
          <p className="text-ink-200 font-medium mb-1">{selectedClipIds.length} clips selected</p>
          <p className="leading-relaxed">
            Multi-selection supports move, delete and ripple delete. Select a single clip to edit its properties.
          </p>
        </div>
      </PanelShell>
    );
  }

  if (!clip) {
    return (
      <PanelShell title="Inspector">
        {track ? (
          <TrackInspector trackId={track.id} trackName={track.name} gain={track.gain} />
        ) : (
          <div className="p-4 text-[12px] text-ink-500 leading-relaxed">
            Select a clip on the timeline to edit its transform, speed, audio and effects.
            <div className="divider" />
            <p className="text-ink-600 text-[11px]">
              Tip: press <Kbd>S</Kbd> to split at the playhead, <Kbd>Del</Kbd> to delete and <Kbd>Shift</Kbd>+
              <Kbd>Del</Kbd> to ripple delete.
            </p>
          </div>
        )}
      </PanelShell>
    );
  }

  const isText = clip.kind === 'text' || clip.kind === 'subtitle';
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;

  return (
    <PanelShell title="Inspector">
      <div className="p-3 space-y-3">
        <div>
          <div className="text-[12px] font-medium text-ink-100 truncate">{clip.name}</div>
          <div className="text-[10px] text-ink-500 mono">
            {clip.timeline.start.toFixed(2)}s → {(clip.timeline.start + clip.timeline.duration).toFixed(2)}s ·{' '}
            {clip.timeline.duration.toFixed(2)}s
            {asset ? ` · ${asset.name}` : ''}
          </div>
        </div>

        {clip.isOffline && (
          <div className="rounded-md border border-accent-danger/40 bg-accent-danger/10 px-2 py-1.5 text-[11px] text-accent-danger flex items-start gap-1.5">
            <Icons.Warning size={13} className="mt-0.5 shrink-0" />
            <span>This clip&apos;s media file is missing. Relink it in the Media panel.</span>
          </div>
        )}

        {/* Transform */}
        <Section title="Transform">
          <SliderRow
            label="Position X"
            value={clip.transform.x}
            min={-1}
            max={1}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => setClip(clip.id, { transform: { ...clip.transform, x: v } }, 'Move clip')}
            onKeyframe={() => setKeyframeOnClip(clip.id, 'position.x', 0, clip.transform.x)}
          />
          <SliderRow
            label="Position Y"
            value={clip.transform.y}
            min={-1}
            max={1}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => setClip(clip.id, { transform: { ...clip.transform, y: v } }, 'Move clip')}
            onKeyframe={() => setKeyframeOnClip(clip.id, 'position.y', 0, clip.transform.y)}
          />
          <SliderRow
            label="Scale"
            value={clip.transform.scale}
            min={0.1}
            max={4}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => setClip(clip.id, { transform: { ...clip.transform, scale: v } }, 'Scale clip')}
            onKeyframe={() => setKeyframeOnClip(clip.id, 'scale', 0, clip.transform.scale)}
          />
          <SliderRow
            label="Rotation"
            value={clip.transform.rotationDeg}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={(v) => setClip(clip.id, { transform: { ...clip.transform, rotationDeg: v } }, 'Rotate clip')}
            onKeyframe={() => setKeyframeOnClip(clip.id, 'rotation', 0, clip.transform.rotationDeg)}
          />
          <SliderRow
            label="Opacity"
            value={clip.transform.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => setClip(clip.id, { transform: { ...clip.transform, opacity: v } }, 'Opacity')}
            onKeyframe={() => setKeyframeOnClip(clip.id, 'opacity', 0, clip.transform.opacity)}
          />
          <div className="flex gap-1 pt-1">
            <button
              className={clsx('btn h-6 px-2 text-[10px] flex-1', clip.transform.flipX && 'icon-btn-on')}
              onClick={() => setClip(clip.id, { transform: { ...clip.transform, flipX: !clip.transform.flipX } }, 'Flip X')}
            >
              Flip X
            </button>
            <button
              className={clsx('btn h-6 px-2 text-[10px] flex-1', clip.transform.flipY && 'icon-btn-on')}
              onClick={() => setClip(clip.id, { transform: { ...clip.transform, flipY: !clip.transform.flipY } }, 'Flip Y')}
            >
              Flip Y
            </button>
          </div>
        </Section>

        {/* Crop */}
        <Section title="Crop">
          <div className="grid grid-cols-2 gap-1.5">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <SliderRow
                key={side}
                label={side[0]!.toUpperCase() + side.slice(1)}
                compact
                value={clip.transform.crop[side]}
                min={0}
                max={0.49}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) =>
                  setClip(clip.id, { transform: { ...clip.transform, crop: { ...clip.transform.crop, [side]: v } } }, 'Crop clip')
                }
              />
            ))}
          </div>
          <button
            className="btn-ghost h-6 text-[10px] w-full"
            onClick={() =>
              setClip(clip.id, { transform: { ...clip.transform, crop: { top: 0, right: 0, bottom: 0, left: 0 } } }, 'Reset crop')
            }
          >
            Reset crop
          </button>
        </Section>

        {/* Speed */}
        <Section title="Speed">
          <SliderRow
            label="Rate"
            value={clip.speed}
            min={0.1}
            max={8}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setClip(clip.id, { speed: v }, 'Change speed')}
          />
          <div className="flex gap-1 flex-wrap pt-1">
            {[0.5, 1, 1.5, 2, 4].map((r) => (
              <button
                key={r}
                className={clsx('btn h-6 px-2 text-[10px]', Math.abs(clip.speed - r) < 0.001 && 'icon-btn-on')}
                onClick={() => setClip(clip.id, { speed: r }, 'Change speed')}
              >
                {r}×
              </button>
            ))}
            <button
              className={clsx('btn h-6 px-2 text-[10px]', clip.reverse && 'icon-btn-on')}
              onClick={() => setClip(clip.id, { reverse: !clip.reverse }, 'Reverse clip')}
              title="Reverse"
            >
              Reverse
            </button>
          </div>
        </Section>

        {/* Audio */}
        {!isText && (
          <Section title="Audio">
            <SliderRow
              label="Volume"
              value={gainToDb(clip.audio.volume)}
              min={-40}
              max={12}
              step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setClip(clip.id, { audio: { ...clip.audio, volume: dbToGain(v) } }, 'Volume')}
              onKeyframe={() => setKeyframeOnClip(clip.id, 'volume', 0, clip.audio.volume)}
            />
            <SliderRow
              label="Pan"
              value={clip.audio.pan}
              min={-1}
              max={1}
              step={0.01}
              format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.abs(v * 100).toFixed(0)}` : `R${(v * 100).toFixed(0)}`)}
              onChange={(v) => setClip(clip.id, { audio: { ...clip.audio, pan: v } }, 'Pan')}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <SliderRow
                label="Fade in"
                compact
                value={clip.audio.fadeInSec}
                min={0}
                max={5}
                step={0.05}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => setClip(clip.id, { audio: { ...clip.audio, fadeInSec: v } }, 'Fade in')}
              />
              <SliderRow
                label="Fade out"
                compact
                value={clip.audio.fadeOutSec}
                min={0}
                max={5}
                step={0.05}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) => setClip(clip.id, { audio: { ...clip.audio, fadeOutSec: v } }, 'Fade out')}
              />
            </div>
            <button
              className={clsx('btn h-6 px-2 text-[10px] w-full', clip.audio.muted && 'icon-btn-on')}
              onClick={() => setClip(clip.id, { audio: { ...clip.audio, muted: !clip.audio.muted } }, 'Mute clip')}
            >
              {clip.audio.muted ? 'Unmute clip' : 'Mute clip'}
            </button>
            <div className="pt-1">
              <span className="field-label">Audio processing (non-destructive)</span>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(AUDIO_PROCESS_LABELS) as AudioProcessId[]).map((id) => {
                  const on = clip.audio.chain.includes(id);
                  return (
                    <button
                      key={id}
                      className={clsx('chip', on ? 'border-brand-500/60 bg-brand-600/20 text-brand-300' : 'border-ink-700 text-ink-400 hover:text-ink-200')}
                      onClick={() =>
                        setClip(
                          clip.id,
                          {
                            audio: {
                              ...clip.audio,
                              chain: on ? clip.audio.chain.filter((c) => c !== id) : [...clip.audio.chain, id],
                            },
                          },
                          'Audio processing',
                        )
                      }
                      title={AUDIO_PROCESS_LABELS[id]}
                    >
                      {AUDIO_PROCESS_LABELS[id]}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>
        )}

        {/* Text */}
        {isText && clip.text && <TextInspector clipId={clip.id} />}

        {/* Effects */}
        <Section title="Effects">
          {clip.effects.length === 0 && <p className="text-[11px] text-ink-500">No effects on this clip.</p>}
          {clip.effects.map((instance) => {
            const def = effectRegistry.get(instance.effectId);
            if (!def) return null;
            return (
              <div key={instance.id} className="rounded-md border border-ink-700 bg-ink-850 p-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    className={clsx('icon-btn w-5 h-5', instance.enabled && 'icon-btn-on')}
                    onClick={() => toggleEffect(clip.id, instance.id)}
                    title={instance.enabled ? 'Disable' : 'Enable'}
                  >
                    <Icons.Eye size={11} />
                  </button>
                  <span className="text-[11px] text-ink-100 flex-1">{def.name}</span>
                  <button
                    className="text-ink-500 hover:text-accent-danger"
                    onClick={() => removeEffectFromClip(clip.id, instance.id)}
                    title="Remove effect"
                  >
                    <Icons.Close size={11} />
                  </button>
                </div>
                {def.previewable || (
                  <p className="text-[9px] text-accent-warm/80 mt-1">Applied at export; the preview shows the original.</p>
                )}
                <div className="mt-1.5 space-y-1">
                  {def.params.map((param) => {
                    const raw = instance.params[param.id] ?? param.default;
                    if (param.type === 'bool') {
                      return (
                        <label key={param.id} className="flex items-center gap-2 text-[11px] text-ink-300">
                          <input
                            type="checkbox"
                            checked={Boolean(raw)}
                            onChange={(e) => setEffectParam(clip.id, instance.id, param.id, e.target.checked)}
                          />
                          {param.label}
                        </label>
                      );
                    }
                    if (param.type === 'enum') {
                      return (
                        <label key={param.id} className="block">
                          <span className="field-label">{param.label}</span>
                          <select
                            className="field h-7 text-[11px]"
                            value={String(raw)}
                            onChange={(e) => setEffectParam(clip.id, instance.id, param.id, e.target.value)}
                          >
                            {(param.options ?? []).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }
                    if (param.type === 'color') {
                      return (
                        <label key={param.id} className="flex items-center gap-2">
                          <span className="field-label mb-0 flex-1">{param.label}</span>
                          <input
                            type="color"
                            className="w-8 h-6 rounded bg-transparent border border-ink-700"
                            value={String(raw)}
                            onChange={(e) => setEffectParam(clip.id, instance.id, param.id, e.target.value)}
                          />
                        </label>
                      );
                    }
                    if (param.type === 'string') {
                      return (
                        <label key={param.id} className="block">
                          <span className="field-label">{param.label}</span>
                          <input
                            className="field h-7 text-[11px]"
                            value={String(raw)}
                            placeholder="Path to file…"
                            onChange={(e) => setEffectParam(clip.id, instance.id, param.id, e.target.value)}
                          />
                        </label>
                      );
                    }
                    return (
                      <SliderRow
                        key={param.id}
                        label={param.label}
                        compact
                        value={Number(raw)}
                        min={param.min ?? 0}
                        max={param.max ?? 1}
                        step={param.step ?? 0.01}
                        unit={param.unit}
                        format={(v) => `${v.toFixed(param.step && param.step >= 1 ? 0 : 2)}${param.unit ?? ''}`}
                        onChange={(v) => setEffectParam(clip.id, instance.id, param.id, v)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          <AddEffectMenu onAdd={(effectId) => addEffectToClip(clip.id, effectId)} />
        </Section>
      </div>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ */

function TextInspector({ clipId }: { clipId: string }) {
  const project = useEditor((s) => s.project);
  const clip = findClip(project.sequence, clipId);
  const { setClip } = useEditor.getState();
  if (!clip?.text) return null;
  const text = clip.text;
  const update = (patch: Partial<typeof text>, label: string) => setClip(clipId, { text: { ...text, ...patch } }, label);

  return (
    <Section title="Text">
      <label className="block">
        <span className="field-label">Content</span>
        <textarea
          className="field h-16 py-1.5 resize-none"
          value={text.text}
          onChange={(e) => update({ text: e.target.value }, 'Edit text')}
        />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="block">
          <span className="field-label">Size</span>
          <input
            type="number"
            className="field h-7 text-[11px]"
            value={text.fontSizePx}
            min={8}
            max={400}
            onChange={(e) => update({ fontSizePx: Number(e.target.value) }, 'Text size')}
          />
        </label>
        <label className="block">
          <span className="field-label">Weight</span>
          <select
            className="field h-7 text-[11px]"
            value={text.fontWeight}
            onChange={(e) => update({ fontWeight: Number(e.target.value) }, 'Text weight')}
          >
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-2 text-[11px] text-ink-300">
          <span className="flex-1">Colour</span>
          <input
            type="color"
            className="w-8 h-6 rounded bg-transparent border border-ink-700"
            value={text.color}
            onChange={(e) => update({ color: e.target.value }, 'Text colour')}
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-ink-300">
          <span className="flex-1">Stroke</span>
          <input
            type="color"
            className="w-8 h-6 rounded bg-transparent border border-ink-700"
            value={text.strokeColor}
            onChange={(e) => update({ strokeColor: e.target.value }, 'Stroke colour')}
          />
        </label>
      </div>
      <SliderRow
        label="Stroke width"
        value={text.strokeWidthPx}
        min={0}
        max={20}
        step={0.5}
        format={(v) => `${v.toFixed(1)}px`}
        onChange={(v) => update({ strokeWidthPx: v }, 'Stroke width')}
      />
      <div className="flex gap-1">
        {(['left', 'center', 'right'] as const).map((align) => (
          <button
            key={align}
            className={clsx('btn h-6 px-2 text-[10px] flex-1 capitalize', text.align === align && 'icon-btn-on')}
            onClick={() => update({ align }, 'Align text')}
          >
            {align}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-ink-300">
        <input type="checkbox" checked={text.uppercase} onChange={(e) => update({ uppercase: e.target.checked }, 'Uppercase')} />
        UPPERCASE
      </label>
    </Section>
  );
}

function TrackInspector({ trackId, trackName, gain }: { trackId: string; trackName: string; gain: number }) {
  const { toggleTrackFlag } = useEditor.getState();
  const project = useEditor((s) => s.project);
  const track = findTrack(project.sequence, trackId);
  if (!track) return null;
  return (
    <div className="p-3 space-y-2">
      <div className="text-[12px] font-medium text-ink-100">{trackName}</div>
      <div className="flex gap-1">
        <button className={clsx('btn h-7 text-[11px] flex-1', track.muted && 'icon-btn-on')} onClick={() => toggleTrackFlag(trackId, 'muted')}>
          {track.muted ? 'Unmute' : 'Mute'}
        </button>
        <button className={clsx('btn h-7 text-[11px] flex-1', track.solo && 'icon-btn-on')} onClick={() => toggleTrackFlag(trackId, 'solo')}>
          Solo
        </button>
      </div>
      <div className="text-[10px] text-ink-500">Track gain: {(gain * 100).toFixed(0)}%</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="panel-header">
        <Icons.Settings size={13} />
        <span>{title}</span>
      </div>
      <div className="flex-1 scroll-area">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-ink-800 bg-ink-850/60">
      <button
        className="w-full flex items-center gap-1.5 px-2 h-7 text-[10px] uppercase tracking-wider text-ink-400 hover:text-ink-200"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={clsx('transition-transform', open && 'rotate-90')}>›</span>
        {title}
      </button>
      {open && <div className="px-2 pb-2 space-y-1.5">{children}</div>}
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  compact?: boolean;
  unit?: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onKeyframe?: () => void;
}

export function SliderRow({ label, value, min, max, step, compact, format, onChange, onKeyframe }: SliderRowProps) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div className={clsx(compact ? 'flex items-center gap-1.5' : '')}>
      <div className={clsx('flex items-center gap-1', compact ? 'flex-1 min-w-0' : 'justify-between')}>
        <span className="text-[10px] text-ink-400 truncate">{label}</span>
        {!compact && <span className="mono text-[10px] text-ink-300">{display}</span>}
      </div>
      <div className={clsx('flex items-center gap-1.5', compact ? 'flex-1' : '')}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(Number(e.target.value))}
          className={compact ? 'flex-1' : 'w-full'}
          aria-label={label}
        />
        {compact && <span className="mono text-[9px] text-ink-400 w-10 text-right">{display}</span>}
        {onKeyframe && (
          <button className="icon-btn w-5 h-5 shrink-0" onClick={onKeyframe} title="Add a keyframe at the clip start">
            <Icons.Keyframe size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function AddEffectMenu({ onAdd }: { onAdd: (effectId: string) => void }) {
  const [open, setOpen] = useState(false);
  const categories = effectRegistry.categories();
  return (
    <div className="relative">
      <button className="btn h-7 w-full text-[11px]" onClick={() => setOpen((o) => !o)}>
        <Icons.Plus size={12} />
        Add effect
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 panel max-h-64 scroll-area p-1 z-40">
          {categories.map((category) => (
            <div key={category}>
              <div className="px-1.5 py-1 text-[9px] uppercase tracking-wider text-ink-500">{category}</div>
              {effectRegistry.byCategory(category).map((def) => (
                <button
                  key={def.id}
                  className="w-full text-left px-1.5 py-1 rounded text-[11px] text-ink-200 hover:bg-ink-750"
                  onClick={() => {
                    onAdd(def.id);
                    setOpen(false);
                  }}
                  title={def.description}
                >
                  {def.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1 py-0.5 rounded bg-ink-800 border border-ink-700 text-[10px] mono text-ink-300">{children}</kbd>
  );
}

import React from 'react';
import { useUI, type RightPanel } from '@/core/uiStore';
import { useProject, useSelectedClip, patchClip, usePlayback } from '@/core/store';
import type { Clip, VisualClip, VideoClip, AudioClip, BlendMode, TransitionInstance } from '@/core/types';
import * as cmd from '@/core/commands';
import { Section, Slider, Toggle, SelectRow, ColorRow, Empty } from '../common';
import { AnimSlider, AnimVec2, Row, NumberField } from './anim';
import { SlidersHorizontal, Palette, Sparkles, Wand2, Diamond, Volume2, Scissors, Droplets, Gauge, Activity, Type, ArrowLeftRight, Captions, FlipHorizontal2, FlipVertical2, RotateCcw, Link2 } from 'lucide-react';
import { AdjustPanel } from './AdjustPanel';
import { EffectsPanel } from './EffectsPanel';
import { AnimationPanel } from './AnimationPanel';
import { KeyframesPanel } from './KeyframesPanel';
import { AudioPanel } from './AudioPanel';
import { MaskPanel } from './MaskPanel';
import { ChromaPanel } from './ChromaPanel';
import { TextPanel } from './TextPanel';
import { CaptionsPanel } from './CaptionsPanel';
import { getTransition, TRANSITIONS } from '@/library/transitions';
import { getAsset } from '@/engine/MediaManager';
import { formatTime } from '@/core/util';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';
import { StabilizePanel } from './StabilizePanel';

const TABS: { id: RightPanel; label: string; icon: React.ReactNode; pro?: boolean; kinds: Clip['kind'][] | 'visual' | 'all' | 'audioish' }[] = [
  { id: 'properties', label: 'Properties', icon: <SlidersHorizontal size={15} />, kinds: 'all' },
  { id: 'text', label: 'Text', icon: <Type size={15} />, kinds: ['text', 'caption'] },
  { id: 'captions', label: 'Captions', icon: <Captions size={15} />, kinds: ['caption'] },
  { id: 'adjust', label: 'Adjust', icon: <Palette size={15} />, kinds: 'visual' },
  { id: 'effects', label: 'Effects', icon: <Sparkles size={15} />, kinds: 'visual' },
  { id: 'animation', label: 'Animation', icon: <Wand2 size={15} />, kinds: 'visual' },
  { id: 'keyframes', label: 'Keyframes', icon: <Diamond size={15} />, kinds: 'all', pro: true },
  { id: 'audio', label: 'Audio', icon: <Volume2 size={15} />, kinds: 'audioish' },
  { id: 'speed', label: 'Speed', icon: <Gauge size={15} />, kinds: ['video', 'audio'] },
  { id: 'mask', label: 'Mask', icon: <Scissors size={15} />, kinds: 'visual' },
  { id: 'chroma', label: 'Chroma key', icon: <Droplets size={15} />, kinds: ['video', 'image'] },
  { id: 'stabilize', label: 'Stabilize', icon: <Activity size={15} />, kinds: ['video'], pro: true },
  { id: 'transition', label: 'Transition', icon: <ArrowLeftRight size={15} />, kinds: 'visual' },
];

export const isVisual = (c: Clip): c is VisualClip => c.kind !== 'audio';
const hasAudio = (c: Clip): c is VideoClip | AudioClip => c.kind === 'audio' || (c.kind === 'video' && c.hasAudio && !c.audioDetached);

export function Inspector() {
  const clip = useSelectedClip();
  const panel = useUI((s) => s.rightPanel);
  const mode = useUI((s) => s.mode);
  const selCount = useProject((s) => s.selection.length);

  if (!clip) return <ProjectSettingsPanel />;

  const tabs = TABS.filter((t) => {
    if (t.pro && mode !== 'pro') return false;
    if (t.kinds === 'all') return true;
    if (t.kinds === 'visual') return isVisual(clip);
    if (t.kinds === 'audioish') return hasAudio(clip);
    return t.kinds.includes(clip.kind);
  });
  const active = tabs.find((t) => t.id === panel) ? panel : 'properties';

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => useUI.getState().setRightPanel(t.id)} title={t.label}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="inspector-head">
        <span className={`dot ${clip.kind}`} />
        <input className="clip-name" value={clip.name} onChange={(e) => patchClip(clip.id, 'Rename clip', { name: e.target.value })} />
        {selCount > 1 && <span className="muted small">{selCount} selected</span>}
      </div>
      <div className="inspector-body">
        {active === 'properties' && <PropertiesPanel clip={clip} />}
        {active === 'text' && (clip.kind === 'text' || clip.kind === 'caption') && <TextPanel clip={clip} />}
        {active === 'captions' && clip.kind === 'caption' && <CaptionsPanel clip={clip} />}
        {active === 'adjust' && isVisual(clip) && <AdjustPanel clip={clip} />}
        {active === 'effects' && isVisual(clip) && <EffectsPanel clip={clip} />}
        {active === 'animation' && isVisual(clip) && <AnimationPanel clip={clip} />}
        {active === 'keyframes' && <KeyframesPanel clip={clip} />}
        {active === 'audio' && hasAudio(clip) && <AudioPanel clip={clip} />}
        {active === 'speed' && (clip.kind === 'video' || clip.kind === 'audio') && <SpeedPanel clip={clip} />}
        {active === 'mask' && isVisual(clip) && <MaskPanel clip={clip} />}
        {active === 'chroma' && (clip.kind === 'video' || clip.kind === 'image') && <ChromaPanel clip={clip} />}
        {active === 'stabilize' && clip.kind === 'video' && <StabilizePanel clip={clip} />}
        {active === 'transition' && isVisual(clip) && <TransitionPanel clip={clip} />}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'softlight', 'hardlight'];

function PropertiesPanel({ clip }: { clip: Clip }) {
  const project = useProject((s) => s.project)!;
  const fps = project.settings.fps;
  const mode = useUI((s) => s.mode);
  const pw = project.settings.width, ph = project.settings.height;
  const asset = 'mediaId' in clip && clip.mediaId ? getAsset(clip.mediaId) : undefined;
  const [linkScale, setLinkScale] = React.useState(true);
  return (
    <>
      <Section title="Timing" id="props-timing">
        <Row label="Start">
          <NumberField value={clip.start} step={1 / fps} min={0} unit="s" onChange={(v) => useProject.getState().apply('Move clip', (p) => cmd.moveClip(p, clip.id, v))} />
          <span className="muted small mono">{formatTime(clip.start, fps)}</span>
        </Row>
        <Row label="Duration">
          <NumberField value={clip.duration} step={1 / fps} min={1 / fps} unit="s" onChange={(v) => useProject.getState().apply('Trim', (p) => cmd.trimClip(p, clip.id, 'end', clip.start + v, asset?.duration))} />
          <span className="muted small mono">{formatTime(clip.duration, fps)}</span>
        </Row>
        {'mediaIn' in clip && asset && asset.duration > 0 && (
          <Row label="Source in">
            <span className="mono small">{formatTime(clip.mediaIn, fps)}</span>
            <span className="muted small">of {formatTime(asset.duration, fps)}</span>
          </Row>
        )}
        {asset && (
          <Row label="Media">
            <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asset.name}>
              {asset.name}
            </span>
            {asset.width > 0 && <span className="muted small">{asset.width}×{asset.height}</span>}
          </Row>
        )}
      </Section>
      {isVisual(clip) && (
        <>
          <Section title="Transform" id="props-transform" actions={<><button className={`icon-btn sm ${linkScale ? 'active' : ''}`} title={linkScale ? 'Scale linked (uniform)' : 'Scale unlinked'} onClick={() => setLinkScale(!linkScale)}><Link2 size={12} /></button><button className="icon-btn sm" title="Reset transform" onClick={() => patchClip(clip.id, 'Reset transform', { transform: { ...clip.transform, position: { value: { x: 0, y: 0 } }, scale: { value: { x: 1, y: 1 } }, rotation: { value: 0 } } } as any, false)}><RotateCcw size={12} /></button></>}>
            <AnimVec2 clip={clip} labels={['Position X', 'Position Y']} prop={clip.transform.position} min={-pw} max={pw} step={1} defaultValue={{ x: 0, y: 0 }} set={(a) => ({ transform: { ...clip.transform, position: a } })} format={(v) => `${Math.round(v)}`} historyLabel="Move" />
            <AnimVec2 clip={clip} labels={['Scale X', 'Scale Y']} prop={clip.transform.scale} fallback={{ x: 1, y: 1 }} min={0} max={5} step={0.01} link={linkScale} defaultValue={{ x: 1, y: 1 }} set={(a) => ({ transform: { ...clip.transform, scale: a } })} format={(v) => `${Math.round(v * 100)}%`} historyLabel="Scale" />
            <AnimSlider clip={clip} label="Rotation" prop={clip.transform.rotation} min={-360} max={360} step={0.5} unit="°" defaultValue={0} set={(a) => ({ transform: { ...clip.transform, rotation: a } })} historyLabel="Rotate" />
            <AnimSlider clip={clip} label="Opacity" prop={clip.transform.opacity} fallback={1} min={0} max={1} step={0.01} defaultValue={1} set={(a) => ({ transform: { ...clip.transform, opacity: a } })} format={(v) => `${Math.round(v * 100)}%`} />
            <div className="row">
              <label>Flip</label>
              <button className={`btn sm ${clip.flipH ? 'primary' : ''}`} onClick={() => patchClip(clip.id, 'Flip', { flipH: !clip.flipH } as any, false)} title="Flip horizontal">
                <FlipHorizontal2 size={13} /> H
              </button>
              <button className={`btn sm ${clip.flipV ? 'primary' : ''}`} onClick={() => patchClip(clip.id, 'Flip', { flipV: !clip.flipV } as any, false)} title="Flip vertical">
                <FlipVertical2 size={13} /> V
              </button>
              <button className="btn sm" onClick={() => patchClip(clip.id, 'Rotate 90°', { transform: { ...clip.transform, rotation: { ...clip.transform.rotation, value: ((clip.transform.rotation.value + 90) % 360) } } } as any, false)} title="Rotate 90°">
                90°
              </button>
            </div>
            <div className="row">
              <label>Fit</label>
              <button className="btn sm" onClick={() => fitClip(clip, pw, ph, 'contain')}>Fit</button>
              <button className="btn sm" onClick={() => fitClip(clip, pw, ph, 'cover')}>Fill</button>
              <button className="btn sm" onClick={() => patchClip(clip.id, 'Center', { transform: { ...clip.transform, position: { value: { x: 0, y: 0 } } } } as any, false)}>Center</button>
            </div>
          </Section>
          <Section title="Crop" id="props-crop" defaultOpen={false}>
            {(['left', 'top', 'right', 'bottom'] as const).map((k) => (
              <Slider key={k} label={k[0].toUpperCase() + k.slice(1)} value={clip.crop[k]} min={0} max={0.95} step={0.005} defaultValue={0} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchClip(clip.id, 'Crop', { crop: { ...clip.crop, [k]: v } } as any)} />
            ))}
            <div className="row">
              <label>Aspect</label>
              {[
                ['1:1', 1],
                ['4:5', 0.8],
                ['9:16', 9 / 16],
                ['16:9', 16 / 9],
              ].map(([l, r]) => (
                <button key={l as string} className="btn sm" onClick={() => cropToAspect(clip, r as number)}>
                  {l}
                </button>
              ))}
              <button className="btn sm ghost" onClick={() => patchClip(clip.id, 'Reset crop', { crop: { left: 0, top: 0, right: 0, bottom: 0 } } as any, false)}>Reset</button>
            </div>
          </Section>
          {mode === 'pro' && (
            <Section title="Compositing" id="props-comp" defaultOpen={false}>
              <SelectRow label="Blend mode" value={clip.blend} options={BLENDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={(v) => patchClip(clip.id, 'Blend mode', { blend: v as BlendMode } as any, false)} />
              {clip.kind === 'color' && <ColorRow label="Color" value={clip.color} onChange={(v) => patchClip(clip.id, 'Color', { color: v || '#000000' } as any)} />}
            </Section>
          )}
        </>
      )}
      <Section title="Clip" id="props-clip" defaultOpen={false}>
        <Toggle label="Locked" value={clip.locked} onChange={(v) => patchClip(clip.id, 'Lock', { locked: v }, false)} />
        <ColorRow label="Label color" value={clip.color ?? null} allowNone onChange={(v) => patchClip(clip.id, 'Label color', { color: v ?? undefined } as any, false)} />
      </Section>
    </>
  );
}

function fitClip(clip: VisualClip, pw: number, ph: number, mode: 'contain' | 'cover') {
  const asset = 'mediaId' in clip && clip.mediaId ? getAsset(clip.mediaId) : undefined;
  const aw = asset?.width || pw, ah = asset?.height || ph;
  // scale 1 = contain (see Renderer). cover = max ratio / min ratio
  const contain = Math.min(pw / aw, ph / ah);
  const cover = Math.max(pw / aw, ph / ah);
  const s = mode === 'contain' ? 1 : cover / contain;
  patchClip(clip.id, 'Fit', { transform: { ...clip.transform, scale: { value: { x: s, y: s } }, position: { value: { x: 0, y: 0 } } } } as any, false);
}

function cropToAspect(clip: VisualClip, ratio: number) {
  const asset = 'mediaId' in clip && clip.mediaId ? getAsset(clip.mediaId) : undefined;
  const p = useProject.getState().project!;
  const aw = asset?.width || p.settings.width, ah = asset?.height || p.settings.height;
  const cur = aw / ah;
  let crop = { left: 0, top: 0, right: 0, bottom: 0 };
  if (cur > ratio) {
    const keep = ratio / cur;
    crop = { ...crop, left: (1 - keep) / 2, right: (1 - keep) / 2 };
  } else {
    const keep = cur / ratio;
    crop = { ...crop, top: (1 - keep) / 2, bottom: (1 - keep) / 2 };
  }
  patchClip(clip.id, 'Crop', { crop } as any, false);
}

/* ------------------------------------------------------------------ */
/* Speed                                                               */
/* ------------------------------------------------------------------ */

const SPEED_CURVES: { id: string; name: string; curve: { t: number; speed: number }[] | undefined }[] = [
  { id: 'none', name: 'Constant', curve: undefined },
  { id: 'montage', name: 'Montage', curve: [{ t: 0, speed: 1 }, { t: 0.3, speed: 3 }, { t: 0.5, speed: 0.5 }, { t: 0.7, speed: 3 }, { t: 1, speed: 1 }] },
  { id: 'hero', name: 'Hero', curve: [{ t: 0, speed: 1 }, { t: 0.4, speed: 4 }, { t: 0.5, speed: 0.3 }, { t: 0.6, speed: 4 }, { t: 1, speed: 1 }] },
  { id: 'bullet', name: 'Bullet time', curve: [{ t: 0, speed: 2 }, { t: 0.45, speed: 2 }, { t: 0.5, speed: 0.2 }, { t: 0.55, speed: 2 }, { t: 1, speed: 2 }] },
  { id: 'jumpcut', name: 'Jump cut', curve: [{ t: 0, speed: 1 }, { t: 0.5, speed: 1 }, { t: 0.51, speed: 6 }, { t: 1, speed: 6 }] },
  { id: 'flash_in', name: 'Flash in', curve: [{ t: 0, speed: 6 }, { t: 0.3, speed: 6 }, { t: 0.4, speed: 1 }, { t: 1, speed: 1 }] },
  { id: 'flash_out', name: 'Flash out', curve: [{ t: 0, speed: 1 }, { t: 0.6, speed: 1 }, { t: 0.7, speed: 6 }, { t: 1, speed: 6 }] },
  { id: 'slowmo', name: 'Slow motion', curve: [{ t: 0, speed: 1 }, { t: 0.3, speed: 0.25 }, { t: 0.7, speed: 0.25 }, { t: 1, speed: 1 }] },
];

function SpeedPanel({ clip }: { clip: VideoClip | AudioClip }) {
  const asset = getAsset(clip.mediaId);
  const curve = clip.speed.curve;
  const apply = (label: string, fn: (p: any) => any) => useProject.getState().apply(label, fn);
  return (
    <>
      <Section title="Speed" id="speed-main">
        {!curve && (
          <>
            <Slider label="Rate" value={clip.speed.rate} min={0.1} max={10} step={0.05} format={(v) => `${v.toFixed(2)}x`} defaultValue={1} onChange={(v) => apply('Speed', (p) => cmd.setSpeed(p, clip.id, v, asset?.duration))} />
            <div className="chips" style={{ marginTop: 6 }}>
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8].map((r) => (
                <button key={r} className={`chip ${Math.abs(clip.speed.rate - r) < 1e-6 ? 'active' : ''}`} onClick={() => apply('Speed', (p) => cmd.setSpeed(p, clip.id, r, asset?.duration))}>
                  {r}x
                </button>
              ))}
            </div>
            {asset && asset.duration > 0 && (
              <div className="row">
                <label>Target duration</label>
                <NumberField value={clip.duration} min={0.1} step={0.1} unit="s" onChange={(d) => apply('Speed', (p) => cmd.setSpeed(p, clip.id, Math.min(10, Math.max(0.1, (cmd.sourceSpan(clip) || clip.duration) / d)), asset.duration))} />
              </div>
            )}
          </>
        )}
        <Toggle label="Reverse" value={clip.speed.reversed} onChange={() => apply('Reverse', (p) => cmd.toggleReverse(p, clip.id))} />
        <Toggle label="Preserve pitch" value={clip.speed.preservePitch} hint="Keep audio pitch when changing speed" onChange={(v) => patchClip(clip.id, 'Preserve pitch', { speed: { ...clip.speed, preservePitch: v } } as any, false)} />
        {clip.kind === 'video' && clip.speed.freezeAt !== undefined && (
          <div className="row">
            <label>Freeze frame</label>
            <span className="small">at {clip.speed.freezeAt.toFixed(2)}s of source</span>
            <button className="btn sm" onClick={() => patchClip(clip.id, 'Unfreeze', { speed: { ...clip.speed, freezeAt: undefined } } as any, false)}>Unfreeze</button>
          </div>
        )}
      </Section>
      <Section title="Speed ramp (curve)" id="speed-curve" defaultOpen={!!curve}>
        <div className="preset-grid cols-4">
          {SPEED_CURVES.map((c) => (
            <button key={c.id} className={`preset ${(!curve && !c.curve) || (curve && c.curve && JSON.stringify(curve) === JSON.stringify(c.curve)) ? 'active' : ''}`} onClick={() => apply('Speed curve', (p) => cmd.setSpeedCurve(p, clip.id, c.curve))} title={c.name}>
              <CurveIcon curve={c.curve} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
        {curve && <SpeedCurveEditor clip={clip} curve={curve} />}
      </Section>
    </>
  );
}

function CurveIcon({ curve }: { curve?: { t: number; speed: number }[] }) {
  const pts = curve ?? [{ t: 0, speed: 1 }, { t: 1, speed: 1 }];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.t * 40},${28 - Math.log2(p.speed * 4) * 5}`).join(' ');
  return (
    <svg width={40} height={28} viewBox="0 0 40 28">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function SpeedCurveEditor({ clip, curve }: { clip: VideoClip | AudioClip; curve: { t: number; speed: number }[] }) {
  const W = 280, H = 120;
  const ref = React.useRef<SVGSVGElement>(null);
  const toY = (s: number) => H - ((Math.log10(s) + 1) / 2) * H; // 0.1..10 log scale
  const fromY = (y: number) => Math.pow(10, (1 - y / H) * 2 - 1);
  const update = (pts: { t: number; speed: number }[], merge = true) => useProject.getState().apply('Speed curve', (p) => cmd.setSpeedCurve(p, clip.id, pts), { merge });
  const onDown = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(H, ((ev.clientY - rect.top) / rect.height) * H));
      const pts = curve.map((p, j) => (j === i ? { t: i === 0 ? 0 : i === curve.length - 1 ? 1 : Math.min(curve[i + 1].t - 0.01, Math.max(curve[i - 1].t + 0.01, x)), speed: Math.max(0.1, Math.min(10, fromY(y))) } : p));
      update(pts);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const addPoint = (e: React.MouseEvent) => {
    if (e.target !== ref.current) return;
    const rect = ref.current!.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    const s = fromY(((e.clientY - rect.top) / rect.height) * H);
    const pts = [...curve, { t, speed: s }].sort((a, b) => a.t - b.t);
    update(pts, false);
  };
  const removePoint = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (i === 0 || i === curve.length - 1) return;
    update(curve.filter((_, j) => j !== i), false);
  };
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${p.t * W},${toY(p.speed)}`).join(' ');
  return (
    <div className="curve-editor">
      <svg ref={ref} width="100%" viewBox={`0 0 ${W} ${H}`} onDoubleClick={addPoint} style={{ background: 'var(--bg-1)', borderRadius: 6, border: '1px solid var(--line)' }}>
        {[0.25, 0.5, 1, 2, 4].map((s) => (
          <g key={s}>
            <line x1={0} x2={W} y1={toY(s)} y2={toY(s)} stroke="var(--line)" strokeDasharray={s === 1 ? undefined : '2 3'} />
            <text x={2} y={toY(s) - 2} fill="var(--text-3)" fontSize={8}>{s}x</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent-2)" strokeWidth={2} />
        {curve.map((p, i) => (
          <circle key={i} cx={p.t * W} cy={toY(p.speed)} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} style={{ cursor: 'grab' }} onMouseDown={onDown(i)} onContextMenu={removePoint(i)} />
        ))}
      </svg>
      <div className="muted small">Drag points · double-click to add · right-click to remove. Duration: {clip.duration.toFixed(2)}s</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transition                                                          */
/* ------------------------------------------------------------------ */

function TransitionPanel({ clip }: { clip: VisualClip }) {
  const sel = useUI((s) => s.selectedTransition);
  const edge: 'in' | 'out' = sel?.clipId === clip.id ? sel.edge : clip.transitionOut ? 'out' : 'in';
  const tr = edge === 'in' ? clip.transitionIn : clip.transitionOut;
  const setTr = (t: TransitionInstance | null, merge = true) => patchClip(clip.id, 'Transition', { [edge === 'in' ? 'transitionIn' : 'transitionOut']: t } as any, merge);
  const def = tr ? getTransition(tr.type) : undefined;
  return (
    <>
      <div className="seg" style={{ margin: 10 }}>
        <button className={edge === 'in' ? 'active' : ''} onClick={() => useUI.getState().set({ selectedTransition: { clipId: clip.id, edge: 'in' } })}>Clip start</button>
        <button className={edge === 'out' ? 'active' : ''} onClick={() => useUI.getState().set({ selectedTransition: { clipId: clip.id, edge: 'out' } })}>Clip end</button>
      </div>
      {!tr ? (
        <Empty>
          No transition at the clip {edge === 'in' ? 'start' : 'end'}. Pick one from the <b>Transitions</b> panel, or
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => setTr({ type: 'fade', duration: 0.6, params: {} }, false)}>Add fade</button>{' '}
            <button className="btn sm ghost" onClick={() => { useUI.getState().setLeftPanel('transitions'); useUI.getState().set({ leftOpen: true }); }}>Browse…</button>
          </div>
        </Empty>
      ) : (
        <>
          <Section title={`Transition: ${def?.name ?? tr.type}`} id="tr-main">
            <SelectRow label="Type" value={tr.type} options={TRANSITIONS.map((t) => ({ value: t.id, label: `${t.icon} ${t.name}` }))} onChange={(v) => setTr({ type: v, duration: tr.duration, params: Object.fromEntries((getTransition(v)?.params ?? []).map((p) => [p.key, p.default])) }, false)} />
            <Slider label="Duration" value={tr.duration} min={0.1} max={Math.max(0.5, Math.min(5, clip.duration))} step={0.05} unit="s" format={(v) => `${v.toFixed(2)}s`} onChange={(v) => setTr({ ...tr, duration: v })} />
            {def?.params.map((p) => (
              <Slider key={p.key} label={p.label} value={tr.params[p.key] ?? p.default} min={p.min} max={p.max} step={p.step ?? 0.01} defaultValue={p.default} onChange={(v) => setTr({ ...tr, params: { ...tr.params, [p.key]: v } })} />
            ))}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => usePlayback.getState().seek(edge === 'in' ? clip.start : Math.max(0, clip.start + clip.duration - tr.duration - 0.3))}>Preview</button>
              <button className="btn sm" onClick={() => { const other = edge === 'in' ? 'transitionOut' : 'transitionIn'; patchClip(clip.id, 'Transition', { [other]: { ...tr } } as any, false); }}>Copy to other edge</button>
              <button className="btn sm danger" onClick={() => setTr(null, false)}>Remove</button>
            </div>
          </Section>
        </>
      )}
    </>
  );
}


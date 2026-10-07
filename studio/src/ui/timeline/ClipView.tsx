import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Clip, Track } from '@/core/types';
import { getAsset } from '@/engine/MediaManager';
import { getSticker } from '@/library/stickers';
import { filmstrip, onThumbnails } from '@/services/thumbnails';
import { collectKeyframeTimes } from '@/core/keyframes';
import { useUI } from '@/core/uiStore';
import { useProject } from '@/core/store';
import * as cmd from '@/core/commands';
import { Lock, Music, Type, Sticker as StickerIcon, Image as ImageIcon, Film, Captions, Square, Zap, Gauge, Scissors as Maskicon } from 'lucide-react';

interface Props {
  clip: Clip;
  track: Track;
  zoom: number;
  selected: boolean;
  dragging: boolean;
  next?: Clip;
  onMouseDown: (e: React.MouseEvent, clip: Clip, kind: 'move' | 'trim-l' | 'trim-r') => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const ClipView = memo(function ClipView({ clip, track, zoom, selected, dragging, next, onMouseDown, onContextMenu }: Props) {
  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  const selTr = useUI((s) => s.selectedTransition);
  const kfTimes = useMemo(() => Array.from(collectKeyframeTimes(clip)).filter((t) => t >= 0 && t <= clip.duration), [clip]);

  const icon = {
    video: <Film size={11} />,
    audio: <Music size={11} />,
    image: <ImageIcon size={11} />,
    text: <Type size={11} />,
    caption: <Captions size={11} />,
    sticker: <StickerIcon size={11} />,
    color: <Square size={11} />,
  }[clip.kind];

  const badges: React.ReactNode[] = [];
  if ('effects' in clip && clip.effects.length) badges.push(<span key="fx" title={`${clip.effects.length} effect(s)`}><Zap size={10} /></span>);
  if ('speed' in clip && (clip.speed.rate !== 1 || clip.speed.curve || clip.speed.reversed)) badges.push(<span key="sp" title={clip.speed.curve ? 'Speed curve' : `${clip.speed.rate}x${clip.speed.reversed ? ' reversed' : ''}`}><Gauge size={10} />{clip.speed.curve ? '~' : `${clip.speed.rate}x`}{clip.speed.reversed ? '◀' : ''}</span>);
  if ('mask' in clip && clip.mask?.enabled) badges.push(<span key="mk" title="Mask"><Maskicon size={10} /></span>);
  if (clip.locked) badges.push(<span key="lk" title="Locked"><Lock size={10} /></span>);

  const onTransitionClick = (e: React.MouseEvent, edge: 'in' | 'out') => {
    e.stopPropagation();
    useProject.getState().select([clip.id]);
    useUI.getState().set({ selectedTransition: { clipId: clip.id, edge }, rightOpen: true });
    useUI.getState().setRightPanel('transition');
  };

  const trIn = 'transitionIn' in clip ? clip.transitionIn : null;
  const trOut = 'transitionOut' in clip ? clip.transitionOut : null;
  const adjacentNext = next && Math.abs(cmd.clipEnd(clip) - next.start) < 1e-3;

  return (
    <div
      className={`clip ${clip.kind} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${clip.locked ? 'locked' : ''}`}
      style={{ left, width, height: track.height - 6, borderColor: clip.color || undefined }}
      onMouseDown={(e) => onMouseDown(e, clip, 'move')}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const ui = useUI.getState();
        ui.set({ rightOpen: true });
        ui.setRightPanel(clip.kind === 'text' ? 'text' : clip.kind === 'audio' ? 'audio' : clip.kind === 'caption' ? 'captions' : 'properties');
      }}
      title={`${clip.name}\n${clip.duration.toFixed(2)}s`}
    >
      <div className="bar">
        {icon}
        <span className="nm" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.kind === 'text' || clip.kind === 'caption' ? (clip as any).text?.split('\n')[0] || clip.name : clip.name}</span>
      </div>
      <div className="body">
        <ClipBody clip={clip} width={width} zoom={zoom} height={Math.max(4, track.height - 6 - 16)} />
        {kfTimes.length > 0 && width > 20 && kfTimes.map((t, i) => <span key={i} className="kf" style={{ left: t * zoom }} />)}
        {badges.length > 0 && <div className="fx-badge">{badges}</div>}
      </div>
      {'audio' in clip && clip.audio.fadeIn > 0 && <div className="fade in" style={{ left: 0, width: clip.audio.fadeIn * zoom }} />}
      {'audio' in clip && clip.audio.fadeOut > 0 && <div className="fade out" style={{ right: 0, width: clip.audio.fadeOut * zoom }} />}
      {!clip.locked && (
        <>
          <div className="handle l" onMouseDown={(e) => onMouseDown(e, clip, 'trim-l')} title="Trim start" />
          <div className="handle r" onMouseDown={(e) => onMouseDown(e, clip, 'trim-r')} title="Trim end" />
        </>
      )}
      {trIn && (
        <div className={`tr-pill in ${selTr?.clipId === clip.id && selTr.edge === 'in' ? 'sel' : ''}`} style={{ width: Math.max(10, trIn.duration * zoom) }} onMouseDown={(e) => onTransitionClick(e, 'in')} title={`Transition in: ${trIn.type} (${trIn.duration}s)`} />
      )}
      {trOut && (
        <div className={`tr-pill out ${selTr?.clipId === clip.id && selTr.edge === 'out' ? 'sel' : ''}`} style={{ width: Math.max(10, trOut.duration * zoom) }} onMouseDown={(e) => onTransitionClick(e, 'out')} title={`Transition out: ${trOut.type} (${trOut.duration}s)`} />
      )}
      {adjacentNext && !trOut && 'transitionOut' in clip && (
        <div
          className="tr-add"
          title="Add transition between clips"
          onMouseDown={(e) => {
            e.stopPropagation();
            useProject.getState().select([clip.id, next!.id]);
            useUI.getState().setLeftPanel('transitions');
            useUI.getState().set({ leftOpen: true });
          }}
        >
          +
        </div>
      )}
    </div>
  );
});

function ClipBody({ clip, width, zoom, height }: { clip: Clip; width: number; zoom: number; height: number }) {
  if (clip.kind === 'video' && clip.hasAudio && !clip.audioDetached && height > 44) {
    const wh = Math.round(height * 0.32);
    return (
      <>
        <Filmstrip clip={clip} width={width} height={height - wh} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: wh, background: 'rgba(0,0,0,0.25)' }}>
          <Waveform clip={clip} width={width} height={wh} />
        </div>
      </>
    );
  }
  if (clip.kind === 'video' || clip.kind === 'image') return <Filmstrip clip={clip} width={width} height={height} />;
  if (clip.kind === 'audio') return <Waveform clip={clip} width={width} height={height} />;
  if (clip.kind === 'color') return <div className="clip-fill" style={{ background: clip.color }} />;
  if (clip.kind === 'sticker') return <div className="clip-fill sticker-fill">{(clip.stickerId && getSticker(clip.stickerId)?.char) || '◆'}</div>;
  void zoom;
  return null;
}

function Filmstrip({ clip, width, height }: { clip: Clip & { mediaId: string }; width: number; height: number }) {
  const [, bump] = useState(0);
  useEffect(() => onThumbnails(() => bump((v) => v + 1)), []);
  const asset = getAsset(clip.mediaId);
  const frames = filmstrip(clip.mediaId, asset?.type === 'image' ? 1 : 12);
  if (!frames || !frames.length) return <div className="clip-fill" />;
  const fh = height;
  const fw = Math.round(fh * ((asset?.width || 16) / (asset?.height || 9)));
  const n = Math.ceil(width / fw) + 1;
  const total = asset?.duration || 1;
  const cells: React.ReactNode[] = [];
  const speed = 'speed' in clip ? Math.abs(clip.speed.rate || 1) : 1;
  const mediaIn = 'mediaIn' in clip ? clip.mediaIn : 0;
  for (let i = 0; i < n && i < 400; i++) {
    const tlT = (i * fw) / Math.max(1, width) * clip.duration;
    const srcT = asset?.type === 'image' ? 0 : mediaIn + tlT * speed;
    const idx = Math.min(frames.length - 1, Math.max(0, Math.floor((srcT / total) * frames.length)));
    cells.push(<img key={i} src={frames[idx]} style={{ width: fw, height: fh }} draggable={false} alt="" />);
  }
  return <div className="filmstrip">{cells}</div>;
}

function Waveform({ clip, width, height }: { clip: Clip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const asset = getAsset((clip as any).mediaId);
  const peaks = asset?.waveform;
  const version = useRef(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.min(4000, Math.ceil(width));
    const h = Math.ceil(height);
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (!peaks || !peaks.length || !asset) return;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const mediaIn = (clip as any).mediaIn || 0;
    const rate = (clip as any).speed?.rate || 1;
    const curve = (clip as any).speed?.curve;
    const total = asset.waveformDuration || asset.duration || 1;
    const fadeIn = (clip as any).audio?.fadeIn || 0;
    const fadeOut = (clip as any).audio?.fadeOut || 0;
    const vol = (clip as any).audio?.volume?.value ?? 1;
    for (let x = 0; x < w; x++) {
      const tl = (x / w) * clip.duration;
      let src: number;
      if (curve) src = cmd.timelineToSourceOffset(clip as any, tl) + mediaIn;
      else src = mediaIn + tl * rate;
      const idx = Math.floor((src / total) * peaks.length);
      let p = peaks[Math.max(0, Math.min(peaks.length - 1, idx))] ?? 0;
      let g = Math.min(1, vol);
      if (fadeIn > 0 && tl < fadeIn) g *= tl / fadeIn;
      if (fadeOut > 0 && tl > clip.duration - fadeOut) g *= (clip.duration - tl) / fadeOut;
      p *= g;
      const bh = Math.max(1, p * (h - 4));
      ctx.fillRect(x, (h - bh) / 2, 1, bh);
    }
    version.current++;
  }, [peaks, width, height, clip]);
  return <canvas ref={ref} className="waveform" style={{ width: Math.ceil(width), height }} />;
}

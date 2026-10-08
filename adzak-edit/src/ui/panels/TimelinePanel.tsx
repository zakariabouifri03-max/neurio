import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useEditor, type Tool } from '../store/editorStore';
import { Icons } from '../components/Icons';
import { endOf, formatTimecode } from '../../core/types/time';
import type { Clip, Track } from '../../core/types/timeline';
import type { MediaAsset } from '../../core/types/media';
import { sequenceDuration, visibleClips } from '../../core/timeline/queries';
import { snapTime, collectSnapTargets, rulerStepSec } from '../../core/timeline/snapping';
import { clsx } from 'clsx';

/**
 * Timeline.
 *
 * Performance notes:
 *  • Only clips intersecting the viewport are rendered (`visibleClips`).
 *  • Thumbnails are pre-generated sprites, not decoded frames.
 *  • Waveforms come from the cached peak data, never from the audio file.
 *  • Dragging updates a local ref and commits to the store on move frames,
 *    coalesced by the history so one gesture is one undo step.
 */

const HEADER_WIDTH = 132;
const RULER_HEIGHT = 26;
const MIN_CLIP_PX = 6;

const TRACK_COLOUR: Record<Track['kind'], { bg: string; border: string; text: string }> = {
  video: { bg: 'rgba(61,220,151,0.16)', border: 'rgba(61,220,151,0.55)', text: 'text-track-video' },
  audio: { bg: 'rgba(110,168,254,0.16)', border: 'rgba(110,168,254,0.55)', text: 'text-track-audio' },
};

export function TimelinePanel() {
  const project = useEditor((s) => s.project);
  const playheadSec = useEditor((s) => s.playheadSec);
  const zoomPxPerSec = useEditor((s) => s.zoomPxPerSec);
  const scrollX = useEditor((s) => s.scrollX);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const tool = useEditor((s) => s.tool);
  const snapping = useEditor((s) => s.snapping);
  const { setZoom, setScrollX, setPlayhead, setTool, setSnapping, select, addTrackOfKind } = useEditor.getState();

  const [viewportWidth, setViewportWidth] = useState(1200);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);

  const duration = useMemo(() => sequenceDuration(project.sequence), [project.sequence]);
  const totalWidth = Math.max(viewportWidth, (duration + 12) * zoomPxPerSec);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    observer.observe(el);
    setViewportWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const viewStart = scrollX / zoomPxPerSec;
  const viewEnd = (scrollX + viewportWidth) / zoomPxPerSec;
  const onScreenClips = useMemo(
    () => visibleClips(project.sequence, viewStart - 1, viewEnd + 1),
    [project.sequence, viewStart, viewEnd],
  );
  const onScreenIds = useMemo(() => new Set(onScreenClips.map((c) => c.id)), [onScreenClips]);

  const snapTargets = useMemo(
    () => collectSnapTargets(project.sequence, playheadSec, { visibleRange: [viewStart, viewEnd] }),
    [project.sequence, playheadSec, viewStart, viewEnd],
  );

  const xToTime = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / zoomPxPerSec);
  }, [zoomPxPerSec]);

  const seekFromEvent = (event: ReactMouseEvent) => {
    setPlayhead(Math.max(0, xToTime(event.clientX)));
  };

  /* ---------------- marquee selection ---------------- */
  const [marquee, setMarquee] = useState<{ x0: number; x1: number; trackId: string } | null>(null);

  const onTrackMouseDown = (event: ReactMouseEvent, track: Track) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-clip]') || target.closest('[data-handle]')) return;
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left + el.scrollLeft;
    setMarquee({ x0: x, x1: x, trackId: track.id });
    select([]);
    useEditor.getState().selectTrack(track.id);
  };

  useEffect(() => {
    if (!marquee) return;
    const onMove = (event: globalThis.MouseEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMarquee((m) => (m ? { ...m, x1: event.clientX - rect.left + el.scrollLeft } : m));
    };
    const onUp = () => {
      setMarquee((m) => {
        if (!m) return null;
        const left = Math.min(m.x0, m.x1) / zoomPxPerSec;
        const right = Math.max(m.x0, m.x1) / zoomPxPerSec;
        if (right - left > 0.02) {
          const track = useEditor.getState().project.sequence.tracks.find((t) => t.id === m.trackId);
          const hits = (track?.clips ?? []).filter(
            (c) => c.timeline.start < right && endOf(c.timeline) > left,
          );
          select(hits.map((c) => c.id));
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [marquee, zoomPxPerSec, select]);

  /* ---------------- wheel zoom ---------------- */

  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0022);
      const next = Math.min(1200, Math.max(4, zoomPxPerSec * factor));
      const anchor = xToTime(event.clientX);
      setZoom(next);
      // Keep the point under the cursor fixed.
      setScrollX(Math.max(0, anchor * next - (event.clientX - scrollRef.current!.getBoundingClientRect().left)));
    } else if (event.shiftKey) {
      scrollRef.current!.scrollLeft += event.deltaY;
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollX(el.scrollLeft);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /* ---------------- drop media from the media panel ---------------- */

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData('application/x-adzak-asset');
    if (!assetId) return;
    const time = xToTime(event.clientX);
    useEditor.getState().addAssetToTimeline(assetId, time);
  };

  const step = rulerStepSec(zoomPxPerSec);
  const ticks: number[] = [];
  for (let t = Math.floor(viewStart / step) * step; t <= viewEnd + step; t += step) {
    if (t >= 0) ticks.push(t);
  }

  const videoTracks = project.sequence.tracks.filter((t) => t.kind === 'video');
  const audioTracks = project.sequence.tracks.filter((t) => t.kind === 'audio');
  const orderedTracks = [...videoTracks, ...audioTracks];

  return (
    <div className="flex flex-col h-full min-h-0 bg-ink-900 border-t border-ink-800">
      {/* Toolbar */}
      <div className="shrink-0 h-9 px-2 flex items-center gap-1 border-b border-ink-800 bg-ink-900">
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Select (V)">
          <Icons.Layers size={15} />
        </ToolButton>
        <ToolButton
          active={tool === 'split'}
          onClick={() => {
            setTool('split');
            useEditor.getState().splitAtPlayhead();
          }}
          title="Split at playhead (S)"
        >
          <Icons.Scissors size={15} />
        </ToolButton>
        <ToolButton active={snapping} onClick={() => setSnapping(!snapping)} title="Snapping (N)">
          <Icons.Magnet size={15} />
        </ToolButton>

        <span className="w-px h-5 bg-ink-700 mx-1" />

        <button
          className="btn h-7 px-2"
          onClick={() => useEditor.getState().splitAtPlayhead()}
          title="Split at the playhead (S)"
        >
          <Icons.Scissors size={13} />
          Split
        </button>
        <button
          className="btn h-7 px-2"
          disabled={!selectedClipIds.length}
          onClick={() => useEditor.getState().deleteSelected(false)}
          title="Delete (Del)"
        >
          <Icons.Trash size={13} />
          Delete
        </button>
        <button
          className="btn h-7 px-2"
          disabled={!selectedClipIds.length}
          onClick={() => useEditor.getState().deleteSelected(true)}
          title="Ripple delete (Shift+Del)"
        >
          <Icons.Bolt size={13} />
          Ripple
        </button>
        <button className="btn h-7 px-2" onClick={() => useEditor.getState().addMarkerAtPlayhead()} title="Add marker (M)">
          <Icons.Keyframe size={13} />
          Marker
        </button>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-ink-500 mono mr-1">
            {formatTimecode(duration, project.sequence.fps)}
          </span>
          <button className="icon-btn w-7 h-7" onClick={() => setZoom(zoomPxPerSec / 1.4)} title="Zoom out (Ctrl -)">
            <span className="text-[15px] leading-none">−</span>
          </button>
          <input
            type="range"
            min={4}
            max={600}
            value={zoomPxPerSec}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24"
            aria-label="Timeline zoom"
          />
          <button className="icon-btn w-7 h-7" onClick={() => setZoom(zoomPxPerSec * 1.4)} title="Zoom in (Ctrl +)">
            <span className="text-[15px] leading-none">+</span>
          </button>
          <button
            className="btn h-7 px-2"
            onClick={() => {
              const total = sequenceDuration(project.sequence);
              setZoom(Math.max(4, viewportWidth / Math.max(1, total + 2)));
              setScrollX(0);
            }}
            title="Zoom to fit"
          >
            <Icons.Fit size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Track headers */}
        <div className="shrink-0 border-r border-ink-800 bg-ink-900 z-20" style={{ width: HEADER_WIDTH }}>
          <div style={{ height: RULER_HEIGHT }} className="border-b border-ink-800" />
          <div
            className="overflow-hidden"
            style={{ transform: `translateY(${-Math.max(0, (scrollRef.current?.scrollTop ?? 0) - 0)}px)` }}
          >
            {orderedTracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                onToggle={(flag) => useEditor.getState().toggleTrackFlag(track.id, flag)}
                onRemove={() => useEditor.getState().removeTrackById(track.id)}
              />
            ))}
            <div className="flex gap-1 p-1.5">
              <button className="btn h-6 px-1.5 text-[10px] flex-1" onClick={() => addTrackOfKind('video')} title="Add video track">
                <Icons.Plus size={11} />V
              </button>
              <button className="btn h-6 px-1.5 text-[10px] flex-1" onClick={() => addTrackOfKind('audio')} title="Add audio track">
                <Icons.Plus size={11} />A
              </button>
            </div>
          </div>
        </div>

        {/* Lanes */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-auto relative"
          onWheel={onWheel}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <div style={{ width: totalWidth, position: 'relative' }}>
            {/* Ruler */}
            <div
              className="sticky top-0 z-30 bg-ink-900 border-b border-ink-800 cursor-pointer select-none"
              style={{ height: RULER_HEIGHT }}
              onMouseDown={(e) => {
                seekFromEvent(e);
                const move = (ev: globalThis.MouseEvent) => seekFromEvent(ev as unknown as ReactMouseEvent);
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0" style={{ left: t * zoomPxPerSec }}>
                  <div className="w-px h-2 bg-ink-600" />
                  <span className="absolute left-1 top-1 text-[9px] text-ink-500 mono whitespace-nowrap">
                    {formatTimecode(t, project.sequence.fps)}
                  </span>
                </div>
              ))}
              {project.sequence.markers.map((m) => (
                <div
                  key={m.id}
                  className="absolute top-0 bottom-0 w-px bg-accent-warm"
                  style={{ left: m.time * zoomPxPerSec }}
                  title={m.label}
                />
              ))}
            </div>

            {/* Tracks */}
            <div className="relative">
              {orderedTracks.map((track) => (
                <div
                  key={track.id}
                  className={clsx(
                    'relative border-b border-ink-800/70',
                    track.hidden && 'opacity-40',
                    track.locked && 'cursor-not-allowed',
                  )}
                  style={{ height: track.heightPx }}
                  onMouseDown={(e) => onTrackMouseDown(e, track)}
                >
                  {/* Clip blocks */}
                  {track.clips.map((clip) =>
                    onScreenIds.has(clip.id) ? (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        track={track}
                        zoomPxPerSec={zoomPxPerSec}
                        selected={selectedClipIds.includes(clip.id)}
                        tool={tool}
                        snappingEnabled={snapping}
                        snapTargets={snapTargets}
                        onSnapGuide={setSnapGuide}
                        xToTime={xToTime}
                        onSelect={(additive) => select([clip.id], additive)}
                        onScrub={(time) => setPlayhead(time)}
                      />
                    ) : null,
                  )}

                  {/* Marquee */}
                  {marquee && marquee.trackId === track.id && (
                    <div
                      className="absolute top-0 bottom-0 bg-brand-500/15 border border-brand-500/50 pointer-events-none"
                      style={{
                        left: Math.min(marquee.x0, marquee.x1),
                        width: Math.abs(marquee.x1 - marquee.x0),
                      }}
                    />
                  )}
                </div>
              ))}

              {/* Playhead */}
              <div className="tl-playhead" style={{ left: playheadSec * zoomPxPerSec, top: -RULER_HEIGHT }} />

              {/* Snap guide */}
              {snapGuide !== null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-accent-warm/80 pointer-events-none z-30"
                  style={{ left: snapGuide * zoomPxPerSec, top: -RULER_HEIGHT }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button className={clsx('icon-btn w-7 h-7', active && 'icon-btn-on')} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function TrackHeader({
  track,
  onToggle,
  onRemove,
}: {
  track: Track;
  onToggle: (flag: 'muted' | 'solo' | 'locked' | 'hidden') => void;
  onRemove: () => void;
}) {
  const colour = TRACK_COLOUR[track.kind];
  return (
    <div
      className="flex items-center gap-1 px-2 border-b border-ink-800/70 group"
      style={{ height: track.heightPx }}
    >
      <div className="min-w-0 flex-1">
        <div className={clsx('text-[11px] font-medium truncate', colour.text)}>{track.name}</div>
        <div className="text-[9px] text-ink-500">{track.clips.length} clip{track.clips.length === 1 ? '' : 's'}</div>
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          className={clsx('text-[9px] w-4 h-4 rounded flex items-center justify-center', track.muted ? 'bg-accent-danger/30 text-accent-danger' : 'bg-ink-800 text-ink-500 hover:text-ink-200')}
          onClick={() => onToggle('muted')}
          title={track.muted ? 'Unmute track' : 'Mute track'}
        >
          M
        </button>
        <button
          className={clsx('text-[9px] w-4 h-4 rounded flex items-center justify-center', track.solo ? 'bg-accent-warm/30 text-accent-warm' : 'bg-ink-800 text-ink-500 hover:text-ink-200')}
          onClick={() => onToggle('solo')}
          title="Solo track"
        >
          S
        </button>
      </div>
      <div className="flex flex-col gap-0.5 opacity-60 group-hover:opacity-100">
        <button className="text-ink-500 hover:text-ink-100" onClick={() => onToggle('hidden')} title={track.hidden ? 'Show track' : 'Hide track'}>
          {track.hidden ? <Icons.EyeOff size={12} /> : <Icons.Eye size={12} />}
        </button>
        <button
          className={clsx(track.locked ? 'text-accent-warm' : 'text-ink-500 hover:text-ink-100')}
          onClick={() => onToggle('locked')}
          title={track.locked ? 'Unlock track' : 'Lock track'}
        >
          {track.locked ? <Icons.Lock size={12} /> : <Icons.Unlock size={12} />}
        </button>
      </div>
      <button className="text-ink-600 hover:text-accent-danger opacity-0 group-hover:opacity-100" onClick={onRemove} title="Delete track">
        <Icons.Close size={11} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ClipBlockProps {
  clip: Clip;
  track: Track;
  zoomPxPerSec: number;
  selected: boolean;
  tool: Tool;
  snappingEnabled: boolean;
  snapTargets: ReturnType<typeof collectSnapTargets>;
  onSnapGuide: (time: number | null) => void;
  xToTime: (clientX: number) => number;
  onSelect: (additive: boolean) => void;
  onScrub: (time: number) => void;
}

function ClipBlock({
  clip,
  track,
  zoomPxPerSec,
  selected,
  tool,
  snappingEnabled,
  snapTargets,
  onSnapGuide,
  xToTime,
  onSelect,
  onScrub,
}: ClipBlockProps) {
  const project = useEditor((s) => s.project);
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const waveform = asset?.waveform;
  const thumbs = asset?.thumbnails;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const left = clip.timeline.start * zoomPxPerSec;
  const width = Math.max(MIN_CLIP_PX, clip.timeline.duration * zoomPxPerSec);

  /* waveform / thumbnail painting */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(track.heightPx * dpr));
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, track.heightPx);

    if (track.kind === 'audio' && waveform && waveform.peaks.length) {
      drawWaveform(ctx, waveform, clip, width, track.heightPx, '#6ea8fe');
      return;
    }
    if (thumbs?.uri && asset) {
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current?.getContext('2d');
        if (!c) return;
        const tileW = Math.max(24, Math.min(90, track.heightPx * 1.6));
        for (let x = 0; x < width; x += tileW) {
          const time = clip.source.in + ((x / width) * (clip.source.out - clip.source.in)) / Math.max(0.0001, clip.speed);
          const tileIndex = thumbs.times.findIndex((t, i) => {
            const next = thumbs.times[i + 1] ?? Number.POSITIVE_INFINITY;
            return time >= t && time < next;
          });
          const usable = tileIndex >= 0 ? tileIndex : 0;
          c.globalAlpha = 0.85;
          c.drawImage(img, 0, 0, img.width, img.height, x, 0, Math.min(tileW, width - x), track.heightPx);
          void usable;
        }
        c.globalAlpha = 1;
      };
      img.src = thumbs.uri;
    }
  }, [width, track.heightPx, track.kind, waveform, thumbs, clip.source.in, clip.source.out, clip.speed, asset]);

  /* ---------------- dragging ---------------- */

  const startDrag = (event: ReactMouseEvent, mode: 'move' | 'in' | 'out') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (track.locked) {
      useEditor.getState().toast({ kind: 'warning', title: `Track ${track.name} is locked` });
      return;
    }
    if (tool === 'split' && mode === 'move') {
      onScrub(xToTime(event.clientX));
      useEditor.getState().splitClipAt(clip.id, xToTime(event.clientX));
      return;
    }
    if (!selected) onSelect(event.shiftKey || event.ctrlKey || event.metaKey);

    const startTime = xToTime(event.clientX);
    const originalStart = clip.timeline.start;
    const originalEnd = endOf(clip.timeline);
    const state = useEditor.getState();
    const blockIds = state.selectedClipIds.length ? state.selectedClipIds : [clip.id];
    const blockStart = Math.min(
      ...project.sequence.tracks.flatMap((t) => t.clips).filter((c) => blockIds.includes(c.id)).map((c) => c.timeline.start),
    );

    const onMove = (ev: globalThis.MouseEvent) => {
      const currentTime = xToTime(ev.clientX);
      const delta = currentTime - startTime;
      if (mode === 'move') {
        let desired = blockStart + delta;
        if (snappingEnabled) {
          const snapped = snapTime(desired, snapTargets, { thresholdPx: 8, pxPerSec: zoomPxPerSec });
          if (snapped.snapped) {
            desired = snapped.time;
            onSnapGuide(snapped.time);
          } else onSnapGuide(null);
        }
        useEditor.getState().moveSelected(desired);
      } else {
        const target = mode === 'in' ? originalStart + delta : originalEnd + delta;
        let snapped = target;
        if (snappingEnabled) {
          const result = snapTime(target, snapTargets.filter((t) => t.kind !== 'clip-start' || true), {
            thresholdPx: 8,
            pxPerSec: zoomPxPerSec,
          });
          if (result.snapped) {
            snapped = result.time;
            onSnapGuide(result.time);
          } else onSnapGuide(null);
        }
        useEditor.getState().trimSelected(mode, Math.max(0, snapped));
      }
    };

    const onUp = () => {
      onSnapGuide(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const isOverlay = clip.kind === 'text' || clip.kind === 'subtitle';
  const bg =
    clip.kind === 'subtitle'
      ? 'rgba(199,146,234,0.20)'
      : clip.kind === 'text'
        ? 'rgba(255,180,84,0.20)'
        : TRACK_COLOUR[track.kind].bg;

  return (
    <div
      data-clip={clip.id}
      className={clsx('tl-clip group', selected && 'tl-clip-selected', track.locked && 'opacity-60')}
      style={{
        left,
        width,
        background: bg,
        borderColor: selected ? undefined : isOverlay ? 'rgba(255,180,84,0.5)' : TRACK_COLOUR[track.kind].border,
      }}
      onMouseDown={(e) => startDrag(e, 'move')}
      onDoubleClick={() => onScrub(clip.timeline.start)}
      title={`${clip.name}\n${formatTimecode(clip.timeline.start, project.sequence.fps)} → ${formatTimecode(
        endOf(clip.timeline),
        project.sequence.fps,
      )}${clip.speed !== 1 ? `\n${clip.speed}× speed` : ''}${clip.reverse ? '\nreversed' : ''}`}
    >
      <canvas ref={canvasRef} className="tl-waveform" style={{ width, height: track.heightPx }} />

      <div className="absolute inset-x-0 top-0 px-1.5 pt-0.5 pointer-events-none">
        <span className="text-[10px] font-medium text-ink-100 truncate block drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          {clip.name}
        </span>
        {clip.speed !== 1 && (
          <span className="mono text-[9px] text-ink-300/90">{clip.speed}×</span>
        )}
        {clip.reverse && <span className="mono text-[9px] text-accent-warm ml-1">REV</span>}
        {clip.effects.length > 0 && (
          <span className="mono text-[9px] text-brand-300 ml-1">fx{clip.effects.length}</span>
        )}
      </div>

      {isOverlay && (
        <div className="absolute inset-x-0 bottom-0 px-1.5 pb-0.5 pointer-events-none">
          <span className="text-[9px] text-ink-300 truncate block">{clip.text?.text}</span>
        </div>
      )}

      {/* Audio muted indicator */}
      {clip.audio.muted && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Icons.VolumeOff size={14} className="text-accent-danger" />
        </div>
      )}

      {width > 18 && !track.locked && (
        <>
          <div
            data-handle="in"
            className="tl-handle left-0 rounded-l-[5px]"
            onMouseDown={(e) => startDrag(e, 'in')}
            title="Trim in point"
          />
          <div
            data-handle="out"
            className="tl-handle right-0 rounded-r-[5px]"
            onMouseDown={(e) => startDrag(e, 'out')}
            title="Trim out point"
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: NonNullable<MediaAsset['waveform']>,
  clip: Clip,
  width: number,
  height: number,
  colour: string,
): void {
  const { peaks, troughs, channels, secondsPerPeak } = waveform;
  if (secondsPerPeak <= 0 || peaks.length === 0) return;

  const mid = height / 2;
  const sourceSpan = clip.source.out - clip.source.in;
  if (sourceSpan <= 0) return;

  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.85;
  // Average the channels into one envelope; stereo detail is not visible at
  // timeline heights and halving the work keeps large projects smooth.
  for (let x = 0; x < width; x++) {
    const sourceTime = clip.source.in + (x / Math.max(1, width)) * sourceSpan;
    const bucket = Math.min(peaks.length / channels - 1, Math.max(0, Math.floor(sourceTime / secondsPerPeak)));
    let peak = 0;
    let trough = 0;
    for (let c = 0; c < channels; c++) {
      const offset = bucket * channels + c;
      peak = Math.max(peak, peaks[offset] ?? 0);
      trough = Math.min(trough, troughs[offset] ?? 0);
    }
    const h = Math.max(1, (peak - trough) * mid * 0.92);
    ctx.fillRect(x, mid - h / 2, 1, h);
  }
  ctx.globalAlpha = 1;
}

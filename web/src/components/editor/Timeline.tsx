'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, SkipBack, Scissors, Trash2, Plus, Volume2, VolumeX, Gauge,
  Rewind, FastForward, Film, Music, Type, Layers, ChevronDown, Upload,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { Button, IconButton, Slider, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { api, upload } from '@/lib/api-client';
import { uid } from '@/engine/factory';
import type { MediaClip, Track, TransitionType } from '@/engine/types';

const TRACK_HEIGHT = 56;
const TRACK_ICON: Record<Track['kind'], any> = { video: Film, audio: Music, overlay: Layers, subtitle: Type };

export function Timeline() {
  const toast = useToast();
  const doc = useEditor((s) => s.doc);
  const timeline = doc.timeline;
  const playing = useEditor((s) => s.timeline.playing);
  const time = useEditor((s) => s.timeline.time);
  const zoom = useEditor((s) => s.timeline.zoom);
  const selectedClipId = useEditor((s) => s.timeline.selectedClipId);
  const setTimeline = useEditor((s) => s.setTimeline);
  const updateTimeline = useEditor((s) => s.updateTimeline);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setTime = useEditor((s) => s.setTime);
  const selectClip = useEditor((s) => s.selectClip);
  const addTrack = useEditor((s) => s.addTrack);
  const addClip = useEditor((s) => s.addClip);
  const updateClip = useEditor((s) => s.updateClip);
  const removeClip = useEditor((s) => s.removeClip);

  const bottomPanel = useEditor((s) => s.bottomPanel);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<{ clipId: string; startX: number; origin: number } | null>(null);

  // A timeline is only created for video projects, or when the user opens the
  // timeline panel — plain designs must not gain an empty one (and go dirty).
  const timelineEnabled = doc.kind === 'video' || bottomPanel === 'timeline';

  useEffect(() => {
    if (!timelineEnabled || doc.timeline) return;
    {
      setTimeline({
        fps: 30,
        duration: 10_000,
        tracks: [
          { id: uid('trk'), kind: 'video', name: 'Video', muted: false, locked: false, clips: [] },
          { id: uid('trk'), kind: 'audio', name: 'Audio', muted: false, locked: false, clips: [] },
          { id: uid('trk'), kind: 'overlay', name: 'Overlay', muted: false, locked: false, clips: [] },
        ],
        subtitles: [],
      });
    }
  }, [doc.timeline, setTimeline]);

  // Playback loop.
  useEffect(() => {
    if (!playing || !timeline) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setTime(Math.min(timeline.duration, useEditor.getState().timeline.time + delta));
      if (useEditor.getState().timeline.time >= timeline.duration) setPlaying(false);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, timeline, setTime, setPlaying]);

  const pxPerMs = useMemo(() => (0.06 * zoom) || 0.06, [zoom]);

  const onDropFiles = useCallback(
    async (files: FileList, trackId: string) => {
      for (const file of [...files]) {
        try {
          const asset = await upload('/api/upload', file);
          const kind: MediaClip['kind'] = asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image';
          const clip: MediaClip = {
            id: uid('clip'),
            trackId,
            name: asset.name,
            kind,
            src: asset.url,
            start: Math.round(useEditor.getState().timeline.time),
            duration: 5000,
            trimStart: 0,
            trimEnd: 0,
            speed: 1,
            reverse: false,
            volume: 1,
            muted: false,
            fadeIn: 0,
            fadeOut: 0,
            transition: null,
          };
          addClip(clip, trackId);
          toast.success('Clip added', asset.name);
        } catch (error) {
          toast.error('Upload failed', (error as Error).message);
        }
      }
    },
    [addClip, toast],
  );

  if (!timeline) return null;

  const selectedClip = timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId);

  function splitClip(clip: MediaClip) {
    const at = time;
    if (at <= clip.start || at >= clip.start + clip.duration) {
      toast.info('Move the playhead inside the clip to split it');
      return;
    }
    updateTimeline((draft) => {
      const track = draft.tracks.find((item) => item.id === clip.trackId);
      if (!track) return;
      const index = track.clips.findIndex((item) => item.id === clip.id);
      if (index < 0) return;
      const leftDuration = at - clip.start;
      const left: MediaClip = { ...clip, duration: leftDuration, trimEnd: clip.trimEnd + (clip.duration - leftDuration) };
      const right: MediaClip = {
        ...JSON.parse(JSON.stringify(clip)),
        id: uid('clip'),
        start: at,
        duration: clip.duration - leftDuration,
        trimStart: clip.trimStart + leftDuration,
      };
      track.clips.splice(index, 1, left, right);
    }, 'Split clip');
  }

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-elevated)' }}>
      {/* ---------------------------------------------------------- transport */}
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <IconButton icon={<SkipBack size={14} />} label="To start" size={28} onClick={() => setTime(0)} />
        <IconButton
          icon={playing ? <Pause size={15} /> : <Play size={15} />}
          label={playing ? 'Pause' : 'Play'}
          size={30}
          onClick={() => {
            if (time >= timeline.duration) setTime(0);
            setPlaying(!playing);
          }}
        />
        <span className="w-[92px] text-center text-[11.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {formatTime(time)} / {formatTime(timeline.duration)}
        </span>

        <div className="mx-2 h-5 w-px" style={{ background: 'var(--border)' }} />

        <IconButton
          icon={<Scissors size={14} />}
          label="Split clip at playhead"
          size={28}
          disabled={!selectedClip}
          onClick={() => selectedClip && splitClip(selectedClip)}
        />
        <IconButton
          icon={<Trash2 size={14} />}
          label="Delete clip"
          size={28}
          disabled={!selectedClip}
          onClick={() => selectedClip && removeClip(selectedClip.id)}
        />

        <div className="ms-auto flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Zoom
          </span>
          <div className="w-24">
            <Slider value={zoom} min={0.3} max={4} step={0.1} onChange={(value) => useEditor.setState((state) => ({ timeline: { ...state.timeline, zoom: value } }))} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={13} />}
            onClick={() => addTrack({ id: uid('trk'), kind: 'overlay', name: `Overlay ${timeline.tracks.length + 1}`, muted: false, locked: false, clips: [] })}
          >
            Track
          </Button>
          <Button size="sm" variant="secondary" icon={<Upload size={13} />} onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => event.target.files && onDropFiles(event.target.files, timeline.tracks[0]!.id)}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------- ruler */}
      <div className="relative h-6 border-b" style={{ borderColor: 'var(--border)' }}>
        <div
          className="absolute inset-y-0 start-0 w-px"
          style={{ background: 'var(--brand)', left: 0 }}
        />
        {Array.from({ length: Math.ceil(timeline.duration / 1000) }).map((_, second) => (
          <span
            key={second}
            className="absolute top-0 h-full border-s text-[9.5px]"
            style={{ left: second * 1000 * pxPerMs, borderColor: 'var(--border)', color: 'var(--text-faint)', paddingInlineStart: 3 }}
          >
            {formatTime(second * 1000)}
          </span>
        ))}
        <button
          type="button"
          aria-label="Scrub"
          className="absolute inset-0"
          onMouseDown={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const seek = (clientX: number) => setTime(Math.max(0, Math.min(timeline.duration, (clientX - rect.left) / pxPerMs)));
            seek(event.clientX);
            const move = (moveEvent: MouseEvent) => seek(moveEvent.clientX);
            const up = () => {
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}
        />
        <div className="absolute inset-y-0 w-px" style={{ background: 'var(--danger)', left: time * pxPerMs }} />
      </div>

      {/* ------------------------------------------------------------ tracks */}
      <div ref={scrollerRef} className="scroll-thin relative min-h-0 flex-1 overflow-auto">
        {timeline.tracks.map((track) => {
          const Icon = TRACK_ICON[track.kind];
          return (
            <div
              key={track.id}
              className="relative border-b"
              style={{ height: TRACK_HEIGHT, borderColor: 'var(--border)' }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (event.dataTransfer.files?.length) onDropFiles(event.dataTransfer.files, track.id);
              }}
            >
              <div className="sticky start-0 top-0 flex h-full w-[136px] shrink-0 items-center gap-1.5 border-e px-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
                <Icon size={13} style={{ color: 'var(--text-faint)' }} />
                <span className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  {track.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateTimeline((draft) => {
                      const target = draft.tracks.find((item) => item.id === track.id);
                      if (target) target.muted = !target.muted;
                    })
                  }
                  className="ms-auto"
                  style={{ color: track.muted ? 'var(--danger)' : 'var(--text-faint)' }}
                  aria-label={track.muted ? 'Unmute track' : 'Mute track'}
                >
                  {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
              </div>

              <div className="absolute inset-y-0 start-[136px] end-0">
                {track.clips.map((clip) => {
                  const selected = clip.id === selectedClipId;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        selectClip(clip.id);
                        const origin = clip.start;
                        const startX = event.clientX;
                        setDragging({ clipId: clip.id, startX, origin });
                        const move = (moveEvent: MouseEvent) => {
                          const delta = (moveEvent.clientX - startX) / pxPerMs;
                          updateClip(clip.id, { start: Math.max(0, Math.round(origin + delta)) }, 'Move clip');
                        };
                        const up = () => {
                          setDragging(null);
                          window.removeEventListener('mousemove', move);
                          window.removeEventListener('mouseup', up);
                        };
                        window.addEventListener('mousemove', move);
                        window.addEventListener('mouseup', up);
                      }}
                      className="absolute top-1.5 flex h-[44px] items-center gap-1 overflow-hidden rounded-md px-2 text-start"
                      style={{
                        left: clip.start * pxPerMs,
                        width: Math.max(24, clip.duration * pxPerMs),
                        background:
                          clip.kind === 'video'
                            ? 'linear-gradient(180deg, rgba(108,92,231,.55), rgba(108,92,231,.3))'
                            : clip.kind === 'audio'
                              ? 'linear-gradient(180deg, rgba(0,184,148,.5), rgba(0,184,148,.25))'
                              : 'linear-gradient(180deg, rgba(253,203,110,.5), rgba(253,203,110,.25))',
                        border: `1px solid ${selected ? 'var(--brand)' : 'transparent'}`,
                        color: '#fff',
                        fontSize: 11,
                      }}
                    >
                      <span className="truncate">{clip.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="absolute inset-y-0 w-px" style={{ background: 'var(--danger)', left: 136 + time * pxPerMs }} />
      </div>

      {/* ------------------------------------------------------- clip inspector */}
      {selectedClip ? (
        <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
          <span className="max-w-[160px] truncate text-[12px]" style={{ color: 'var(--text)' }}>
            {selectedClip.name}
          </span>

          <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            <Gauge size={12} /> Speed
          </label>
          <div className="w-[120px]">
            <Select
              value={String(selectedClip.speed)}
              onChange={(value) => updateClip(selectedClip.id, { speed: Number(value) }, 'Clip speed')}
              options={['0.25', '0.5', '1', '1.5', '2'].map((speed) => ({ value: speed, label: `${speed}×` }))}
            />
          </div>

          <Button size="sm" variant={selectedClip.reverse ? 'primary' : 'secondary'} icon={<Rewind size={12} />} onClick={() => updateClip(selectedClip.id, { reverse: !selectedClip.reverse }, 'Reverse')}>
            Reverse
          </Button>

          <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Volume
          </label>
          <div className="w-[100px]">
            <Slider value={Math.round((selectedClip.volume ?? 1) * 100)} min={0} max={100} onChange={(value) => updateClip(selectedClip.id, { volume: value / 100 }, 'Volume')} suffix="%" />
          </div>

          <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Fade in
          </label>
          <div className="w-[80px]">
            <Slider value={selectedClip.fadeIn / 100} min={0} max={30} onChange={(value) => updateClip(selectedClip.id, { fadeIn: value * 100 }, 'Fade in')} suffix="00ms" />
          </div>

          <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Fade out
          </label>
          <div className="w-[80px]">
            <Slider value={selectedClip.fadeOut / 100} min={0} max={30} onChange={(value) => updateClip(selectedClip.id, { fadeOut: value * 100 }, 'Fade out')} suffix="00ms" />
          </div>

          <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Transition
          </label>
          <div className="w-[130px]">
            <Select
              value={selectedClip.transition?.type ?? 'none'}
              onChange={(value) =>
                updateClip(
                  selectedClip.id,
                  { transition: value === 'none' ? null : { type: value as TransitionType, duration: 600 } },
                  'Transition',
                )
              }
              options={['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'zoom', 'wipe'].map((type) => ({ value: type, label: type }))}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor((ms % 1000) / 33);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

export { ChevronDown, FastForward };

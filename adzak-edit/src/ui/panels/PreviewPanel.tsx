import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { Icons } from '../components/Icons';
import { CanvasCompositor, type CompositorAsset } from '../../core/render/compositor';
import { sequenceDuration, findClip, isTrackAudible, videoTracks } from '../../core/timeline/queries';
import { toSourceTime } from '../../core/timeline/queries';
import { endOf } from '../../core/types/time';
import { formatTimecode } from '../../core/types/time';
import { getBridge } from '../../core/bridge';
import { setWebExportDeps } from '../../core/render/webExport';
import { clsx } from 'clsx';

/**
 * Preview panel.
 *
 * Renders the timeline with the shared canvas compositor and keeps the playhead
 * in the store in sync with wall-clock time, so scrubbing the timeline and
 * playing the preview can never disagree.
 */

type FitMode = 'fit' | 'fill' | number;

export function PreviewPanel() {
  const project = useEditor((s) => s.project);
  const playheadSec = useEditor((s) => s.playheadSec);
  const playing = useEditor((s) => s.playback.playing);
  const rate = useEditor((s) => s.playback.rate);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<CanvasCompositor | null>(null);
  const [fit, setFit] = useState<FitMode>('fit');
  const [fullscreen, setFullscreen] = useState(false);
  const [muted, setMuted] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const audioNodesRef = useRef<AudioNode[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const duration = useMemo(() => sequenceDuration(project.sequence), [project.sequence]);
  const fps = project.sequence.fps || 30;

  /* ---------------- compositor ---------------- */

  if (!compositorRef.current) {
    compositorRef.current = new CanvasCompositor((assetId) => {
      const asset = useEditor.getState().project.assets.find((a) => a.id === assetId);
      if (!asset) return null;
      const kind: CompositorAsset['kind'] =
        asset.kind === 'audio' ? 'audio' : asset.kind === 'image' || asset.kind === 'gif' ? 'image' : 'video';
      return {
        id: asset.id,
        uri: getBridge().toDisplayUri(asset.originalPath),
        kind,
        width: asset.probe?.width ?? 0,
        height: asset.probe?.height ?? 0,
        durationSec: asset.probe?.durationSec ?? 0,
      };
    });
  }

  const drawAt = useCallback(
    async (timeSec: number) => {
      const canvas = canvasRef.current;
      const compositor = compositorRef.current;
      if (!canvas || !compositor) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await compositor.prepare(useEditor.getState().project, timeSec);
      compositor.draw(ctx, useEditor.getState().project, timeSec);
    },
    [],
  );

  /* ---------------- audio graph ---------------- */

  const syncAudio = useCallback(
    (timeSec: number, play: boolean) => {
      const state = useEditor.getState();
      const AudioCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      audioCtxRef.current ??= new AudioCtor();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const compositor = compositorRef.current;
      if (!compositor) return;

      const wanted = new Set<string>();
      for (const track of state.project.sequence.tracks) {
        if (!isTrackAudible(track, state.project.sequence.tracks)) continue;
        for (const clip of track.clips) {
          if (clip.kind !== 'media' || !clip.assetId) continue;
          if (clip.audio.muted) continue;
          const asset = state.project.assets.find((a) => a.id === clip.assetId);
          if (!asset?.probe?.hasAudio) continue;
          if (clip.timeline.start > timeSec || endOf(clip.timeline) <= timeSec) continue;
          wanted.add(asset.id);
        }
      }

      // Detach elements that are no longer on screen.
      audioNodesRef.current = audioNodesRef.current.filter((node) => {
        const tag = (node as unknown as { __assetId?: string }).__assetId;
        if (tag && !wanted.has(tag)) {
          try {
            node.disconnect();
          } catch {
            /* already detached */
          }
          return false;
        }
        return true;
      });

      const connected = new Set(
        audioNodesRef.current.map((n) => (n as unknown as { __assetId?: string }).__assetId).filter(Boolean),
      );

      for (const assetId of wanted) {
        if (connected.has(assetId)) continue;
        const video = compositor.videoFor(assetId);
        if (!video) continue;
        try {
          const source = ctx.createMediaElementSource(video);
          const gain = ctx.createGain();
          const clip = state.project.sequence.tracks
            .flatMap((t) => t.clips)
            .find((c) => c.assetId === assetId && c.timeline.start <= timeSec && endOf(c.timeline) > timeSec);
          gain.gain.value = muted ? 0 : clip?.audio.volume ?? 1;
          source.connect(gain).connect(ctx.destination);
          (gain as unknown as { __assetId?: string }).__assetId = assetId;
          audioNodesRef.current.push(gain);
        } catch {
          // createMediaElementSource throws if called twice for one element.
        }
      }

      for (const assetId of wanted) {
        const video = compositor.videoFor(assetId);
        if (!video) continue;
        const clip = state.project.sequence.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.assetId === assetId && c.timeline.start <= timeSec && endOf(c.timeline) > timeSec);
        if (!clip) continue;
        const target = toSourceTime(clip, timeSec);
        if (target !== null && Math.abs(video.currentTime - target) > 0.3) {
          try {
            video.currentTime = target;
          } catch {
            /* ignore */
          }
        }
        if (play) void video.play().catch(() => undefined);
        else video.pause();
      }
    },
    [muted],
  );

  /* ---------------- playback loop ---------------- */

  useEffect(() => {
    let frame = 0;
    const state = useEditor.getState();
    if (!playing) {
      compositorRef.current?.pauseAll();
      syncAudio(state.playheadSec, false);
      void drawAt(state.playheadSec);
      return;
    }
    void compositorRef.current?.playRange(state.project, state.playheadSec, state.playheadSec + 2);
    syncAudio(state.playheadSec, true);

    const tick = () => {
      const s = useEditor.getState();
      if (!s.playback.playing) return;
      const elapsed = ((performance.now() - s.playback.startedAt) / 1000) * s.playback.rate;
      const next = s.playback.startedAtSec + elapsed;
      const total = sequenceDuration(s.project.sequence);
      if (next >= total) {
        useEditor.setState({ playheadSec: total, playback: { ...s.playback, playing: false } });
        compositorRef.current?.pauseAll();
        syncAudio(total, false);
        return;
      }
      useEditor.setState({ playheadSec: next });
      syncAudio(next, true);
      void drawAt(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `rate` and `muted` change the loop's behaviour, so they belong in the deps.
  }, [playing, rate, muted, drawAt, syncAudio]);

  /* ---------------- redraw when the edit changes ---------------- */

  useEffect(() => {
    if (!playing) void drawAt(playheadSec);
  }, [project, playheadSec, playing, drawAt]);

  /* ---------------- expose to the browser exporter ---------------- */

  useEffect(() => {
    setWebExportDeps({
      durationSec: sequenceDuration(useEditor.getState().project.sequence),
      width: useEditor.getState().project.settings.width,
      height: useEditor.getState().project.settings.height,
      fps: useEditor.getState().project.sequence.fps || 30,
      drawFrame: async (ctx, timeSec) => {
        const compositor = compositorRef.current;
        if (!compositor) return;
        await compositor.prepare(useEditor.getState().project, timeSec);
        compositor.draw(ctx, useEditor.getState().project, timeSec);
      },
      prepareAudio: async () => {
        syncAudio(0, true);
        return audioNodesRef.current;
      },
      stopAudio: () => {
        compositorRef.current?.pauseAll();
        syncAudio(0, false);
      },
    });
    return () => setWebExportDeps(null);
  }, [syncAudio]);

  useEffect(() => () => compositorRef.current?.dispose(), []);

  /* ---------------- geometry ---------------- */

  const aspect = project.settings.width / Math.max(1, project.settings.height);
  const stageStyle = useMemo(() => {
    if (typeof fit === 'number') return { width: `${fit * 100}%`, aspectRatio: String(aspect) };
    return fit === 'fill'
      ? { width: '100%', height: '100%' }
      : { maxWidth: '100%', maxHeight: '100%', aspectRatio: String(aspect), width: 'auto', height: 'auto' };
  }, [fit, aspect]);

  const selectedClip = selectedClipIds.length === 1 ? findClip(project.sequence, selectedClipIds[0]!) : undefined;
  const hasVideo = videoTracks(project.sequence).some((t) => t.clips.length > 0);

  const scrub = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const x = ((event.clientX - canvasRect.left) / Math.max(1, canvasRect.width)) * project.settings.width;
    void rect;
    // Horizontal position over the preview maps to the timeline when the user
    // drags with the split tool; a plain click just seeks by click-y-time.
    void x;
  };

  return (
    <div className={clsx('flex flex-col h-full min-h-0 bg-ink-900', fullscreen && 'fixed inset-0 z-50')}>
      {!fullscreen && (
        <div className="panel-header">
          <Icons.Eye size={14} />
          <span>Preview</span>
          {selectedClip && (
            <span className="ml-2 normal-case tracking-normal text-ink-500 truncate max-w-[180px]">
              {selectedClip.name}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              className={clsx('icon-btn w-7 h-7', fit === 'fit' && 'icon-btn-on')}
              onClick={() => setFit('fit')}
              title="Fit to window"
            >
              <Icons.Fit size={14} />
            </button>
            <button
              className={clsx('icon-btn w-7 h-7', fit === 'fill' && 'icon-btn-on')}
              onClick={() => setFit('fill')}
              title="Fill window"
            >
              <Icons.Expand size={14} />
            </button>
            <button className={clsx('icon-btn w-7 h-7', muted && 'icon-btn-on')} onClick={() => setMuted((m) => !m)} title="Mute preview">
              {muted ? <Icons.VolumeOff size={14} /> : <Icons.Volume size={14} />}
            </button>
            <button
              className="icon-btn w-7 h-7"
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <Icons.Expand size={14} />
            </button>
          </div>
        </div>
      )}

      <div
        ref={stageRef}
        className="preview-stage"
        onMouseDown={scrub}
        onClick={() => {
          if (fullscreen) setFullscreen(false);
        }}
      >
        <div style={stageStyle} className="relative max-h-full max-w-full">
          <canvas
            ref={canvasRef}
            width={project.settings.width}
            height={project.settings.height}
            className="w-full h-full object-contain bg-black rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
          />
          {!hasVideo && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-ink-500 text-[12px] bg-ink-950/70 px-3 py-1.5 rounded-md">
                Import media and drop it on the timeline to start editing
              </p>
            </div>
          )}
        </div>
      </div>

      <TransportBar duration={duration} fps={fps} />
    </div>
  );
}

function TransportBar({ duration, fps }: { duration: number; fps: number }) {
  const playheadSec = useEditor((s) => s.playheadSec);
  const playing = useEditor((s) => s.playback.playing);
  const rate = useEditor((s) => s.playback.rate);
  const { togglePlay, stop, stepFrame, setPlayhead, setPlaybackRate } = useEditor.getState();

  return (
    <div className="shrink-0 border-t border-ink-800 bg-ink-900 px-3 py-2 flex items-center gap-2">
      <button className="icon-btn" onClick={() => setPlayhead(0)} title="Go to start">
        <Icons.SkipBack size={16} />
      </button>
      <button className="icon-btn" onClick={() => stepFrame(-1)} title="Previous frame (←)">
        <Icons.FrameBack size={16} />
      </button>
      <button className="icon-btn w-10 h-10 bg-ink-800 hover:bg-ink-700" onClick={togglePlay} title="Play / pause (Space)">
        {playing ? <Icons.Pause size={18} /> : <Icons.Play size={18} />}
      </button>
      <button className="icon-btn" onClick={() => stepFrame(1)} title="Next frame (→)">
        <Icons.FrameForward size={16} />
      </button>
      <button className="icon-btn" onClick={stop} title="Stop">
        <Icons.Stop size={14} />
      </button>

      <div className="mono text-[12px] text-ink-200 ml-2 tabular-nums">
        {formatTimecode(playheadSec, fps, true)}
        <span className="text-ink-500"> / {formatTimecode(duration, fps, true)}</span>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0.1, duration)}
        step={1 / fps}
        value={Math.min(playheadSec, duration)}
        onChange={(e) => setPlayhead(Number(e.target.value))}
        className="flex-1 mx-2"
        aria-label="Playhead position"
      />

      <select
        className="field w-[74px] h-7 text-[11px]"
        value={String(rate)}
        onChange={(e) => setPlaybackRate(Number(e.target.value))}
        title="Playback speed (preview only — it does not change your clips)"
      >
        {[0.25, 0.5, 1, 1.5, 2].map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  );
}

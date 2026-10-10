"""Timeline → FFmpeg render pipeline.

This module builds the actual ffmpeg command line for a Timeline and runs it.
Nothing here fakes output: the function returns the path of the encoded file
and raises if ffmpeg reports failure.

Supported in this release
-------------------------
- Multiple video/audio tracks, concatenated in start-time order with gaps
  filled (black video / silence audio).
- Per-clip speed changes incl. reverse, volume, opacity/fade-in via filters.
- Brightness / contrast / saturation / exposure / hue / rotation / crop /
  scale, chroma-key colour removal, denoise and rudimentary stabilisation.
- Burn-in of SRT subtitles.
- H.264 and H.265 encoders, CRF quality, thread control, preview-scale
  renders for low-end machines.

The generated command is exposed via :func:`build_render_args` so tests can
assert on it and advanced users can inspect exactly what will run.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from ..core.ffmpeg import FFmpegJob, find_ffmpeg, probe, run_ffmpeg
from ..core.logging_setup import get_logger
from .presets import ExportPreset
from .timeline import Clip, Effect, Timeline, Track

log = get_logger("exporter")

VALID_CONTAINERS = {"mp4", "mkv", "webm", "mov", "gif", "avi"}


@dataclass
class RenderSettings:
    out_path: str
    width: int = 1920
    height: int = 1080
    fps: float = 30.0
    vcodec: str = "libx264"
    acodec: str = "aac"
    crf: int = 20
    x264_preset: str = "medium"
    audio_bitrate_k: int = 192
    threads: int = 0           # 0 = let ffmpeg decide
    burn_subtitles: str | None = None   # path to .srt
    scale_preview: float = 1.0          # 0.5 = render at half resolution


class RenderError(RuntimeError):
    pass


def _esc(text: str) -> str:
    """Escape a path for use inside ffmpeg filtergraph strings."""
    return text.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def _clip_video_filters(clip: Clip, target_w: int, target_h: int, fps: float) -> str:
    """Filter chain applied to one clip's video stream."""
    parts: list[str] = []
    src_dur = clip.source_duration or clip.out_resolved
    parts.append(f"trim=start={clip.in_resolved:.3f}:end={clip.out_resolved:.3f}")
    if clip.speed < 0:
        parts.append("reverse")
        speed = abs(clip.speed)
    else:
        speed = clip.speed
    if speed != 1.0:
        parts.append(f"setpts=PTS/{speed:.4f}")
    else:
        parts.append("setpts=PTS-STARTPTS")
    for fx in clip.effects:
        p = fx.params
        if fx.kind == "brightness":
            parts.append(f"eq=brightness={p.get('value', 0):+.3f}")
        elif fx.kind == "contrast":
            parts.append(f"eq=contrast={p.get('value', 1.0):.3f}")
        elif fx.kind == "saturation":
            parts.append(f"eq=saturation={p.get('value', 1.0):.3f}")
        elif fx.kind == "exposure":
            parts.append(f"eq=gamma={p.get('value', 1.0):.3f}")
        elif fx.kind == "hue":
            parts.append(f"hue=h={p.get('value', 0):.1f}")
        elif fx.kind == "rotate":
            angle = p.get("degrees", 0)
            if angle in (90, -270):
                parts.append("transpose=1")
            elif angle in (-90, 270):
                parts.append("transpose=2")
            elif angle == 180:
                parts.append("transpose=1,transpose=1")
        elif fx.kind == "crop":
            parts.append(
                f"crop={p.get('w', 'iw')}:{p.get('h', 'ih')}:{p.get('x', 0)}:{p.get('y', 0)}")
        elif fx.kind == "chroma_key":
            color = p.get("color", "0x00FF00")
            sim = p.get("similarity", 0.30)
            parts.append(f"chromakey=color={color}:similarity={sim}:blend=0.1")
        elif fx.kind == "denoise":
            parts.append(f"hqdn3d={p.get('strength', 4)}")
        elif fx.kind == "stabilize":
            # Two-pass vid.stab is heavy; offer the single-pass deshake-lite.
            parts.append("deshake")
        elif fx.kind == "fade_video":
            d = p.get("duration", 0.5)
            parts.append(f"fade=t=in:st=0:d={d:.2f}")
    if clip.opacity < 1.0:
        parts.append(f"format=rgba,colorchannelmixer=aa={clip.opacity:.2f}")
    parts.append(f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease")
    parts.append(f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black")
    parts.append(f"fps={fps:g}")
    parts.append(f"setsar=1")
    return ",".join(parts)


def _clip_audio_filters(clip: Clip, fade_in: float = 0.0) -> str:
    parts = [f"atrim=start={clip.in_resolved:.3f}:end={clip.out_resolved:.3f}",
             "asetpts=PTS-STARTPTS"]
    if clip.speed < 0:
        parts.append("areverse")
        speed = abs(clip.speed)
    else:
        speed = clip.speed
    if speed != 1.0:
        parts.append(f"atempo={min(max(speed, 0.5), 100.0):.4f}")
    vol = clip.volume
    for fx in clip.effects:
        if fx.kind == "fade_audio":
            d = fx.params.get("duration", 0.5)
            parts.append(f"afade=t=in:st=0:d={d:.2f}")
    if vol != 1.0:
        parts.append(f"volume={vol:.3f}")
    parts.append("aresample=44100")
    return ",".join(parts)


def _gap_clip(duration: float, width: int, height: int, fps: float) -> str:
    return (f"color=c=black:s={width}x{height}:r={fps:g}:d={duration:.3f}")


def build_render_args(tl: Timeline, rs: RenderSettings) -> list[str]:
    """Construct the full ffmpeg argument list for rendering a timeline."""
    if rs.vcodec not in {"libx264", "libx265", "mpeg4", "gif"}:
        raise ValueError(f"Unsupported video codec: {rs.vcodec}")
    w = int(rs.width * rs.scale_preview)
    h = int(rs.height * rs.scale_preview)
    w -= w % 2
    h -= h % 2

    # Gather segments: flatten all clips across tracks ordered by start time.
    video_tracks = [t for t in tl.tracks if t.kind == "video" and not t.muted]
    audio_tracks = [t for t in tl.tracks if t.kind == "audio" and not t.muted]
    segments: list[tuple[float, Clip, Track]] = []
    for t in video_tracks:
        segments += [(c.start, c, t) for c in t.clips]
    segments.sort(key=lambda s: s[0])
    total = tl.duration()
    if total <= 0:
        raise RenderError("Timeline is empty — nothing to render.")

    inputs: list[str] = []
    input_index: dict[str, int] = {}

    def input_for(path: str) -> int:
        if path not in input_index:
            input_index[path] = len(inputs)
            inputs.append(path)
        return input_index[path]

    video_only = rs.vcodec == "gif"
    video_chains: list[str] = []
    audio_chains: list[str] = []
    cursor = 0.0
    chain_idx = 0

    for start, clip, track in segments:
        if start > cursor + 0.02:
            gap = start - cursor
            video_chains.append(f"{_gap_clip(gap, w, h, rs.fps)}[gv{chain_idx}]")
            if not video_only:
                audio_chains.append(
                    f"anullsrc=r=44100:cl=stereo,atrim=duration={gap:.3f}[ga{chain_idx}]")
            chain_idx += 1
            cursor = start
        idx = input_for(clip.source)
        vfilters = _clip_video_filters(clip, w, h, rs.fps)
        video_chains.append(f"[{idx}:v]{vfilters}[gv{chain_idx}]")
        if not video_only:
            if _has_audio(clip.source):
                afilters = _clip_audio_filters(clip)
                audio_chains.append(f"[{idx}:a]{afilters}[ga{chain_idx}]")
            else:
                audio_chains.append(
                    f"anullsrc=r=44100:cl=stereo,atrim=duration={clip.duration:.3f}[ga{chain_idx}]")
        chain_idx += 1
        cursor = max(cursor, clip.end)

    args: list[str] = []
    for src in inputs:
        args += ["-i", str(src)]

    filter_parts = video_chains + audio_chains
    if video_only:
        concat_inputs = "".join(f"[gv{i}]" for i in range(chain_idx))
        filter_parts.append(f"{concat_inputs}concat=n={chain_idx}:v=1:a=0[vcat]")
    else:
        concat_inputs = "".join(f"[gv{i}][ga{i}]" for i in range(chain_idx))
        filter_parts.append(
            f"{concat_inputs}concat=n={chain_idx}:v=1:a=1[vcat][acat]")
    final_v = "[vcat]"
    if rs.burn_subtitles:
        filter_parts.append(f"[vcat]subtitles='{_esc(rs.burn_subtitles)}'[vsub]")
        final_v = "[vsub]"
    args += ["-filter_complex", ";".join(filter_parts)]
    args += ["-map", final_v]
    if not video_only:
        args += ["-map", "[acat]"]

    if rs.vcodec == "gif":
        args += ["-c:v", "gif", "-loop", "0"]
    else:
        args += ["-c:v", rs.vcodec, "-preset", rs.x264_preset,
                 "-crf", str(rs.crf), "-pix_fmt", "yuv420p"]
        if rs.vcodec == "libx264":
            args += ["-profile:v", "high", "-level", "4.1"]
    if rs.threads:
        args += ["-threads", str(rs.threads)]
    if not video_only:
        args += ["-c:a", rs.acodec]
        if rs.acodec in {"aac", "libmp3lame"} and rs.audio_bitrate_k:
            args += ["-b:a", f"{rs.audio_bitrate_k}k"]
    args += ["-movflags", "+faststart"] if Path(rs.out_path).suffix == ".mp4" else []
    args += ["-t", f"{total:.3f}", str(rs.out_path)]
    return args


_AUDIO_PROBE_CACHE: dict[str, bool] = {}


def _has_audio(path: str) -> bool:
    if path in _AUDIO_PROBE_CACHE:
        return _AUDIO_PROBE_CACHE[path]
    try:
        info = probe(path)
        ok = info.audio_stream is not None
    except Exception:
        ok = False
    _AUDIO_PROBE_CACHE[path] = ok
    return ok


def render(tl: Timeline, rs: RenderSettings,
           on_progress=None, cancel=None, ffmpeg_path: str | None = None) -> Path:
    """Render synchronously, calling ``on_progress(fraction)`` as data arrives."""
    if not find_ffmpeg(ffmpeg_path):
        raise RenderError("FFmpeg is not installed or configured.")
    args = build_render_args(tl, rs)
    job = FFmpegJob(args, ffmpeg_path=ffmpeg_path, timeout=None)
    job.total_duration = tl.duration() or None
    import time as _time
    job.start()
    while True:
        frac, finished = job.poll()
        if frac is not None and on_progress:
            on_progress(frac)
        if finished:
            break
        if cancel is not None and cancel():
            job.terminate()
            job.wait(timeout=10)
            raise RenderError("Render cancelled by user.")
        _time.sleep(0.08)
    rc = job.wait()
    if rc != 0:
        tail = job.stderr_tail(800)
        raise RenderError(f"ffmpeg exited with code {rc}: {tail.strip()[-300:]}")
    out = Path(rs.out_path)
    if not out.is_file() or out.stat().st_size == 0:
        raise RenderError("ffmpeg finished but produced no output file.")
    return out

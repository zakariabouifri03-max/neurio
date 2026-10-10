"""Turns a Timeline into one FFmpeg filtergraph and renders it (export or single-frame preview).

Every clip becomes an input; video clips are trimmed, retimed, rotated, cropped, colour-corrected,
chroma-keyed and overlaid on a black canvas by track; audio is trimmed, retimed, faded, delayed and
mixed. Text clips are rendered to transparent PNGs with Pillow and overlaid.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from ..core import ffmpeg
from ..core.errors import AppError
from ..core.log import get_logger
from ..image.text import place_on_canvas, render_text
from .model import Clip, Timeline

log = get_logger("render")


@dataclass
class Plan:
    inputs: list[str] = field(default_factory=list)   # ffmpeg input args
    filter_complex: str = ""
    vout: str = "vout"
    aout: Optional[str] = None
    total: float = 0.0
    width: int = 0
    height: int = 0
    fps: int = 30


def _atempo(speed: float) -> list[str]:
    parts: list[str] = []
    s = speed
    while s > 2.0 + 1e-9:
        parts.append("atempo=2.0")
        s /= 2.0
    while s < 0.5 - 1e-9:
        parts.append("atempo=0.5")
        s /= 0.5
    if abs(s - 1.0) > 1e-9 or not parts:
        parts.append(f"atempo={s:.6f}")
    return parts


def _rotate_filters(deg: int) -> list[str]:
    return {90: ["transpose=1"], 180: ["transpose=1", "transpose=1"], 270: ["transpose=2"]}.get(deg, [])


def _video_chain(i: int, c: Clip, out_w: int, out_h: int, text_scale: float) -> str:
    """Filter chain for input i producing label [v{i}] (fully timed on the timeline)."""
    f: list[str] = []
    if c.kind == "video":
        f += [f"trim=start={c.in_point:.6f}:end={c.source_end:.6f}", "setpts=PTS-STARTPTS"]
        if c.reverse:
            f += ["reverse", "setpts=PTS-STARTPTS"]
        f += [f"setpts=PTS/{c.speed:.6f}"]
        f += _rotate_filters(c.rotate)
        x, y, w, h = c.crop
        if (x, y, w, h) != (0.0, 0.0, 1.0, 1.0):
            f.append(f"crop=iw*{w:.6f}:ih*{h:.6f}:iw*{x:.6f}:ih*{y:.6f}")
        if c.stabilize:
            f.append("deshake")
    elif c.kind == "image":
        f += ["setpts=PTS-STARTPTS"]
    else:  # text
        f += ["setpts=PTS-STARTPTS"]
    if c.kind in ("video", "image") and (c.brightness, c.contrast, c.saturation, c.gamma) != (0.0, 1.0, 1.0, 1.0):
        f.append(f"eq=brightness={c.brightness:.4f}:contrast={c.contrast:.4f}:"
                 f"saturation={c.saturation:.4f}:gamma={c.gamma:.4f}")
    if c.kind in ("video", "image"):
        if c.chroma_color:
            col = "0x" + c.chroma_color.lstrip("#")
            f.append(f"chromakey=color={col}:similarity={c.chroma_similarity:.4f}:blend=0.05")
        f.append("format=yuva420p")
        if c.opacity < 1.0:
            f.append(f"colorchannelmixer=aa={c.opacity:.4f}")
        if c.fade_in > 0:
            f.append(f"fade=t=in:st={c.start:.6f}:d={c.fade_in:.6f}:alpha=1")
        if c.fade_out > 0:
            f.append(f"fade=t=out:st={c.end - c.fade_out:.6f}:d={c.fade_out:.6f}:alpha=1")
        f += [f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease:force_divisible_by=2",
              "setsar=1"]
    else:
        f += ["format=yuva420p", f"scale={out_w}:{out_h}"]
    # place the clip on the timeline (absolute timestamps)
    f.append(f"setpts=PTS+{c.start:.6f}/TB")
    return f"[{i}:v]" + ",".join(f) + f"[v{i}]"


def _audio_chain(i: int, c: Clip) -> str:
    f = [f"atrim=start={c.in_point:.6f}:end={c.source_end:.6f}", "asetpts=PTS-STARTPTS"]
    if c.reverse:
        f.append("areverse")
    f += _atempo(c.speed)
    if abs(c.volume - 1.0) > 1e-6:
        f.append(f"volume={c.volume:.4f}")
    if c.fade_in > 0:
        f.append(f"afade=t=in:st=0:d={c.fade_in:.6f}")
    if c.fade_out > 0:
        f.append(f"afade=t=out:st={c.duration - c.fade_out:.6f}:d={c.fade_out:.6f}")
    ms = int(round(c.start * 1000))
    if ms > 0:
        f.append(f"adelay={ms}:all=1")
    return f"[{i}:a]" + ",".join(f) + f"[a{i}]"


def build_plan(
    tl: Timeline,
    probes: dict[str, ffmpeg.MediaInfo],
    *,
    out_w: int,
    out_h: int,
    fps: int,
    text_dir: Optional[Path] = None,
    source_map: Optional[dict[str, str]] = None,
    preview_height: Optional[int] = None,
    with_audio: bool = True,
) -> Plan:
    if not tl.clips:
        raise AppError("The timeline is empty. Import media and add it to the timeline first.")
    tl.validate()
    total = tl.duration()
    source_map = source_map or {}
    text_scale = out_h / 1080.0
    plan = Plan(total=total, width=out_w, height=out_h, fps=fps)
    chains: list[str] = []
    audio_labels: list[str] = []
    video_clips: list[tuple[int, Clip]] = []

    clips = [c for c in tl.sorted_clips()]
    for idx, c in enumerate(clips):
        if c.kind == "text":
            if text_dir is None:
                raise AppError("Text clips need a working folder for rendering.")
            img = render_text(c.text, size=max(8, int(c.text_size * text_scale)), color=c.text_color,
                              stroke_width=int(c.text_stroke * text_scale),
                              shadow_offset=(3, 3) if c.text_stroke == 0 else (0, 0))
            layer = place_on_canvas(img, out_w, out_h, c.text_position)
            png = Path(text_dir) / f"text-{c.id}.png"
            layer.save(png)
            plan.inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{c.duration:.6f}", "-i", str(png)]
        else:
            src = source_map.get(c.src, c.src)
            if not Path(c.src).is_file():
                raise AppError(f"Source file is missing: {Path(c.src).name}",
                               details=c.src)
            if c.kind == "image":
                plan.inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{c.duration:.6f}", "-i", src]
            else:
                plan.inputs += ["-i", src]
        input_no = sum(1 for a in plan.inputs if a == "-i") - 1
        chains.append(_video_chain(input_no, c, out_w, out_h, text_scale))
        video_clips.append((input_no, c))
        info = probes.get(c.src)
        if with_audio and c.kind in ("video", "audio") and (info is None or info.has_audio) and c.volume > 0:
            chains.append(_audio_chain(input_no, c))
            audio_labels.append(f"[a{input_no}]")

    base = f"color=c=black:s={out_w}x{out_h}:r={fps}:d={total:.3f}[base]"
    graph = [base] + chains
    prev = "[base]"
    for n, (input_no, c) in enumerate(video_clips):
        label = f"[o{n}]" if n < len(video_clips) - 1 else "[vmain]"
        graph.append(f"{prev}[v{input_no}]overlay=x=(W-w)/2:y=(H-h)/2:format=auto:eof_action=pass{label}")
        prev = label
    post = "format=yuv420p"
    if preview_height:
        post += f",scale=-2:{int(preview_height)}"
        plan.vout = "vpreview"
    graph.append(f"[vmain]{post}[{plan.vout}]")
    if audio_labels:
        if len(audio_labels) == 1:
            graph.append(f"{audio_labels[0]}anull[aout]")
        else:
            graph.append("".join(audio_labels) + f"amix=inputs={len(audio_labels)}:duration=longest:normalize=0[aout]")
        plan.aout = "aout"
    plan.filter_complex = ";".join(graph)
    return plan


def _video_codec_args(codec: str, crf: int, preset: str, hw: bool, encs: set[str]) -> list[str]:
    if codec == "h264":
        if hw and "h264_qsv" in encs:
            return ["-c:v", "h264_qsv", "-global_quality", str(crf)]
        return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-profile:v", "high"]
    if codec == "h265":
        if hw and "hevc_qsv" in encs:
            return ["-c:v", "hevc_qsv", "-global_quality", str(crf), "-tag:v", "hvc1"]
        return ["-c:v", "libx265", "-preset", preset, "-crf", str(crf), "-tag:v", "hvc1"]
    if codec == "vp9":
        return ["-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0", "-row-mt", "1", "-deadline", "good",
                "-cpu-used", "4"]
    raise AppError(f"Unsupported video codec: {codec}")


CONTAINERS = {".mp4": "aac", ".mov": "aac", ".mkv": "aac", ".webm": "libopus"}


def export_timeline(
    tl: Timeline,
    out_path: str | Path,
    *,
    width: Optional[int] = None,
    height: Optional[int] = None,
    fps: Optional[int] = None,
    codec: str = "h264",
    crf: int = 23,
    preset: str = "medium",
    audio_bitrate: str = "192k",
    threads: int = 0,
    hardware: bool = False,
    work_dir: Path,
    source_map: Optional[dict[str, str]] = None,
    on_progress: Optional[Callable[[float], None]] = None,
    cancel: Optional[threading.Event] = None,
) -> Path:
    out = Path(out_path)
    ext = out.suffix.lower()
    if ext not in CONTAINERS:
        raise AppError("Choose an output file ending in .mp4, .mov, .mkv or .webm.")
    if codec == "vp9" and ext != ".webm":
        raise AppError("VP9 video is only supported in .webm files.")
    if codec == "h265" and ext == ".webm":
        raise AppError("H.265 is not supported in .webm files. Use .mp4 or .mkv.")
    if not 0 <= crf <= 51 or (codec == "vp9" and crf > 63):
        raise AppError("Quality (CRF) value is out of range.")
    out_w, out_h = width or tl.size[0], height or tl.size[1]
    out_fps = fps or tl.fps
    for c in tl.clips:
        if c.kind in ("video", "audio", "image") and not Path(c.src).is_file():
            raise AppError(f"Source file is missing: {Path(c.src).name}", details=c.src)
    probes = {}
    for c in tl.clips:
        if c.kind in ("video", "audio", "image") and c.src not in probes:
            probes[c.src] = ffmpeg.probe(c.src)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    plan = build_plan(tl, probes, out_w=out_w, out_h=out_h, fps=out_fps, text_dir=work_dir,
                      source_map=source_map)
    encs = ffmpeg.encoders()
    args = [*plan.inputs, "-filter_complex", plan.filter_complex, "-map", f"[{plan.vout}]"]
    args += _video_codec_args(codec, crf, preset, hardware, encs)
    if plan.aout:
        acodec = CONTAINERS[ext] if codec != "vp9" else "libopus"
        args += ["-map", f"[{plan.aout}]", "-c:a", acodec, "-b:a", audio_bitrate]
    else:
        args += ["-an"]
    if threads > 0:
        args += ["-threads", str(threads)]
    if ext == ".mp4" or ext == ".mov":
        args += ["-movflags", "+faststart"]
    args += ["-t", f"{plan.total:.3f}", "-r", str(out_fps), str(out)]
    tmp = out.with_name(f".{out.stem}.rendering{out.suffix}")
    args[-1] = str(tmp)
    try:
        ffmpeg.run(args, duration=plan.total, on_progress=on_progress, cancel=cancel)
        tmp.replace(out)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    log.info("Exported %s (%.1fs, %dx%d)", out.name, plan.total, out_w, out_h)
    return out


def preview_frame(
    tl: Timeline,
    t: float,
    out_png: str | Path,
    *,
    height: int = 360,
    work_dir: Path,
    source_map: Optional[dict[str, str]] = None,
) -> Path:
    """Render the composited frame at time t (seconds) into a PNG for the preview panel."""
    if not 0 <= t < max(tl.duration(), 0.001):
        raise AppError("The playhead is outside the timeline.")
    probes = {c.src: ffmpeg.probe(c.src) for c in tl.clips if c.kind in ("video", "audio", "image")}
    out_w, out_h = tl.size
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    plan = build_plan(tl, probes, out_w=out_w, out_h=out_h, fps=tl.fps, text_dir=work_dir,
                      source_map=source_map, preview_height=height, with_audio=False)
    args = [*plan.inputs, "-filter_complex", plan.filter_complex, "-map", f"[{plan.vout}]",
            "-ss", f"{t:.3f}", "-frames:v", "1", "-an", str(out_png)]
    ffmpeg.run(args, timeout=120)
    return Path(out_png)

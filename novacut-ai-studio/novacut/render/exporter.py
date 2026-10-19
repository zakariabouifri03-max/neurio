"""Export engine: runs the filter graph through FFmpeg with progress/cancel."""
from __future__ import annotations

import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from ..core import paths
from ..core.ffmpeg import (CancellableProcess, ffmpeg_supports_encoders,
                           find_ffmpeg, FFmpegNotFoundError)
from ..core.logging_setup import get_logger
from ..models.project import Project
from .filtergraph import FilterGraphBuilder
from .presets import ExportSettings

log = get_logger("exporter")


@dataclass
class ExportReport:
    ok: bool
    output_path: str
    duration_s: float
    used_encoder: str
    hardware_used: bool
    fell_back: bool = False
    cancelled: bool = False
    error: str = ""
    stderr_tail: str = ""
    bytes_written: int = 0


class ExportError(RuntimeError):
    pass


def check_disk_space(output_path: str, needed_bytes: int) -> tuple[bool, int, int]:
    """Return (ok, free_bytes, needed_bytes)."""
    free = shutil.disk_usage(str(Path(output_path).parent)).free
    return free >= needed_bytes, free, needed_bytes


def build_command(project: Project, settings: ExportSettings,
                  filter_script_path: Optional[str] = None) -> tuple[list[str], float, str]:
    """Assemble the full ffmpeg argv. Returns (argv, duration, filter_script)."""
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise FFmpegNotFoundError("FFmpeg was not found.")
    w, h = settings.resolution(project.settings.width, project.settings.height)
    builder = FilterGraphBuilder(project, use_proxies=settings.use_proxies,
                                 burn_subtitles=settings.burn_subtitles)
    input_args, filter_script, maps, duration = builder.build()

    # Output scaling/fps normalisation happens after the composed graph.
    last_v_label = maps[1].strip("[]")
    extra_vf = (f"scale={w}:{h}:flags=lanczos,fps={settings.fps},"
                f"setsar=1")
    filter_script += ";\n[" + last_v_label + "]" + extra_vf + "[vout_final]"
    maps = ["-map", "[vout_final]"] + maps[2:]

    if filter_script_path is None:
        paths.ensure_dirs()
        fd, filter_script_path = tempfile.mkstemp(
            prefix="novacut_filter_", suffix=".txt", dir=str(paths.CACHE_DIR))
        os.close(fd)
        Path(filter_script_path).write_text(filter_script, encoding="utf-8")
    else:
        Path(filter_script_path).write_text(filter_script, encoding="utf-8")

    cmd: list[str] = [str(ffmpeg), "-y", "-hide_banner", "-nostdin"]
    cmd += input_args
    cmd += ["-filter_complex_script", str(filter_script_path)]
    cmd += maps
    cmd += _encoder_args(settings, w, h)
    cmd += ["-progress", "pipe:1", "-nostats", settings.output_path]
    return cmd, duration, filter_script_path


def _encoder_args(settings: ExportSettings, w: int, h: int) -> list[str]:
    args: list[str] = []
    encoder = settings.video_encoder
    caps = ffmpeg_supports_encoders()
    hw = settings.use_hardware and encoder in ("h264_nvenc", "hevc_nvenc",
                                                "h264_qsv", "hevc_qsv",
                                                "h264_amf", "hevc_amf")
    if hw and not caps.get(_caps_key(encoder), False):
        log.warning("Encoder %s unavailable; using CPU fallback", encoder)
        encoder = "libx265" if "hevc" in encoder else "libx264"
        hw = False
    args += ["-c:v", encoder]
    if encoder in ("libx264", "libx265"):
        args += ["-preset", "medium", "-crf", str(settings.crf)]
        if settings.video_bitrate_k > 0:
            args += ["-maxrate", f"{settings.video_bitrate_k}k",
                     "-bufsize", f"{settings.video_bitrate_k * 2}k"]
        if encoder == "libx265" and settings.container == ".mp4":
            args += ["-tag:v", "hvc1"]
    elif encoder.endswith("nvenc"):
        args += ["-preset", "p5", "-rc", "vbr",
                 "-cq", str(settings.crf), "-b:v",
                 f"{max(1000, settings.video_bitrate_k or 8000)}k"]
    elif encoder.endswith("qsv"):
        args += ["-global_quality", str(settings.crf)]
    elif encoder.endswith("amf"):
        args += ["-rc", "cqp", "-qp_i", str(settings.crf),
                 "-qp_p", str(settings.crf)]
    args += ["-c:a", settings.audio_encoder,
             "-b:a", f"{settings.audio_bitrate_k}k",
             "-ar", str(settings.sample_rate),
             "-ac", str(settings.audio_channels)]
    if settings.container == ".mp4":
        args += ["-movflags", "+faststart"]
    if settings.extra_metadata:
        args += ["-metadata", "encoder=NovaCut AI Studio"]
    return args


def _caps_key(encoder: str) -> str:
    return encoder if encoder in ("h264_nvenc", "hevc_nvenc", "h264_qsv",
                                  "hevc_qsv", "h264_amf", "hevc_amf") else encoder


def run_export(project: Project, settings: ExportSettings,
               on_progress: Optional[Callable[[float, float, float], None]] = None,
               should_cancel: Optional[Callable[[], bool]] = None) -> ExportReport:
    """Render the complete timeline. Blocks; run inside a worker thread."""
    problems = settings.validate()
    if problems:
        raise ExportError("; ".join(problems))
    out = Path(settings.output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd, duration, script_path = build_command(project, settings)
    runner = CancellableProcess()
    started = time.time()
    last_ts = started

    def _on_progress(fraction: float, seconds: float) -> None:
        nonlocal last_ts
        now = time.time()
        eta = 0.0
        if fraction > 0.02 and now - started > 1:
            eta = (now - started) / fraction - (now - started)
        last_ts = now
        if on_progress:
            on_progress(fraction, seconds, max(0.0, eta))
        if should_cancel and should_cancel():
            runner.cancel()

    log.info("Exporting %s -> %s (%.1fs timeline)", project.settings.name,
             settings.output_path, duration)
    result = runner.run(cmd, total_duration=duration, on_progress=_on_progress)
    used_encoder = settings.video_encoder
    hw_used = settings.use_hardware

    if runner.cancelled or (should_cancel and should_cancel()):
        out.unlink(missing_ok=True)
        return ExportReport(False, str(out), time.time() - started,
                           used_encoder, hw_used, cancelled=True,
                           error="Cancelled by user")
    if not result.ok:
        # Automatic CPU fallback when a hardware encoder failed at runtime.
        hw_encoders = ("h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv",
                       "h264_amf", "hevc_amf")
        if settings.video_encoder in hw_encoders:
            log.warning("Hardware encode failed; retrying on CPU. %s",
                        result.stderr[-300:])
            fallback = dict(settings.__dict__)
            fallback["video_codec_id"] = (
                "h265_cpu" if "hevc" in settings.video_encoder else "h264_cpu")
            fb_settings = ExportSettings(**fallback)
            fb_cmd, _, _ = build_command(project, fb_settings, script_path)
            fb = CancellableProcess()
            fb_result = fb.run(fb_cmd, total_duration=duration,
                               on_progress=_on_progress)
            if fb_result.ok:
                return ExportReport(True, str(out), time.time() - started,
                                    fb_settings.video_encoder, False,
                                    fell_back=True,
                                    bytes_written=out.stat().st_size if out.exists() else 0)
            result = fb_result
            used_encoder = fb_settings.video_encoder
        tail = result.stderr[-2000:]
        out.unlink(missing_ok=True)
        return ExportReport(False, str(out), time.time() - started,
                            used_encoder, False,
                            error=_diagnose(tail), stderr_tail=tail)
    return ExportReport(True, str(out), time.time() - started, used_encoder,
                        hw_used, bytes_written=out.stat().st_size if out.exists() else 0)


def _diagnose(stderr: str) -> str:
    low = stderr.lower()
    if "no such filter" in low or "failed to parse" in low:
        return ("FFmpeg rejected a filter in the render graph. Your FFmpeg "
                "build may be too old. Details:\n" + stderr[-400:])
    if "could not open codec" in low or "unknown encoder" in low:
        return ("The selected codec/encoder is not supported by this FFmpeg "
                "build. Try a different encoder in Export settings.")
    if "permission denied" in low:
        return "Permission denied writing the output file. Close other apps using it."
    if "no space left" in low:
        return "Out of disk space while rendering."
    if "missing picture" in low or "invalid data" in low:
        return ("A source media file appears corrupt or uses an unsupported "
                "codec. Check the media bin for missing/problem files.")
    return "FFmpeg failed. See diagnostics log for details."

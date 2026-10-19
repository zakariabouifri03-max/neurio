"""Automatic subtitles via a local Whisper-compatible engine."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..core import paths
from ..core.logging_setup import get_logger
from .base import AITool, ToolStatus
from . import model_manager

log = get_logger("ai-subtitles")

WHISPER_SIZES = ("tiny", "base", "small", "medium", "large-v3")


@dataclass
class SubtitleSegment:
    start: float
    end: float
    text: str

    def clamp(self) -> "SubtitleSegment":
        self.text = self.text.strip()
        if self.end < self.start:
            self.end = self.start + 0.1
        return self


@dataclass
class SubtitleStyle:
    font_family: str = "Arial"
    font_size: int = 48
    primary_color: str = "#FFFFFF"     # ASS BGR order handled in writer
    outline_color: str = "#000000"
    outline_width: int = 2
    bold: bool = True
    margin_v: int = 40
    alignment: int = 2                # ASS numpad alignment (2 = bottom center)


def _fmt_ts(seconds: float, sep: str) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def write_srt(segments: list[SubtitleSegment], path: str) -> str:
    lines = []
    for i, seg in enumerate(segments, 1):
        lines += [str(i),
                  f"{_fmt_ts(seg.start, ',')} --> {_fmt_ts(seg.end, ',')}",
                  seg.text, ""]
    Path(path).write_text("\n".join(lines), encoding="utf-8")
    return path


def write_vtt(segments: list[SubtitleSegment], path: str) -> str:
    lines = ["WEBVTT", ""]
    for seg in segments:
        lines += [f"{_fmt_ts(seg.start, '.')} --> {_fmt_ts(seg.end, '.')}",
                  seg.text, ""]
    Path(path).write_text("\n".join(lines), encoding="utf-8")
    return path


def _ass_color(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def write_ass(segments: list[SubtitleSegment], path: str,
              style: SubtitleStyle | None = None,
              width: int = 1920, height: int = 1080) -> str:
    st = style or SubtitleStyle()
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{st.font_family},{st.font_size},{_ass_color(st.primary_color)},{_ass_color(st.outline_color)},&H64000000,{ -1 if st.bold else 0},0,1,{st.outline_width},1,{st.alignment},20,20,{st.margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    rows = []
    for seg in segments:
        text = seg.text.replace("\n", "\\N")
        rows.append(f"Dialogue: 0,{_fmt_ts(seg.start, '.')[:-1]},{_fmt_ts(seg.end, '.')[:-1]},"
                    f"Default,,0,0,0,,{text}")
    Path(path).write_text(header + "\n".join(rows), encoding="utf-8")
    return path


class SubtitleEngine(AITool):
    id = "subtitles"
    name = "Automatic subtitles"
    description = "Local Whisper transcription with SRT/VTT export and burn-in."
    needs_model = True
    model_kind = "whisper"

    def check(self) -> ToolStatus:
        has_fw = self.module_available("faster_whisper")
        has_w = self.module_available("whisper")
        if not (has_fw or has_w):
            return self.unavailable(
                "No local transcription engine installed. Install "
                "'faster-whisper' (recommended) from the Model Manager.")
        engine = "faster_whisper" if has_fw else "whisper"
        return self.available(requirements=f"engine={engine}",
                              resource_note="Models run fully offline on CPU/GPU.")

    def install_engine_model(self, size: str = "base",
                             progress=None, should_cancel=None) -> Path:
        """Explicit model fetch through the engine into our models folder."""
        if size not in WHISPER_SIZES:
            raise ValueError(f"Unknown model size {size}")
        target = paths.MODELS_DIR / "whisper"
        target.mkdir(parents=True, exist_ok=True)
        try:
            from huggingface_hub import snapshot_download
        except ImportError as exc:
            raise RuntimeError(
                "Install faster-whisper first (it bundles huggingface_hub).") from exc
        repo = f"Systran/faster-whisper-{size}"
        path = snapshot_download(
            repo_id=repo, local_dir=str(target / size),
            ignore=["*.msgpack", "*.h5", "vocabulary.json"],
        )
        return Path(path)

    def transcribe(self, media_path: str, model_size: str = "base",
                   language: Optional[str] = None,
                   progress=None, should_cancel=None) -> list[SubtitleSegment]:
        status = self.check()
        if not status.available:
            raise RuntimeError(status.reason)
        if self.module_available("faster_whisper"):
            return self._transcribe_fw(media_path, model_size, language,
                                       progress, should_cancel)
        return self._transcribe_openai(media_path, model_size, language, progress)

    def _transcribe_fw(self, media_path, model_size, language, progress,
                       should_cancel):
        from faster_whisper import WhisperModel
        root = str(paths.MODELS_DIR / "whisper")
        model = WhisperModel(model_size, device="cpu", compute_type="int8",
                             download_root=root)
        segments_iter, info = model.transcribe(
            media_path, language=language, vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500))
        total = max(1.0, info.duration or 0.0)
        out: list[SubtitleSegment] = []
        for seg in segments_iter:
            if should_cancel and should_cancel():
                raise RuntimeError("Transcription cancelled")
            out.append(SubtitleSegment(seg.start, seg.end, seg.text).clamp())
            if progress:
                progress(min(1.0, seg.end / total), f"Transcribing {seg.end:.0f}s/{total:.0f}s")
        if progress:
            progress(1.0, f"{len(out)} segments")
        return out

    def _transcribe_openai(self, media_path, model_size, language, progress):
        import whisper  # type: ignore
        root = str(paths.MODELS_DIR / "whisper")
        model = whisper.load_model(model_size, download_root=root)
        result = model.transcribe(media_path, language=language, fp16=False)
        out = [SubtitleSegment(s["start"], s["end"], s["text"]).clamp()
               for s in result.get("segments", [])]
        if progress:
            progress(1.0, f"{len(out)} segments")
        return out

    def export(self, segments: list[SubtitleSegment], out_path: str,
               style: SubtitleStyle | None = None,
               width: int = 1920, height: int = 1080) -> str:
        ext = Path(out_path).suffix.lower()
        if ext == ".srt":
            return write_srt(segments, out_path)
        if ext == ".vtt":
            return write_vtt(segments, out_path)
        if ext == ".ass":
            return write_ass(segments, out_path, style, width, height)
        raise ValueError(f"Unsupported subtitle format: {ext}")

"""Full-timeline FFmpeg graph generation and cancellable asynchronous rendering."""
from __future__ import annotations

from dataclasses import dataclass
import math
import os
from pathlib import Path
import subprocess
import threading
import time
from typing import Iterable

from PySide6.QtCore import QThread, Signal

from .media import ffmpeg_capabilities, find_ffmpeg
from .models import Clip, Project


class ExportError(RuntimeError):
    pass


@dataclass
class ExportSettings:
    output_path: str
    container: str = "mp4"
    video_codec: str = "h264"
    width: int = 1920
    height: int = 1080
    fps: float = 30.0
    quality: int = 20
    bitrate_kbps: int = 12000
    quality_mode: bool = True
    audio_codec: str = "aac"
    audio_bitrate_kbps: int = 192
    sample_rate: int = 48000
    use_hardware: bool = False

    def validate(self) -> None:
        if self.container not in {"mp4", "mkv", "mov", "webm"}:
            raise ExportError("Unsupported output container")
        if self.video_codec not in {"h264", "h265", "vp9"}:
            raise ExportError("Unsupported video codec")
        if self.audio_codec not in {"aac", "opus", "mp3", "pcm_s16le", "none"}:
            raise ExportError("Unsupported audio codec")
        if not 16 <= self.width <= 16384 or not 16 <= self.height <= 16384:
            raise ExportError("Export resolution is outside the supported range")
        if self.width % 2 or self.height % 2:
            raise ExportError("This export profile uses 4:2:0 video; width and height must be even numbers")
        if not 1 <= self.fps <= 240:
            raise ExportError("Export frame rate must be between 1 and 240 FPS")
        if not 0 <= self.quality <= 51 or not 100 <= self.bitrate_kbps <= 200000:
            raise ExportError("Quality or bitrate is outside the supported range")
        if self.sample_rate not in {32000, 44100, 48000, 96000}:
            raise ExportError("Unsupported audio sample rate")
        if not Path(self.output_path).expanduser().parent.exists():
            # The export dialog normally creates this folder, but a direct caller
            # may specify a new parent directory.
            Path(self.output_path).expanduser().parent.mkdir(parents=True, exist_ok=True)


class FFmpegCommandBuilder:
    """Build one filter_complex command that composites every enabled timeline track."""

    @staticmethod
    def _atempo(rate: float) -> list[str]:
        rate = min(16.0, max(0.0625, rate))
        filters: list[str] = []
        while rate > 2.0:
            filters.append("atempo=2.0")
            rate /= 2.0
        while rate < 0.5:
            filters.append("atempo=0.5")
            rate /= 0.5
        filters.append(f"atempo={rate:.6f}")
        return filters

    @staticmethod
    def _escape_filter_text(text: str) -> str:
        # FFmpeg's filtergraph parser needs these characters escaped even though
        # the command is passed as an argv list (there is no shell expansion).
        escaped = text.replace("\\", r"\\")
        for character in ("'", ":", ",", "[", "]", ";", "%"):
            escaped = escaped.replace(character, "\\" + character)
        return escaped.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")

    @staticmethod
    def _ass_time(value: float) -> str:
        centiseconds = max(0, int(round(value * 100)))
        hours, centiseconds = divmod(centiseconds, 360000)
        minutes, centiseconds = divmod(centiseconds, 6000)
        seconds, centiseconds = divmod(centiseconds, 100)
        return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"

    @classmethod
    def write_ass_titles(cls, project: Project, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        events = []
        track_order = {track.id: index for index, track in enumerate(project.tracks)}
        for clip in project.clips:
            if clip.type != "title":
                continue
            track = project.track(clip.track_id)
            if not track or not track.visible:
                continue
            color = clip.title_color.lstrip("#")
            if len(color) == 3:
                color = "".join(character * 2 for character in color)
            if len(color) != 6:
                color = "FFFFFF"
            red, green, blue = color[0:2], color[2:4], color[4:6]
            ass_bgr = f"{blue}{green}{red}".upper()
            alpha = round((1.0 - min(1.0, max(0.0, clip.opacity))) * 255)
            x = round(project.width / 2 + clip.position_x)
            y = round(project.height / 2 + clip.position_y)
            layer = max(0, len(project.tracks) - track_order.get(track.id, 0))
            tags = [r"\an5", f"\\pos({x},{y})", f"\\fs{int(clip.title_size)}",
                    f"\\1c&H{ass_bgr}&", f"\\alpha&H{alpha:02X}&", "\\bord2", "\\shad1"]
            if clip.fade_in > 0 or clip.fade_out > 0:
                tags.append(f"\\fad({int(max(0, clip.fade_in) * 1000)},{int(max(0, clip.fade_out) * 1000)})")
            text = clip.title.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
            text = text.replace("\r\n", r"\N").replace("\n", r"\N").replace("\r", r"\N")
            dialogue = (
                f"Dialogue: {layer},{cls._ass_time(clip.start)},{cls._ass_time(clip.end)},Default,,0,0,0,,"
                f"{{{''.join(tags)}}}{text}"
            )
            events.append((clip.start, dialogue))
        events.sort(key=lambda pair: pair[0])
        header = (
            "[Script Info]\nScriptType: v4.00+\n"
            f"PlayResX: {project.width}\nPlayResY: {project.height}\n"
            "WrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,5,40,40,40,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        )
        target.write_text(header + "\n".join(line for _, line in events) + "\n", encoding="utf-8-sig")
        return target

    @staticmethod
    def _escape_filter_path(path: str | Path) -> str:
        value = str(path).replace("\\", r"\\")
        for character in ("'", ":", ",", "[", "]", ";"):
            value = value.replace(character, "\\" + character)
        return value

    @staticmethod
    def _encoder(settings: ExportSettings, encoders: set[str]) -> tuple[str, bool]:
        if settings.video_codec == "h264":
            hardware = "h264_nvenc"
            software = "libx264"
        elif settings.video_codec == "h265":
            hardware = "hevc_nvenc"
            software = "libx265"
        else:
            hardware = ""
            software = "libvpx-vp9"
        if settings.use_hardware and hardware and hardware in encoders:
            return hardware, True
        return software, False

    @classmethod
    def build(
        cls,
        project: Project,
        settings: ExportSettings,
        ffmpeg_path: str | None = None,
        encoders: Iterable[str] | None = None,
        output_override: str | None = None,
        filters: Iterable[str] | None = None,
        titles_path: str | Path | None = None,
    ) -> list[str]:
        project.validate()
        settings.validate()
        binary = ffmpeg_path or find_ffmpeg()
        if not binary:
            raise ExportError("FFmpeg was not found. Install FFmpeg or choose its executable in Settings.")
        if not project.clips:
            raise ExportError("The timeline is empty. Add media or a title before exporting.")
        output = Path(output_override or settings.output_path).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        duration = project.duration
        if duration <= 0:
            raise ExportError("The project timeline has no duration")
        capabilities = ffmpeg_capabilities(binary) if encoders is None or filters is None else {"encoders": set(encoders), "filters": set(filters)}
        available = set(encoders) if encoders is not None else capabilities["encoders"]
        available_filters = set(filters) if filters is not None else capabilities["filters"]
        encoder, hardware = cls._encoder(settings, available)
        if encoder not in available:
            raise ExportError(f"The selected FFmpeg build does not include the {encoder} encoder.")
        if settings.container == "webm" and settings.video_codec != "vp9":
            raise ExportError("WEBM output in NovaCut requires the VP9 video codec.")
        if settings.container == "webm" and settings.audio_codec not in {"opus", "none"}:
            raise ExportError("WEBM output in NovaCut requires Opus audio or no audio.")
        if settings.container == "mp4" and settings.audio_codec == "pcm_s16le":
            raise ExportError("PCM audio is not compatible with the MP4 export profile. Choose AAC or use MKV/MOV.")
        title_clips_present = any(clip.type == "title" and (track := project.track(clip.track_id)) and track.visible
                                  for clip in project.clips)
        title_filter = ""
        if title_clips_present:
            if "drawtext" in available_filters:
                title_filter = "drawtext"
            elif "ass" in available_filters or "subtitles" in available_filters:
                title_filter = "ass"
            else:
                raise ExportError("This FFmpeg build has neither drawtext nor libass. Install a build with a text/subtitle filter to export titles.")

        args = [binary, "-hide_banner", "-y", "-loglevel", "warning", "-stats_period", "0.5", "-progress", "pipe:1", "-nostats"]
        visual_clips: list[tuple[int, Clip]] = []
        audio_clips: list[tuple[int, Clip]] = []
        track_index = {track.id: index for index, track in enumerate(project.tracks)}
        clip_input: dict[str, int] = {}
        input_streams: dict[str, tuple[bool, bool]] = {}
        for clip in project.clips:
            if clip.type == "title":
                continue
            track = project.track(clip.track_id)
            asset = project.asset(clip.media_id)
            if track is None or asset is None:
                raise ExportError(f"Clip {clip.id} references missing track or media")
            media_path = Path(asset.path).expanduser()
            if not media_path.is_file():
                raise ExportError(f"Media file is missing: {asset.name}\n{asset.path}")
            visual = asset.kind in {"video", "image"} and track.kind == "video" and track.visible
            audio = asset.has_audio and not track.muted and settings.audio_codec != "none"
            if not visual and not audio:
                continue
            input_index = len(clip_input)
            clip_input[clip.id] = input_index
            input_streams[clip.id] = (visual, audio)
            if asset.kind == "image":
                # Loop a still for exactly the non-destructive clip duration.
                args.extend(["-loop", "1", "-framerate", f"{project.fps:g}", "-t", f"{clip.duration:.6f}", "-i", str(media_path)])
            else:
                args.extend(["-i", str(media_path)])
            if visual:
                visual_clips.append((track_index[track.id], clip))
            if audio:
                audio_clips.append((track_index[track.id], clip))

        graph: list[str] = []
        base = "base0"
        graph.append(
            f"color=c=black:s={settings.width}x{settings.height}:r={settings.fps:g}:d={duration:.6f},format=rgba[{base}]"
        )
        current_base = base
        visual_order = {track.id: idx for idx, track in enumerate(project.tracks)}
        visual_clips.sort(key=lambda item: (item[0], item[1].start, item[1].id))
        composite_index = 0
        for _, clip in visual_clips:
            input_index = clip_input[clip.id]
            asset = project.asset(clip.media_id)
            source = f"[{input_index}:v:0]"
            label = f"vclip{composite_index}"
            source_duration = clip.source_duration
            timeline_duration = clip.duration
            chain = [
                f"trim=start={clip.source_in:.6f}:duration={source_duration:.6f}",
                f"setpts=(PTS-STARTPTS)/{clip.playback_rate:.6f}",
                f"fps={settings.fps:g}",
            ]
            effects = clip.effects or {}
            brightness = float(effects.get("brightness", 0.0) or 0.0) + float(effects.get("exposure", 0.0) or 0.0) * 0.12
            contrast = float(effects.get("contrast", 1.0) or 1.0)
            saturation = float(effects.get("saturation", 1.0) or 1.0)
            if abs(brightness) > 1e-6 or abs(contrast - 1) > 1e-6 or abs(saturation - 1) > 1e-6:
                chain.append(f"eq=brightness={brightness:.5f}:contrast={contrast:.5f}:saturation={saturation:.5f}")
            if effects.get("chroma_key"):
                color = str(effects.get("chroma_color", "0x00ff00")).lstrip("#")
                if len(color) == 6:
                    color = "0x" + color
                similarity = min(1.0, max(0.01, float(effects.get("chroma_similarity", 0.25))))
                blend = min(1.0, max(0.0, float(effects.get("chroma_blend", 0.08))))
                chain.append(f"colorkey={color}:{similarity:.3f}:{blend:.3f}")
            lut_path = str(effects.get("lut_path", "")).strip()
            if lut_path:
                if not Path(lut_path).is_file():
                    raise ExportError(f"LUT file is missing: {lut_path}")
                chain.append(f"lut3d=file='{cls._escape_filter_path(lut_path)}'")
            scale = min(8.0, max(0.05, clip.scale))
            chain.append(f"scale={settings.width}:{settings.height}:force_original_aspect_ratio=decrease")
            crop = effects.get("crop", {})
            crop_left = min(0.95, max(0.0, float(crop.get("left", 0.0))))
            crop_top = min(0.95, max(0.0, float(crop.get("top", 0.0))))
            crop_width = min(1.0 - crop_left, max(0.05, float(crop.get("width", 1.0))))
            crop_height = min(1.0 - crop_top, max(0.05, float(crop.get("height", 1.0))))
            if crop_left > 0 or crop_top > 0 or crop_width < 0.999 or crop_height < 0.999:
                chain.append(
                    f"crop=w=trunc(iw*{crop_width:.6f}/2)*2:h=trunc(ih*{crop_height:.6f}/2)*2:"
                    f"x=trunc(iw*{crop_left:.6f}/2)*2:y=trunc(ih*{crop_top:.6f}/2)*2"
                )
            chain.extend([
                f"scale=trunc(iw*{scale:.6f}/2)*2:trunc(ih*{scale:.6f}/2)*2",
                "format=rgba",
            ])
            if abs(clip.rotation) > 1e-5:
                radians = math.radians(clip.rotation)
                chain.append(f"rotate={radians:.9f}:ow=rotw(iw):oh=roth(ih):c=black@0")
            chain.append(f"colorchannelmixer=aa={clip.opacity:.5f}")
            if clip.fade_in > 0:
                chain.append(f"fade=t=in:st=0:d={min(clip.fade_in, timeline_duration):.5f}:alpha=1")
            if clip.fade_out > 0:
                fade_start = max(0.0, timeline_duration - clip.fade_out)
                chain.append(f"fade=t=out:st={fade_start:.5f}:d={min(clip.fade_out, timeline_duration):.5f}:alpha=1")
            chain.append(f"setpts=PTS-STARTPTS+{clip.start:.6f}/TB")
            graph.append(f"{source}{','.join(chain)}[{label}]")
            next_base = f"base{composite_index + 1}"
            x = f"(W-w)/2+({clip.position_x:.3f})"
            y = f"(H-h)/2+({clip.position_y:.3f})"
            graph.append(
                f"[{current_base}][{label}]overlay=x='{x}':y='{y}':eof_action=pass:shortest=0:"
                f"format=auto:enable='between(t,{clip.start:.6f},{clip.end:.6f})'[{next_base}]"
            )
            current_base = next_base
            composite_index += 1

        # Text clips are rendered by libass when available (portable across builds)
        # and by drawtext as a fallback. The title text remains editable project data.
        title_clips = []
        for clip in project.clips:
            if clip.type != "title":
                continue
            track = project.track(clip.track_id)
            if track and track.kind == "video" and track.visible:
                title_clips.append((visual_order[track.id], clip))
        title_clips.sort(key=lambda item: (item[0], item[1].start, item[1].id))
        if title_clips and title_filter == "ass":
            sidecar = Path(titles_path) if titles_path else output.with_name(output.name + ".titles.ass")
            cls.write_ass_titles(project, sidecar)
            label = "titles"
            graph.append(f"[{current_base}]ass=filename='{cls._escape_filter_path(sidecar)}'[{label}]")
            current_base = label
        elif title_clips and title_filter == "drawtext":
            for index, (_, clip) in enumerate(title_clips):
                text = cls._escape_filter_text(clip.title)
                alpha = f"{clip.opacity:.5f}"
                if clip.fade_in > 0:
                    alpha = f"if(lt(t,{clip.start + clip.fade_in:.6f}),({alpha})*(t-{clip.start:.6f})/{clip.fade_in:.6f},{alpha})"
                if clip.fade_out > 0:
                    alpha = f"if(gt(t,{clip.end - clip.fade_out:.6f}),({alpha})*({clip.end:.6f}-t)/{clip.fade_out:.6f},{alpha})"
                label = f"title{index}"
                graph.append(
                    f"[{current_base}]drawtext=font='Arial':text='{text}':fontsize={int(clip.title_size)}:"
                    f"fontcolor='{clip.title_color}':x='(w-text_w)/2+({clip.position_x:.3f})':"
                    f"y='(h-text_h)/2+({clip.position_y:.3f})':alpha='{alpha}':"
                    f"enable='between(t,{clip.start:.6f},{clip.end:.6f})'[{label}]"
                )
                current_base = label
        graph.append(f"[{current_base}]format=yuv420p[outv]")

        audio_labels: list[str] = []
        for index, (_, clip) in enumerate(audio_clips):
            input_index = clip_input[clip.id]
            source_duration = clip.source_duration
            label = f"aclip{index}"
            chain = [
                f"atrim=start={clip.source_in:.6f}:duration={source_duration:.6f}",
                "asetpts=PTS-STARTPTS",
                *cls._atempo(clip.playback_rate),
            ]
            effects = clip.effects or {}
            if effects.get("denoise"):
                strength = min(30.0, max(6.0, float(effects.get("denoise_strength", 18.0))))
                chain.append(f"afftdn=nr={strength:.3f}:nf=-25")
            bass = float(effects.get("bass_db", 0.0) or 0.0)
            treble = float(effects.get("treble_db", 0.0) or 0.0)
            if abs(bass) > 1e-6:
                chain.append(f"equalizer=f=100:width_type=o:width=1:g={bass:.3f}")
            if abs(treble) > 1e-6:
                chain.append(f"equalizer=f=8000:width_type=o:width=1:g={treble:.3f}")
            chain.append(f"volume={max(0.0, clip.volume):.6f}")
            if clip.fade_in > 0:
                chain.append(f"afade=t=in:st=0:d={min(clip.fade_in, clip.duration):.5f}")
            if clip.fade_out > 0:
                chain.append(f"afade=t=out:st={max(0.0, clip.duration - clip.fade_out):.5f}:d={min(clip.fade_out, clip.duration):.5f}")
            delay_ms = max(0, int(round(clip.start * 1000)))
            chain.append(f"adelay={delay_ms}:all=1")
            graph.append(f"[{input_index}:a:0]{','.join(chain)}[{label}]")
            audio_labels.append(label)
        if audio_labels:
            mix_inputs = "".join(f"[{label}]" for label in audio_labels)
            graph.append(
                f"{mix_inputs}amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0:normalize=0,"
                f"apad=whole_dur={duration:.6f},atrim=duration={duration:.6f},aresample={settings.sample_rate}[aout]"
            )
            audio_encoder = {"aac": "aac", "opus": "libopus", "mp3": "libmp3lame", "pcm_s16le": "pcm_s16le"}[settings.audio_codec]
            if audio_encoder not in available:
                raise ExportError(f"The selected FFmpeg build does not include the {audio_encoder} audio encoder.")
            if settings.audio_codec == "opus" and settings.container in {"mp4", "mov"}:
                # Opus-in-MP4 is not consistently supported by consumer players.
                raise ExportError("For broadly compatible MP4/MOV audio, choose AAC; use MKV or WEBM for Opus.")
        if visual_clips and "overlay" not in available_filters:
            raise ExportError("This FFmpeg build does not include the overlay filter required for timeline composition.")
        if any(clip.type != "title" and clip.effects.get("denoise") for clip in project.clips) and "afftdn" not in available_filters:
            raise ExportError("This FFmpeg build does not include afftdn, required by the enabled noise-reduction effect.")
        if any(clip.type != "title" and clip.effects.get("lut_path") for clip in project.clips) and "lut3d" not in available_filters:
            raise ExportError("This FFmpeg build does not include lut3d, required by the selected LUT effect.")
        if any(clip.type != "title" and clip.effects.get("chroma_key") for clip in project.clips) and "colorkey" not in available_filters:
            raise ExportError("This FFmpeg build does not include the colorkey filter required by chroma key.")

        args.extend(["-filter_complex", ";".join(graph), "-map", "[outv]"])
        if audio_labels:
            args.extend(["-map", "[aout]"])
        else:
            args.append("-an")
        args.extend(["-t", f"{duration:.6f}", "-r", f"{settings.fps:g}", "-c:v", encoder])
        if hardware:
            args.extend(["-preset", "p5"])
            if settings.quality_mode:
                args.extend(["-cq", str(settings.quality), "-b:v", "0"])
            else:
                args.extend(["-b:v", f"{settings.bitrate_kbps}k"])
        elif settings.video_codec == "h264":
            args.extend(["-preset", "medium"])
            if settings.quality_mode:
                args.extend(["-crf", str(settings.quality)])
            else:
                args.extend(["-b:v", f"{settings.bitrate_kbps}k"])
        elif settings.video_codec == "h265":
            args.extend(["-preset", "medium"])
            if settings.quality_mode:
                args.extend(["-crf", str(settings.quality)])
            else:
                args.extend(["-b:v", f"{settings.bitrate_kbps}k"])
        else:
            args.extend(["-deadline", "good", "-cpu-used", "2"])
            if settings.quality_mode:
                args.extend(["-crf", str(settings.quality), "-b:v", "0"])
            else:
                args.extend(["-b:v", f"{settings.bitrate_kbps}k"])
        args.extend(["-pix_fmt", "yuv420p"])
        if audio_labels:
            if settings.audio_codec == "aac":
                args.extend(["-c:a", "aac", "-b:a", f"{settings.audio_bitrate_kbps}k"])
            elif settings.audio_codec == "opus":
                args.extend(["-c:a", "libopus", "-b:a", f"{settings.audio_bitrate_kbps}k"])
            elif settings.audio_codec == "mp3":
                args.extend(["-c:a", "libmp3lame", "-b:a", f"{settings.audio_bitrate_kbps}k"])
            elif settings.audio_codec == "pcm_s16le":
                args.extend(["-c:a", "pcm_s16le"])
            args.extend(["-ar", str(settings.sample_rate)])
        if settings.container in {"mp4", "mov"}:
            args.extend(["-movflags", "+faststart"])
        args.extend(["-f", settings.container, str(output)])
        return args


def format_eta(seconds: float) -> str:
    if not math.isfinite(seconds) or seconds < 0:
        return "calculating…"
    seconds = int(seconds)
    if seconds >= 3600:
        return f"{seconds // 3600}h {(seconds % 3600) // 60:02d}m remaining"
    if seconds >= 60:
        return f"{seconds // 60}m {seconds % 60:02d}s remaining"
    return f"{seconds}s remaining"


class ExportThread(QThread):
    progress = Signal(int, str)
    log_line = Signal(str)
    succeeded = Signal(str)
    failed = Signal(str)

    def __init__(self, project: Project, settings: ExportSettings, ffmpeg_path: str = ""):
        super().__init__()
        self.project = project
        self.settings = settings
        self.ffmpeg_path = ffmpeg_path
        self._cancel = threading.Event()
        self._process: subprocess.Popen | None = None
        self._start_time = 0.0

    def cancel(self) -> None:
        self._cancel.set()
        process = self._process
        if process and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass

    def _run(self, command: list[str], output_duration: float) -> tuple[int, str]:
        try:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, errors="replace", bufsize=1)
        except OSError as exc:
            raise ExportError(f"Could not start FFmpeg: {exc}") from exc
        self._process = process
        log: list[str] = []
        for raw in iter(process.stdout.readline, "") if process.stdout else []:
            line = raw.rstrip()
            if not line:
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                if key in {"out_time_ms", "out_time_us"}:
                    try:
                        media_time = int(value) / 1_000_000.0
                        percent = min(99, max(0, int(media_time * 100 / max(output_duration, 0.01))))
                        elapsed = max(0.01, time.monotonic() - self._start_time)
                        eta = format_eta(elapsed * max(0, 100 - percent) / max(percent, 1))
                        self.progress.emit(percent, eta)
                    except ValueError:
                        pass
                elif key == "progress" and value == "end":
                    self.progress.emit(100, "Finishing file…")
                elif key in {"speed", "frame", "fps"}:
                    continue
            else:
                log.append(line)
                if len(log) > 100:
                    log.pop(0)
                self.log_line.emit(line[-400:])
            if self._cancel.is_set() and process.poll() is None:
                process.terminate()
        try:
            code = process.wait(timeout=8 if self._cancel.is_set() else None)
        except subprocess.TimeoutExpired:
            process.kill()
            code = process.wait()
        self._process = None
        return code, "\n".join(log[-50:])

    def run(self) -> None:
        target = Path(self.settings.output_path).expanduser().resolve()
        suffix = target.suffix or f".{self.settings.container}"
        temp = target.with_name(target.stem + ".novacut-render" + suffix)
        title_sidecar = temp.with_name(temp.name + ".titles.ass")
        try:
            self.settings.output_path = str(target)
            self.settings.validate()
            binary = self.ffmpeg_path or find_ffmpeg()
            if not binary:
                raise ExportError("FFmpeg was not found. Install FFmpeg or choose its executable in Settings.")
            capabilities = ffmpeg_capabilities(binary)
            duration = self.project.duration
            requested_hw = self.settings.use_hardware
            attempts = [requested_hw, False] if requested_hw else [False]
            last_error = ""
            self._start_time = time.monotonic()
            for attempt_index, use_hw in enumerate(attempts):
                if self._cancel.is_set():
                    raise InterruptedError("Export cancelled")
                temp.unlink(missing_ok=True)
                attempt_settings = ExportSettings(**{**self.settings.__dict__, "use_hardware": use_hw})
                command = FFmpegCommandBuilder.build(
                    self.project, attempt_settings, binary, capabilities["encoders"], str(temp),
                    filters=capabilities["filters"], titles_path=title_sidecar,
                )
                self.log_line.emit("Starting FFmpeg render" + (" (hardware encoder)" if use_hw else " (CPU encoder)"))
                code, details = self._run(command, duration)
                if self._cancel.is_set():
                    raise InterruptedError("Export cancelled")
                if code == 0 and temp.is_file() and temp.stat().st_size > 0:
                    os.replace(temp, target)
                    self.progress.emit(100, "Complete")
                    self.succeeded.emit(str(target))
                    return
                last_error = details or f"FFmpeg exited with code {code}"
                if requested_hw and use_hw and attempt_index + 1 < len(attempts):
                    self.log_line.emit("Hardware encoding failed; retrying this render with the CPU encoder.")
                    continue
                raise ExportError(last_error)
        except InterruptedError:
            self.failed.emit("Export cancelled by user.")
        except Exception as exc:
            self.failed.emit(str(exc))
        finally:
            temp.unlink(missing_ok=True)
            title_sidecar.unlink(missing_ok=True)

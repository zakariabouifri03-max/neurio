"""Optional, explicitly local AI integrations and model installation helpers.

No model is downloaded during startup or feature discovery. Network access is
only used by download_model after an explicit user action, or when contacting a
loopback-only Ollama service selected by the user.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Callable
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .media import find_ffmpeg
from .models import MediaAsset
from .project import app_data_dir, cache_dir


@dataclass(frozen=True)
class ModelSpec:
    key: str
    name: str
    category: str
    size_bytes: int
    filename: str
    url: str
    license_note: str
    resources: str


WHISPER_SIZES = {
    "tiny": (75, "~1 GB RAM, fastest"),
    "base": (142, "~1 GB RAM, balanced"),
    "small": (466, "~2 GB RAM, better accuracy"),
    "medium": (1500, "~5 GB RAM, slower"),
}
MODEL_CATALOG: tuple[ModelSpec, ...] = tuple(
    ModelSpec(
        key=f"whisper-{size}", name=f"Whisper.cpp · {size.title()}", category="transcription",
        size_bytes=mb * 1024 * 1024, filename=f"ggml-{size}.bin",
        url=f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{size}.bin?download=true",
        license_note="Whisper model weights are obtained from the upstream Whisper.cpp model repository; review upstream model terms before use.",
        resources=resource,
    )
    for size, (mb, resource) in WHISPER_SIZES.items()
) + (
    ModelSpec(
        key="u2net", name="U²-Net · background removal", category="segmentation",
        size_bytes=176 * 1024 * 1024, filename="u2net.onnx",
        url="https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
        license_note="Optional upstream U²-Net checkpoint; verify the upstream repository/model terms before redistribution.",
        resources="~2 GB RAM; CPU processing can be slow",
    ),
)


def model_root() -> Path:
    return app_data_dir() / "models"


def model_path(key: str) -> Path:
    spec = next((item for item in MODEL_CATALOG if item.key == key), None)
    if not spec:
        raise ValueError(f"Unknown model: {key}")
    if key.startswith("whisper-"):
        return model_root() / "whisper" / spec.filename
    if key == "u2net":
        return model_root() / "rembg" / spec.filename
    return model_root() / spec.filename


def download_model(
    key: str,
    progress: Callable[[int, str], None] | None = None,
    cancel_event=None,
    timeout: int = 45,
) -> Path:
    """Download one catalogued model after explicit confirmation by the UI.

    The partial file is kept beside the final file while downloading and removed
    if the request fails or is cancelled. An approximate size check prevents
    starting when the target volume is clearly too small.
    """
    spec = next((item for item in MODEL_CATALOG if item.key == key), None)
    if not spec:
        raise ValueError(f"Unknown model: {key}")
    target = model_path(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(target.parent).free
    required = int(spec.size_bytes * 1.12) + 64 * 1024 * 1024
    if free < required:
        raise OSError(
            f"Not enough free disk space for {spec.name}. Available: {free / 1024**3:.2f} GB; "
            f"recommended: {required / 1024**3:.2f} GB."
        )
    if target.is_file() and target.stat().st_size > spec.size_bytes * 0.8:
        if progress:
            progress(100, "Model already installed")
        return target
    partial = target.with_suffix(target.suffix + ".download")
    headers = {"User-Agent": "NovaCut-AI-Studio/0.1 (explicit local model download)"}
    request = Request(spec.url, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response, partial.open("wb") as output:
            content_length = int(response.headers.get("Content-Length", "0") or 0)
            total = content_length or spec.size_bytes
            downloaded = 0
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise InterruptedError("Model download cancelled")
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                percent = min(99, int(downloaded * 100 / total)) if total else 0
                if progress:
                    progress(percent, f"{downloaded / 1024**2:.1f} MB / ~{total / 1024**2:.0f} MB")
            output.flush()
            os.fsync(output.fileno())
        if partial.stat().st_size < spec.size_bytes * 0.8:
            raise OSError(
                f"The download is smaller than expected ({partial.stat().st_size / 1024**2:.1f} MB). "
                "The upstream file may have changed or the connection was interrupted."
            )
        partial.replace(target)
        if progress:
            progress(100, "Download complete")
        return target
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def find_whisper_cli(configured: str = "") -> str | None:
    if configured and Path(configured).is_file():
        return str(Path(configured).resolve())
    for name in ("whisper-cli.exe", "whisper-cli", "main.exe", "main"):
        found = shutil.which(name)
        if found:
            return found
    return None


def whisper_availability(configured_cli: str = "") -> tuple[bool, str, Path | None]:
    executable = find_whisper_cli(configured_cli)
    if not executable:
        return False, "whisper-cli was not found. Install Whisper.cpp separately; no executable is bundled.", None
    local_models = [model_path(f"whisper-{size}") for size in WHISPER_SIZES]
    installed = next((path for path in local_models if path.is_file() and path.stat().st_size > 10_000_000), None)
    if not installed:
        return False, "No local Whisper model is installed. Open Model Manager to choose and download one.", None
    return True, f"Ready · {Path(executable).name} · {installed.name}", installed


@dataclass
class SubtitleSegment:
    start: float
    end: float
    text: str


def _timestamp(value: str) -> float:
    hours, minutes, rest = value.strip().replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(rest)


def parse_srt(path: str | Path) -> list[SubtitleSegment]:
    text = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    segments: list[SubtitleSegment] = []
    blocks = text.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n\n")
    for block in blocks:
        lines = block.splitlines()
        time_line = next((line for line in lines if "-->" in line), "")
        if not time_line:
            continue
        left, right = (part.strip().split(" ", 1)[0] for part in time_line.split("-->", 1))
        try:
            start, end = _timestamp(left), _timestamp(right)
        except (ValueError, IndexError):
            continue
        index = lines.index(time_line)
        caption = "\n".join(lines[index + 1:]).strip()
        if caption and end > start:
            segments.append(SubtitleSegment(start, end, caption))
    return segments


def format_srt_time(value: float) -> str:
    millis = max(0, int(round(value * 1000)))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def format_vtt_time(value: float) -> str:
    return format_srt_time(value).replace(",", ".")


def export_subtitles(project, path: str | Path, fmt: str | None = None) -> Path:
    target = Path(path).expanduser().resolve()
    fmt = (fmt or target.suffix.lstrip(".") or "srt").lower()
    if fmt not in {"srt", "vtt"}:
        raise ValueError("Subtitle export format must be SRT or VTT")
    cues = []
    for clip in project.clips:
        if clip.type == "title":
            cues.append((clip.start, clip.end, clip.title))
    cues.sort(key=lambda cue: (cue[0], cue[1]))
    lines: list[str] = ["WEBVTT", ""] if fmt == "vtt" else []
    for index, (start, end, content) in enumerate(cues, 1):
        if fmt == "srt":
            lines.extend((str(index), f"{format_srt_time(start)} --> {format_srt_time(end)}", content, ""))
        else:
            lines.extend((f"{format_vtt_time(start)} --> {format_vtt_time(end)}", content, ""))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")
    return target


def _run_checked(command: list[str], progress: Callable[[str], None] | None = None, cancel_event=None, env=None) -> str:
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", env=env)
    except OSError as exc:
        raise RuntimeError(f"Could not start {Path(command[0]).name}: {exc}") from exc
    output: list[str] = []
    while True:
        if cancel_event is not None and cancel_event.is_set():
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
            raise InterruptedError("Local AI task cancelled")
        line = process.stdout.readline() if process.stdout else ""
        if line:
            output.append(line.rstrip())
            if progress:
                progress(line.rstrip()[-300:])
        elif process.poll() is not None:
            break
        else:
            time.sleep(0.05)
    code = process.wait()
    details = "\n".join(output[-50:])
    if code != 0:
        raise RuntimeError(details or f"Local AI process returned exit code {code}")
    return details


def transcribe_local(
    media: MediaAsset,
    size: str = "tiny",
    ffmpeg_path: str | None = None,
    whisper_cli: str = "",
    progress: Callable[[str], None] | None = None,
    cancel_event=None,
) -> list[SubtitleSegment]:
    if size not in WHISPER_SIZES:
        raise ValueError("Choose a supported Whisper model size")
    cli = find_whisper_cli(whisper_cli)
    model = model_path(f"whisper-{size}")
    if not cli:
        raise RuntimeError("whisper-cli is not installed. See the Local AI dependencies panel.")
    if not model.is_file():
        raise RuntimeError(f"The local Whisper {size} model is missing. Use Model Manager to install it first.")
    if not media.has_audio:
        raise RuntimeError("The selected media has no audio stream")
    ffmpeg = ffmpeg_path or find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required to prepare audio for Whisper transcription")
    output_dir = cache_dir() / "transcriptions"
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="novacut-whisper-") as folder:
        wav = Path(folder) / "input.wav"
        prefix = Path(output_dir) / f"{Path(media.path).stem}-{time.time_ns()}"
        _run_checked(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", media.path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
            progress, cancel_event,
        )
        _run_checked(
            [cli, "-m", str(model), "-f", str(wav), "-l", "auto", "-osrt", "-of", str(prefix)],
            progress, cancel_event,
        )
        result_file = Path(str(prefix) + ".srt")
        if not result_file.is_file():
            raise RuntimeError("Whisper completed but did not produce an SRT file")
        return parse_srt(result_file)


def background_remove_image(
    media: MediaAsset,
    output_path: str | Path,
    progress: Callable[[str], None] | None = None,
) -> Path:
    """Run rembg on a still image using the explicitly installed local U²-Net model."""
    if media.kind != "image":
        raise RuntimeError("This first version removes backgrounds from still images only; video masking is not yet implemented.")
    checkpoint = model_path("u2net")
    if not checkpoint.is_file():
        raise RuntimeError("The local U²-Net model is missing. Use Model Manager to install it first.")
    os.environ["U2NET_HOME"] = str(checkpoint.parent)
    try:
        from PIL import Image
        from rembg import new_session, remove
    except ImportError as exc:
        raise RuntimeError("Install the optional rembg and Pillow packages to use local background removal.") from exc
    if progress:
        progress("Loading local U²-Net model (CPU)")
    session = new_session("u2net", providers=["CPUExecutionProvider"])
    with Image.open(media.path) as image:
        result = remove(image.convert("RGBA"), session=session)
    target = Path(output_path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    result.save(target, format="PNG")
    return target


def _require_loopback(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("NovaCut's local assistant only connects to localhost/loopback Ollama addresses.")
    return base_url.rstrip("/")


def ollama_models(base_url: str = "http://127.0.0.1:11434") -> list[str]:
    base = _require_loopback(base_url)
    request = Request(base + "/api/tags", headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=3) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("Ollama is not responding on this computer. Start Ollama and install a local model.") from exc
    return [str(item.get("name", "")) for item in data.get("models", []) if item.get("name")]


def ask_local_ollama(
    prompt: str,
    model: str,
    project_summary: str,
    base_url: str = "http://127.0.0.1:11434",
    cancel_event=None,
) -> str:
    base = _require_loopback(base_url)
    if not model.strip():
        raise ValueError("Choose an installed Ollama model first")
    data = {
        "model": model,
        "stream": False,
        "prompt": (
            "You are NovaCut's offline editing assistant. Give clear, concise suggestions and explanations. "
            "You are advisory only: never claim to have changed the timeline.\n\n"
            f"Project summary: {project_summary}\n\nUser question: {prompt}\n\n"
            "Answer with suggestions only; the user must make and confirm all edits."
        ),
        "options": {"temperature": 0.3},
    }
    request = Request(base + "/api/generate", data=json.dumps(data).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    if cancel_event is not None and cancel_event.is_set():
        raise InterruptedError("Assistant request cancelled")
    try:
        with urlopen(request, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Local Ollama request failed: {exc}") from exc
    return str(result.get("response", "")).strip() or "The local model returned an empty response."
